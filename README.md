# Coin Flip 5-second frontend animation

Standalone, dependency-free UI demo. Open `index.html` in a browser.

## Integration
- Keep your existing backend, wallet, betting rules and round lifecycle unchanged.
- Call `CoinFlipVisual.create(element, {getServerNow, onAudioPreferenceChange})` once per game card.
- Call `visual.updateRound({roundId, deadlineMs, result})` when existing backend data arrives. `deadlineMs` must be an epoch-millisecond timestamp from your authoritative game clock. `result` is `heads`, `tails`, or null while pending.
- Call `visual.destroy()` when the component unmounts.
- For accurate synchronization, pass an existing server-synchronized `getServerNow()` implementation; the default Date.now() is for demo only.
- Browsers may block sound until the user interacts with the page. Audio is enabled through the sound toggle.
- On slow/background tabs, visual frames can be skipped; animation phase is derived from deadline, not accumulated frames.

Demo only: The buttons in index.html simulate a server-provided result; no betting, randomness, or backend code is included. The demo does not claim to modify your existing website.
