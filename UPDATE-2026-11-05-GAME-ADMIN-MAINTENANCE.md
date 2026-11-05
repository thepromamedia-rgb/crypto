# Game Management + Head Admin Maintenance Update

## Game management
- Admin → Games → Soon Games now lists all built-in games and admin-added games.
- Existing built-in games can be edited (name, description, image) or hidden/deleted from Home and Games.
- Admin-added games can also be edited and deleted.
- Historical bets and gameplay records are not deleted when a game card is removed.
- Home and Games pages render the same server-provided catalogue, preventing the two sections from drifting apart.
- Coin Game and WinGo retain their existing play actions; upcoming entries retain the Soon state.

## Maintenance mode
- A global maintenance switch is visible only to Head Admin in the admin header.
- Server-side authorization requires the `headAdmin` role for both reading and changing maintenance state.
- When enabled, public pages and APIs are blocked; visitors receive a maintenance page.
- Head Admin can still log in, access the admin panel, and switch maintenance off.
- Maintenance state is persisted in the existing database document.

## Verification
- `node --check server.js` — PASS
- `node --check admin.js` — PASS
- `node --check app.js` — PASS
- `npm test` — PASS (existing server, admin-role, WinGo and game tests plus built-in/custom game edit/delete, persistence and maintenance-mode integration checks)

## Deployment note
- No Render deployment was performed. Deploy this ZIP through the existing Render service after backing up production data.
- The maintenance flag and game edits require the existing database storage to be durable. On Render, use the configured Upstash Redis or a properly mounted persistent disk; ordinary ephemeral service storage will not retain changes across restarts/redeploys.
- Existing Render environment variables (including Head Admin credentials) are not embedded or changed by this ZIP.
