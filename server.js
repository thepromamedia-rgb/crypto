'use strict';
// Crypto Bridge — dependency-free Node server (Render Web Service).
// Serves the site, /healthz, auth, wallet (deposit/withdrawal requests), live prices, admin API.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const E = process.env;
const PROD = E.NODE_ENV === 'production' || !!E.RENDER;

const MIN_DEPOSIT = 1000;   // ₹
const MIN_WITHDRAW = 300;   // ₹
const MAX_AMOUNT = 10000000;
const MIN_TRADE = 100;     // ₹ per buy order
const r2 = x => Math.round(x * 100) / 100;
const r8 = x => Math.round(x * 1e8) / 1e8;

// ---------- storage (Upstash Redis if configured, else JSON file) ----------
const clean = v => (v || '').trim().replace(/^["']|["']$/g, '');
const UP_TOKEN = clean(E.UPSTASH_REDIS_REST_TOKEN);
const UP_RAW = clean(E.UPSTASH_REDIS_REST_URL);
const UP_URL = UP_RAW && (/^https?:\/\//.test(UP_RAW) ? UP_RAW : 'https://' + UP_RAW);
const KEY = E.CB_DB_KEY || 'cryptobridge_data';
const DATA_DIR = E.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

async function up(cmd) {
  const r = await fetch(UP_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + UP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Upstash: ' + (j.error || r.status));
  return j.result;
}

const BONUS_DEFAULT = () => ({ enabled: false, symbol: 'CBX', name: 'CB Reward Coin', returnPct: 5, refPct: 10, refBase: 'profit', lockHours: 24, minAmount: 100, maxAmount: 100000 });
const defaults = () => ({
  v: 1, seq: 1, secret: crypto.randomBytes(32).toString('hex'),
  users: [], deposits: [], withdrawals: [], trades: [], positions: [], audit: [],
  settings: { upi: '', payee: '', qr: '', support: '', notice: '', bonus: '', bonusCoin: BONUS_DEFAULT() }
});
let D = defaults();

async function loadDB() {
  let raw = null;
  if (UP_URL) { raw = await up(['GET', KEY]); console.log('Storage: Upstash Redis'); }
  else {
    try { raw = fs.readFileSync(DB_FILE, 'utf8'); } catch {}
    console.log('Storage: local file ' + DB_FILE + (PROD ? '  (WARNING: ephemeral on Render — set UPSTASH_REDIS_REST_URL/TOKEN or attach a disk)' : ''));
  }
  if (raw) {
    const saved = JSON.parse(raw);                       // existing data is merged, never discarded
    const ss = saved.settings || {};
    D = { ...defaults(), ...saved, settings: { ...defaults().settings, ...ss, bonusCoin: { ...BONUS_DEFAULT(), ...(ss.bonusCoin || {}) } } };
    for (const k of ['users', 'deposits', 'withdrawals', 'trades', 'positions', 'audit']) if (!Array.isArray(D[k])) D[k] = [];
  }
}
let saveChain = Promise.resolve();
function save() {
  const snap = JSON.stringify(D);
  saveChain = saveChain.then(async () => {
    if (UP_URL) await up(['SET', KEY, snap]);
    else {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, snap); fs.renameSync(tmp, DB_FILE);
    }
  }).catch(e => console.error('SAVE FAILED', e.message));
  return saveChain;
}

// ---------- helpers ----------
const nid = () => D.seq++;
const now = () => Date.now();
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const money = v => { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= MAX_AMOUNT ? n : null; };
const audit = (who, action, detail) => { D.audit.push({ id: nid(), ts: now(), who, action, detail }); if (D.audit.length > 2000) D.audit.splice(0, D.audit.length - 2000); };
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new HttpError(code, msg); };

function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPw(pw, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sign = s => crypto.createHmac('sha256', D.secret).update(s).digest('base64url');
function makeToken(uid) { const p = Buffer.from(JSON.stringify({ uid, exp: now() + 7 * 864e5 })).toString('base64url'); return p + '.' + sign(p); }
function readToken(t) {
  if (!t) return null; const [p, s] = t.split('.');
  if (!p || !s || sign(p) !== s) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > now() ? o.uid : null; } catch { return null; }
}
function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); }); return o; }
const setCookie = (res, v, maxAge) => res.setHeader('Set-Cookie', `cb_session=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${PROD ? '; Secure' : ''}`);
function authUser(req) { const uid = readToken(cookies(req).cb_session); const u = uid && D.users.find(x => x.id === uid); return u && !u.blocked ? u : null; }

