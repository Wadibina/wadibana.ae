'use strict';

const { createHash, randomBytes, scryptSync } = require('node:crypto');
const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const databaseURL = 'https://wadi-bana-b585b-default-rtdb.firebaseio.com';
initializeApp({ credential: applicationDefault(), databaseURL });

const database = getDatabase();
const COLLECTIONS = [
  'buses', 'trips', 'drivers', 'employees', 'passengers', 'cargo',
  'vouchers', 'debtInvoices', 'transitVisas'
];
const BRANCH_ALIASES = new Map([
  ['ajman', 'ajman'], ['فرع عجمان', 'ajman'], ['عجمان', 'ajman'],
  ['abudhabi', 'abudhabi'], ['فرع ابوظبي', 'abudhabi'], ['ابوظبي', 'abudhabi'], ['أبوظبي', 'abudhabi'],
  ['ain', 'ain'], ['فرع العين', 'ain'], ['العين', 'ain'],
  ['muscat', 'muscat'], ['oman', 'muscat'], ['فرع عمان', 'muscat'], ['عمان', 'muscat'],
  ['yemen', 'yemen'], ['mukalla', 'yemen'], ['aden', 'yemen'], ['فرع اليمن', 'yemen'], ['اليمن', 'yemen']
]);
const VALID_ROLES = new Set([
  'owner', 'it_admin', 'gm', 'chief_accountant',
  'branch_manager_accountant', 'branch_manager', 'branch_accountant', 'employee'
]);
const USERNAME_PATTERN = /^[\p{L}\p{N}_. -]{3,64}$/u;

function normalizeBranch(record) {
  const raw = String(record?.branchId || record?.branch || '').trim().toLocaleLowerCase('ar').replace(/\s+/g, '');
  return BRANCH_ALIASES.get(raw) || BRANCH_ALIASES.get(String(record?.branch || '').trim()) || null;
}

function usernameIndexKey(username) {
  return createHash('sha256').update(String(username).trim().toLocaleLowerCase('en-US')).digest('hex');
}

function getRecords(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean);
  return [];
}

function migrateData(source) {
  const records = Object.fromEntries(COLLECTIONS.map(name => [name, getRecords(source?.[name])]));
  const ownership = new Map();
  const tripBranches = new Map();
  for (const name of ['passengers', 'cargo']) {
    for (const record of records[name]) {
      const branch = normalizeBranch(record);
      if (branch && record.tripId) {
        const branches = tripBranches.get(String(record.tripId)) || new Set();
        branches.add(branch);
        tripBranches.set(String(record.tripId), branches);
      }
    }
  }
  for (const trip of records.trips) {
    const direct = normalizeBranch(trip);
    const linked = tripBranches.get(String(trip.id));
    const branch = direct || (linked?.size === 1 ? [...linked][0] : 'unassigned');
    ownership.set(`trips:${trip.id}`, branch);
  }

  const partitions = Object.fromEntries([...new Set(['unassigned', ...tripBranches.values()].flatMap(value => value instanceof Set ? [...value] : [value]))]
    .map(branch => [branch, Object.fromEntries(COLLECTIONS.map(name => [name, []]))]));
  if (!partitions.unassigned) partitions.unassigned = Object.fromEntries(COLLECTIONS.map(name => [name, []]));

  for (const name of COLLECTIONS) {
    for (const record of records[name]) {
      let branch = normalizeBranch(record);
      if (!branch && record.tripId) branch = ownership.get(`trips:${record.tripId}`) || 'unassigned';
      if (!branch && name === 'trips') branch = ownership.get(`trips:${record.id}`) || 'unassigned';
      if (!branch) branch = 'unassigned';
      if (!partitions[branch]) partitions[branch] = Object.fromEntries(COLLECTIONS.map(collection => [collection, []]));
      partitions[branch][name].push(record);
      if (name === 'trips') ownership.set(`trips:${record.id}`, branch);
    }
  }

  const meta = {};
  for (const key of ['nextTicketNo', 'nextCargoNo', 'nextDebtInvNo', 'nextTransitNo']) {
    if (source?.[key] !== undefined) meta[key] = source[key];
  }
  partitions.unassigned.meta = meta;
  return partitions;
}

