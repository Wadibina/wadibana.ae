# Security

## Current deployment risks

- `firebase.database.rules.json` currently grants public read and write access. Do not deploy it or use the application with live data until database rules enforce authenticated, role-aware access.
- The repository has contained a Google OAuth client secret and a PEM private key. Treat both as compromised: revoke or rotate them with their respective providers. Removing local copies does not remove them from Git history.
- The PHP endpoints currently allow cross-origin requests from any origin and use an optional Firebase token. Configure trusted origins and server-side authentication before exposing them publicly.

## Reporting

Report suspected vulnerabilities to the repository maintainers through a private channel. Do not include credentials, personal data, or production database exports in public issues.
