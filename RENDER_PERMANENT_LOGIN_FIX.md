# Render.com – persistent Panel Admin login

## Why Panel Admin credentials disappear
Render web services normally use an ephemeral filesystem. Writing `data/db.json` in the deployed service is NOT persistent across deploy/restart. A valid panel login can become "Wrong email or password" when the account record disappears. Changing password hashing does not recover missing records.

## Recommended: existing Upstash REST storage support
This code already supports Upstash Redis REST; no database migration is needed for a NEW installation.

1. Create a durable Upstash Redis database (not Render Free Key Value). Obtain the REST URL and REST token.
2. In Render > your Web Service > Environment, set:
   - `UPSTASH_REDIS_REST_URL` = your Upstash REST URL
   - `UPSTASH_REDIS_REST_TOKEN` = your Upstash REST token
   - `CB_DB_KEY` = `cryptobridge_data` (leave consistent after setup)
   - `NODE_ENV` = `production`
3. Save and redeploy. Do NOT publish tokens in chat, Git, screenshots or source files.
4. Log in as Head Admin, create a new test panel, log in to `/p/<panel-slug>/admin`.
5. Restart the Render web service and verify the same Panel Admin still logs in.
6. Head Admin can use `GET /api/admin/panel-login-diagnostics` while authenticated to inspect account presence, panel assignment and storage status (no passwords exposed).

IMPORTANT: Before switching from a working local DB to Upstash, BACK UP AND MIGRATE the existing `data/db.json` with appropriate care for user balances and transactions. Simply enabling Upstash on an existing site starts with an empty database if the Upstash key is empty. Do not do this on a live site without migration and reconciliation.

## Alternative: Render paid persistent disk
Mount a disk at `/var/data`; configure `DATA_DIR=/var/data` and `CB_PERSISTENT_DISK=true`. The flag is a declaration by the operator, not an automatic check that a disk is actually mounted. Verify the mount in Render and restart test. Free Render web services cannot attach persistent disks.

## Code behavior
- On Render, new panel creation now fails clearly with HTTP 503 if durable storage has not been configured, rather than misleadingly reporting success and losing the account after a restart.
- Missing Upstash URL/token pairs fail startup rather than silently falling back to local files.
- Existing account creation, hash verification, panel login redirect and diagnostics remain in place.
- Existing 66 automated tests pass; production storage/restart test must be done in your Render account.

## Recovering missing accounts
An account lost from an ephemeral filesystem cannot be recovered by code. Recover from an existing backup, or create/reset the Panel Admin account after durable storage is configured. Never reset live financial balances without reconciliation.
