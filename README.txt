CRYPTO BRIDGE — v2 (Render Web Service)

Same site/design as before, now with: live prices (CoinGecko), Register/Login, wallet
(min deposit Rs 1,000, min withdrawal Rs 300), Admin Panel at /admin, and /healthz.
No npm dependencies.

RENDER SETTINGS (existing Web Service — do NOT create a new one)
  Build Command : yarn install      (or npm install)
  Start Command : yarn start
  Health Check Path : /healthz
  Upload ALL files (server.js, index.html, admin.html, app.js, admin.js, style.css, package.json).

ENVIRONMENT VARIABLES (Render > Environment)
  ADMIN_EMAIL / ADMIN_PASSWORD  your admin login (password min 8 chars). If you skip ADMIN_PASSWORD
                                a random one is printed ONCE in Render > Logs.
  UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
                                REQUIRED to keep data across deploys. Render's disk is wiped on every
                                deploy otherwise. You can reuse the same Upstash DB as Refer Karo; data
                                is stored under its own key "cryptobridge_data" (override: CB_DB_KEY),
                                so Refer Karo data is untouched.
  COINGECKO_API_KEY (optional)  free demo key if you hit rate limits.

HOW MONEY FLOWS (manual UPI verification, same idea as Refer Karo's QR/UTR mode)
  Deposit    : user pays to your UPI/QR (Admin > Settings) and submits amount + UTR. Min Rs 1,000.
               Admin approves -> balance credited exactly once.
  Withdrawal : min Rs 300, up to balance. Amount is held immediately; admin pays the user's UPI and
               marks Paid, or Rejects (amount refunded exactly once).

ADMIN PANEL (/admin): Overview, Deposits, Withdrawals, Users (block, set password, logged balance
adjust), Settings (UPI, QR, support link, notice, bonus text), Audit log, JSON backup download.

DATA SAFETY: existing data is loaded and merged on start, never reset. Writes are serialized; the
server refuses to start if Upstash is configured but unreachable (so it can't overwrite your data).
Backups exclude password hashes.

TESTS: npm test  (19 checks: rules, one-time credit/refund, auth, file exposure, persistence)

v2.1 ADDITIONS
  Buy/Sell: tap any coin in Quotes/Home -> coin page -> Buy (min Rs 100, from wallet) / Sell. Price is
  decided on the server (live USD price x USD/INR rate, no fee). Orders are refused if the live price
  is stale. Holdings are shown in Assets; Admin > Trades lists all orders.
  NOTE: the platform itself is the counterparty — user profits/losses move the wallet liabilities
  you owe, so keep enough real funds to honour withdrawals.
  Assets page: Recharge / Withdrawal / Buy-Sell / Change password / Logout buttons.
  Password fields have a show/hide eye. Optional env: USD_INR (fallback rate), FX_URL.