// simple in-memory rate limit
const hits = new Map();
function limit(key, max, windowMs) {
  const t = now(), a = (hits.get(key) || []).filter(x => t - x < windowMs);
  if (a.length >= max) fail(429, 'Too many attempts. Please wait a few minutes.');
  a.push(t); hits.set(key, a);
}
setInterval(() => { const t = now(); for (const [k, a] of hits) if (!a.some(x => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

const pubUser = u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, balance: u.balance, refCode: u.refCode, created: u.created, holdings: u.holdings || {}, refEarned: u.refEarned || 0 });
const normEmail = v => str(v, 120).toLowerCase();
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const makeRef = () => { let c; do c = 'CB' + crypto.randomBytes(3).toString('hex').toUpperCase(); while (D.users.some(u => u.refCode === c)); return c; };

// ---------- live prices (CoinGecko public API, cached, stale-if-error) ----------
const COINS = [
  ['BTC', 'Bitcoin', 'bitcoin', '₿'], ['ETH', 'Ethereum', 'ethereum', 'Ξ'], ['ETC', 'Ethereum Classic', 'ethereum-classic', 'E'],
  ['TRX', 'TRON', 'tron', 'T'], ['DOGE', 'Dogecoin', 'dogecoin', 'Ð'], ['BCH', 'Bitcoin Cash', 'bitcoin-cash', 'B'],
  ['COMP', 'Compound', 'compound-governance-token', 'C'], ['DASH', 'Dash', 'dash', 'D'], ['ADA', 'Cardano', 'cardano', 'A'],
  ['LINK', 'Chainlink', 'chainlink', 'L'], ['LTC', 'Litecoin', 'litecoin', 'Ł'], ['BNB', 'BNB', 'binancecoin', 'B'],
  ['XRP', 'XRP', 'ripple', 'X'], ['SOL', 'Solana', 'solana', 'S']
];
const PRICE_API = E.PRICE_API_URL || 'https://api.coingecko.com/api/v3/coins/markets';
let priceCache = { ts: 0, data: null, error: null };
const BINANCE_API = E.BINANCE_API_URL || 'https://data-api.binance.vision/api/v3/ticker/24hr';
async function fromCoinGecko() {
  const url = `${PRICE_API}?vs_currency=usd&ids=${COINS.map(c => c[2]).join(',')}&sparkline=true&price_change_percentage=24h`;
  const headers = { Accept: 'application/json' };
  if (E.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = E.COINGECKO_API_KEY;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('CoinGecko ' + r.status);
  const rows = await r.json(), by = Object.fromEntries(rows.map(x => [x.id, x]));
  return COINS.map(([symbol, name, id, mark]) => {
    const x = by[id]; if (!x) return null;
    const sp = (x.sparkline_in_7d && x.sparkline_in_7d.price) || [], step = Math.max(1, Math.floor(sp.length / 28));
    return { symbol, name, mark, price: x.current_price, change: x.price_change_percentage_24h_in_currency ?? x.price_change_percentage_24h ?? 0, spark: sp.filter((_, i) => i % step === 0) };
  }).filter(Boolean);
}
async function fromBinance() {   // backup source: no geo-block on data-api.binance.vision, USDT ≈ USD
  const syms = encodeURIComponent(JSON.stringify(COINS.map(c => c[0] + 'USDT')));
  const r = await fetch(`${BINANCE_API}?symbols=${syms}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Binance ' + r.status);
  const by = Object.fromEntries((await r.json()).map(x => [x.symbol, x]));
  const old = Object.fromEntries(((priceCache.data) || []).map(x => [x.symbol, x.spark]));
  return COINS.map(([symbol, name, , mark]) => {
    const x = by[symbol + 'USDT']; if (!x) return null;
    return { symbol, name, mark, price: Number(x.lastPrice), change: Number(x.priceChangePercent), spark: old[symbol] || [] };
  }).filter(Boolean);
}
async function getPrices() {
  if (priceCache.data && now() - priceCache.ts < 20e3) return priceCache;
  let data = null, errs = [];
  for (const src of [fromCoinGecko, fromBinance]) {
    try { data = await src(); if (data.length) { priceCache = { ts: now(), data, error: null, source: src === fromBinance ? 'Binance' : 'CoinGecko' }; return priceCache; } }
    catch (e) { errs.push(e.message); }
  }
  priceCache = { ...priceCache, error: errs.join(' | ') };
  if (!priceCache.data) fail(503, 'Price sources failed: ' + errs.join(' | '));
  return priceCache;
}


// USD->INR rate for trades (cached). Trades are refused if no trustworthy rate is available.
const FX_URL = E.FX_URL || 'https://open.er-api.com/v6/latest/USD';
let fxCache = { ts: 0, v: Number(E.USD_INR) || 0 };
async function getFx() {
  if (fxCache.v && now() - fxCache.ts < 600e3) return fxCache.v;
  let v = 0;
  try { const r = await fetch(FX_URL, { signal: AbortSignal.timeout(6000) }); const j = await r.json(); v = Number(j.rates && j.rates.INR); } catch {}
  if (!(v > 50 && v < 200)) {
    try { const r = await fetch((E.BINANCE_FX_URL || 'https://data-api.binance.vision/api/v3/ticker/price') + '?symbol=USDTINR', { signal: AbortSignal.timeout(6000) }); v = Number((await r.json()).price); } catch {}
  }
  if (v > 50 && v < 200) fxCache = { ts: now(), v };
  else if (fxCache.v) fxCache.ts = now() - 540e3;       // keep last good rate, retry in ~1 min
  if (!fxCache.v) fail(503, 'INR rate unavailable right now. Try again shortly.');
  return fxCache.v;
}


// ---------- candles (Binance klines, cached, stale-if-error) ----------
const KL_LIMIT = { '15m': 96, '1h': 96, '4h': 90, '1d': 90 };
const KL_API = E.BINANCE_KLINES_URL || 'https://data-api.binance.vision/api/v3/klines';
const klCache = new Map();
async function getKlines(sym, iv) {
  const key = sym + ':' + iv, c = klCache.get(key);
  if (c && now() - c.ts < 30e3) return c.candles;
  try {
    const r = await fetch(`${KL_API}?symbol=${sym}USDT&interval=${iv}&limit=${KL_LIMIT[iv]}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('Binance ' + r.status);
    const candles = (await r.json()).map(k => [k[0], +k[1], +k[2], +k[3], +k[4]]);
    klCache.set(key, { ts: now(), candles }); return candles;
  } catch (e) { if (c) return c.candles; fail(503, 'Chart data unavailable: ' + e.message); }
}

// ---------- bonus coin: fixed return after lock period + referral commission (all admin-controlled) ----------
// Settlement is idempotent: only an 'Active' position can be settled, so principal+return are paid exactly once.
function settlePosition(p) {
  if (p.status !== 'Active') return false;
  const u = D.users.find(x => x.id === p.uid), profit = r2(p.amount * p.returnPct / 100);
  p.status = 'Settled'; p.profit = profit; p.done = now();
  if (u) u.balance = r2(u.balance + p.amount + profit);
  const ref = u && u.refBy && D.users.find(x => x.id === u.refBy);
  if (ref && !ref.blocked && p.refPct > 0) {
    const c = r2((p.refBase === 'amount' ? p.amount : profit) * p.refPct / 100);
    if (c > 0) { ref.balance = r2(ref.balance + c); ref.refEarned = r2((ref.refEarned || 0) + c); p.refUid = ref.id; p.refPaid = c; }
  }
  audit('system', 'bonus-settle', `#${p.id} ${p.email} +₹${profit}` + (p.refPaid ? ` ref ₹${p.refPaid}` : ''));
  return true;
}
function settleDue() { let n = 0; for (const p of D.positions) if (p.status === 'Active' && p.matureAt <= now() && settlePosition(p)) n++; return n; }
async function settleAndSave() { if (settleDue()) await save(); }

// ---------- API ----------
const PUBLIC_SETTINGS = () => ({ upi: D.settings.upi, payee: D.settings.payee, qr: D.settings.qr, support: D.settings.support, notice: D.settings.notice, bonus: D.settings.bonus, minDeposit: MIN_DEPOSIT, minWithdraw: MIN_WITHDRAW, minTrade: MIN_TRADE, bonusCoin: D.settings.bonusCoin });
const needUser = u => u || fail(401, 'Please login.');
const needAdmin = u => { needUser(u); if (u.role !== 'admin') fail(403, 'Forbidden'); };

const routes = {
  'GET /api/prices': async () => { const c = await getPrices(); const fx = await getFx().catch(() => fxCache.v || 0); return { fx, prices: c.data, updated: c.ts, stale: !!c.error, source: c.source || '' }; },
  'GET /api/config': async () => PUBLIC_SETTINGS(),
  'GET /api/klines': async (req) => {
    limit('kl:' + req.ip, 120, 60e3);
    const q = new URL(req.url, 'http://x').searchParams, sym = str(q.get('symbol'), 10).toUpperCase(), iv = q.get('interval') || '1h';
    if (!COINS.some(c => c[0] === sym)) fail(400, 'Unknown coin.'); if (!KL_LIMIT[iv]) fail(400, 'Bad interval.');
    return { symbol: sym, interval: iv, candles: await getKlines(sym, iv) };
  },

  'POST /api/register': async (req, res, b) => {
    limit('reg:' + req.ip, 10, 3600e3);
    const name = str(b.name, 60), email = normEmail(b.email), phone = str(b.phone, 20).replace(/[^\d+]/g, ''), pw = String(b.password || '');
    if (name.length < 2) fail(400, 'Enter your name.');
    if (!emailOk(email)) fail(400, 'Enter a valid email.');
    if (pw.length < 8 || pw.length > 100) fail(400, 'Password must be 8–100 characters.');
    if (D.users.some(u => u.email === email)) fail(409, 'This email is already registered.');
    const ref = str(b.ref, 20).toUpperCase(), refBy = ref && D.users.find(u => u.refCode === ref);
    const u = { id: nid(), name, email, phone, role: 'user', pass: hashPw(pw), balance: 0, refCode: makeRef(), refBy: refBy ? refBy.id : null, blocked: false, created: now() };
    D.users.push(u); audit('system', 'register', u.email); await save();
    setCookie(res, makeToken(u.id), 7 * 86400);
    return { user: pubUser(u) };
  },
  'POST /api/login': async (req, res, b) => {
    const email = normEmail(b.email); limit('login:' + req.ip, 20, 600e3); limit('loginu:' + email, 8, 600e3);
    const u = D.users.find(x => x.email === email);
    if (!u || !checkPw(String(b.password || ''), u.pass)) fail(401, 'Wrong email or password.');
    if (u.blocked) fail(403, 'This account is blocked. Contact support.');
    setCookie(res, makeToken(u.id), 7 * 86400);
    return { user: pubUser(u) };
  },
  'POST /api/logout': async (req, res) => { setCookie(res, '', 0); return { ok: true }; },
  'GET /api/me': async (req, res, b, u) => {
    needUser(u); await settleAndSave();
    return {
      user: pubUser(u), config: PUBLIC_SETTINGS(),
      positions: D.positions.filter(p => p.uid === u.id).sort((a, c) => c.ts - a.ts).slice(0, 50),
      deposits: D.deposits.filter(d => d.uid === u.id).sort((a, c) => c.ts - a.ts),
      withdrawals: D.withdrawals.filter(w => w.uid === u.id).sort((a, c) => c.ts - a.ts),
      referrals: D.users.filter(x => x.refBy === u.id).length,
      trades: D.trades.filter(t => t.uid === u.id).sort((a, c) => c.ts - a.ts).slice(0, 50)
    };
  },
  'POST /api/password': async (req, res, b, u) => {
    needUser(u); limit('pw:' + u.id, 5, 600e3);
    if (!checkPw(String(b.current || ''), u.pass)) fail(400, 'Current password is wrong.');
    const pw = String(b.password || ''); if (pw.length < 8 || pw.length > 100) fail(400, 'New password must be 8–100 characters.');
    u.pass = hashPw(pw); audit(u.email, 'password-change', ''); await save(); return { ok: true };
  },
  'POST /api/deposit': async (req, res, b, u) => {
    needUser(u); limit('dep:' + u.id, 10, 3600e3);
    const amount = money(b.amount); if (!amount) fail(400, 'Enter a valid amount.');
    if (amount < MIN_DEPOSIT) fail(400, `Minimum deposit is ₹${MIN_DEPOSIT.toLocaleString('en-IN')}.`);
    const utr = str(b.utr, 30).toUpperCase(); if (!/^[A-Z0-9]{8,30}$/.test(utr)) fail(400, 'Enter the UTR / transaction reference (8–30 letters/digits).');
    if (D.deposits.some(d => d.utr === utr)) fail(409, 'This UTR has already been submitted.');
    if (!D.settings.upi && !D.settings.qr) fail(503, 'Deposits are not open yet. Contact support.');
    const d = { id: nid(), uid: u.id, email: u.email, amount, utr, status: 'Pending', ts: now() };
    D.deposits.push(d); audit(u.email, 'deposit-request', `₹${amount} ${utr}`); await save(); return { deposit: d };
  },
  'POST /api/withdraw': async (req, res, b, u) => {
    needUser(u); limit('wd:' + u.id, 10, 3600e3);
    const amount = money(b.amount); if (!amount) fail(400, 'Enter a valid amount.');
    if (amount < MIN_WITHDRAW) fail(400, `Minimum withdrawal is ₹${MIN_WITHDRAW}.`);
    if (amount > u.balance) fail(400, 'Amount is more than your available balance.');
    const upi = str(b.upi, 60); if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upi)) fail(400, 'Enter a valid UPI ID (name@bank).');
    u.balance -= amount;   // held at request time; refunded once if rejected
    const w = { id: nid(), uid: u.id, email: u.email, amount, upi, status: 'Pending', ts: now() };
    D.withdrawals.push(w); audit(u.email, 'withdraw-request', `₹${amount} ${upi}`); await save(); return { withdrawal: w, balance: u.balance };
  },

  'POST /api/trade': async (req, res, b, u) => {
    needUser(u); limit('trade:' + u.id, 40, 600e3);
    const sym = str(b.symbol, 10).toUpperCase(), coin = COINS.find(c => c[0] === sym); if (!coin) fail(400, 'Unknown coin.');
    if (b.side !== 'buy' && b.side !== 'sell') fail(400, 'Bad order.');
    const pc = await getPrices(), fx = await getFx();
    if (pc.error || now() - pc.ts > 60e3) fail(503, 'Live price is not fresh right now. Please try again in a moment.');
    const p = pc.data.find(x => x.symbol === sym); if (!p) fail(503, 'Price unavailable for ' + sym);
    const unit = p.price * fx;                       // ₹ per coin, decided on the server only
    if (!u.holdings) u.holdings = {};
    let qty, inrAmt;
    if (b.side === 'buy') {
      inrAmt = r2(Number(b.amount));
      if (!Number.isFinite(inrAmt) || inrAmt < MIN_TRADE) fail(400, `Minimum buy is ₹${MIN_TRADE}.`);
      if (inrAmt > u.balance) fail(400, 'Not enough wallet balance. Recharge first.');
      qty = Math.floor(inrAmt / unit * 1e8) / 1e8; if (qty <= 0) fail(400, 'Amount too small.');
      u.balance = r2(u.balance - inrAmt); u.holdings[sym] = r8((u.holdings[sym] || 0) + qty);
    } else {
      const have = u.holdings[sym] || 0;
      qty = b.all ? have : r8(Number(b.qty));
      if (!Number.isFinite(qty) || qty <= 0) fail(400, 'Enter a quantity to sell.');
      if (qty > have + 1e-9) fail(400, 'You do not hold that much ' + sym + '.');
      qty = Math.min(qty, have); inrAmt = r2(qty * unit);
      if (inrAmt <= 0) fail(400, 'Amount too small.');
      u.balance = r2(u.balance + inrAmt); u.holdings[sym] = r8(have - qty); if (u.holdings[sym] <= 1e-9) delete u.holdings[sym];
    }
    const t = { id: nid(), uid: u.id, email: u.email, side: b.side, symbol: sym, qty, priceUsd: p.price, fx, price: r2(unit), amount: inrAmt, ts: now() };
    D.trades.push(t); if (D.trades.length > 20000) D.trades.splice(0, D.trades.length - 20000);
    await save(); return { trade: t, balance: u.balance, holdings: u.holdings };
  },

  'POST /api/bonus/trade': async (req, res, b, u) => {
    needUser(u); limit('bonus:' + u.id, 30, 600e3);
    const c = D.settings.bonusCoin; if (!c.enabled) fail(403, c.symbol + ' is not open right now.');
    const amount = money(b.amount); if (!amount) fail(400, 'Enter a valid whole-rupee amount.');
    if (amount < c.minAmount) fail(400, `Minimum is ₹${c.minAmount}.`); if (amount > c.maxAmount) fail(400, `Maximum per trade is ₹${c.maxAmount}.`);
    if (amount > u.balance) fail(400, 'Not enough wallet balance. Recharge first.');
    u.balance = r2(u.balance - amount);
    // rates are snapshotted on the position, so later admin changes never alter an open trade
    const p = { id: nid(), uid: u.id, email: u.email, symbol: c.symbol, amount, returnPct: c.returnPct, refPct: c.refPct, refBase: c.refBase, lockHours: c.lockHours, status: 'Active', ts: now(), matureAt: now() + c.lockHours * 3600e3 };
    D.positions.push(p); audit(u.email, 'bonus-trade', `#${p.id} ₹${amount} @${c.returnPct}%`);
    settleDue(); await save(); return { position: p, balance: u.balance };
  },

  // ----- admin -----
  'GET /api/admin/overview': async (req, res, b, u) => {
    needAdmin(u); await settleAndSave();
    const users = D.users.filter(x => x.role !== 'admin'), ok = D.deposits.filter(d => d.status === 'Approved'), paid = D.withdrawals.filter(w => w.status === 'Paid');
    const sum = a => a.reduce((s, x) => s + x.amount, 0);
    return {
      users: users.length, wallets: r2(users.reduce((s, x) => s + x.balance, 0)), trades: D.trades.length,
      depositsApproved: sum(ok), withdrawalsPaid: sum(paid),
      pendingDeposits: D.deposits.filter(d => d.status === 'Pending').length, pendingWithdrawals: D.withdrawals.filter(w => w.status === 'Pending').length,
      bonus: { active: D.positions.filter(p => p.status === 'Active').length, activeAmount: sum(D.positions.filter(p => p.status === 'Active')), profitPaid: r2(D.positions.reduce((s, p) => s + (p.profit || 0), 0)), refPaid: r2(D.positions.reduce((s, p) => s + (p.refPaid || 0), 0)) },
      storage: UP_URL ? 'upstash' : 'file', settings: D.settings, min: { deposit: MIN_DEPOSIT, withdraw: MIN_WITHDRAW }
    };
  },
  'GET /api/admin/users': async (req, res, b, u) => { needAdmin(u); return { users: D.users.map(x => ({ ...pubUser(x), blocked: x.blocked, refBy: x.refBy })) }; },
  'GET /api/admin/deposits': async (req, res, b, u) => { needAdmin(u); return { items: [...D.deposits].sort((a, c) => c.ts - a.ts) }; },
  'GET /api/admin/withdrawals': async (req, res, b, u) => { needAdmin(u); return { items: [...D.withdrawals].sort((a, c) => c.ts - a.ts) }; },
  'GET /api/admin/trades': async (req, res, b, u) => { needAdmin(u); return { items: [...D.trades].sort((a, c) => c.ts - a.ts).slice(0, 500) }; },
  'GET /api/admin/bonus': async (req, res, b, u) => { needAdmin(u); await settleAndSave(); return { config: D.settings.bonusCoin, items: [...D.positions].sort((a, c) => c.ts - a.ts).slice(0, 500) }; },
  'POST /api/admin/bonuscoin': async (req, res, b, u) => {
    needAdmin(u);
    const sym = str(b.symbol, 8).toUpperCase(), name = str(b.name, 40), ret = Number(b.returnPct), refp = Number(b.refPct), lock = Number(b.lockHours), mn = Number(b.minAmount), mx = Number(b.maxAmount);
    if (!/^[A-Z0-9]{2,8}$/.test(sym)) fail(400, 'Symbol must be 2–8 letters/digits.'); if (COINS.some(c => c[0] === sym)) fail(400, 'Symbol clashes with a market coin.');
    if (name.length < 2) fail(400, 'Enter a coin name.');
    if (!(ret >= 0 && ret <= 100)) fail(400, 'Return % must be 0–100.'); if (!(refp >= 0 && refp <= 100)) fail(400, 'Referral % must be 0–100.');
    if (b.refBase !== 'profit' && b.refBase !== 'amount') fail(400, 'Bad referral base.');
    if (!(lock >= 0 && lock <= 720)) fail(400, 'Lock hours must be 0–720.');
    if (!Number.isInteger(mn) || mn < 1 || !Number.isInteger(mx) || mx < mn || mx > MAX_AMOUNT) fail(400, 'Check min / max amounts.');
    D.settings.bonusCoin = { enabled: !!b.enabled, symbol: sym, name, returnPct: r2(ret), refPct: r2(refp), refBase: b.refBase, lockHours: lock, minAmount: mn, maxAmount: mx };
    audit(u.email, 'bonuscoin-settings', JSON.stringify(D.settings.bonusCoin)); await save(); return { ok: true };
  },
  'POST /api/admin/position': async (req, res, b, u) => {
    needAdmin(u); const p = D.positions.find(x => x.id === b.id); if (!p) fail(404, 'Not found');
    if (p.status !== 'Active') fail(409, 'Already ' + p.status + '.');
    if (b.action === 'cancel') { const t = D.users.find(x => x.id === p.uid); if (t) t.balance = r2(t.balance + p.amount); p.status = 'Cancelled'; p.done = now(); }   // refund principal once
    else if (b.action === 'settle') settlePosition(p); else fail(400, 'Bad action');
    audit(u.email, 'position-' + b.action, `#${p.id} ₹${p.amount}`); await save(); return { item: p };
  },
  'GET /api/admin/audit': async (req, res, b, u) => { needAdmin(u); return { items: [...D.audit].reverse().slice(0, 300) }; },
  'POST /api/admin/deposit': async (req, res, b, u) => {
    needAdmin(u); const d = D.deposits.find(x => x.id === b.id); if (!d) fail(404, 'Not found');
    if (d.status !== 'Pending') fail(409, 'Already ' + d.status + '.');     // credit exactly once
    if (b.action === 'approve') { const t = D.users.find(x => x.id === d.uid); if (!t) fail(404, 'User missing'); t.balance += d.amount; d.status = 'Approved'; }
    else if (b.action === 'reject') d.status = 'Rejected'; else fail(400, 'Bad action');
    d.by = u.email; d.done = now(); audit(u.email, 'deposit-' + b.action, `#${d.id} ₹${d.amount}`); await save(); return { item: d };
  },
  'POST /api/admin/withdrawal': async (req, res, b, u) => {
    needAdmin(u); const w = D.withdrawals.find(x => x.id === b.id); if (!w) fail(404, 'Not found');
    if (w.status !== 'Pending') fail(409, 'Already ' + w.status + '.');
    if (b.action === 'paid') { w.status = 'Paid'; w.ref = str(b.ref, 40); }
    else if (b.action === 'reject') { const t = D.users.find(x => x.id === w.uid); if (t) t.balance += w.amount; w.status = 'Rejected'; w.note = str(b.note, 120); } // refund once
    else fail(400, 'Bad action');
    w.by = u.email; w.done = now(); audit(u.email, 'withdrawal-' + b.action, `#${w.id} ₹${w.amount}`); await save(); return { item: w };
  },
  'POST /api/admin/user': async (req, res, b, u) => {
    needAdmin(u); const t = D.users.find(x => x.id === b.id); if (!t) fail(404, 'Not found');
    if (t.role === 'admin') fail(400, 'Admin accounts cannot be changed here.');
    if (b.action === 'block') t.blocked = true; else if (b.action === 'unblock') t.blocked = false;
    else if (b.action === 'password') { const pw = String(b.password || ''); if (pw.length < 8) fail(400, 'Min 8 characters'); t.pass = hashPw(pw); }
    else if (b.action === 'adjust') {        // manual wallet correction, always logged with a reason
      const amt = Number(b.amount), reason = str(b.reason, 120);
      if (!Number.isInteger(amt) || amt === 0 || Math.abs(amt) > MAX_AMOUNT) fail(400, 'Enter a non-zero whole amount.');
      if (!reason) fail(400, 'A reason is required.'); if (t.balance + amt < 0) fail(400, 'Balance cannot go below zero.');
      t.balance += amt; audit(u.email, 'adjust', `#${t.id} ${amt > 0 ? '+' : ''}${amt} — ${reason}`); await save(); return { ok: true };
    } else fail(400, 'Bad action');
    audit(u.email, 'user-' + b.action, `#${t.id} ${t.email}`); await save(); return { ok: true };
  },
  'POST /api/admin/settings': async (req, res, b, u) => {
    needAdmin(u); const s = D.settings;
    s.upi = str(b.upi, 60); s.payee = str(b.payee, 60); s.support = str(b.support, 200); s.notice = str(b.notice, 300); s.bonus = str(b.bonus, 600);
    if (s.support && !/^https?:\/\//.test(s.support)) fail(400, 'Support link must start with http:// or https://');
    if (b.qr !== undefined) { const q = String(b.qr || ''); if (q && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(q) || q.length > 400000)) fail(400, 'QR must be a PNG/JPG/WEBP under ~250 KB.'); s.qr = q; }
    audit(u.email, 'settings', ''); await save(); return { ok: true };
  },
  'GET /api/admin/backup': async (req, res, b, u) => {
    needAdmin(u);
    const copy = JSON.parse(JSON.stringify(D)); delete copy.secret; copy.users.forEach(x => delete x.pass);
    return { __download: 'cryptobridge-backup-' + new Date().toISOString().slice(0, 10) + '.json', data: copy };
  }
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 600e3) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new HttpError(400, 'Bad JSON')); } });
    req.on('error', reject);
  });
}
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
function json(res, code, obj, extra = {}) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC, ...extra }); res.end(JSON.stringify(obj)); }

