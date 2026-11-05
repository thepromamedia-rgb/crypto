'use strict';
const assert = require('node:assert/strict');
const { summarizeRoundBets } = require('./wingo-result-logic');

function bet(type, pick, won, resultSize, roundNo=7, payout=won?180:0) {
  return { type, pick, won, resultSize, roundNo, payout, status: 'Settled' };
}

// Both sides selected: Big result shows only the Big winning-side bet.
let s = summarizeRoundBets([
  bet('size','Big',true,'Big'), bet('size','Small',false,'Big')
], 7);
assert.equal(s.won, true);
assert.equal(s.filteredOppositeSize, true);
assert.deepEqual(s.bets.map(x=>x.pick), ['Big']);
assert.equal(s.amount, 180);

// Both sides selected: Small result shows only the Small winning-side bet.
s = summarizeRoundBets([
  bet('size','Big',false,'Small'), bet('size','Small',true,'Small')
], 7);
assert.equal(s.won, true);
assert.deepEqual(s.bets.map(x=>x.pick), ['Small']);

// Single-side bets retain normal win/loss outcomes.
assert.equal(summarizeRoundBets([bet('size','Big',true,'Big')],7).won, true);
assert.equal(summarizeRoundBets([bet('size','Big',false,'Small')],7).won, false);
assert.equal(summarizeRoundBets([bet('size','Small',true,'Small')],7).won, true);
assert.equal(summarizeRoundBets([bet('size','Small',false,'Big')],7).won, false);

// Number and color bets remain independent and are not filtered with size bets.
s = summarizeRoundBets([
  bet('size','Big',true,'Big'), bet('size','Small',false,'Big'),
  bet('number','9',false,'Big',7,0), bet('color','Green',true,'Big',7,80)
],7);
assert.deepEqual(s.bets.map(x=>x.type+':'+x.pick), ['size:Big','number:9','color:Green']);
assert.equal(s.won, true);
assert.equal(s.amount, 260);

// Different rounds and unsettled bets are never mixed into this notification.
assert.equal(summarizeRoundBets([
  bet('size','Big',true,'Big',6), bet('size','Small',false,'Small',7)
],7).bets.length, 1);
assert.equal(summarizeRoundBets([{...bet('size','Big',true,'Big'),status:'Pending'}],7), null);

console.log('WinGo result notification tests: PASS (8 scenario groups)');
