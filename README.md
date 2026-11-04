# Crypto Bridge — Existing Project

This is the existing Crypto Bridge website project. It includes the Node.js backend, frontend, admin panels, JSON database seed/data file, and existing game modules.

## Run locally

- Node.js 18+
- `npm install`
- Configure environment variables using `.env.example`
- `npm start`
- `npm test` to run the automated integration suite

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
