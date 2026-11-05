# Admin Panel Migration & Database Compatibility

## Compatibility
This upgrade is built on the existing Crypto Bridge project. It does not replace the database, reset users, alter wallet balances, or rewrite the website/game data model. Existing JSON database records remain readable. The admin UI redesign itself requires no database migration.

The existing role implementation supports `headAdmin`, `superAdmin`, `subAdmin` and `supportAdmin` while retaining legacy `panelAdmin` accounts. New staff accounts continue to be stored in the existing users collection with a role and panel ID; passwords are stored as salted hashes.

## Safe deployment
1. Take a verified JSON backup using the Head Admin backup action before deployment.
2. Preserve the existing `data/db.json` or configured Upstash dataset. Do not initialize an empty database over production data.
3. Deploy the updated files with the existing environment variables.
4. Run `npm install`, `npm test`, and `npm run test:admin-roles`.
5. Confirm `/healthz` and test each role in a separate session.
6. Keep persistent storage configured. A local JSON file on an ephemeral host can be lost during restart or deployment.

## Rollback
Restore the previous application files and the pre-deployment database backup together if any issue occurs. Do not roll back only the database after users or transactions have changed unless the business owner has reconciled those changes.
