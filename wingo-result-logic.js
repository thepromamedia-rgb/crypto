'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CryptoClubWingoResult = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function summarizeRoundBets(bets, roundNo) {
    const mine = (Array.isArray(bets) ? bets : []).filter(b =>
      Number(b.roundNo) === Number(roundNo) && b.status === 'Settled'
    );
    if (!mine.length) return null;

    const sizePicks = new Set(mine.filter(b => b.type === 'size').map(b => String(b.pick)));
    const bothSizeSides = sizePicks.has('Big') && sizePicks.has('Small');
    // When both sides were selected in the same round, present only the
    // winning size side. Keep number/color bets independent and visible.
    const visible = bothSizeSides
      ? mine.filter(b => b.type !== 'size' || String(b.pick) === String(b.resultSize))
      : mine;

    if (!visible.length) return null;
    return {
      won: visible.some(b => b.won === true),
      amount: Math.round(visible.reduce((sum, b) => sum + Number(b.payout || 0), 0) * 100) / 100,
      bets: visible,
      filteredOppositeSize: bothSizeSides,
      resultSize: String(mine[0].resultSize || '')
    };
  }
  return { summarizeRoundBets };
});
