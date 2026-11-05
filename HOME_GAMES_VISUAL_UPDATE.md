# Home & Games Visual Update

- Added the supplied WinGo artwork as `/wingo-home.jpg` and removed the 55CLUB mark from the supplied image.
- Used the artwork in the Games chooser and Home game card.
- Added Bingo, Today Lottery, Aviator and More Games as clearly disabled Coming Soon cards; no fake game engine or betting flow was added.
- Increased game-card sizing by approximately 5% and refreshed game/action/live-winner demo colours.
- Existing Coin Game and WinGo game logic, wallet, settlement and database code were not intentionally changed.

## Verification
- `node --check app.js`, `server.js`, `admin.js`, `coin-flip.js`: passed.
- `node test-server.js`: passed.
- `node test-admin-roles.js`: passed.
- Browser visual / production deployment verification remains a staging step.
