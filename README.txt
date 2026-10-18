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

TESTS: npm test  (offline integration suite: auth, balances, trading, fees, Razorpay mocked flow, webhook signatures, persistence)

v2.1 ADDITIONS
  Buy/Sell: tap any coin in Quotes/Home -> coin page -> Buy (min Rs 100, from wallet) / Sell. Price is
  decided on the server (live USD price x USD/INR rate, no fee). Orders are refused if the live price
  is stale. Holdings are shown in Assets; Admin > Trades lists all orders.
  NOTE: the platform itself is the counterparty — user profits/losses move the wallet liabilities
  you owe, so keep enough real funds to honour withdrawals.
  Assets page: Recharge / Withdrawal / Buy-Sell / Change password / Logout buttons.
  Password fields have a show/hide eye. Optional env: USD_INR (fallback rate), FX_URL.

v2.2 ADDITIONS
  Charts: coin page now has Candlestick + Line chart (15m / 1H / 4H / 1D), touch/hover shows O-H-L-C.
          Data: Binance klines via /api/klines (server cached; browser falls back to Binance directly).
  Bonus coin (Admin > Bonus Coin) - everything is set by admin:
    Open/close the coin, symbol + name, USER RETURN % (default 5), REFERRAL % (default 10),
    referral base (user's return/profit OR user's trade amount), lock hours (0 = instant),
    min / max trade. Coin shows at the top of Quotes/Home.
    User trades from wallet -> after lock time gets amount + return %. If the user joined with a
    referral code, the referrer's wallet gets the commission at that moment (exactly once).
    Rates are saved on each trade, so changing settings never alters trades already open.
    Admin can "Pay now" or "Cancel + refund" any active trade. Users tab shows referrer + earnings.
  NOTE: returns and commissions are paid from the platform's own funds - keep enough real balance
  to honour withdrawals, and check local rules on fixed-return / referral schemes.

v2.3 ADDITIONS
  Chart: timeframes 1m / 3m / 5m / 15m / 1H / 1D, MA5 / MA10 / MA30 lines, volume bars, OHLC + MA values on touch.
  Admin > Reports: last 14 days (IST) sign-ups, deposits, withdrawals, net in, trade volume + CSV export
  of deposits / withdrawals / trades / users.

v2.4 ADDITIONS
  Admin > Coins: add any number of market coins (symbol + name + CoinGecko API id; verified against Binance
  and CoinGecko before listing) and remove coins. A coin cannot be removed while any user still holds it.
  The list is saved in the database and survives deploys.

v2.5 ADDITIONS
  Admin > Settings > Limits: minimum deposit, minimum withdrawal and minimum buy order are now set by admin
  (defaults Rs 1,000 / 300 / 100). Applied instantly on the site and checked on the server.

v2.6 ADDITIONS
  Admin > Referral: level-1 referral commission on the referred user's REAL realised trading profit
  (market coins, average-cost method). Admin sets on/off, % and an optional max per trade. Paid by the
  platform; the user's own proceeds are not reduced. Nothing on deposits, losses or zero-profit trades.
  Sell confirmation now shows the user's profit/loss. Same-phone self-referral is ignored.
  Admin Overview shows total trade-referral commission paid.


v2.7 ADDITIONS
  Admin > Referral now has separate settings for: (1) commissions on approved deposits and (2) commissions on REAL realised market-trading profit.
  Each has independent Level 1 / Level 2 / Level 3 percentages (0–100%). Deposit commissions trigger only once when an admin approves the deposit. Trading-profit commissions trigger only when a sell realises positive profit; no payout on buys, losses or unrealised price changes. Optional per-level cap applies to trading-profit commissions.
  Admin > Coins no longer has a hard-coded 60-coin limit. Coins still must be supported by both Binance (SYMBOLUSDT) and CoinGecko to provide live market prices. Deletion is blocked while users hold that coin, to avoid trapping their holdings.
  Existing user, wallet, deposit, withdrawal, trade, coin and settings data is loaded and merged as before; new settings migrate with safe defaults.

