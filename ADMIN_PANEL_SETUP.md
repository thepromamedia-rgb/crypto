# Upgraded Admin Panel — Setup

## Requirements
- Node.js 18+
- npm
- Existing Crypto Bridge project environment and persistent database

## Install
```bash
npm install
```

## Environment
Copy `.env.example` to `.env` and configure the existing required production values. In particular:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` (at least 8 characters for the existing seed process; use a strong unique password)
- `DATA_DIR` only when using a persistent mounted disk
- `CB_PERSISTENT_DISK=true` only when that directory is actually mounted and persistent
- Upstash Redis URL/token if using Upstash
- `NODE_ENV=production`
- SMTP and payment provider secrets only if those existing features are enabled

Never commit `.env` or share production credentials.

## Run
```bash
npm start
```
Open `/admin` (or the assigned panel admin URL).

## Admin management
Sign in as Head Admin and open **Admin Management**. Create staff accounts with unique email addresses and passwords of at least 12 characters. Super Admins can create Sub Admins and Support Admins within their panel. Head Admins can create all three new roles.

## Verify
```bash
node --check server.js
node --check admin.js
npm test
npm run test:admin-roles
```
The existing automated integration suite covers authentication, wallet flows, deposits, withdrawals, trading, panel isolation, backup handling and other legacy functionality.
