# Home Game Visual Update

- Added the supplied WinGo artwork as `wingo-home.jpg`; the 55CLUB logo in the top-right was removed while retaining the red WinGo artwork.
- Replaced the emoji-only home shortcuts with visual Coin Flip and WinGo tiles and added a clearly marked Bingo preview tile. Bingo is labelled Coming soon because this project does not contain a Bingo game engine or backend/API; the tile is intentionally not presented as playable.
- Increased home game card spacing and icon sizing by approximately 5% and improved winner-list and quick-action colours.
- Moved the Coin Game sound control into the game notice/header area and made it a compact corner toggle. WinGo retains its own sound toggle, styled as a compact control.
- No database schema or game outcome/settlement logic was changed.

## Validation
- `node --check` passed for app.js, server.js, admin.js, coin-flip.js and test-admin-roles.js.
- `npm test` passed all integration tests.
- `npm run test:admin-roles` passed all admin-role tests.
- `python test-site.py`: 17 checks passed; one existing chart pointer-drag/momentum assertion failed. This is unrelated to the home-game visual update and remains to be investigated.
- Browser-based visual QA is still required on staging before production deployment.
