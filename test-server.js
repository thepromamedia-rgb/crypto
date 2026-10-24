'use strict';
// Integration test: npm test  (no network needed; prices come from a local stub)
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-'));
process.env.DATA_DIR = tmp; process.env.ADMIN_EMAIL = 'admin@test.io'; process.env.ADMIN_PASSWORD = 'AdminPass123';
delete process.env.UPSTASH_REDIS_REST_URL;

global.__mult = 1;
const stub = http.createServer((q, r) => {
  if (q.url.startsWith('/fx')) { r.setHeader('Content-Type', 'application/json'); return r.end(JSON.stringify({ rates: { INR: 80 } })); }
  if (q.url.startsWith('/b?')) { r.setHeader('Content-Type', 'application/json'); return r.end(JSON.stringify([{ symbol: 'MATICUSDT', lastPrice: '1', priceChangePercent: '0' }])); }
  if (q.url.startsWith('/kl')) { r.setHeader('Content-Type', 'application/json'); return r.end(JSON.stringify(Array.from({ length: 5 }, (_, i) => [1700000000000 + i * 36e5, '100', '110', '95', String(100 + i), '5']))); }
  const ids = new URL(q.url, 'http://x').searchParams.get('ids').split(',');
  r.setHeader('Content-Type', 'application/json');
  r.end(JSON.stringify(ids.map((id, i) => ({ id, current_price: (100 + i) * global.__mult, price_change_percentage_24h: i - 3, sparkline_in_7d: { price: Array.from({ length: 168 }, (_, k) => 90 + (k % 17)) } }))));
});
(async () => {
  await new Promise(r => stub.listen(0, r));
  process.env.PRICE_API_URL = `http://127.0.0.1:${stub.address().port}/m`; process.env.FX_URL = `http://127.0.0.1:${stub.address().port}/fx`; process.env.BINANCE_API_URL = `http://127.0.0.1:${stub.address().port}/b`; process.env.BINANCE_KLINES_URL = `http://127.0.0.1:${stub.address().port}/kl`;
  const { server, loadDB, seedAdmin, _resetPrices } = require('./server.js');
  await loadDB(); await seedAdmin();
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const mk = (panelSlug = 'main') => { let cookie = ''; return async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Panel-Slug': panelSlug, ...(cookie && { Cookie: cookie }) }, body: body && JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { s: r.status, j: await r.json().catch(() => ({})), r };
  }; };
  const ok = n => console.log('PASS:', n);

  const anon = mk();
  assert.equal((await fetch(base + '/healthz')).status, 200); ok('/healthz');
  for (const f of ['/server.js', '/package.json', '/data/db.json', '/test-server.js']) assert.equal((await fetch(base + f)).status, 404, f);
  ok('server files not exposed');
  const pr = await anon('GET', '/api/prices'); assert.equal(pr.s, 200); assert.equal(pr.j.prices.length, 14); assert.ok(pr.j.prices[0].spark.length > 5); ok('live prices');
  assert.equal((await anon('GET', '/api/me')).s, 401); assert.equal((await anon('GET', '/api/admin/overview')).s, 401); ok('auth required');

  const u = mk();
  assert.equal((await u('POST', '/api/register', { name: 'Ravi', email: 'ravi@x.io', password: 'short' })).s, 400);
  assert.equal((await u('POST', '/api/register', { name: 'Ravi', email: 'ravi@x.io', password: 'password1' })).s, 200);
  assert.equal((await u('POST', '/api/register', { name: 'Dup', email: 'RAVI@x.io', password: 'password1' })).s, 409); ok('register + duplicate');
  assert.equal((await u('GET', '/api/admin/overview')).s, 403); ok('user cannot reach admin');
  assert.equal((await mk()('POST', '/api/login', { email: 'ravi@x.io', password: 'bad' })).s, 401);

  // deposit rules
  assert.equal((await u('POST', '/api/deposit', { amount: 999, utr: 'ABCDEFGH1234' })).s, 400); ok('deposit < 1000 rejected');
  assert.equal((await u('POST', '/api/deposit', { amount: 1000, utr: 'ABCDEFGH1234' })).s, 503); ok('deposit blocked until admin sets UPI');
  const a = mk(); assert.equal((await a('POST', '/api/login', { email: 'admin@test.io', password: 'AdminPass123' })).s, 200);
  const mainForCredits = (await a('GET', '/api/admin/panels')).j.panels.find(p => p.slug === 'main');
  const mainAllocation = await a('POST', '/api/admin/panels', { action: 'allocate', id: mainForCredits.id, amount: 9000000, reason: 'integration test starting credits' });
  assert.equal(mainAllocation.s, 200); assert.equal(mainAllocation.j.panel.creditBalance, 9000000); ok('Head Admin allocates credits to main panel');
  assert.equal((await a('POST', '/api/admin/settings', { upi: 'shop@upi', payee: 'CB', support: 'https://t.me/x', notice: '', bonus: '' })).s, 200);
  const d = await u('POST', '/api/deposit', { amount: 1000, utr: 'abcdefgh1234' }); assert.equal(d.s, 200);
  assert.equal((await u('POST', '/api/deposit', { amount: 2000, utr: 'ABCDEFGH1234' })).s, 409); ok('duplicate UTR rejected');
  assert.equal((await u('GET', '/api/me')).j.user.balance, 0);
  assert.equal((await a('POST', '/api/admin/deposit', { id: d.j.deposit.id, action: 'approve' })).s, 200);
  assert.equal((await a('POST', '/api/admin/deposit', { id: d.j.deposit.id, action: 'approve' })).s, 409); ok('approve credits exactly once');
  assert.equal((await u('GET', '/api/me')).j.user.balance, 1000);
  assert.equal((await a('GET', '/api/admin/overview')).j.creditBalance, 8999000); ok('deposit approval debits panel credits exactly once');

  // Set zero retry delay for this legacy withdrawal flow; cooldown enforcement is tested separately in production checks.
  assert.equal((await a('POST', '/api/admin/settings', { withdrawalCooldownHours: 0, upi: '', payee: '', support: '', notice: '', bonus: '' })).s, 200);
  // withdrawal rules
  assert.equal((await u('POST', '/api/withdraw', { amount: 299, upi: 'ravi@bank' })).s, 400); ok('withdraw < 300 rejected');
  assert.equal((await u('POST', '/api/withdraw', { amount: 1001, upi: 'ravi@bank' })).s, 400);
  assert.equal((await u('POST', '/api/withdraw', { amount: 300, upi: 'bad' })).s, 400);
  const w = await u('POST', '/api/withdraw', { amount: 300, upi: 'ravi@bank' }); assert.equal(w.s, 200); assert.equal(w.j.balance, 700);
  assert.equal((await a('POST', '/api/admin/withdrawal', { id: w.j.withdrawal.id, action: 'reject' })).s, 200);
  assert.equal((await a('POST', '/api/admin/withdrawal', { id: w.j.withdrawal.id, action: 'reject' })).s, 409);
  assert.equal((await u('GET', '/api/me')).j.user.balance, 1000); ok('reject refunds exactly once');
  const w2 = await u('POST', '/api/withdraw', { amount: 400, upi: 'ravi@bank' });
  assert.equal((await a('POST', '/api/admin/withdrawal', { id: w2.j.withdrawal.id, action: 'paid', ref: 'X1' })).s, 200);
  assert.equal((await u('GET', '/api/me')).j.user.balance, 600); ok('paid withdrawal keeps deduction');
  assert.equal((await a('GET', '/api/admin/overview')).j.withdrawalsPaid, 400);
  assert.equal((await a('POST', '/api/admin/user', { id: (await u('GET', '/api/me')).j.user.id, action: 'adjust', amount: -5000, reason: 'x' })).s, 400); ok('adjust cannot go negative');

  // trading: BTC stub price = $100 -> ₹8000 at fx 80
  assert.equal((await u('POST', '/api/trade', { symbol: 'BTC', side: 'buy', amount: 99 })).s, 400); ok('buy < ₹100 rejected');
  assert.equal((await u('POST', '/api/trade', { symbol: 'BTC', side: 'buy', amount: 99999 })).s, 400); ok('buy > balance rejected');
  assert.equal((await u('POST', '/api/trade', { symbol: 'NOPE', side: 'buy', amount: 200 })).s, 400);
  assert.equal((await anon('POST', '/api/trade', { symbol: 'BTC', side: 'buy', amount: 200 })).s, 401);
  const by = await u('POST', '/api/trade', { symbol: 'BTC', side: 'buy', amount: 400 });
  assert.equal(by.s, 200); assert.equal(by.j.balance, 200); assert.equal(by.j.holdings.BTC, 0.05); assert.equal(by.j.trade.price, 8000); ok('buy at server price');
  assert.equal((await u('POST', '/api/trade', { symbol: 'BTC', side: 'sell', qty: 0.06 })).s, 400); ok('cannot oversell');
  const sl = await u('POST', '/api/trade', { symbol: 'BTC', side: 'sell', qty: 0.02 }); assert.equal(sl.j.balance, 360); assert.equal(sl.j.holdings.BTC, 0.03);
  const sa = await u('POST', '/api/trade', { symbol: 'BTC', side: 'sell', all: true }); assert.equal(sa.j.balance, 600); assert.ok(!sa.j.holdings.BTC); ok('sell + sell all');
  assert.equal((await a('GET', '/api/admin/trades')).j.items.length, 3);

  // Demo workspace is isolated from real users, wallets and login.
  const dc = await a('POST', '/api/admin/demo-user', { action: 'create', name: 'Demo One', email: 'demo1@x.io', password: 'DemoPass123' }); assert.equal(dc.s, 200); const demoId = dc.j.user.id;
  assert.equal((await a('GET', '/api/admin/demo-users')).j.users.length, 1);
  assert.equal((await a('POST', '/api/admin/demo-user', { action: 'adjust', id: demoId, amount: 999999 })).s, 200);
  assert.equal((await a('GET', '/api/admin/overview')).j.wallets, 600); ok('demo accounts isolated from real overview/wallets');
  assert.equal((await mk()('POST', '/api/login', { email: 'demo1@x.io', password: 'DemoPass123' })).s, 200); ok('demo account login uses shared login page');

  // block + persistence across restart (data preserved)
  const bk = await a('GET', '/api/admin/backup'); assert.ok(!JSON.stringify(bk.j).includes('"pass"')); ok('backup has no password hashes');
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'db.json'), 'utf8')); assert.equal(saved.users.length, 2); assert.equal(saved.deposits.length, 1);
  const before = saved.users.find(x => x.email === 'ravi@x.io').balance;
  assert.equal(before, 600);
  ok('data persisted to disk');

  // candles
  const kl = await anon('GET', '/api/klines?symbol=BTC&interval=1h'); assert.equal(kl.s, 200); assert.equal(kl.j.candles.length, 5); assert.equal(kl.j.candles[0].length, 6);
  assert.equal((await anon('GET', '/api/klines?symbol=NOPE&interval=1h')).s, 400); assert.equal((await anon('GET', '/api/klines?symbol=BTC&interval=9x')).s, 400); ok('klines (candles) endpoint');

  // bonus coin: 5% return, 10% referral of the return
  const boss = mk(), kid = mk();
  const bj = await boss('POST', '/api/register', { name: 'Boss', email: 'boss@x.io', password: 'password1' });
  await kid('POST', '/api/register', { name: 'Kid', email: 'kid@x.io', password: 'password1', ref: bj.j.user.refCode });
  const kidId = (await kid('GET', '/api/me')).j.user.id;
  await a('POST', '/api/admin/user', { id: kidId, action: 'adjust', amount: 5000, reason: 'test' });
  assert.equal((await kid('POST', '/api/bonus/trade', { amount: 1000 })).s, 403); ok('bonus coin closed by default');
  const cfg = { enabled: true, symbol: 'CBX', name: 'CB Reward', returnPct: 5, refPct: 10, refBase: 'profit', lockHours: 24, minAmount: 100, maxAmount: 3000 };
  assert.equal((await kid('POST', '/api/admin/bonuscoin', cfg)).s, 403);
  assert.equal((await a('POST', '/api/admin/bonuscoin', { ...cfg, returnPct: 500 })).s, 400); assert.equal((await a('POST', '/api/admin/bonuscoin', { ...cfg, symbol: 'BTC' })).s, 400);
  assert.equal((await a('POST', '/api/admin/bonuscoin', cfg)).s, 200); assert.equal((await anon('GET', '/api/config')).j.bonusCoin.returnPct, 5);
  const demoLogin = mk(); assert.equal((await demoLogin('POST', '/api/login', { email: 'demo1@x.io', password: 'DemoPass123' })).s, 200);
  await a('POST', '/api/admin/demo-user', { id: demoId, action: 'adjust', amount: 5000, reason: 'demo bonus test' });
  const demoTrade = await demoLogin('POST', '/api/bonus/trade', { symbol: 'CBX', amount: 1000 }); assert.equal(demoTrade.s, 200); assert.equal(demoTrade.j.balance, 1003999); assert.equal(demoTrade.j.position.mode, 'demo'); ok('demo Bonus Coin position opens with isolated demo balance');
  assert.equal((await kid('POST', '/api/bonus/trade', { amount: 50 })).s, 400); assert.equal((await kid('POST', '/api/bonus/trade', { amount: 4000 })).s, 400); assert.equal((await kid('POST', '/api/bonus/trade', { amount: 99999 })).s, 400);
  const bt = await kid('POST', '/api/bonus/trade', { amount: 1000 }); assert.equal(bt.s, 200); assert.equal(bt.j.balance, 4000); assert.equal(bt.j.position.status, 'Active'); ok('bonus trade holds amount');
  await a('POST', '/api/admin/bonuscoin', { ...cfg, returnPct: 50 });                       // later admin change must not affect open trade
  assert.equal((await a('POST', '/api/admin/position', { id: bt.j.position.id, action: 'settle' })).s, 200);
  assert.equal((await a('POST', '/api/admin/position', { id: bt.j.position.id, action: 'settle' })).s, 409);
  assert.equal((await a('POST', '/api/admin/position', { id: bt.j.position.id, action: 'cancel' })).s, 409);
  assert.equal((await kid('GET', '/api/me')).j.user.balance, 5050); assert.equal((await boss('GET', '/api/me')).j.user.balance, 5); assert.equal((await boss('GET', '/api/me')).j.user.refEarned, 5); ok('5% return + 10% referral paid exactly once, snapshot rates');
  await a('POST', '/api/admin/bonuscoin', { ...cfg, refBase: 'amount', lockHours: 0 });
  const bi = await kid('POST', '/api/bonus/trade', { amount: 1000 }); assert.equal(bi.j.position.status, 'Settled');
  assert.equal((await kid('GET', '/api/me')).j.user.balance, 5100); assert.equal((await boss('GET', '/api/me')).j.user.balance, 105); ok('instant mode + referral on trade amount');
  await a('POST', '/api/admin/bonuscoin', { ...cfg, lockHours: 24 });
  const bc = await kid('POST', '/api/bonus/trade', { amount: 500 }); assert.equal((await a('POST', '/api/admin/position', { id: bc.j.position.id, action: 'cancel' })).s, 200);
  assert.equal((await kid('GET', '/api/me')).j.user.balance, 5100); assert.equal((await a('GET', '/api/admin/bonus')).j.items.length, 4); ok('admin cancel refunds principal');
  const rp = await a('GET', '/api/admin/report'); assert.equal(rp.s, 200); assert.equal(rp.j.rows.length, 14); assert.ok(rp.j.rows[0].depositAmt >= 1000); assert.equal((await u('GET', '/api/admin/report')).s, 403); ok('admin report');
  assert.equal((await anon('GET', '/api/klines?symbol=BTC&interval=1m')).s, 200); ok('1m interval');
  // admin coin list: removal rules (add needs live Binance/CoinGecko, so only validation paths are tested offline)
  assert.equal((await u('POST', '/api/admin/coin', { action: 'remove', symbol: 'DOGE' })).s, 403);
  assert.equal((await a('POST', '/api/admin/coin', { action: 'add', symbol: 'x', name: 'X', id: 'x' })).s, 400);
  assert.equal((await a('POST', '/api/admin/coin', { action: 'add', symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin' })).s, 409);
  assert.equal((await a('POST', '/api/admin/coin', { action: 'remove', symbol: 'DOGE' })).s, 200); assert.equal((await anon('GET', '/api/config')).j.coins.length, 13);
  assert.equal((await u('POST', '/api/trade', { symbol: 'DOGE', side: 'buy', amount: 200 })).s, 400);
  await u('POST', '/api/trade', { symbol: 'ETH', side: 'buy', amount: 200 });
  assert.equal((await a('POST', '/api/admin/coin', { action: 'remove', symbol: 'ETH' })).s, 409); ok('admin remove coin (blocked while users hold it)');
  assert.equal((await a('POST', '/api/admin/coin', { action: 'add', symbol: 'matic', name: 'Polygon', id: 'matic-network' })).s, 200); assert.equal((await anon('GET', '/api/config')).j.coins.length, 14);
  assert.equal((await anon('GET', '/api/prices')).j.prices.some(p => p.symbol === 'MATIC'), true); ok('admin add coin + appears in prices');
  const sv = { upi: 'shop@upi', payee: 'CB', support: '', notice: '', bonus: '' };
  assert.equal((await a('POST', '/api/admin/settings', { ...sv, minDeposit: 0, minWithdraw: 300, minTrade: 100 })).s, 400);
  assert.equal((await u('POST', '/api/admin/settings', { ...sv, minDeposit: 500, minWithdraw: 200, minTrade: 50 })).s, 403);
  assert.equal((await a('POST', '/api/admin/settings', { ...sv, minDeposit: 500, minWithdraw: 200, minTrade: 50 })).s, 200);
  assert.equal((await anon('GET', '/api/config')).j.minDeposit, 500);
  assert.equal((await u('POST', '/api/deposit', { amount: 499, utr: 'ZZZZZZZZ9999' })).s, 400); assert.equal((await u('POST', '/api/deposit', { amount: 500, utr: 'ZZZZZZZZ9999' })).s, 200);
  assert.equal((await u('POST', '/api/withdraw', { amount: 199, upi: 'ravi@bank' })).s, 400); ok('admin-set minimum deposit / withdrawal');
  // referral on real trading profit (level 1 only)
  assert.equal((await boss('POST', '/api/admin/referral', { enabled: true, pct: 10 })).s, 403);
  assert.equal((await a('POST', '/api/admin/referral', { enabled: true, pct: 150 })).s, 400);
  assert.equal((await a('POST', '/api/admin/referral', { enabled: true, pct: 10, maxPerTrade: 0 })).s, 200);
  const bossBefore = (await boss('GET', '/api/me')).j.user.balance, kidBefore = (await kid('GET', '/api/me')).j.user.balance;
  await kid('POST', '/api/trade', { symbol: 'LINK', side: 'buy', amount: 1000 });
  const sell1 = await kid('POST', '/api/trade', { symbol: 'LINK', side: 'sell', all: true });      // same stub price -> no profit
  assert.equal(sell1.j.trade.profit, 0); assert.equal((await boss('GET', '/api/me')).j.user.balance, bossBefore); ok('no commission when no profit');
  await kid('POST', '/api/trade', { symbol: 'LINK', side: 'buy', amount: 1000 });
  global.__mult = 1.5; _resetPrices();                                                              // price +50%
  const bossB2 = (await boss('GET', '/api/me')).j.user.balance;
  const sell2 = await kid('POST', '/api/trade', { symbol: 'LINK', side: 'sell', all: true });
  assert.ok(Math.abs(sell2.j.trade.profit - 500) < 1, 'profit ' + sell2.j.trade.profit); assert.ok(Math.abs(sell2.j.trade.refPaid - 50) < 0.2);
  assert.ok(Math.abs((await boss('GET', '/api/me')).j.user.balance - bossB2 - 50) < 0.2); ok('10% of real profit paid to referrer, user keeps full proceeds');
  global.__mult = 0.5; _resetPrices(); await kid('POST', '/api/trade', { symbol: 'LINK', side: 'buy', amount: 1000 }); global.__mult = 0.25; _resetPrices();
  const bossB3 = (await boss('GET', '/api/me')).j.user.balance; const sell3 = await kid('POST', '/api/trade', { symbol: 'LINK', side: 'sell', all: true });
  assert.ok(sell3.j.trade.profit < 0); assert.equal((await boss('GET', '/api/me')).j.user.balance, bossB3); ok('no commission on a loss');
  const pk = mk(); await pk('POST', '/api/register', { name: 'Self', email: 'self@x.io', phone: '9999900000', password: 'password1' });
  const rc = (await pk('GET', '/api/me')).j.user.refCode; await mk()('POST', '/api/register', { name: 'Twin', email: 'twin@x.io', phone: '9999900000', password: 'password1', ref: rc });
  assert.equal((await pk('GET', '/api/me')).j.referrals, 0); ok('same-phone self referral ignored');
  // Admin-controlled withdrawal fee is stored on each request and rejected requests refund gross amount.
  const feeUser = mk(); await feeUser('POST', '/api/register', { name: 'Fee User', email: 'fee@x.io', password: 'password1' });
  const feeMe = (await feeUser('GET', '/api/me')).j.user;
  assert.equal((await a('POST', '/api/admin/user', { id: feeMe.id, action: 'adjust', amount: 1000, reason: 'fee test' })).s, 200);
  assert.equal((await a('POST', '/api/admin/settings', { withdrawalFeeType: 'percent', withdrawalFeeValue: 2, withdrawalFeeLabel: 'Platform Fee', paymentMode: 'qr' })).s, 200);
  const feeWd = await feeUser('POST', '/api/withdraw', { amount: 300, upi: 'fee@bank' });
  assert.equal(feeWd.s, 200); assert.equal(feeWd.j.withdrawal.fee, 6); assert.equal(feeWd.j.withdrawal.netAmount, 294); assert.equal(feeWd.j.balance, 700);
  assert.equal((await a('POST', '/api/admin/withdrawal', { id: feeWd.j.withdrawal.id, action: 'reject' })).s, 200);
  assert.equal((await feeUser('GET', '/api/me')).j.user.balance, 1000); ok('admin withdrawal fee and gross refund');
  assert.equal((await a('POST', '/api/admin/settings', { paymentMode: 'razorpay' })).s, 400); ok('Razorpay cannot be enabled without server secrets');
  assert.equal((await feeUser('POST', '/api/razorpay/order', { amount: 1000 })).s, 403); ok('Razorpay order blocked while QR mode is selected');

  // Full Razorpay flow against a deterministic API stub (no live money or secrets).
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'test_api_secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
  let fakeOrderN = 0, fakeLastAmount = 100000;
  const realFetch = global.fetch;
  global.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith('https://api.razorpay.com/v1/orders')) {
      const body = JSON.parse(init.body); fakeLastAmount = body.amount; fakeOrderN++;
      return new Response(JSON.stringify({ id: 'order_mock_' + fakeOrderN, amount: body.amount, currency: body.currency, status: 'created' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://api.razorpay.com/v1/payments/')) {
      const id = url.split('/').pop();
      return new Response(JSON.stringify({ id, order_id: 'order_mock_1', amount: fakeLastAmount, currency: 'INR', status: 'captured' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, init);
  };
  assert.equal((await a('POST', '/api/admin/settings', { paymentMode: 'razorpay' })).s, 200);
  const balBeforeRz = (await feeUser('GET', '/api/me')).j.user.balance;
  const ord = await feeUser('POST', '/api/razorpay/order', { amount: 1000 });
  assert.equal(ord.s, 200); assert.equal(ord.j.orderId, 'order_mock_1'); assert.equal(ord.j.amount, 100000); ok('Razorpay server-side order creation');
  const paySig = require('node:crypto').createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update('order_mock_1|pay_mock_1').digest('hex');
  const ver = await feeUser('POST', '/api/razorpay/verify', { razorpay_order_id: 'order_mock_1', razorpay_payment_id: 'pay_mock_1', razorpay_signature: paySig });
  assert.equal(ver.s, 200); assert.equal((await feeUser('GET', '/api/me')).j.user.balance, balBeforeRz + 1000); ok('Razorpay captured payment verified and credited');
  const balAfterVerify = (await feeUser('GET', '/api/me')).j.user.balance;
  const whEvent = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_mock_1', order_id: 'order_mock_1', amount: 100000, currency: 'INR', status: 'captured' } } } });
  const whSig = require('node:crypto').createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(whEvent).digest('hex');
  const wh = await fetch(base + '/api/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': whSig }, body: whEvent });
  assert.equal(wh.status, 200); assert.equal((await feeUser('GET', '/api/me')).j.user.balance, balAfterVerify); ok('Razorpay duplicate webhook does not double-credit');
  const badWh = await fetch(base + '/api/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': '0'.repeat(64) }, body: whEvent });
  assert.equal(badWh.status, 400); ok('Razorpay webhook rejects invalid signature');
  global.fetch = realFetch;

  // Head Admin multi-panel isolation and silent user/data migration.
  const panelCreate = await a('POST', '/api/admin/panels', { action: 'create', name: 'Panel One', slug: 'panel-one', email: 'paneladmin@x.io', password: 'PanelPass123' });
  assert.equal(panelCreate.s, 200); assert.equal(panelCreate.j.panel.link, '/p/panel-one');
  const panelAllocation = await a('POST', '/api/admin/panels', { action: 'allocate', id: panelCreate.j.panel.id, amount: 1500, reason: 'panel test allocation' }); assert.equal(panelAllocation.s, 200); assert.equal(panelAllocation.j.panel.creditBalance, 1500); ok('Head Admin allocates isolated panel credits');
  assert.equal(panelCreate.j.panel.adminLink, '/p/panel-one/admin');
  assert.equal((await fetch(base + '/p/panel-one')).status, 200); assert.equal((await fetch(base + '/p/panel-one/admin')).status, 200); ok('single-domain panel routes serve site and admin pages');
  const wrongPanelLogin = await mk()('POST', '/api/login', { email: 'paneladmin@x.io', password: 'PanelPass123' });
  assert.equal(wrongPanelLogin.s, 403); assert.match(wrongPanelLogin.j.error, /\/p\/panel-one\/admin/); ok('wrong main-admin URL gives correct panel login link');
  const panelAdmin = mk('panel-one');
  assert.equal((await panelAdmin('POST', '/api/login', { email: 'paneladmin@x.io', password: 'PanelPass123' })).s, 200);
  assert.equal((await panelAdmin('POST', '/api/admin/panels', { action: 'allocate', id: panelCreate.j.panel.id, amount: 100 })).s, 403); ok('panel admins cannot allocate or expand their own credit pool');
  assert.equal((await a('POST', '/api/admin/settings', { upi: 'main@upi', payee: 'Main', paymentMode: 'qr' })).s, 200);
  assert.equal((await panelAdmin('POST', '/api/admin/settings', { upi: 'panel@upi', payee: 'Panel One', paymentMode: 'qr' })).s, 200);
  assert.equal((await a('GET', '/api/config')).j.upi, 'main@upi');
  assert.equal((await panelAdmin('GET', '/api/config')).j.upi, 'panel@upi'); ok('panel settings are isolated');
  assert.equal((await a('POST', '/api/admin/panels', { action: 'edit', id: panelCreate.j.panel.id, name: 'Panel One Renamed', slug: 'panel-one-renamed', email: 'paneladmin@x.io', password: '' })).s, 200);
  assert.equal((await panelAdmin('GET', '/api/config')).s, 200); ok('panel link edits preserve old URL alias');
  const resetLogin = await a('POST', '/api/admin/panels', { action: 'reset-login', id: panelCreate.j.panel.id, email: 'paneladmin@x.io', password: 'ResetPass123' });
  assert.equal(resetLogin.s, 200); assert.equal(resetLogin.j.panel.adminLink, '/p/panel-one-renamed/admin');
  assert.equal((await mk('panel-one-renamed')('POST', '/api/login', { email: 'paneladmin@x.io', password: 'PanelPass123' })).s, 401);
  assert.equal((await mk('panel-one-renamed')('POST', '/api/login', { email: 'paneladmin@x.io', password: 'ResetPass123' })).s, 200); ok('Head Admin can reset panel admin login and new password works');
  const panelUser = mk('panel-one');
  const panelRegister = await panelUser('POST', '/api/register', { name: 'Panel User', email: 'paneluser@x.io', password: 'password1' });
  assert.equal(panelRegister.s, 200); assert.ok(panelRegister.j.user.id != null);
  const panelListed = await panelAdmin('GET', '/api/admin/users'); assert.equal(panelListed.s, 200); assert.equal(panelListed.j.users.find(x => x.email === 'paneluser@x.io').id, panelRegister.j.user.id); assert.equal(panelListed.j.users.find(x => x.email === 'paneluser@x.io').panelId, 'panel-one-renamed');
  const headListed = await a('GET', '/api/admin/users'); assert.equal(headListed.s, 200); assert.equal(headListed.j.users.find(x => x.email === 'paneluser@x.io').id, panelRegister.j.user.id); assert.equal(headListed.j.scope, 'all-panels'); ok('registered user UID appears in both panel admin and Head Admin user lists');
  const panelDep = await panelUser('POST', '/api/deposit', { amount: 1000, utr: 'PANELUTR12345' });
  assert.equal(panelDep.s, 200); assert.equal((await panelAdmin('GET', '/api/admin/deposits')).j.items.length, 1);
  assert.equal((await a('GET', '/api/admin/panels')).j.panels.find(x => x.slug === 'panel-one-renamed').users, 1); ok('panel user and deposit are scoped');
  assert.equal((await panelUser('POST', '/api/login', { email: 'paneluser@x.io', password: 'password1' })).s, 200);
  const approvedPanelDep = await panelAdmin('POST', '/api/admin/deposit', { id: panelDep.j.deposit.id, action: 'approve', credits: 1200 });
  assert.equal(approvedPanelDep.s, 200); assert.equal(approvedPanelDep.j.item.creditedAmount, 1200); assert.equal(approvedPanelDep.j.creditBalance, 300);
  assert.equal((await panelUser('GET', '/api/me')).j.user.balance, 1200);
  const panelLedger = await panelAdmin('GET', '/api/admin/credits'); assert.equal(panelLedger.s, 200); assert.equal(panelLedger.j.balance, 300); assert.ok(panelLedger.j.items.some(x => x.action === 'deposit-credit' && x.amount === -1200)); ok('custom deposit credits debit panel balance and record credit ledger');
  const panelDep2 = await panelUser('POST', '/api/deposit', { amount: 500, utr: 'PANELUTR54321' }); assert.equal(panelDep2.s, 200);
  const tooMuch = await panelAdmin('POST', '/api/admin/deposit', { id: panelDep2.j.deposit.id, action: 'approve', credits: 400 }); assert.equal(tooMuch.s, 409); assert.equal((await panelUser('GET', '/api/me')).j.user.balance, 1200); ok('insufficient panel credits block deposit approval without mutation');
  assert.equal((await panelAdmin('POST', '/api/admin/deposit', { id: panelDep2.j.deposit.id, action: 'reject' })).s, 200);
  const panelUserId = (await panelUser('GET', '/api/me')).j.user.id;
  const manualCredit = await panelAdmin('POST', '/api/admin/user', { id: panelUserId, action: 'adjust', amount: 200, reason: 'test manual wallet credit' }); assert.equal(manualCredit.s, 200);
  assert.equal((await panelUser('GET', '/api/me')).j.user.balance, 1400); assert.equal((await panelAdmin('GET', '/api/admin/overview')).j.creditBalance, 100); ok('manual positive wallet adjustment debits panel credits');
  const panelId = panelCreate.j.panel.id;
  const reclaim = await a('POST', '/api/admin/panels', { action: 'reclaim', id: panelId, amount: 50, reason: 'test reclaim unused credits' });
  assert.equal(reclaim.s, 200); assert.equal(reclaim.j.panel.creditBalance, 50); assert.equal(reclaim.j.reclaimed, 50); ok('Head Admin can reclaim only unused panel credits');
  const mainCreditsBeforeReturn = (await a('GET', '/api/admin/panels')).j.panels.find(x => x.slug === 'main').creditBalance;
  const panelDelete = await a('POST', '/api/admin/panels', { action: 'delete', id: panelId });
  assert.equal(panelDelete.s, 200);
  assert.equal((await panelUser('GET', '/api/me')).s, 200);
  assert.equal((await panelUser('GET', '/api/me')).j.user.balance, 1400);
  assert.equal((await a('GET', '/api/admin/users')).j.users.find(x => x.email === 'paneluser@x.io').panelId, 'main');
  assert.equal((await a('GET', '/api/admin/deposits')).j.items.some(x => x.utr === 'PANELUTR12345' && x.panelId === 'main'), true);
  assert.equal((await a('GET', '/api/admin/panels')).j.panels.find(x => x.slug === 'main').creditBalance, mainCreditsBeforeReturn + 50); ok('panel deletion migrates users, history and unused credits to Head Admin without logout');

  server.close(); stub.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ALL TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