function normalizeUsers(source, trustedUsers, bootstrapPassword) {
  const publicUsers = {};
  const credentials = {};
  const usernameIndex = {};
  const owners = [];
  for (const [uid, value] of Object.entries(source || {})) {
    if (!value || typeof value !== 'object') throw new Error(`User ${uid} has an invalid profile.`);
    const trusted = trustedUsers[uid];
    if (!trusted) throw new Error(`User ${uid} has no verified entry in the user map.`);
    const username = String(trusted.username || '').trim();
    const role = String(trusted.role || '');
    const branchId = trusted.branchId === 'all' ? 'all' : String(trusted.branchId || '');
    if (!USERNAME_PATTERN.test(username) || !VALID_ROLES.has(role)) {
      throw new Error(`User ${uid} has invalid verified profile data.`);
    }
    if (branchId !== 'all' && !['ajman', 'abudhabi', 'ain', 'muscat', 'yemen'].includes(branchId)) {
      throw new Error(`User ${username} has an invalid verified branch.`);
    }
    if (branchId === 'all' && !['owner', 'it_admin', 'gm', 'chief_accountant'].includes(role)) {
      throw new Error(`User ${username} cannot be assigned to all branches.`);
    }
    if (role === 'owner' && branchId !== 'all') {
      throw new Error(`Owner ${username} must be assigned to all branches.`);
    }
    if (role === 'owner') owners.push(uid);
    const key = usernameIndexKey(username);
    if (usernameIndex[key]) throw new Error(`Duplicate username: ${username}.`);
    usernameIndex[key] = uid;
    if (role === 'owner') {
      const salt = randomBytes(16);
      const hash = scryptSync(bootstrapPassword, salt, 64, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 128 * 1024 * 1024
      });
      credentials[uid] = { scheme: 'scrypt', salt: salt.toString('hex'), hash: hash.toString('hex') };
    }
    publicUsers[uid] = {
      username,
      fullName: String(value.fullName || trusted.fullName || username),
      phone: String(value.phone || ''),
      role,
      branchId,
      active: role === 'owner',
      hidden: trusted.hidden === true,
      tokenValidAfter: 0
    };
  }
  if (owners.length !== 1 || bootstrapPassword.length < 12) {
    throw new Error('Provide exactly one verified owner and a BOOTSTRAP_OWNER_PASSWORD of at least 12 characters.');
  }
  if (Object.keys(trustedUsers).length !== Object.keys(source || {}).length) {
    throw new Error('The verified user map must match the existing user records exactly.');
  }
  return { publicUsers, credentials, usernameIndex };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const userMapArgument = process.argv.find(argument => argument.startsWith('--user-map='));
  if (!userMapArgument) throw new Error('Pass --user-map=security-user-map.json with verified UID, username, role, and branch entries.');
  const trustedUsers = JSON.parse(require('node:fs').readFileSync(userMapArgument.slice('--user-map='.length), 'utf8'));
  if (!trustedUsers || typeof trustedUsers !== 'object' || Array.isArray(trustedUsers)) {
    throw new Error('The verified user map must be a JSON object keyed by Firebase UID.');
  }
  const bootstrapPassword = process.env.BOOTSTRAP_OWNER_PASSWORD || '';
  const [dataSnapshot, usersSnapshot] = await Promise.all([
    database.ref('systemUnifiedData').get(),
    database.ref('users').get()
  ]);
  const sourceData = dataSnapshot.val() || {};
  const migratedData = migrateData(sourceData);
  const migratedUsers = normalizeUsers(usersSnapshot.val() || {}, trustedUsers, bootstrapPassword);
  const branchSummary = Object.fromEntries(Object.entries(migratedData).map(([branch, data]) => [
    branch,
    COLLECTIONS.reduce((total, collection) => total + data[collection].length, 0)
  ]));
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    users: Object.keys(migratedUsers.publicUsers).length,
    dataRecordsByBranch: branchSummary,
    unassignedRecords: branchSummary.unassigned || 0,
    note: 'Unassigned records are readable only by owner/IT admin/general manager.'
  }, null, 2));
  if (!apply) return;

  const updates = {
    users: migratedUsers.publicUsers,
    authCredentials: migratedUsers.credentials,
    usernameIndex: migratedUsers.usernameIndex
  };
  for (const [branch, data] of Object.entries(migratedData)) {
    for (const collection of COLLECTIONS) {
      updates[`systemUnifiedData/${branch}/${collection}`] = data[collection];
    }
    if (data.meta && Object.keys(data.meta).length) {
      updates[`systemUnifiedData/${branch}/meta`] = data.meta;
    }
  }
  await database.ref().update(updates);
  console.log('Migration written. Legacy user password hashes were discarded; the original unified data collections remain in place.');
}

main().catch(error => {
  console.error('Security migration failed:', error);
  process.exitCode = 1;
});
