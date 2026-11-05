# Admin Panel Upgrade — Database Migration Guide

## Compatibility
This upgrade keeps the existing Crypto Bridge JSON database (`data/db.json`) and existing user, deposit, withdrawal, trade, panel, wallet, audit, and settings records. No destructive schema migration is required.

New staff accounts are stored in the existing `users` collection with these role values:
- `superAdmin`
- `subAdmin`
- `supportAdmin`

Existing `headAdmin`, `admin`, and `panelAdmin` records remain supported. Existing Head Admin and Panel Admin sign-in paths are retained.

## Before deploying
1. Stop the application.
2. Make a full backup of `data/db.json` (and your configured persistent storage).
3. Keep a copy of the currently deployed ZIP.
4. Deploy the upgraded source files.
5. Keep the same `DATA_DIR`, `CB_DB_KEY`, Upstash configuration, and existing persistent disk mount.
6. Start one application instance and verify `/healthz` and admin login.
7. Create staff accounts from Admin Management.

## Role model
| Role | Access |
|---|---|
| Head Admin | Existing owner-level access; creates Super, Sub and Support Admins; manages panels |
| Super Admin | Panel-scoped admin operations and staff management; may create/manage Sub and Support Admins |
| Sub Admin | Panel-scoped user directory; can block/unblock regular user accounts only |
| Support Admin | Read-only overview, user directory and audit log |

The server checks permissions independently of the UI. Hiding a tab is not treated as an authorization control.

## Rollback
Stop the application, restore the previous source ZIP and restore the pre-deployment `db.json` backup if any data issue occurred after deployment. Do not restore an old database over newer production transactions unless you have reconciled those transactions.

## Production notes
- Use HTTPS and strong server secrets.
- Configure persistent storage (Upstash Redis or a correctly mounted persistent disk) before deploying to an ephemeral host.
- Run a single application instance while using JSON snapshot storage.
- Keep `.env` and database backups private.
- Rotate any credentials that may have been exposed during development.
