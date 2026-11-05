# Home & Games Visual Update

- Kept the existing WinGo artwork and gameplay entry point.
- Added the supplied original Aviator artwork to both Home and Games chooser cards.
- Added realistic premium gold coin, Bingo cage/numbered balls, lottery tickets/balls, and gaming controller artwork to both Home and Games chooser cards.
- Added the new image files to the server's explicit static-asset whitelist.
- Kept Bingo, Today Lottery, Aviator and More Games as disabled Coming Soon cards; no fake gameplay or betting flow was added.
- Existing Coin Game and WinGo gameplay, betting, wallet, Admin Panel, database and settlement logic were not intentionally changed.

## Verification
- `node --check app.js`, `server.js`, `admin.js`: passed.
- `npm test`: passed (server, admin roles and WinGo result scenarios).
- Static whitelist includes all five newly added artwork files.
- Browser visual / production deployment verification remains a staging step.
