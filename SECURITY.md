# Security

## Firebase authentication and deployment

- The application now uses Firebase Authentication Email/Password and Realtime Database profiles keyed by the exact Auth UID. No Cloud Functions are configured for deployment, so the current setup does not require the Blaze plan.
- The rules in `firebase.database.rules.json` are source changes and have not yet been deployed for this authentication model. The live database may still be using the previous custom-claims rules; do not assume production is protected by this file until it is deployed and tested.
- Create the initial owner Auth account and its `users/{uid}` profile in Firebase Console before deploying the new rules. Otherwise, no user will satisfy the profile checks and everyone will be locked out.
- Rules read roles and branch assignments from the corresponding profile, and prevent users from editing their own profile. Profile management is limited by role; branch managers can only manage employee profiles in their branch. Passwords remain in Firebase Authentication and are never written to Realtime Database.
- RTDB rules require the authenticated email to end in `@swd.ae`, except for the explicitly configured current owner UID. If that UID changes, update the exception before deploying; otherwise the owner may be locked out.
- Removing a profile revokes database access but does not delete the Auth account. Disable or delete Auth accounts separately in Firebase Console.
- Old imported `authCredentials` and `usernameIndex` data is no longer used and is denied by the rules. Back up the database, then remove those legacy records from Firebase Console. Do not reuse old passwords or hashes.
- Check-in writes are branch-scoped, immutable after creation, and use an RTDB transaction to prevent duplicate check-ins. Validate the rules against the emulator and test positive and negative role/branch cases before deploying.

## Legacy risks

- Previous Firebase rules allowed public reads and writes. Treat old password hashes and data as potentially exposed or altered. Rotate passwords and assess any personal-data exposure; a rules migration cannot reverse prior disclosure.
- The repository has contained a Google OAuth client secret and a PEM private key. Treat both as compromised: revoke or rotate them with their respective providers. Removing local copies does not remove them from Git history.
- Review any PHP endpoints before public exposure. Configure trusted origins and require verified server-side authentication; do not rely on an optional Firebase token or permissive CORS.

## Reporting

Report suspected vulnerabilities to the repository maintainers through a private channel. Do not include credentials, personal data, or production database exports in public issues.
