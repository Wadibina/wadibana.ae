# Security

## Deployment status and risks

- The repository now includes deny-by-default Realtime Database rules and username-based Cloud Functions authentication. These are source changes only: they have not been deployed or verified against the live Firebase project. Do not treat production as secured until deployment and access tests succeed.
- Legacy Firebase rules allowed public reads and writes. Treat old password hashes and data as potentially exposed or altered. Rotate passwords, review access logs where available, and assess any personal-data exposure. The migration deliberately discards all old password hashes and requires a newly verified role/branch map.
- Follow the backup, account-map, dry-run, migration, and deployment sequence in `README.md`. Do not deploy the migrated frontend before the backend and database rules are ready.
- The repository has contained a Google OAuth client secret and a PEM private key. Treat both as compromised: revoke or rotate them with their respective providers. Removing local copies does not remove them from Git history.
- Review any PHP endpoints before public exposure. Configure trusted origins and require verified server-side authentication; do not rely on an optional Firebase token or permissive CORS.

## Reporting

Report suspected vulnerabilities to the repository maintainers through a private channel. Do not include credentials, personal data, or production database exports in public issues.