async function handleApi(req, res, pathname) {
  const h = routes[req.method + ' ' + pathname];
  if (!h) return json(res, 404, { error: 'Not found' });
  try {
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) fail(403, 'Bad origin');   // CSRF guard
    }
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await h(req, res, body, authUser(req));
    if (out && out.__download) { res.setHeader('Content-Disposition', `attachment; filename="${out.__download}"`); return json(res, 200, out.data); }
    json(res, 200, out);
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.code, { error: e.message });
    console.error(e); json(res, 500, { error: 'Server error' });
  }
}

// ---------- static (whitelist only: never expose server.js / data) ----------
const STATIC = {
  '/index.html': ['text/html; charset=utf-8', 'no-cache'], '/admin.html': ['text/html; charset=utf-8', 'no-cache'],
  '/style.css': ['text/css; charset=utf-8', 'no-cache'], '/app.js': ['text/javascript; charset=utf-8', 'no-cache'], '/admin.js': ['text/javascript; charset=utf-8', 'no-cache']
};
const server = http.createServer((req, res) => {
  req.ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end('Bad Request'); }

  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('ok'); }
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method Not Allowed'); }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  const meta = STATIC[pathname];
  if (!meta) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not Found'); }
  fs.readFile(path.join(ROOT, pathname), (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': meta[0], 'Cache-Control': meta[1], ...SEC });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
});

