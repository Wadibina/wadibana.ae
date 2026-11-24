'use strict';

const { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp({ databaseURL: 'https://wadi-bana-b585b-default-rtdb.firebaseio.com' });

const database = getDatabase();
const scryptAsync = promisify(scrypt);
const PASSWORD_LENGTH_MIN = 12;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const BRANCHES = new Set(['ajman', 'abudhabi', 'ain', 'muscat', 'yemen']);
const ROLE_CODES = new Set([
  'owner', 'it_admin', 'gm', 'chief_accountant',
  'branch_manager_accountant', 'branch_manager',
  'branch_accountant', 'employee'
]);
const ALL_BRANCH_ROLES = new Set(['owner', 'it_admin', 'gm', 'chief_accountant']);
const USERNAME_PATTERN = /^[\p{L}\p{N}_. -]{3,64}$/u;

function usernameKey(username) {
  const normalized = String(username || '').trim().toLocaleLowerCase('en-US');
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new HttpsError('invalid-argument', 'اسم المستخدم غير صالح.');
  }
  return createHash('sha256').update(normalized).digest('hex');
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').replace(/^00/, '');
}

function safeProfile(profile, uid) {
  if (!profile || profile.active !== true) {
    throw new HttpsError('permission-denied', 'الحساب غير مفعل.');
  }
  return { ...profile, uid };
}

async function getActiveProfile(uid) {
  const snapshot = await database.ref(`users/${uid}`).get();
  return safeProfile(snapshot.val(), uid);
}

async function ensureAuthUser(uid) {
  try {
    return await getAuth().getUser(uid);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    return getAuth().createUser({ uid });
  }
}

async function requireActor(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'سجّل الدخول أولاً.');
  }
  const profile = await getActiveProfile(request.auth.uid);
  if (Number(request.auth.token.auth_time || 0) < Number(profile.tokenValidAfter || 0)
      || request.auth.token.role !== profile.role
      || request.auth.token.branchId !== profile.branchId) {
    throw new HttpsError('unauthenticated', 'انتهت صلاحية الجلسة. سجّل الدخول مجدداً.');
  }
  return profile;
}

function canManageUsers(actor, targetRole, targetBranch) {
  if (actor.role === 'owner') return true;
  if (actor.role === 'it_admin') return targetRole !== 'owner';
  if (actor.role === 'gm') return !['owner', 'it_admin', 'gm'].includes(targetRole);
  return ['branch_manager', 'branch_manager_accountant'].includes(actor.role)
    && targetRole === 'employee'
    && targetBranch === actor.branchId;
}

function validateProfileInput(input, actor, previous = null) {
  const role = String(input.role || previous?.role || 'employee');
  const branchId = String(input.branchId || previous?.branchId || actor.branchId || 'ajman');
  const username = String(input.username || previous?.username || '').trim();
  const fullName = String(input.fullName || previous?.fullName || username).trim();
  const phone = String(input.phone || '').trim();
  if (!ROLE_CODES.has(role) || !BRANCHES.has(branchId) && branchId !== 'all') {
    throw new HttpsError('invalid-argument', 'الدور أو الفرع غير صالح.');
  }
  if (!canManageUsers(actor, role, branchId)) {
    throw new HttpsError('permission-denied', 'لا تملك صلاحية إدارة هذا الحساب.');
  }
  usernameKey(username);
  if (fullName.length < 1 || fullName.length > 100 || phone.length > 40) {
    throw new HttpsError('invalid-argument', 'بيانات الحساب غير صالحة.');
  }
  if (branchId === 'all' && !ALL_BRANCH_ROLES.has(role)) {
    throw new HttpsError('invalid-argument', 'لا يمكن إسناد هذا الدور إلى جميع الفروع.');
  }
  if (previous?.role === 'owner' && actor.role !== 'owner') {
    throw new HttpsError('permission-denied', 'إدارة حساب المالك متاحة للمالك فقط.');
  }
  return {
    username,
    fullName,
    phone,
    role,
    branchId,
    active: input.active === undefined ? previous?.active !== false : input.active === true,
    hidden: input.hidden === undefined ? previous?.hidden === true : input.hidden === true
  };
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64, SCRYPT_OPTIONS);
  return { scheme: 'scrypt', salt: salt.toString('hex'), hash: Buffer.from(hash).toString('hex') };
}

