# Admin Panel Setup

1. Back up the current deployment and database before replacing files.
2. Extract this ZIP and deploy the contents of `crypto-main/` using the same Node.js service and environment variables as the existing project.
3. Use Node.js 18 or later and run `npm install`.
4. Configure durable storage before production. Prefer Upstash by setting `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; if using a Render disk, set `DATA_DIR` to its mount path and `CB_PERSISTENT_DISK=true`.
5. Keep existing environment variables and existing data file. No destructive database reset is required for this UI update or the existing JSON role fields.
6. Start with `npm start` and check `/healthz`.
7. Sign in as Head Admin, then verify each staff role using a separate browser session. Test both permitted and denied actions.

## Admin URL
- Main workspace: `/admin`
- Panel workspace: `/p/<panel-slug>/admin`

## Security
- Use unique passwords (12+ characters recommended).
- Enable authenticator 2FA for admin accounts where available.
- Never give Support Admin or Sub Admin a Super Admin password.
- Review Audit Log after staff changes.
- Backups and restore remain Head Admin-only.

See `ADMIN_PANEL_MIGRATION.md` for compatibility details and `ADMIN_PANEL_TEST_REPORT.md` for automated test results and deployment limitations.