v2.9 multi bonus coin update
- Admin can add unlimited bonus coins, edit per-coin settings, enable/disable, and delete coins.
- Each bonus coin has its own symbol/name, admin-configured display price, promotional return percentage, referral rate/base, min/max trade, and countdown duration.
- On purchase, the return and timer settings are snapshotted. Principal plus promotional reward settles once after the countdown; active positions prevent coin deletion.
- Bonus coin chart is explicitly marked simulated/admin-configured. These custom coins do not have exchange-backed live market prices; listed market coins continue to use live exchange data.
- Promotional rewards are not market trading profit or guaranteed investment returns. Review local financial/legal compliance before enabling real-money payouts.


V3.0 ADMIN ACCOUNT MANAGEMENT
- Admin > Demo Accounts is a separate sandbox section. Create unlimited demo account records, set/reset demo balance, set password, block/unblock, reset demo state, and delete demo records.
- Demo records are stored in a separate demoUsers collection. They are excluded from real user lists, real wallet totals, deposits, withdrawals, referrals and financial overview. Demo credentials do not authenticate through the real-user login. This section is for isolated admin-managed demo records, not a separate customer-facing demo trading login.
- Admin > Users supports block/unblock, set password, balance adjustment with a required audit reason, and delete. Deleted user IDs cannot authenticate; financial records are retained for audit.
- Backup JSON omits password hashes for both real and demo accounts.


RAZORPAY CHECKOUT + WITHDRAWAL FEES (ADDED)
------------------------------------------------------------
Admin > Settings now lets you choose one deposit flow:
- QR: user submits UTR and admin manually verifies it.
- Razorpay Checkout: server creates an order and the site verifies the Checkout signature plus the Razorpay payment status before crediting the wallet.

Render Environment variables required before selecting Razorpay:
- RAZORPAY_KEY_ID = your Razorpay Key ID (public key ID)
- RAZORPAY_KEY_SECRET = your Razorpay Key Secret (server only; never put in frontend or chat)
- RAZORPAY_WEBHOOK_SECRET = a separate secret configured for the webhook in Razorpay Dashboard

Razorpay Dashboard webhook URL:
https://crypto-bridge-demo.onrender.com/api/razorpay/webhook
Subscribe to payment.captured. Use the exact same webhook secret in Render. The webhook endpoint verifies the X-Razorpay-Signature against the raw request body. Test with Razorpay test keys first; switch to live credentials only after tests and account approval. Successful payment must be captured and match the stored order ID, INR currency and exact amount. Duplicate callback/webhook deliveries do not credit twice in the running process.

Admin > Settings > Withdrawal fee:
- Set fee label, percentage or fixed rupee fee.
- Fee is snapshotted when the withdrawal request is made. User's gross amount is held; fee and net payout are shown separately. Rejection refunds the full gross amount. Payout remains manual; this does not send money automatically.

IMPORTANT DEPLOYMENT NOTES:
- This project stores data in a JSON file unless Upstash Redis is configured. On Render ephemeral storage can be lost on restart/deploy. Configure persistent storage/Upstash before handling real payment records.
- The current JSON storage is not a transactional database. For production payments, use a durable transactional database with a unique constraint on Razorpay order/payment IDs and atomic wallet ledger credits. Do not treat this demo implementation as production-ready custody/exchange infrastructure.
- Automatic payment verification only confirms a payment received by Razorpay; it does not automatically process crypto deposits or withdrawals. Withdrawals are still manually paid by admin.
- Real crypto exchange/custody operations require appropriate provider access, security and legal/compliance review.

AUDIT / LIVE-MONEY SAFETY NOTES
-------------------------------
- `npm test` now runs the full offline suite, including mocked Razorpay order creation,
  captured-payment verification, webhook-signature rejection and duplicate-credit checks.
  This is not a live Razorpay transaction test; use Razorpay TEST keys first.
- Storage writes now fail the request if persistence fails rather than falsely reporting success.
- Do not run multiple Render instances/replicas against this JSON/Upstash single-key store for
  real-money balances. The webhook/callback duplicate guard is process-local and this storage
  layer is not a transactional ledger. Before accepting live customer funds, move balances,
  deposits, and webhook event IDs to a durable transactional database with unique constraints
  and atomic crediting; also add operational reconciliation and backups.
- Withdrawals are still manually paid by the admin. Razorpay Checkout in this build handles
  deposits only; it does not automatically send withdrawals to users.
- Crypto market/Bonus Coin activity in this app is not an exchange order-book or custody system.
  Do not represent it as a regulated exchange or accept real funds until appropriate licensing,
  compliance, custody, and security reviews are completed.