async function seedAdmin() {
  const email = normEmail(E.ADMIN_EMAIL || 'admin@cryptobridge.local');
  let pw = E.ADMIN_PASSWORD;
  let admin = D.users.find(u => u.role === 'admin' && u.email === email);
  if (!admin) {
    const generated = !pw; if (!pw) pw = crypto.randomBytes(9).toString('base64url');
    admin = { id: nid(), name: 'Admin', email, phone: '', role: 'admin', pass: hashPw(pw), balance: 0, refCode: makeRef(), refBy: null, blocked: false, created: now() };
    D.users.push(admin); audit('system', 'admin-created', email); await save();
    console.log(`ADMIN CREATED: ${email}` + (generated ? `  password: ${pw}   (set ADMIN_EMAIL / ADMIN_PASSWORD env vars on Render to choose your own)` : ''));
  } else if (E.ADMIN_PASSWORD && !checkPw(E.ADMIN_PASSWORD, admin.pass)) {
    admin.pass = hashPw(E.ADMIN_PASSWORD); audit('system', 'admin-password-from-env', email); await save();
  }
}

if (require.main === module) {
  loadDB().then(seedAdmin).then(() => {
    setInterval(() => settleAndSave().catch(e => console.error(e.message)), 30e3).unref();
    server.listen(PORT, HOST, () => console.log(`Crypto Bridge listening on ${HOST}:${PORT}`));
  }).catch(e => { console.error('Startup failed:', e.message); process.exit(1); });
}
module.exports = { server, loadDB, seedAdmin, MIN_DEPOSIT, MIN_WITHDRAW };
