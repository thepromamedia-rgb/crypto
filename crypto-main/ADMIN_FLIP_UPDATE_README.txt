Crypto Bridge V15 – Coin Flip admin improvements
- Head Admin sees current-round Heads/Tails totals and bet counts for all nondeleted panels, plus higher side, provisional outcome, configured rule, and confirmed outcome.
- Panel Admin sees only their own panel in the live totals view.
- Panel Admin login on the wrong URL shows a clickable link to the correct panel URL; credential and panel isolation rules preserved.
- Each Panel Admin can configure Heads / Tails / Lower Amount / Random in Flip Coin settings; rules are snapshotted at round creation and finalized server-side after betting closes.
- Public game UI discloses the configured rule. Lower Amount ties use a random tie-break. Random outcomes are not predictable before finalization.
- Current game 5-second animation and sound are preserved.
- Manual Refresh live totals button is available.
- All existing automated tests passed, and JS syntax checks passed. Browser and production wallet testing are not included.
IMPORTANT: Configured outcomes such as Always Heads/Always Tails are not fair random coin flips. Disclose this clearly to players, especially if real-money betting is involved.
