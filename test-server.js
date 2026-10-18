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

const stub = http.createServer((q, r) => {
  const ids = new URL(q.url, 'http://x').searchParams.get('ids').split(',');
  r.setHeader('Content-Type', 'application/json');
  r.end(JSON.stringify(ids.map((id, i) => ({ id, current_price: 100 + i, price_change_percentage_24h: i - 3, sparkline_in_7d: { price: Array.from({ length: 168 }, (_, k) => 90 + (k % 17)) } }))));
});
(async () => {
  await new Promise(r => stub.listen(0, r));
  process.env.PRICE_API_URL = `http://127.0.0.1:${stub.address().port}/m`;
  const { server, loadDB, seedAdmin } = require('./server.js');
  await loadDB(); await seedAdmin();
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const mk = () => { let cookie = ''; return async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: body && JSON.stringify(body) });
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
  assert.equal((await a('POST', '/api/admin/settings', { upi: 'shop@upi', payee: 'CB', support: 'https://t.me/x', notice: '', bonus: '' })).s, 200);
  const d = await u('POST', '/api/deposit', { amount: 1000, utr: 'abcdefgh1234' }); assert.equal(d.s, 200);
  assert.equal((await u('POST', '/api/deposit', { amount: 2000, utr: 'ABCDEFGH1234' })).s, 409); ok('duplicate UTR rejected');
  assert.equal((await u('GET', '/api/me')).j.user.balance, 0);
  assert.equal((await a('POST', '/api/admin/deposit', { id: d.j.deposit.id, action: 'approve' })).s, 200);
  assert.equal((await a('POST', '/api/admin/deposit', { id: d.j.deposit.id, action: 'approve' })).s, 409); ok('approve credits exactly once');
  assert.equal((await u('GET', '/api/me')).j.user.balance, 1000);

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

  // block + persistence across restart (data preserved)
  const bk = await a('GET', '/api/admin/backup'); assert.ok(!JSON.stringify(bk.j).includes('"pass"')); ok('backup has no password hashes');
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'db.json'), 'utf8')); assert.equal(saved.users.length, 2); assert.equal(saved.deposits.length, 1);
  const before = saved.users.find(x => x.email === 'ravi@x.io').balance;
  assert.equal(before, 600);
  ok('data persisted to disk');
  server.close(); stub.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ALL TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
