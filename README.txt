CRYPTO BRIDGE DEMO — RENDER DEPLOYMENT

This is a front-end prototype using sample market data. It does not provide real accounts, wallets, trading, deposits, withdrawals, or financial services.

DEPLOY TO THE EXISTING RENDER WEB SERVICE:
- Keep the service type as Web Service.
- Root Directory: leave blank (or set to the directory containing package.json).
- Build Command: yarn install (there are no external dependencies; npm install also works).
- Start Command: yarn start
- Environment: Render supplies PORT automatically; do not hardcode it.
- Push/upload ALL root files including package.json and server.js to GitHub, then deploy latest commit.

The included server.js is a dependency-free Node HTTP server. It serves index.html, style.css, app.js, and exposes /healthz for a basic health check.

LOCAL TEST:
  npm test
  npm start
Then open http://localhost:3000

For Render, set Health Check Path to /healthz if that setting is available.
