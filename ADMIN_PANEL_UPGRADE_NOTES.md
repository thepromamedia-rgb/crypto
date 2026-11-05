# Admin Panel Upgrade Notes

## What changed
- Replaced the cramped horizontal tab row with a responsive left-side navigation on desktop and a compact scrollable navigation on mobile.
- Added a refreshed control-center header, current-role/workspace identity, refresh control, and quick-action shortcuts.
- Added a Role & Access page explaining the Head Admin, Super Admin, Sub Admin and Support Admin boundaries and the server-side permission model.
- Hid actions from Support Admin's read-only user directory so the UI no longer offers operations that the server will reject.
- Limited quick actions to each role's available operations; backup download is shown only to Head Admin.
- Preserved existing website pages, game logic, wallet flows, panel logic and existing admin tools.

## Existing options retained
Overview, Weekly Accounting (Head Admin), Admin Panels (Head Admin), Deposits, Withdrawals, Credits, Trades, Coins, Bonus Coin, Games, Admin Management (Head/Super Admin), Users, Demo Accounts, Reports, Referral, Settings and Audit Log.

## Role boundaries
- Head Admin: owner-level controls, including panel lifecycle and backup/restore.
- Super Admin: day-to-day operations and Sub/Support Admin management within the assigned panel; no owner-only panel/backup/restore controls.
- Sub Admin: scoped user directory and permitted user operations only.
- Support Admin: read-only dashboard, user lookup and audit visibility.

The server remains the authority for permissions. Client-side menu visibility is only a usability aid.

## Leaderboard integrity
The homepage earnings leaderboard is explicitly marked DEMO and says the values are simulated, not actual user earnings or payouts. It was intentionally not changed to manufacture or imply real ₹20 lakh / ₹12 lakh wins. For a public real-winner board, use only actual, settled and auditable payout records; entries below a threshold should be omitted, never increased or fabricated.
