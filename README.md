# Crypto Bridge — Existing Project

This is the existing Crypto Bridge website project. It includes the Node.js backend, frontend, admin panels, JSON database seed/data file, and existing game modules.

## Run locally

- Node.js 18+
- `npm install`
- Configure environment variables using `.env.example`
- `npm start`
- `npm test` to run backend, admin-role and WinGo result-presentation tests; `python test-site.py` for static UI smoke checks

## Email password recovery

Install dependencies with `npm install` and configure all of:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.

Password recovery sends a real email OTP. It does not simulate successful delivery. Pending OTP challenges are in process memory and are invalidated on server restart.

## Production storage

Use Upstash Redis or a correctly mounted persistent disk as documented in `.env.example`. The current storage model is a JSON snapshot and is not a multi-instance transactional database. Run a single application instance until wallet and other balance-changing operations are moved to transactional storage.

## Demo activity disclosure

Recent Winners and Today's Earnings are simulated display-only content. They are not verified payouts and do not create financial transactions or change user balances.

## Existing Coin Flip visual module

`coin-flip.js` and `coin-flip.css` are retained as part of the existing game code. Do not treat the standalone animation demo as a replacement for the production game backend.


## Upgraded Admin Panel
The existing Head Admin and Panel Admin flows are preserved. The upgraded panel adds panel-scoped `superAdmin`, `subAdmin`, and `supportAdmin` accounts with server-side permission checks and an Admin Management screen.

See:
- `ADMIN_PANEL_SETUP.md` for installation and startup
- `ADMIN_PANEL_MIGRATION.md` for compatibility, backup, migration and rollback
- `ADMIN_PANEL_TEST_REPORT.md` for executed tests and remaining staging checks


## WinGo result notification update

The Big/Small result-popup presentation is covered by `test-wingo-result.js`.
When both Big and Small were selected in one round, only the winning size-side bet
is included in the notification summary. Backend result selection and wallet
settlement are unchanged. Pending result notifications are held by duration and
round until the API confirms settlement, and the pending marker is cleared before
the popup is displayed.

See `BUGFIX_REPORT.md` for the change summary, test results, untested areas and
deployment cautions. Browser visual QA and live duration rollover tests remain
required in staging.