async function verifyPassword(password, credential) {
  if (!credential || typeof credential.hash !== 'string') return false;
  if (credential.scheme === 'sha256') {
    const candidate = createHash('sha256').update(password).digest('hex');
    const expected = Buffer.from(credential.hash, 'hex');
    const actual = Buffer.from(candidate, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  if (credential.scheme !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(credential.salt)) return false;
  const expected = Buffer.from(credential.hash, 'hex');
  const actual = Buffer.from(await scryptAsync(password, Buffer.from(credential.salt, 'hex'), expected.length, SCRYPT_OPTIONS));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function claimUsername(key, uid) {
  const result = await database.ref(`usernameIndex/${key}`).transaction(current => current == null || current === uid ? uid : undefined);
  if (!result.committed) throw new HttpsError('already-exists', 'اسم المستخدم مستخدم بالفعل.');
}

async function applyProfileUpdate(uid, profile, credential = undefined, previousUsername = null) {
  const key = usernameKey(profile.username);
  const previousKey = previousUsername ? usernameKey(previousUsername) : null;
  if (previousKey !== key) await claimUsername(key, uid);
  const updates = {
    [`users/${uid}`]: profile,
    [`usernameIndex/${key}`]: uid
  };
  if (previousKey && previousKey !== key) updates[`usernameIndex/${previousKey}`] = null;
  if (credential) updates[`authCredentials/${uid}`] = credential;
  try {
    await database.ref().update(updates);
  } catch (error) {
    if (previousKey !== key) {
      await database.ref(`usernameIndex/${key}`).transaction(current => current === uid ? null : current);
    }
    throw error;
  }
}

async function writeAuditEntry(actor, action, targetUsername, details = {}) {
  const logRef = database.ref('systemAuditLogs').push();
  await logRef.set({
    uid: actor.uid,
    actor: actor.fullName || actor.username,
    actorUsername: actor.username,
    action,
    targetUsername: String(targetUsername || '').slice(0, 64),
    details,
    timestamp: Date.now()
  });
}

exports.loginWithUsername = onCall(async request => {
  const username = String(request.data?.username || '').trim();
  const password = String(request.data?.password || '');
  const key = usernameKey(username);
  if (!password || password.length > 256) {
    throw new HttpsError('unauthenticated', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
  }

  const ip = request.rawRequest.ip || 'unknown';
  const attemptKey = createHash('sha256').update(`${ip}:${key}`).digest('hex');
  const attemptRef = database.ref(`loginAttempts/${attemptKey}`);
  const now = Date.now();
  const attempt = await attemptRef.transaction(current => {
    if (!current || current.windowStartedAt < now - 15 * 60 * 1000) {
      return { windowStartedAt: now, count: 1 };
    }
    return { ...current, count: current.count + 1 };
  });
  if ((attempt.snapshot.val()?.count || 0) > 10) {
    throw new HttpsError('resource-exhausted', 'محاولات كثيرة. حاول بعد 15 دقيقة.');
  }

  const uidSnapshot = await database.ref(`usernameIndex/${key}`).get();
  const uid = uidSnapshot.val();
  if (!uid) throw new HttpsError('unauthenticated', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
  const [profileSnapshot, credentialSnapshot] = await Promise.all([
    database.ref(`users/${uid}`).get(),
    database.ref(`authCredentials/${uid}`).get()
  ]);
  const profile = profileSnapshot.val();
  const credential = credentialSnapshot.val();
  if (!profile || profile.active !== true || profile.username?.toLocaleLowerCase('en-US') !== username.toLocaleLowerCase('en-US')
      || !await verifyPassword(password, credential)) {
    throw new HttpsError('unauthenticated', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
  }

  if (credential.scheme === 'sha256') {
    await database.ref(`authCredentials/${uid}`).set(await hashPassword(password));
  }
  await ensureAuthUser(uid);
  await getAuth().setCustomUserClaims(uid, { role: profile.role, branchId: profile.branchId });
  await attemptRef.remove();
  return {
    token: await getAuth().createCustomToken(uid, { role: profile.role, branchId: profile.branchId })
  };
});

exports.changeOwnPassword = onCall(async request => {
  const actor = await requireActor(request);
  const password = String(request.data?.password || '');
  if (password.length < PASSWORD_LENGTH_MIN || password.length > 256) {
    throw new HttpsError('invalid-argument', `يجب أن تتكون كلمة المرور من ${PASSWORD_LENGTH_MIN} أحرف على الأقل.`);
  }
  await writeAuditEntry(actor, 'CHANGE_PASSWORD', actor.username);
  await database.ref(`authCredentials/${actor.uid}`).set(await hashPassword(password));
  await database.ref(`users/${actor.uid}/tokenValidAfter`).set(Math.floor(Date.now() / 1000) + 1);
  await getAuth().revokeRefreshTokens(actor.uid);
  return { success: true };
});

exports.createManagedUser = onCall(async request => {
  const actor = await requireActor(request);
  const input = request.data || {};
  const profile = validateProfileInput(input, actor);
  const password = String(input.password || '');
  if (password.length < PASSWORD_LENGTH_MIN || password.length > 256) {
    throw new HttpsError('invalid-argument', `يجب أن تتكون كلمة المرور من ${PASSWORD_LENGTH_MIN} أحرف على الأقل.`);
  }
  const uid = randomUUID();
  const key = usernameKey(profile.username);
  const credential = await hashPassword(password);
  await claimUsername(key, uid);
  try {
    await getAuth().createUser({ uid, disabled: !profile.active });
    await getAuth().setCustomUserClaims(uid, { role: profile.role, branchId: profile.branchId });
    await database.ref().update({
      [`users/${uid}`]: { ...profile, tokenValidAfter: 0 },
      [`authCredentials/${uid}`]: credential,
      [`usernameIndex/${key}`]: uid
    });
  } catch (error) {
    const cleanupErrors = [];
    try {
      await database.ref(`usernameIndex/${key}`).transaction(current => current === uid ? null : current);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      await getAuth().deleteUser(uid);
    } catch (cleanupError) {
      if (cleanupError.code !== 'auth/user-not-found') cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length) console.error('Managed-user creation rollback was incomplete.', cleanupErrors);
    throw error;
  }
  await writeAuditEntry(actor, 'CREATE_USER', profile.username, { role: profile.role, branchId: profile.branchId });
  return { uid };
});

exports.updateManagedUser = onCall(async request => {
  const actor = await requireActor(request);
  const uid = String(request.data?.uid || '');
  if (!uid) throw new HttpsError('invalid-argument', 'معرّف الحساب مطلوب.');
  const userRef = database.ref(`users/${uid}`);
  const previousSnapshot = await userRef.get();
  if (!previousSnapshot.exists()) throw new HttpsError('not-found', 'الحساب غير موجود.');
  const previous = previousSnapshot.val();
  const profile = validateProfileInput(request.data, actor, previous);
  if (actor.uid === uid && profile.active === false) {
    throw new HttpsError('failed-precondition', 'لا يمكنك إيقاف حسابك أثناء استخدامه.');
  }
  let credential;
  if (request.data.password) {
    const password = String(request.data.password);
    if (password.length < PASSWORD_LENGTH_MIN || password.length > 256) {
      throw new HttpsError('invalid-argument', `يجب أن تتكون كلمة المرور من ${PASSWORD_LENGTH_MIN} أحرف على الأقل.`);
    }
    credential = await hashPassword(password);
  }
  const authorizationChanged = profile.role !== previous.role
    || profile.branchId !== previous.branchId
    || profile.active !== (previous.active === true);
  profile.tokenValidAfter = authorizationChanged
    ? Math.floor(Date.now() / 1000) + 1
    : Number(previous.tokenValidAfter || 0);
  await applyProfileUpdate(uid, profile, credential, previous.username);
  await ensureAuthUser(uid);
  await getAuth().setCustomUserClaims(uid, { role: profile.role, branchId: profile.branchId });
  await getAuth().updateUser(uid, { disabled: !profile.active });
  if (authorizationChanged) await getAuth().revokeRefreshTokens(uid);
  await writeAuditEntry(actor, 'UPDATE_PERMISSIONS', profile.username, {
    from: { username: previous.username, role: previous.role, branchId: previous.branchId },
    to: { username: profile.username, role: profile.role, branchId: profile.branchId, active: profile.active }
  });
  return { success: true };
});

exports.deleteManagedUser = onCall(async request => {
  const actor = await requireActor(request);
  const uid = String(request.data?.uid || '');
  if (!uid || uid === actor.uid) throw new HttpsError('failed-precondition', 'لا يمكنك حذف حسابك الحالي.');
  const userRef = database.ref(`users/${uid}`);
  const snapshot = await userRef.get();
  if (!snapshot.exists()) return { success: true };
  const profile = snapshot.val();
  if (!canManageUsers(actor, profile.role, profile.branchId) || profile.role === 'owner' && actor.role !== 'owner') {
    throw new HttpsError('permission-denied', 'لا تملك صلاحية حذف هذا الحساب.');
  }
  const key = usernameKey(profile.username);
  await writeAuditEntry(actor, 'REMOVE_USER_PROFILE', profile.username, { uid });
  await database.ref().update({
    [`users/${uid}`]: null,
    [`authCredentials/${uid}`]: null,
    [`usernameIndex/${key}`]: null
  });
  await getAuth().deleteUser(uid).catch(error => {
    if (error.code !== 'auth/user-not-found') throw error;
  });
  return { success: true };
});

exports.requestPasswordReset = onCall(async request => {
  const username = String(request.data?.username || '').trim();
  const phone = normalizePhone(request.data?.phone);
  const key = usernameKey(username);
  const uid = (await database.ref(`usernameIndex/${key}`).get()).val();
  const profile = uid ? (await database.ref(`users/${uid}`).get()).val() : null;
  if (profile?.active === true && phone && normalizePhone(profile.phone) === phone) {
    const requestRef = database.ref('passwordResetRequests').push();
    await requestRef.set({
      uid,
      username: profile.username,
      phone: profile.phone,
      status: 'pending',
      requestedAt: Date.now()
    });
  }
  return { success: true };
});

exports.recordTicketCheckIn = onCall(async request => {
  const actor = await requireActor(request);
  const ticketId = String(request.data?.ticketId || '').trim();
  if (!ticketId || ticketId.length > 64) throw new HttpsError('invalid-argument', 'رقم التذكرة غير صالح.');
  const branchId = actor.branchId;
  if (!BRANCHES.has(branchId)) {
    throw new HttpsError('permission-denied', 'يجب استخدام حساب تابع لفرع محدد لمسح التذكرة.');
  }
  const passengers = (await database.ref(`systemUnifiedData/${branchId}/passengers`).get()).val() || [];
  const records = Array.isArray(passengers) ? passengers : Object.values(passengers);
  const ticket = records.find(record => record && String(record.id) === ticketId);
  if (!ticket) throw new HttpsError('not-found', 'التذكرة غير موجودة في فرعك.');

  const checkInKey = createHash('sha256').update(`${branchId}:${ticketId}`).digest('hex');
  const recordRef = database.ref(`ticketCheckIns/${checkInKey}`);
  const result = await recordRef.transaction(current => current == null ? {
    ticketId,
    tripId: ticket.tripId || '',
    passengerName: ticket.name || '',
    tripDate: ticket.date || '',
    checkedInBy: actor.fullName || actor.username,
    checkedInAt: Date.now()
  } : undefined);
  return { committed: result.committed, checkedInBy: result.snapshot.val()?.checkedInBy || null };
});
