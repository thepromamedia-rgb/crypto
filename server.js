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

const MIN_DEPOSIT = 1000;   // ₹ default; admin can change in Settings
const MIN_WITHDRAW = 300;   // ₹ default
const MAX_AMOUNT = 10000000;
const MIN_TRADE = 100;     // ₹ per buy order (default)
const LIM = () => D.settings.limits;
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
// Render's ordinary service filesystem is ephemeral. A custom DATA_DIR is not
// evidence of durability unless it is mounted to a Render persistent disk.
const RENDER_DURABLE = !!(UP_URL && UP_TOKEN) || !!(E.DATA_DIR && E.CB_PERSISTENT_DISK === 'true');
const STORAGE_WARNING = !!E.RENDER && !RENDER_DURABLE;


async function up(cmd) {
  const r = await fetch(UP_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + UP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Upstash: ' + (j.error || r.status));
  return j.result;
}

const DEFAULT_COINS = [
  ['BTC', 'Bitcoin', 'bitcoin', '₿'], ['ETH', 'Ethereum', 'ethereum', 'Ξ'], ['ETC', 'Ethereum Classic', 'ethereum-classic', 'E'],
  ['TRX', 'TRON', 'tron', 'T'], ['DOGE', 'Dogecoin', 'dogecoin', 'Ð'], ['BCH', 'Bitcoin Cash', 'bitcoin-cash', 'B'],
  ['COMP', 'Compound', 'compound-governance-token', 'C'], ['DASH', 'Dash', 'dash', 'D'], ['ADA', 'Cardano', 'cardano', 'A'],
  ['LINK', 'Chainlink', 'chainlink', 'L'], ['LTC', 'Litecoin', 'litecoin', 'Ł'], ['BNB', 'BNB', 'binancecoin', 'B'],
  ['XRP', 'XRP', 'ripple', 'X'], ['SOL', 'Solana', 'solana', 'S']
];
const BONUS_DEFAULT = () => ({ enabled: false, symbol: 'CBX', name: 'CB Reward Coin', returnPct: 5, refPct: 10, refBase: 'profit', lockSeconds: 60, lockHours: 0, minAmount: 100, maxAmount: 100000 });
const defaults = () => ({
  v: 1, seq: 1, secret: crypto.randomBytes(32).toString('hex'),
  users: [], demoUsers: [], deposits: [], withdrawals: [], trades: [], positions: [], flipCoinBets: [], flipCoinSessions: [], flipCoinRounds: [], bigSmallBets: [], bigSmallRounds: [], audit: [], panels: [], creditLedger: [],
  settings: { upi: '', payee: '', qr: '', support: '', notice: '', bonus: '', footerText: 'India-focused platform', paymentMode: 'qr', withdrawalFeeType: 'percent', withdrawalFeeValue: 0, withdrawalFeeLabel: 'Platform Fee', limits: { minDeposit: MIN_DEPOSIT, minWithdraw: MIN_WITHDRAW, minTrade: MIN_TRADE }, depositRef: { enabled: false, levels: [0, 0, 0] }, tradeRef: { enabled: false, pct: 5, maxPerTrade: 0, levels: [5, 0, 0] }, bonusCoin: BONUS_DEFAULT(), bonusCoins: [], flipCoin: { enabled: true, minBet: 10, maxBet: 10000, multiplier: 2, lossPct: 100, walletLossPct: 100, walletProfitPct: 100, lossSharePct: 0, feePct: 0, timeProfitMinutes: 0, timeProfitPct: 0, timeLossMinutes: 0, timeLossPct: 0, betProfitCount: 0, betProfitPct: 0, betLossCount: 0, betLossPct: 0 }, withdrawalMode: 'all', withdrawalCooldownHours: 24, coins: DEFAULT_COINS.map(c => c.slice()) }
});
let D = defaults();
const clone = v => JSON.parse(JSON.stringify(v));
const defaultPanel = () => ({ id: 'main', slug: 'main', name: 'Head Admin Main', active: true, deleted: false, created: Date.now(), creditBalance: 0, creditsAllocated: 0, creditsUsed: 0, settings: clone(D.settings) });
function getPanel(slug) {
  slug = String(slug || 'main').toLowerCase();
  const p = (D.panels || []).find(x => x.slug === slug || (Array.isArray(x.aliases) && x.aliases.includes(slug)));
  if (!p) return null;
  // Existing compatibility: migrated users from deleted panels still access main.
  if (p.deleted || !p.active) return D.panels.find(x => x.slug === 'main') || null;
  return p;
}
const S = req => (req && req.panel && req.panel.settings) || D.settings;
const isHead = u => !!u && u.role === 'headAdmin';
const isPanelAdmin = u => !!u && u.role === 'panelAdmin';
const FLIP_MODES = ['heads','tails','lower','random'];
const flipMode = panelId => {
  const panel = (D.panels || []).find(p=>p.slug===panelId);
  const cfg = panel?.settings?.flipCoin || (panelId==='main' ? D.settings.flipCoin : {});
  return FLIP_MODES.includes(cfg?.winningMode) ? cfg.winningMode : 'lower';
};
const flipTotals = (panelId, roundNo) => {
  const bets=(D.flipCoinBets||[]).filter(x=>String(x.panelId||'main')===String(panelId)&&Number(x.roundNo)===Number(roundNo));
  return {heads:r2(bets.filter(x=>x.side==='heads').reduce((n,x)=>n+Number(x.amount||0),0)),tails:r2(bets.filter(x=>x.side==='tails').reduce((n,x)=>n+Number(x.amount||0),0)),headsCount:bets.filter(x=>x.side==='heads').length,tailsCount:bets.filter(x=>x.side==='tails').length};
};
const chooseFlipResult = (mode,t) => mode==='heads'?'heads':mode==='tails'?'tails':mode==='lower'?(t.heads<t.tails?'heads':t.tails<t.heads?'tails':crypto.randomInt(0,2)?'heads':'tails'):(crypto.randomInt(0,2)?'heads':'tails');

function panelValueMatches(panel, value) {
  const v = String(value || 'main');
  if (!panel) return v === 'main';
  return v === String(panel.slug) || v === String(panel.id) || (Array.isArray(panel.aliases) && panel.aliases.includes(v));
}
const panelRows = (req, rows) => isHead(req.user) ? rows : rows.filter(x => panelValueMatches(req.panel, x.panelId || 'main'));
function assertPanelAccess(req, row) { if (!isHead(req.user) && !panelValueMatches(req.panel, row && row.panelId || 'main')) fail(404, 'Not found'); }

async function loadDB() {
  let raw = null;
  if (UP_URL && !UP_TOKEN) throw new Error('UPSTASH_REDIS_REST_TOKEN is missing');
  if (UP_TOKEN && !UP_URL) throw new Error('UPSTASH_REDIS_REST_URL is missing');
  if (UP_URL) { raw = await up(['GET', KEY]); console.log('Storage: Upstash Redis'); }
  else {
    try { raw = fs.readFileSync(DB_FILE, 'utf8'); } catch {}
    console.log('Storage: local file ' + DB_FILE + (PROD ? '  (WARNING: ephemeral on Render — set UPSTASH_REDIS_REST_URL/TOKEN or attach a disk)' : ''));
  }
  if (raw) {
    const saved = JSON.parse(raw);                       // existing data is merged, never discarded
    const ss = saved.settings || {};
    D = { ...defaults(), ...saved, settings: { ...defaults().settings, ...ss, limits: { ...defaults().settings.limits, ...(ss.limits || {}) }, depositRef: { ...defaults().settings.depositRef, ...(ss.depositRef || {}) }, tradeRef: { ...defaults().settings.tradeRef, ...(ss.tradeRef || {}), levels: Array.isArray((ss.tradeRef || {}).levels) ? (ss.tradeRef || {}).levels : [Number((ss.tradeRef || {}).pct || 0), 0, 0] }, bonusCoin: { ...BONUS_DEFAULT(), ...(ss.bonusCoin || {}) }, bonusCoins: Array.isArray(ss.bonusCoins) ? ss.bonusCoins : [], flipCoin: { enabled: true, minBet: 10, maxBet: 10000, multiplier: 2, lossPct: 100, walletLossPct: 100, walletProfitPct: 100, lossSharePct: 0, feePct: 0, timeProfitMinutes: 0, timeProfitPct: 0, timeLossMinutes: 0, timeLossPct: 0, betProfitCount: 0, betProfitPct: 0, betLossCount: 0, betLossPct: 0, ...(ss.flipCoin || {}) }, withdrawalMode: ['all','profit'].includes(ss.withdrawalMode) ? ss.withdrawalMode : 'all', withdrawalCooldownHours: Number.isInteger(Number(ss.withdrawalCooldownHours)) && Number(ss.withdrawalCooldownHours) >= 0 && Number(ss.withdrawalCooldownHours) <= 720 ? Number(ss.withdrawalCooldownHours) : 24, paymentMode: ss.paymentMode === 'razorpay' ? 'razorpay' : 'qr', withdrawalFeeType: ss.withdrawalFeeType === 'fixed' ? 'fixed' : 'percent', withdrawalFeeValue: Math.max(0, Number(ss.withdrawalFeeValue || 0)), withdrawalFeeLabel: String(ss.withdrawalFeeLabel || 'Platform Fee').slice(0, 40) } };
    if (!Array.isArray(ss.bonusCoins) && D.settings.bonusCoin) D.settings.bonusCoins = [{ ...D.settings.bonusCoin, id: 'legacy-' + String(D.settings.bonusCoin.symbol || 'CBX'), startPrice: 1, priceHistory: [] }];
    D.settings.bonusCoin = D.settings.bonusCoins[0] || BONUS_DEFAULT();
    if (!Array.isArray(D.settings.coins) || !D.settings.coins.length) D.settings.coins = DEFAULT_COINS.map(c => c.slice());
    syncCoins();
    for (const k of ['users', 'demoUsers', 'deposits', 'withdrawals', 'trades', 'positions', 'flipCoinBets', 'flipCoinSessions', 'flipCoinRounds', 'bigSmallBets', 'bigSmallRounds', 'audit', 'panels', 'creditLedger']) if (!Array.isArray(D[k])) D[k] = [];
  }
  if (!Array.isArray(D.panels)) D.panels = [];
  if (!D.panels.some(x => x.slug === 'main')) D.panels.unshift(defaultPanel());
  const mainPanel = D.panels.find(x => x.slug === 'main');
  if (!mainPanel.settings) mainPanel.settings = clone(D.settings);
  D.settings = mainPanel.settings; syncCoins();
  mainPanel.name = 'Head Admin Main'; mainPanel.active = true; mainPanel.deleted = false;
  for (const p of D.panels) {
    if (!Number.isFinite(Number(p.creditBalance))) p.creditBalance = 0;
    if (!Number.isFinite(Number(p.creditsAllocated))) p.creditsAllocated = Number(p.creditBalance || 0);
    if (!Number.isFinite(Number(p.creditsUsed))) p.creditsUsed = 0;
    if (!p.settings) p.settings = clone(D.settings);
    if (p.slug !== 'main' && !p.deleted && !p.active) p.active = true;
  }
  // Normalize historical panel references (slug, alias or internal panel ID) without dropping records.
  const panelScopedRows = [...D.users, ...D.demoUsers, ...D.deposits, ...D.withdrawals, ...D.trades, ...D.positions, ...D.creditLedger];
  for (const x of panelScopedRows) {
    if (!x.panelId) { x.panelId = 'main'; continue; }
    const owner = D.panels.find(p => !p.deleted && panelValueMatches(p, x.panelId));
    if (owner) x.panelId = owner.slug;
  }
  ensureAccountUids();
}
let saveChain = Promise.resolve();
function save() {
  const snap = JSON.stringify(D);
  // Serialize writes, but do not report success to an API caller if durable storage failed.
  // Recover the queue after a failed write so later requests can retry.
  const write = saveChain.then(async () => {
    if (UP_URL) await up(['SET', KEY, snap]);
    else {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, snap);
      fs.renameSync(tmp, DB_FILE);
    }
  });
  saveChain = write.catch(e => { console.error('SAVE FAILED', e.message); });
  return write;
}

// ---------- helpers ----------
const nid = () => D.seq++;
const now = () => Date.now();
function uidPrefix(account) {
  const role = String(account && account.role || 'user');
  if (role === 'headAdmin' || role === 'admin') return 'HAD';
  if (role === 'panelAdmin') return 'PAD';
  if (account && account.mode === 'demo' || String(account && account.id || '').startsWith('demo-')) return 'DEM';
  return 'USR';
}
function nextAccountUid(prefix) {
  const accounts = [...(D.users || []), ...(D.demoUsers || [])];
  const used = new Set(accounts.map(x => String(x.uid || '')).filter(Boolean));
  let n = 1, candidate;
  do { candidate = prefix + '-' + String(n++).padStart(6, '0'); } while (used.has(candidate));
  return candidate;
}
function ensureAccountUids() {
  const accounts = [...(D.users || []), ...(D.demoUsers || [])];
  const seen = new Set();
  // Keep established IDs unchanged. Fill missing IDs in creation order and repair duplicates.
  accounts.sort((a, b) => Number(a.created || 0) - Number(b.created || 0) || String(a.id).localeCompare(String(b.id)));
  for (const account of accounts) {
    const prefix = uidPrefix(account);
    if (!account.uid || seen.has(String(account.uid))) account.uid = nextAccountUid(prefix);
    seen.add(String(account.uid));
  }
}
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const money = v => { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= MAX_AMOUNT ? n : null; };
const audit = (who, action, detail) => { D.audit.push({ id: nid(), ts: now(), who, action, detail }); if (D.audit.length > 2000) D.audit.splice(0, D.audit.length - 2000); };
function recordCreditLedger(panel, amount, action, who, detail = '') {
  const row = { id: nid(), ts: now(), panelId: panel.slug, amount: r2(amount), action, who, detail, balanceAfter: r2(panel.creditBalance || 0) };
  D.creditLedger.push(row); if (D.creditLedger.length > 5000) D.creditLedger.splice(0, D.creditLedger.length - 5000);
  return row;
}
function consumePanelCredits(panelId, amount, who, action, detail = '') {
  const panel = D.panels.find(p => p.slug === String(panelId || 'main') && !p.deleted);
  if (!panel) fail(409, 'Credit panel not found.');
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 0 || n > MAX_AMOUNT) fail(400, 'Credit amount must be a whole number between 0 and 10,000,000.');
  if (Number(panel.creditBalance || 0) < n) fail(409, `Insufficient panel credits. Available: ${Number(panel.creditBalance || 0)}; required: ${n}. Ask Head Admin to allocate more credits.`);
  panel.creditBalance = r2(Number(panel.creditBalance || 0) - n);
  panel.creditsUsed = r2(Number(panel.creditsUsed || 0) + n);
  recordCreditLedger(panel, -n, action, who, detail);
  return panel;
}
function previewDepositReferralTotal(user, baseAmount, rates) {
  let total = 0, parentId = user && user.refBy;
  for (let level = 0; level < 3 && parentId; level++) {
    const ref = D.users.find(x => x.id === parentId); if (!ref) break;
    const pct = Number(rates[level] || 0);
    if (!ref.blocked && pct > 0 && baseAmount > 0) total += r2(baseAmount * pct / 100);
    parentId = ref.refBy;
  }
  return r2(total);
}
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
function authUser(req) { const uid = readToken(cookies(req).cb_session); const u = uid && (D.users.find(x => x.id === uid) || D.demoUsers.find(x => x.id === uid)); return u && !u.blocked ? u : null; }

// simple in-memory rate limit
const hits = new Map();
function limit(key, max, windowMs) {
  const t = now(), a = (hits.get(key) || []).filter(x => t - x < windowMs);
  if (a.length >= max) fail(429, 'Too many attempts. Please wait a few minutes.');
  a.push(t); hits.set(key, a);
}
setInterval(() => { const t = now(); for (const [k, a] of hits) if (!a.some(x => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

const pubUser = u => ({ id: u.id, uid: String(u.uid || u.id), name: u.name, email: u.email, phone: u.phone, role: u.role || 'user', mode: u.mode || (String(u.id).startsWith('demo-') ? 'demo' : 'real'), balance: Number(u.balance || 0), refCode: u.refCode || '', created: u.created, holdings: u.holdings || {}, refEarned: u.refEarned || 0 });
const normEmail = v => str(v, 120).toLowerCase();
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const makeRef = () => { let c; do c = 'CB' + crypto.randomBytes(3).toString('hex').toUpperCase(); while (D.users.some(u => u.refCode === c)); return c; };

// ---------- live prices (CoinGecko public API, cached, stale-if-error) ----------
const COINS = DEFAULT_COINS.map(c => c.slice());   // live list; mutated in place when admin adds/removes coins
const syncCoins = () => { COINS.length = 0; COINS.push(...D.settings.coins.map(c => c.slice())); };
const PRICE_API = E.PRICE_API_URL || 'https://api.coingecko.com/api/v3/coins/markets';
let priceCache = { ts: 0, data: null, error: null };
const BINANCE_API = E.BINANCE_API_URL || 'https://data-api.binance.vision/api/v3/ticker/24hr';
async function fromCoinGecko(coins = COINS) {
  const url = `${PRICE_API}?vs_currency=usd&ids=${coins.map(c => c[2]).join(',')}&sparkline=true&price_change_percentage=24h`;
  const headers = { Accept: 'application/json' };
  if (E.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = E.COINGECKO_API_KEY;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('CoinGecko ' + r.status);
  const rows = await r.json(), by = Object.fromEntries(rows.map(x => [x.id, x]));
  return coins.map(([symbol, name, id, mark]) => {
    const x = by[id]; if (!x) return null;
    const sp = (x.sparkline_in_7d && x.sparkline_in_7d.price) || [], step = Math.max(1, Math.floor(sp.length / 28));
    return { symbol, name, mark, price: x.current_price, change: x.price_change_percentage_24h_in_currency ?? x.price_change_percentage_24h ?? 0, spark: sp.filter((_, i) => i % step === 0) };
  }).filter(Boolean);
}
async function fromBinance(coins = COINS, oldCache = priceCache) {   // backup source: no geo-block on data-api.binance.vision, USDT ≈ USD
  const syms = encodeURIComponent(JSON.stringify(coins.map(c => c[0] + 'USDT')));
  const r = await fetch(`${BINANCE_API}?symbols=${syms}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Binance ' + r.status);
  const by = Object.fromEntries((await r.json()).map(x => [x.symbol, x]));
  const old = Object.fromEntries(((oldCache.data) || []).map(x => [x.symbol, x.spark]));
  return coins.map(([symbol, name, , mark]) => {
    const x = by[symbol + 'USDT']; if (!x) return null;
    return { symbol, name, mark, price: Number(x.lastPrice), change: Number(x.priceChangePercent), spark: old[symbol] || [] };
  }).filter(Boolean);
}
const priceCaches = new Map();
async function getPrices(coins = COINS) {
  const cacheKey = coins.map(c => c[0] + ':' + c[2]).join('|');
  let cache = priceCaches.get(cacheKey) || (cacheKey === COINS.map(c => c[0] + ':' + c[2]).join('|') ? priceCache : { ts: 0, data: null, error: null });
  if (cache.data && now() - cache.ts < 20e3) return cache;
  let data = null, errs = [];
  for (const src of ['cg', 'binance']) {
    try {
      data = src === 'cg' ? await fromCoinGecko(coins) : await fromBinance(coins, cache);
      if (data.length) {
        cache = { ts: now(), data, error: null, source: src === 'binance' ? 'Binance' : 'CoinGecko' };
        priceCaches.set(cacheKey, cache);
        if (cacheKey === COINS.map(c => c[0] + ':' + c[2]).join('|')) priceCache = cache;
        return cache;
      }
    } catch (e) { errs.push(e.message); }
  }
  cache = { ...cache, error: errs.join(' | ') };
  priceCaches.set(cacheKey, cache);
  if (!cache.data) fail(503, 'Price sources failed: ' + errs.join(' | '));
  return cache;
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
const KL_LIMIT = { '1m': 130, '3m': 130, '5m': 130, '15m': 130, '1h': 130, '4h': 130, '1d': 130 };
const KL_API = E.BINANCE_KLINES_URL || 'https://data-api.binance.vision/api/v3/klines';
const klCache = new Map();
function getAdminCoinKlines(coin, iv) {
  const durations = { '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
  const step = durations[iv] || 3600000, nowMs = now(), latestTs = Math.floor(nowMs / step) * step;
  const base = Math.max(0.00000001, Number(coin.startPrice) || 1);
  const pct = Math.max(-95, Math.min(500, Number(coin.chartPercent ?? 0)));
  const trendHours = Math.max(1, Math.min(8760, Number(coin.chartHours) || 24));
  const ageHours = Math.max(1, Math.min(8760, Number(coin.chartAgeHours) || 24));
  const chartStartedAt = Number(coin.chartStartedAt) || (nowMs - ageHours * 3600000);
  const firstTs = Math.floor(chartStartedAt / step) * step;
  const count = Math.max(2, Math.min(2000, Math.floor((latestTs - firstTs) / step) + 1));
  const volatility = Math.max(0, Math.min(20, Number(coin.candleVolatilityPct ?? 2))) / 100;
  // Stable synthetic OHLC candles. Historical candles are deterministic per time bucket;
  // only the currently-forming candle changes between polls. Not exchange-sourced data.
  const elapsedHours = Math.max(0, (latestTs - chartStartedAt) / 3600000);
  const target = Math.max(0.00000001, base * Math.pow(Math.max(0.05, 1 + pct / 100), elapsedHours / trendHours));
  const drift = Math.pow(Math.max(0.05, 1 + pct / 100), step / (trendHours * 3600000));
  const randomFor = ts => {
    const text = `${coin.symbol || 'COIN'}:${ts}`; let seed = 2166136261;
    for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619) >>> 0;
    return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  };
  const out = new Array(count); let close = target;
  for (let i = count - 1; i >= 0; i--) {
    const ts = latestTs - (count - 1 - i) * step, rand = randomFor(ts);
    const candleMove = (rand() * 2 - 1) * volatility;
    const open = Math.max(0.00000001, close / Math.max(0.00000001, drift * (1 + candleMove)));
    const isCurrent = i === count - 1;
    const phase = Math.max(0, Math.min(1, (nowMs - latestTs) / step));
    const wobble = isCurrent ? Math.sin(phase * Math.PI * 2 + (ts % 17)) * volatility * phase : 0;
    const candleClose = Math.max(0.00000001, isCurrent ? target * (1 + wobble) : close);
    const high = Math.max(open, candleClose) * (1 + rand() * volatility * 0.7);
    const low = Math.max(0.00000001, Math.min(open, candleClose) * (1 - rand() * volatility * 0.7));
    out[i] = [ts, open, high, low, candleClose, Math.round(100 + rand() * 900)];
    close = open;
  }
  // Keep all completed candles unchanged during the current interval; only last candle wobbles.
  return out;
}
async function getKlines(sym, iv) {
  const adminCoin = (D.settings.bonusCoins || []).find(x => x.symbol === sym);
  if (adminCoin) return getAdminCoinKlines(adminCoin, iv);
  const key = sym + ':' + iv, c = klCache.get(key);
  if (c && now() - c.ts < 30e3) return c.candles;
  try {
    const r = await fetch(`${KL_API}?symbol=${sym}USDT&interval=${iv}&limit=${KL_LIMIT[iv]}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('Binance ' + r.status);
    const candles = (await r.json()).map(k => [k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
    klCache.set(key, { ts: now(), candles }); return candles;
  } catch (e) { if (c) return c.candles; fail(503, 'Chart data unavailable: ' + e.message); }
}

// ---------- bonus coin: fixed return after lock period + referral commission (all admin-controlled) ----------
// Settlement is idempotent: only an 'Active' position can be settled, so principal+return are paid exactly once.
function settlePosition(p) {
  if (p.status !== 'Active') return false;
  const u = p.mode === 'demo' ? D.demoUsers.find(x => x.id === p.uid) : D.users.find(x => x.id === p.uid), profit = r2(p.amount * p.returnPct / 100);
  p.status = 'Settled'; p.profit = profit; p.done = now();
  if (u) u.balance = r2(u.balance + p.amount + profit);
  const ref = p.mode !== 'demo' && u && u.refBy && D.users.find(x => x.id === u.refBy && String(x.panelId || 'main') === String(p.panelId || 'main'));
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
function payReferralLevels(user, baseAmount, rates, kind, maxPerTrade = 0) {
  const payments = []; let parentId = user && user.refBy;
  for (let level = 0; level < 3 && parentId; level++) {
    const ref = D.users.find(x => x.id === parentId);
    if (!ref) break;
    const pct = Number(rates[level] || 0);
    if (!ref.blocked && pct > 0 && baseAmount > 0) {
      let amount = r2(baseAmount * pct / 100);
      if (kind === 'trade' && maxPerTrade > 0) amount = Math.min(amount, maxPerTrade);
      if (amount > 0) {
        ref.balance = r2((ref.balance || 0) + amount);
        ref.refEarned = r2((ref.refEarned || 0) + amount);
        payments.push({ level: level + 1, uid: ref.id, email: ref.email, pct, amount });
      }
    }
    parentId = ref.refBy;
  }
  return payments;
}
const PUBLIC_SETTINGS = (req) => { const st = S(req); return ({ withdrawalMode: st.withdrawalMode || 'all', withdrawalCooldownHours: st.withdrawalCooldownHours ?? 24, withdrawalFeeType: st.withdrawalFeeType || 'percent', withdrawalFeeValue: Number(st.withdrawalFeeValue || 0), withdrawalFeeLabel: st.withdrawalFeeLabel || 'Platform Fee', paymentMode: st.paymentMode || 'qr', razorpayEnabled: !!(E.RAZORPAY_KEY_ID && E.RAZORPAY_KEY_SECRET && E.RAZORPAY_WEBHOOK_SECRET), razorpayKeyId: E.RAZORPAY_KEY_ID || '', upi: st.upi, payee: st.payee, qr: st.qr, support: st.support, notice: st.notice, bonus: st.bonus, footerText: st.footerText || 'India-focused platform', flipCoin: { winningMode: FLIP_MODES.includes(st.flipCoin?.winningMode)?st.flipCoin.winningMode:'lower', enabled: true, minBet: Number(st.flipCoin?.minBet || 10), maxBet: Number(st.flipCoin?.maxBet || 10000), multiplier: 2, lossPct: Number(st.flipCoin?.lossPct ?? 100), walletLossPct: Number(st.flipCoin?.walletLossPct ?? st.flipCoin?.lossPct ?? 100), walletProfitPct: Number(st.flipCoin?.walletProfitPct ?? 100), lossSharePct: Number(st.flipCoin?.lossSharePct || 0), feePct: Number(st.flipCoin?.feePct || 0), timeProfitMinutes: Number(st.flipCoin?.timeProfitMinutes || 0), timeProfitPct: Number(st.flipCoin?.timeProfitPct || 0), timeLossMinutes: Number(st.flipCoin?.timeLossMinutes || 0), timeLossPct: Number(st.flipCoin?.timeLossPct || 0), betProfitCount: Number(st.flipCoin?.betProfitCount || 0), betProfitPct: Number(st.flipCoin?.betProfitPct || 0), betLossCount: Number(st.flipCoin?.betLossCount || 0), betLossPct: Number(st.flipCoin?.betLossPct || 0) }, minDeposit: st.limits.minDeposit, minWithdraw: st.limits.minWithdraw, minTrade: st.limits.minTrade, bonusCoin: st.bonusCoins[0] || st.bonusCoin, bonusCoins: st.bonusCoins.filter(c => c.enabled), depositRef: st.depositRef, tradeRef: { enabled: st.tradeRef.enabled, pct: st.tradeRef.pct, levels: st.tradeRef.levels || [st.tradeRef.pct || 0, 0, 0] }, coins: st.coins }); };
const needUser = u => u || fail(401, 'Please login.');
const needAdmin = u => { needUser(u); if (!['admin', 'headAdmin', 'panelAdmin'].includes(u.role)) fail(403, 'Forbidden'); };
const needHead = u => { needUser(u); if (!isHead(u)) fail(403, 'Head Admin only.'); };

async function razorpayRequest(method, endpoint, payload) {
  const id = E.RAZORPAY_KEY_ID, secret = E.RAZORPAY_KEY_SECRET;
  if (!id || !secret) fail(503, 'Razorpay is not configured on the server.');
  const r = await fetch('https://api.razorpay.com/v1' + endpoint, { method, headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'), 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Razorpay API error', r.status, j.error && j.error.code); fail(502, 'Razorpay could not process the request. Please retry or contact support.'); }
  return j;
}
function signatureMatches(expected, supplied) {
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const a = Buffer.from(expected, 'hex'), b = Buffer.from(supplied, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function creditDeposit(d, paymentId) {
  if (!d || d.status === 'Approved') return { credited: false, alreadyCredited: true };
  if (d.status !== 'Pending' || d.provider !== 'razorpay') return { credited: false, waitingForCredits: false };
  const user = D.users.find(x => x.id === d.uid);
  if (!user) { d.paymentId = paymentId; d.providerStatus = 'captured'; d.capturedAt = d.capturedAt || now(); d.creditPending = true; d.creditError = 'User account missing; manual review required'; return { credited: false, waitingForCredits: true }; }
  const panel = D.panels.find(p => p.slug === String(d.panelId || 'main') && !p.deleted);
  if (!panel) return { credited: false, waitingForCredits: true };
  const creditAmount = Number(d.creditAmount || d.amount);
  const panelSettings = panel.settings || D.settings;
  const cfg = panelSettings.depositRef || { enabled: false, levels: [0,0,0] };
  const referralCost = cfg.enabled && user.refBy ? previewDepositReferralTotal(user, d.amount, cfg.levels || [0,0,0]) : 0;
  const totalCost = r2(creditAmount + referralCost);
  // Payment can be captured before this panel has enough allocated wallet credits.
  // Keep the request pending and retry after Head Admin allocates credits.
  d.paymentId = paymentId; d.providerStatus = 'captured'; d.capturedAt = d.capturedAt || now();
  if (Number(panel.creditBalance || 0) < totalCost) {
    d.creditPending = true; d.creditError = `Awaiting panel credits (${totalCost} required)`;
    audit('system', 'razorpay-awaiting-panel-credits', `deposit #${d.id}, captured ₹${d.amount}; needs ${totalCost} panel credits`);
    return { credited: false, waitingForCredits: true };
  }
  consumePanelCredits(panel.slug, totalCost, 'Razorpay verified', 'deposit-credit', `deposit #${d.id}; user credit ${creditAmount}; referral ${referralCost}`);
  user.balance = r2((user.balance || 0) + creditAmount);
  d.creditedAmount = creditAmount; d.creditsSpent = totalCost; d.creditPending = false; delete d.creditError;
  d.status = 'Approved'; d.done = now(); d.by = 'Razorpay verified';
  if (cfg.enabled && user.refBy) { d.refPayments = payReferralLevels(user, d.amount, cfg.levels || [0,0,0], 'deposit'); d.refPaid = r2(d.refPayments.reduce((sum, x) => sum + x.amount, 0)); }
  audit('system', 'razorpay-deposit-captured', `deposit #${d.id}, order ${d.orderId}, payment ${paymentId}, ₹${d.amount}; credited ${creditAmount}`);
  return { credited: true, waitingForCredits: false };
}
async function confirmRazorpayPayment(orderId, paymentId, suppliedSignature) {
  const d = D.deposits.find(x => x.provider === 'razorpay' && x.orderId === orderId);
  if (!d) fail(404, 'Payment order not found.');
  if (d.status === 'Approved') return { ok: true, alreadyCredited: true };
  if (d.status !== 'Pending' || d.uid == null) fail(409, 'This deposit is no longer pending.');
  const expected = crypto.createHmac('sha256', E.RAZORPAY_KEY_SECRET).update(orderId + '|' + paymentId).digest('hex');
  if (!signatureMatches(expected, suppliedSignature)) fail(400, 'Payment signature verification failed.');
  const payment = await razorpayRequest('GET', '/payments/' + encodeURIComponent(paymentId));
  if (payment.order_id !== orderId || payment.status !== 'captured' || Number(payment.amount) !== Number(d.amount) * 100 || payment.currency !== 'INR') fail(409, 'Payment is not captured for the expected amount. Balance was not credited.');
  const result = creditDeposit(d, paymentId);
  await save();
  return { ok: true, alreadyCredited: false, waitingForCredits: !!result.waitingForCredits, message: result.waitingForCredits ? 'Payment verified. Wallet credit is pending until Head Admin allocates enough panel credits.' : 'Payment verified and wallet credited.', deposit: d };
}

const routes = {
  'GET /api/prices': async (req) => { const c = await getPrices(S(req).coins); const fx = await getFx().catch(() => fxCache.v || 0); return { fx, prices: c.data, updated: c.ts, stale: !!c.error, source: c.source || '' }; },
  'GET /api/config': async (req) => PUBLIC_SETTINGS(req),
  'GET /api/klines': async (req) => {
    limit('kl:' + req.ip, 120, 60e3);
    const q = new URL(req.url, 'http://x').searchParams, sym = str(q.get('symbol'), 10).toUpperCase(), iv = q.get('interval') || '1h';
    if (!S(req).coins.some(c => c[0] === sym) && !(S(req).bonusCoins || []).some(c => c.symbol === sym)) fail(400, 'Unknown coin.'); if (!KL_LIMIT[iv]) fail(400, 'Bad interval.');
    const localCoin = (S(req).bonusCoins || []).find(c => c.symbol === sym);
    return { symbol: sym, interval: iv, candles: localCoin ? getAdminCoinKlines(localCoin, iv) : await getKlines(sym, iv) };
  },

  'POST /api/register': async (req, res, b) => {
    limit('reg:' + req.ip, 10, 3600e3);
    const name = str(b.name, 60), email = normEmail(b.email), phone = str(b.phone, 20).replace(/[^\d+]/g, ''), pw = String(b.password || '');
    if (name.length < 2) fail(400, 'Enter your name.');
    if (!emailOk(email)) fail(400, 'Enter a valid email.');
    if (pw.length < 8 || pw.length > 100) fail(400, 'Password must be 8–100 characters.');
    if (D.users.some(u => u.email === email) || D.demoUsers.some(u => u.email === email)) fail(409, 'This email is already registered.');
    const ref = str(b.ref, 20).toUpperCase(); let refBy = ref && D.users.find(u => u.refCode === ref && String(u.panelId || 'main') === String(req.panelId || 'main'));
    if (refBy && ((refBy.phone && refBy.phone === phone) || refBy.email === email)) refBy = null;   // no self-referral with the same phone
    const u = { id: nid(), uid: nextAccountUid('USR'), name, email, phone, role: 'user', panelId: req.panelId || 'main', pass: hashPw(pw), balance: 0, refCode: makeRef(), refBy: refBy ? refBy.id : null, blocked: false, created: now() };
    D.users.push(u); audit('system', 'register', u.email); await save();
    setCookie(res, makeToken(u.id), 7 * 86400);
    return { user: pubUser(u) };
  },
  'POST /api/login': async (req, res, b) => {
    const email = normEmail(b.email); limit('login:' + req.ip, 20, 600e3); limit('loginu:' + email, 8, 600e3);
    // Verify against matching credentials rather than the first email match.
    // Older imported databases can contain duplicate email records.
    const candidates = [...D.users, ...D.demoUsers].filter(x => normEmail(x.email) === email);
    const u = candidates.find(x => checkPw(String(b.password || ''), x.pass));
    if (!u) fail(401, 'Wrong email or password.');
    // Once credentials are verified, give panel admins a useful redirect hint instead of
    // disguising a correct password as a password error when they use /admin by mistake.
    if (u.role === 'panelAdmin' && String(u.panelId || '') !== String(req.panelId || 'main')) {
      const slug = String(u.panelId || '');
      if (u.blocked) fail(403, 'This account is blocked. Contact support.');
      const ownPanel = getPanel(slug);
      if (!ownPanel || ownPanel.deleted || ownPanel.active === false) fail(403, 'This panel is unavailable. Contact Head Admin.');
      setCookie(res, makeToken(u.id), 7 * 86400);
      return { user: pubUser(u), adminRedirect: '/p/' + ownPanel.slug + '/admin' };
    }
    if (u.role !== 'headAdmin' && String(u.panelId || 'main') !== String(req.panelId || 'main')) fail(401, 'Wrong email or password.');
    if (u.blocked) fail(403, 'This account is blocked. Contact support.');
    setCookie(res, makeToken(u.id), 7 * 86400);
    return { user: pubUser(u), ...(u.role === 'headAdmin' && req.panelId !== 'main' ? {adminRedirect:'/admin'} : {}) };
  },
  'POST /api/logout': async (req, res) => { setCookie(res, '', 0); return { ok: true }; },
  'GET /api/me': async (req, res, b, u) => {
    needUser(u); await settleAndSave();
    return {
      user: pubUser(u), config: PUBLIC_SETTINGS(req), panel: { id: req.panel.id, slug: req.panel.slug, name: req.panel.name },
      positions: D.positions.filter(p => p.uid === u.id).sort((a, c) => c.ts - a.ts).slice(0, 50),
      deposits: D.deposits.filter(d => d.uid === u.id).sort((a, c) => c.ts - a.ts),
      withdrawals: D.withdrawals.filter(w => w.uid === u.id).sort((a, c) => c.ts - a.ts),
      referrals: u.mode === 'demo' ? 0 : D.users.filter(x => x.refBy === u.id && String(x.panelId || 'main') === String(u.panelId || 'main')).length,
      trades: (u.mode === 'demo' ? (u.trades || []) : D.trades.filter(t => t.uid === u.id)).sort((a, c) => c.ts - a.ts).slice(0, 50)
    };
  },
  'POST /api/password': async (req, res, b, u) => {
    needUser(u); limit('pw:' + u.id, 5, 600e3);
    if (!checkPw(String(b.current || ''), u.pass)) fail(400, 'Current password is wrong.');
    const pw = String(b.password || ''); if (pw.length < 8 || pw.length > 100) fail(400, 'New password must be 8–100 characters.');
    u.pass = hashPw(pw); audit(u.email, 'password-change', ''); await save(); return { ok: true };
  },
  'POST /api/razorpay/order': async (req, res, b, u) => {
    needUser(u); if (u.mode === 'demo') fail(403, 'Demo accounts cannot make real deposits.');
    if (S(req).paymentMode !== 'razorpay') fail(403, 'Razorpay deposits are currently disabled by the administrator.');
    if (!E.RAZORPAY_KEY_ID || !E.RAZORPAY_KEY_SECRET || !E.RAZORPAY_WEBHOOK_SECRET) fail(503, 'Razorpay is not fully configured on the server.');
    limit('rzorder:' + u.id, 8, 3600e3);
    const amount = money(b.amount); if (!amount) fail(400, 'Enter a valid amount.');
    if (amount < S(req).limits.minDeposit) fail(400, `Minimum deposit is ₹${S(req).limits.minDeposit.toLocaleString('en-IN')}.`);
    const d = { id: nid(), uid: u.id, email: u.email, panelId: u.panelId || req.panelId || 'main', amount, status: 'Pending', provider: 'razorpay', paymentMethod: 'razorpay', ts: now() };
    const order = await razorpayRequest('POST', '/orders', { amount: amount * 100, currency: 'INR', receipt: 'cb_' + d.id + '_' + now(), notes: { app: 'Crypto Bridge', deposit_id: String(d.id), user_id: String(u.id) } });
    d.orderId = order.id; d.providerStatus = order.status || 'created'; D.deposits.push(d);
    audit(u.email, 'razorpay-order-created', `deposit #${d.id}, order ${order.id}, ₹${amount}`); await save();
    return { keyId: E.RAZORPAY_KEY_ID, orderId: order.id, amount: order.amount, currency: order.currency, depositId: d.id, name: 'Crypto Bridge', description: 'Wallet deposit' };
  },
  'POST /api/razorpay/verify': async (req, res, b, u) => {
    needUser(u); const orderId = str(b.razorpay_order_id, 80), paymentId = str(b.razorpay_payment_id, 80), sig = str(b.razorpay_signature, 128);
    const d = D.deposits.find(x => x.provider === 'razorpay' && x.orderId === orderId);
    if (!d || d.uid !== u.id) fail(404, 'Your payment order was not found.');
    return await confirmRazorpayPayment(orderId, paymentId, sig);
  },
  'POST /api/deposit': async (req, res, b, u) => {
    needUser(u); if (u.mode === 'demo') fail(403, 'Demo accounts use simulated funds; real deposits are disabled.'); if (S(req).paymentMode === 'razorpay') fail(403, 'QR/UTR deposits are disabled. Use Razorpay Checkout.'); limit('dep:' + u.id, 10, 3600e3);
    const amount = money(b.amount); if (!amount) fail(400, 'Enter a valid amount.');
    if (amount < S(req).limits.minDeposit) fail(400, `Minimum deposit is ₹${S(req).limits.minDeposit.toLocaleString('en-IN')}.`);
    const utr = str(b.utr, 30).toUpperCase(); if (!/^[A-Z0-9]{8,30}$/.test(utr)) fail(400, 'Enter the UTR / transaction reference (8–30 letters/digits).');
    if (D.deposits.some(d => d.utr === utr)) fail(409, 'This UTR has already been submitted.');
    if (!S(req).upi && !S(req).qr) fail(503, 'Deposits are not open yet. Contact support.');
    const d = { id: nid(), uid: u.id, email: u.email, panelId: u.panelId || req.panelId || 'main', amount, utr, status: 'Pending', ts: now() };
    D.deposits.push(d); audit(u.email, 'deposit-request', `₹${amount} ${utr}`); await save(); return { deposit: d };
  },
  'POST /api/withdraw': async (req, res, b, u) => {
    needUser(u); limit('wd:' + u.id, 10, 3600e3);
    const amount = money(b.amount); if (!amount) fail(400, 'Enter a valid amount.');
    if (amount < S(req).limits.minWithdraw) fail(400, `Minimum withdrawal is ₹${S(req).limits.minWithdraw}.`);
    const lastRejected = D.withdrawals.filter(w => w.uid === u.id && w.status === 'Rejected' && Number(w.retryAt || 0) > now()).sort((a,b) => Number(b.retryAt || 0) - Number(a.retryAt || 0))[0];
    if (lastRejected) { const mins = Math.ceil((lastRejected.retryAt - now()) / 60000); fail(429, `Your last withdrawal was rejected. You can submit another request in about ${mins} minute(s).`); }
    if (amount > u.balance) fail(400, 'Amount is more than your available balance.');
    const mode = S(req).withdrawalMode || 'all';
    if (mode === 'profit') {
      const userTrades = u.mode === 'demo' ? (u.trades || []) : D.trades.filter(t => t.uid === u.id);
      const earned = r2(D.positions.filter(p => p.uid === u.id && p.status === 'Settled').reduce((n,p) => n + Math.max(0, Number(p.profit || 0)), 0) + userTrades.reduce((n,t) => n + Math.max(0, Number(t.profit || 0)), 0));
      const alreadyRequested = r2(D.withdrawals.filter(w => w.uid === u.id && ['Pending','Paid'].includes(w.status)).reduce((n,w) => n + Number(w.amount || 0), 0));
      const availableProfit = Math.max(0, r2(earned - alreadyRequested));
      if (amount > availableProfit) fail(400, `Profit-only withdrawals are enabled. Available profit for withdrawal: ₹${availableProfit}. To request principal release, contact support.`);
    }
    const upi = str(b.upi, 60); if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upi)) fail(400, 'Enter a valid UPI ID (name@bank).');
    const feeType = S(req).withdrawalFeeType === 'fixed' ? 'fixed' : 'percent';
    const feeValue = Math.max(0, Number(S(req).withdrawalFeeValue || 0));
    const fee = Math.min(amount, r2(feeType === 'fixed' ? feeValue : amount * feeValue / 100));
    const netAmount = r2(amount - fee);
    if (netAmount <= 0) fail(400, 'Withdrawal fee must be less than the requested amount.');
    u.balance = r2(u.balance - amount);   // gross amount held; refunded once if rejected
    const w = { id: nid(), uid: u.id, email: u.email, panelId: u.panelId || req.panelId || 'main', mode: u.mode || (String(u.id).startsWith('demo-') ? 'demo' : 'real'), amount, fee, feeType, feeValue, feeLabel: str(S(req).withdrawalFeeLabel || 'Platform Fee', 40), netAmount, upi, status: 'Pending', ts: now() };
    D.withdrawals.push(w); audit(u.email, 'withdraw-request', `gross ₹${amount}; fee ₹${fee}; payout ₹${netAmount} ${upi}`); await save(); return { withdrawal: w, balance: u.balance };
  },

  'POST /api/trade': async (req, res, b, u) => {
    needUser(u); limit('trade:' + u.id, 40, 600e3);
    const sym = str(b.symbol, 10).toUpperCase(), coin = S(req).coins.find(c => c[0] === sym); if (!coin) fail(400, 'Unknown coin.');
    if (b.side !== 'buy' && b.side !== 'sell') fail(400, 'Bad order.');
    const pc = await getPrices(S(req).coins), fx = await getFx();
    if (pc.error || now() - pc.ts > 60e3) fail(503, 'Live price is not fresh right now. Please try again in a moment.');
    const p = pc.data.find(x => x.symbol === sym); if (!p) fail(503, 'Price unavailable for ' + sym);
    const unit = p.price * fx;                       // ₹ per coin, decided on the server only
    if (!u.holdings) u.holdings = {};
    let qty, inrAmt, profit = null, refPaid = 0, refUid = null, tRefPayments = [];
    if (b.side === 'buy') {
      inrAmt = r2(Number(b.amount));
      if (!Number.isFinite(inrAmt) || inrAmt < S(req).limits.minTrade) fail(400, `Minimum buy is ₹${S(req).limits.minTrade}.`);
      if (inrAmt > u.balance) fail(400, 'Not enough wallet balance. Recharge first.');
      qty = Math.floor(inrAmt / unit * 1e8) / 1e8; if (qty <= 0) fail(400, 'Amount too small.');
      if (!u.cost) u.cost = {};
      if (u.cost[sym] == null && (u.holdings[sym] || 0) > 0) u.cost[sym] = r2(u.holdings[sym] * unit);   // legacy holding: cost basis = value now (no profit claimed)
      u.cost[sym] = r2((u.cost[sym] || 0) + inrAmt);
      u.balance = r2(u.balance - inrAmt); u.holdings[sym] = r8((u.holdings[sym] || 0) + qty);
    } else {
      const have = u.holdings[sym] || 0;
      qty = b.all ? have : r8(Number(b.qty));
      if (!Number.isFinite(qty) || qty <= 0) fail(400, 'Enter a quantity to sell.');
      if (qty > have + 1e-9) fail(400, 'You do not hold that much ' + sym + '.');
      qty = Math.min(qty, have); inrAmt = r2(qty * unit);
      if (inrAmt <= 0) fail(400, 'Amount too small.');
      if (!u.cost) u.cost = {};
      const costPart = u.cost[sym] == null ? inrAmt : r2(u.cost[sym] * qty / have);       // average-cost method
      profit = r2(inrAmt - costPart); u.cost[sym] = r2(Math.max(0, (u.cost[sym] == null ? 0 : u.cost[sym]) - costPart));
      u.balance = r2(u.balance + inrAmt); u.holdings[sym] = r8(have - qty); if (u.holdings[sym] <= 1e-9) { delete u.holdings[sym]; delete u.cost[sym]; }
      // referral commission: only on REAL realised profit, paid from platform funds (the user's own proceeds are not reduced)
      const tr = S(req).tradeRef;
      if (tr.enabled && profit > 0 && u.refBy) {
        const rates = Array.isArray(tr.levels) ? tr.levels : [Number(tr.pct || 0), 0, 0];
        const payments = payReferralLevels(u, profit, rates, 'trade', Number(tr.maxPerTrade || 0));
        refPaid = r2(payments.reduce((sum, x) => sum + x.amount, 0));
        if (payments.length) { tRefPayments = payments; refUid = payments[0].uid; }
      }
    }
    const t = { id: nid(), uid: u.id, email: u.email, panelId: u.panelId || req.panelId || 'main', side: b.side, symbol: sym, qty, priceUsd: p.price, fx, price: r2(unit), amount: inrAmt, ts: now() };
    if (profit !== null) t.profit = profit; if (refPaid) { t.refPaid = refPaid; t.refUid = refUid; t.refPayments = tRefPayments; audit('system', 'trade-referral', `#${t.id} ${u.email} profit ₹${profit} -> ₹${refPaid} across ${tRefPayments.length} level(s)`); }
    if (u.mode === 'demo') { if (!Array.isArray(u.trades)) u.trades = []; u.trades.push(t); if (u.trades.length > 2000) u.trades.splice(0, u.trades.length - 2000); }
    else { D.trades.push(t); if (D.trades.length > 20000) D.trades.splice(0, D.trades.length - 20000); }
    await save(); return { trade: t, balance: u.balance, holdings: u.holdings };
  },

  'POST /api/bonus/trade': async (req, res, b, u) => {
    needUser(u); limit('bonus:' + u.id, 30, 600e3);
    const sym = str(b.symbol || (S(req).bonusCoins[0] || S(req).bonusCoin).symbol, 8).toUpperCase(); const c = S(req).bonusCoins.find(x => x.symbol === sym); if (!c || !c.enabled) fail(403, sym + ' is not open right now.');
    const amount = money(b.amount); if (!amount) fail(400, 'Enter a valid whole-rupee amount.');
    if (amount < c.minAmount) fail(400, `Minimum is ₹${c.minAmount}.`); if (amount > c.maxAmount) fail(400, `Maximum per trade is ₹${c.maxAmount}.`);
    if (amount > u.balance) fail(400, 'Not enough wallet balance. Recharge first.');
    u.balance = r2(u.balance - amount);
    // rates are snapshotted on the position, so later admin changes never alter an open trade
    const p = { id: nid(), uid: u.id, email: u.email, panelId: u.panelId || req.panelId || 'main', mode: u.mode || (String(u.id).startsWith('demo-') ? 'demo' : 'real'), symbol: c.symbol, amount, returnPct: c.returnPct, refPct: c.refPct, refBase: c.refBase, lockSeconds: Number(c.lockSeconds ?? (c.lockHours || 0) * 3600), lockHours: Number(c.lockSeconds ?? (c.lockHours || 0) * 3600) / 3600, status: 'Active', ts: now(), matureAt: now() + Number(c.lockSeconds ?? (c.lockHours || 0) * 3600) * 1000 };
    D.positions.push(p); audit(u.email, 'bonus-trade', `#${p.id} ₹${amount} @${c.returnPct}%`);
    settleDue(); await save(); return { position: p, balance: u.balance };
  },

  // ----- Flip Coin game (server-authoritative results and wallet accounting) -----
  'GET /api/games/flip-coin': async (req, res, b, u) => {
    needUser(u); const cfg = S(req).flipCoin || {};
    if (!Array.isArray(D.flipCoinSessions)) D.flipCoinSessions = [];
    if (!Array.isArray(D.flipCoinRounds)) D.flipCoinRounds = [];
    const panelId = req.panelId || 'main', ts = now();
    // Global 30-second rounds: one server-generated outcome is shared by all users in a panel.
    const roundNo = Math.floor(ts / 30000), startTs = roundNo * 30000, endTs = startTs + 30000;
    // Create round records independently of bets, backfilling recent rounds on every poll.
    let roundsChanged = false;
    for (let n = Math.max(0, roundNo - 10); n <= roundNo; n++) {
      if (!D.flipCoinRounds.some(x => Number(x.roundNo) === n && String(x.panelId || 'main') === String(panelId))) {
        D.flipCoinRounds.push({ roundNo:n, panelId, startTs:n*30000, endTs:(n+1)*30000, result:null, winningMode:flipMode(panelId), settled:false, createdTs:ts }); roundsChanged = true;
      }
    }
    if (D.flipCoinRounds.length > 2000) D.flipCoinRounds.splice(0, D.flipCoinRounds.length - 2000);
    let round = D.flipCoinRounds.find(x => x.roundNo === roundNo && String(x.panelId || 'main') === String(panelId));
    if (roundsChanged) await save();
    // Published rule: the side with the lower total stake wins. Ties use a fair coin toss.
    // Lock results only after the betting deadline; never change a finalized round.
    for (const r of D.flipCoinRounds) {
      if (String(r.panelId || 'main') !== String(panelId) || Number(r.roundNo) >= roundNo || r.outcomeLocked) continue;
      const bets = (D.flipCoinBets || []).filter(x => String(x.panelId || 'main') === String(panelId) && Number(x.roundNo) === Number(r.roundNo));
      const heads = r2(bets.filter(x => x.side === 'heads').reduce((n,x)=>n+Number(x.amount||0),0));
      const tails = r2(bets.filter(x => x.side === 'tails').reduce((n,x)=>n+Number(x.amount||0),0));
      r.winningMode = r.winningMode || flipMode(panelId);
      r.result = chooseFlipResult(r.winningMode,{heads,tails});
      r.headsTotal = heads; r.tailsTotal = tails; r.outcomeLocked = true;
      roundsChanged = true;
    }
    if (roundsChanged) await save();
    // Settle bets from completed rounds once, using the stored shared result.
    let changed = false;
    for (const bet of (D.flipCoinBets || [])) {
      if (bet.status !== 'Pending' || Number(bet.roundNo) >= roundNo || String(bet.panelId || 'main') !== String(panelId)) continue;
      const resultRound = D.flipCoinRounds.find(x => x.roundNo === Number(bet.roundNo) && String(x.panelId || 'main') === String(panelId));
      if (!resultRound) continue;
      const owner = [...D.users, ...D.demoUsers].find(x => String(x.id) === String(bet.userId));
      if (!owner) { bet.status = 'Settled'; bet.result = resultRound.result; bet.won = resultRound.result === bet.side; bet.net = 0; bet.ts = resultRound.endTs; changed = true; continue; }
      const won = resultRound.result === bet.side, payout = won ? r2(bet.amount * 2) : 0;
      const beforeSettle = Number(owner.balance || 0); owner.balance = r2(beforeSettle + payout);
      bet.result = resultRound.result; bet.won = won; bet.payout = payout; bet.lossAmount = won ? 0 : bet.amount; bet.net = r2((won ? bet.amount : -bet.amount) - Number(bet.fee || 0)); bet.balanceAfter = owner.balance; bet.status = 'Settled'; bet.ts = resultRound.endTs; changed = true;
      audit(bet.email, 'flip-coin-settlement', `round #${bet.roundNo} ${bet.result}; ${won ? 'won' : 'lost'}; payout ${payout}`);
    }
    if (changed) await save();
    let gameSession = D.flipCoinSessions.find(x => x.userId === u.id && String(x.panelId || 'main') === String(panelId));
    if (!gameSession || ts - Number(gameSession.lastActivityTs || gameSession.startTs || 0) > 30 * 60000) {
      gameSession = { id: crypto.randomUUID(), userId: u.id, panelId, startTs: ts, startBalance: r2(Number(u.balance || 0)), timeProfitResetTs: ts, timeLossResetTs: ts, betProfitCount: 0, betLossCount: 0, lastActivityTs: ts };
      D.flipCoinSessions = D.flipCoinSessions.filter(x => !(x.userId === u.id && String(x.panelId || 'main') === String(panelId))); D.flipCoinSessions.push(gameSession); await save();
    } else { gameSession.lastActivityTs = ts; }
    return { config: { winningMode:flipMode(panelId), enabled: true, minBet: Number(cfg.minBet || 10), maxBet: Number(cfg.maxBet || 10000), multiplier: 2, feePct: Number(cfg.feePct || 0) },
      round: { number: roundNo, startTs, endTs, remainingMs: Math.max(0, endTs-ts), bettingOpen: endTs-ts > 5000 },
      resultsHistory: D.flipCoinRounds.filter(x => String(x.panelId || 'main') === String(panelId) && Number(x.roundNo) < roundNo && x.outcomeLocked).slice().sort((a,b)=>Number(b.roundNo)-Number(a.roundNo)).slice(0,10).map(x=>({roundNo:x.roundNo,result:x.result,endTs:x.endTs})),
      currentBets: (D.flipCoinBets || []).filter(x => x.userId === u.id && String(x.panelId || 'main') === String(panelId) && Number(x.roundNo) === roundNo).map(x=>({id:x.id,side:x.side,amount:x.amount,status:x.status})),
      history: (D.flipCoinBets || []).filter(x => x.userId === u.id && String(x.panelId || 'main') === String(panelId)).slice().sort((a,b)=>Number(b.ts)-Number(a.ts)).slice(0,1000) };
  },
  'POST /api/games/flip-coin': async (req, res, b, u) => {
    needUser(u); if (u.role !== 'user') fail(403, 'Only user accounts can play this game.');
    const cfg = S(req).flipCoin || {}, amount = Number(b.amount), side = String(b.side || '').toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) fail(400, 'Enter a valid bet amount.');
    if (amount < Number(cfg.minBet || 10) || amount > Number(cfg.maxBet || 10000)) fail(400, `Bet must be between ${cfg.minBet} and ${cfg.maxBet} credits.`);
    if (!['heads','tails'].includes(side)) fail(400, 'Choose Heads or Tails.');
    if (!Array.isArray(D.flipCoinRounds)) D.flipCoinRounds = [];
    const ts = now(), roundNo = Math.floor(ts / 30000), startTs = roundNo * 30000, endTs = startTs + 30000, remainingMs = endTs-ts;
    if (remainingMs <= 5000) fail(400, 'Betting closed for this round. Wait for the next round.');
    const panelId = req.panelId || 'main';
    let round = D.flipCoinRounds.find(x => x.roundNo === roundNo && String(x.panelId || 'main') === String(panelId));
    if (!round) { round = { roundNo, panelId, startTs, endTs, result:null, winningMode:flipMode(panelId), settled:false, createdTs:ts }; D.flipCoinRounds.push(round); if (D.flipCoinRounds.length > 2000) D.flipCoinRounds.splice(0, D.flipCoinRounds.length - 2000); }
    const existingRoundBets = (D.flipCoinBets || []).filter(x => String(x.userId) === String(u.id) && String(x.panelId || 'main') === String(panelId) && Number(x.roundNo) === roundNo);
    if (existingRoundBets.some(x => String(x.side).toLowerCase() !== side)) fail(400, 'Is round mein aap pehle hi doosri side choose kar chuke ho. Isi side par hi bet laga sakte ho.');
    const feePct = Number(cfg.feePct || 0), fee = r2(amount*feePct/100), debit = r2(amount+fee), before = r2(Number(u.balance||0));
    if (debit > before) fail(400, 'Not enough wallet credits for this bet and fee.');
    u.balance = r2(before-debit);
    const row = { id: crypto.randomUUID(), userId:u.id, uid:String(u.uid||u.id), email:u.email, panelId, roundNo, amount:r2(amount), side, status:'Pending', result:null, won:null, multiplier:2, feePct, fee, payout:0, lossAmount:0, net:0, balanceAfter:u.balance, ts, roundEndTs:endTs };
    if (!Array.isArray(D.flipCoinBets)) D.flipCoinBets=[]; D.flipCoinBets.push(row);
    audit(u.email, 'flip-coin', `bet ${amount} ${side}; round #${roundNo}; pending result; fee ${fee}`);
    await save(); return { bet: row, balance:u.balance, round:{number:roundNo,endTs,remainingMs,bettingOpen:remainingMs>5000} };
  },
  // ----- Big Small game: shared number result, with independent duration rounds -----
  'GET /api/games/big-small': async (req, res, b, u) => {
    needUser(u);
    const panelId=req.panelId||'main', ts=now();
    const requestedDuration=Number(new URL(req.url,'http://localhost').searchParams.get('duration')||30000);
    const durationMs=[30000,60000,180000,300000].includes(requestedDuration)?requestedDuration:30000;
    const durationKey=String(durationMs), isDuration=x=>Number(x.durationMs||30000)===durationMs;
    const roundNo=Math.floor(ts/durationMs), startTs=roundNo*durationMs, endTs=startTs+durationMs;
    if(!Array.isArray(D.bigSmallRounds))D.bigSmallRounds=[];
    if(!Array.isArray(D.bigSmallBets))D.bigSmallBets=[];
    for(let n=Math.max(0,roundNo-10);n<=roundNo;n++) if(!D.bigSmallRounds.some(x=>Number(x.roundNo)===n&&String(x.panelId||'main')===String(panelId)&&isDuration(x))) D.bigSmallRounds.push({roundNo:n,panelId,durationMs,startTs:n*durationMs,endTs:(n+1)*durationMs,result:null,createdTs:ts,outcomeLocked:false});
    let changed=false;
    for(const r of D.bigSmallRounds){ if(String(r.panelId||'main')!==String(panelId)||!isDuration(r)||Number(r.roundNo)>=roundNo||r.outcomeLocked) continue;
      // Preserve the ZIP's existing result-selection rules for every duration.
      const roundBets=D.bigSmallBets.filter(x=>Number(x.roundNo)===Number(r.roundNo)&&String(x.panelId||'main')===String(panelId)&&Number(x.durationMs||30000)===durationMs);
      if(roundBets.length===0){ r.result=crypto.randomInt(0,10); }
      else {
        const totals={Big:0,Small:0};
        for(const bet of roundBets) if(bet.type==='size'&&(bet.pick==='Big'||bet.pick==='Small')) totals[bet.pick]+=Number(bet.amount||0);
        let chosenSize;
        if(totals.Big<totals.Small)chosenSize='Big'; else if(totals.Small<totals.Big)chosenSize='Small'; else chosenSize='Small';
        const nums=chosenSize==='Big'?[5,6,7,8,9]:[0,1,2,3,4];
        const numberTotals=Object.fromEntries(nums.map(n=>[n,0]));
        for(const bet of roundBets) if(bet.type==='number'&&Object.prototype.hasOwnProperty.call(numberTotals,String(bet.pick))) numberTotals[Number(bet.pick)]+=Number(bet.amount||0);
        const lowest=Math.min(...nums.map(n=>numberTotals[n])); const tied=nums.filter(n=>numberTotals[n]===lowest); r.result=Math.min(...tied);
      }
      r.bigSmall=r.result>=5?'Big':'Small';
      r.color=(r.result===0?'Red+Violet':r.result===5?'Green+Violet':r.result%2===1?'Green':'Red'); r.outcomeLocked=true; changed=true;
    }
    for(const bet of D.bigSmallBets){ if(bet.status!=='Pending'||Number(bet.roundNo)>=roundNo||String(bet.panelId||'main')!==String(panelId)||Number(bet.durationMs||30000)!==durationMs) continue;
      const rr=D.bigSmallRounds.find(x=>Number(x.roundNo)===Number(bet.roundNo)&&String(x.panelId||'main')===String(panelId)&&isDuration(x)); if(!rr||!rr.outcomeLocked)continue;
      const owner=[...D.users,...D.demoUsers].find(x=>String(x.id)===String(bet.userId));
      const win=bet.type==='number'?Number(bet.pick)===Number(rr.result):bet.type==='size'?String(bet.pick)===rr.bigSmall:String(bet.pick)==='Violet'?rr.color.includes('Violet'):rr.color.split('+')[0]===String(bet.pick);
      const payout=win?r2(Number(bet.amount)*Number(bet.multiplier)):0;
      if(owner&&payout)owner.balance=r2(Number(owner.balance||0)+payout);
      bet.result=rr.result;bet.resultSize=rr.bigSmall;bet.resultColor=rr.color;bet.won=win;bet.payout=payout;bet.net=r2(payout-Number(bet.amount));bet.status='Settled';bet.settledTs=rr.endTs;changed=true;
      if(owner)audit(owner.email,'big-small-settlement',`round #${bet.roundNo} (${durationKey}ms); ${bet.type} ${bet.pick}; ${win?'won':'lost'}; payout ${payout}`);
    }
    if(changed)await save();
    const round=D.bigSmallRounds.find(x=>Number(x.roundNo)===roundNo&&String(x.panelId||'main')===String(panelId)&&isDuration(x));
    const matchingRounds=D.bigSmallRounds.filter(x=>String(x.panelId||'main')===String(panelId)&&isDuration(x));
    const matchingBets=D.bigSmallBets.filter(x=>String(x.panelId||'main')===String(panelId)&&Number(x.durationMs||30000)===durationMs);
    return {config:{durationMs,minBet:10,maxBet:10000,multipliers:{size:1.8,color:1.8,number:8.8}},round:{number:roundNo,startTs,endTs,remainingMs:Math.max(0,endTs-ts),bettingOpen:endTs-ts>5000},resultsHistory:matchingRounds.filter(x=>x.outcomeLocked&&Number(x.roundNo)<roundNo).sort((a,b)=>b.roundNo-a.roundNo).slice(0,20).map(x=>({roundNo:x.roundNo,number:x.result,size:x.bigSmall,color:x.color,endTs:x.endTs})),currentBets:matchingBets.filter(x=>String(x.userId)===String(u.id)&&Number(x.roundNo)===roundNo),history:matchingBets.filter(x=>String(x.userId)===String(u.id)).sort((a,b)=>b.ts-a.ts).slice(0,500)};
  },
  'POST /api/games/big-small': async (req,res,b,u) => {
    needUser(u); if(u.role!=='user')fail(403,'Only user accounts can play this game.');
    const type=String(b.type||''),pick=String(b.pick||''),amount=Number(b.amount),allowed=type==='number'?/^(?:[0-9])$/.test(pick):type==='size'?['Big','Small'].includes(pick):type==='color'?['Green','Red','Violet'].includes(pick):false;
    if(!allowed)fail(400,'Choose a valid number, color, or Big/Small option.');if(!Number.isFinite(amount)||amount<10||amount>10000||amount>MAX_AMOUNT)fail(400,'Bet amount must be between ₹10 and ₹10,000.');
    const requestedDuration=Number(b.durationMs||30000),durationMs=[30000,60000,180000,300000].includes(requestedDuration)?requestedDuration:30000;
    const ts=now(),roundNo=Math.floor(ts/durationMs),startTs=roundNo*durationMs,endTs=startTs+durationMs;
    if(endTs-ts<=5000)fail(400,'Betting is closed for the last 5 seconds of this round.');
    if(!Array.isArray(D.bigSmallBets))D.bigSmallBets=[];if(!Array.isArray(D.bigSmallRounds))D.bigSmallRounds=[];
    const panelId=req.panelId||'main';let rr=D.bigSmallRounds.find(x=>Number(x.roundNo)===roundNo&&String(x.panelId||'main')===String(panelId)&&Number(x.durationMs||30000)===durationMs);
    if(!rr){rr={roundNo,panelId,durationMs,startTs,endTs,result:null,outcomeLocked:false,createdTs:ts};D.bigSmallRounds.push(rr);}
    const multiplier=type==='number'?8.8:1.8,debit=r2(amount),balance=Number(u.balance||0);if(debit>balance)fail(400,'Not enough wallet balance for this bet.');u.balance=r2(balance-debit);
    const bet={id:crypto.randomUUID(),userId:u.id,uid:String(u.uid||u.id),email:u.email,panelId,durationMs,roundNo,type,pick,amount:r2(amount),multiplier,status:'Pending',result:null,won:null,payout:0,net:0,ts,roundEndTs:endTs};D.bigSmallBets.push(bet);audit(u.email,'big-small-bet',`round #${roundNo} (${durationMs}ms); ${type} ${pick}; ₹${amount}; ${multiplier}x`);await save();return {bet,balance:u.balance,round:{number:roundNo,endTs,remainingMs:endTs-ts,bettingOpen:endTs-ts>5000}};
  },
  // ----- admin -----
  'GET /api/admin/flip-coin': async (req, res, b, u) => {
    needAdmin(u); const rows = (D.flipCoinBets || []).filter(x => isHead(u) || String(x.panelId || 'main') === String(req.panelId || 'main')).slice().sort((a,b) => b.ts-a.ts).slice(0,1000);
    const totalWager = r2(rows.reduce((n,x)=>n+Number(x.amount||0),0)); const totalPayout = r2(rows.reduce((n,x)=>n+Number(x.payout||0),0)); const losses = r2(rows.filter(x=>x.status==='Settled' && !x.won).reduce((n,x)=>n+Number(x.amount||0),0)); const winningProfit = r2(rows.filter(x=>x.won).reduce((n,x)=>n+Math.max(0,Number(x.payout||0)-Number(x.amount||0)),0)); const fees = r2(rows.reduce((n,x)=>n+Number(x.fee||0),0)); const platformNet = r2(losses - winningProfit + fees); const currentRound=Math.floor(now()/30000);
    const allowedPanels=isHead(u)?(D.panels||[]).filter(p=>!p.deleted).map(p=>p.slug):[req.panelId||'main'];
    if(!allowedPanels.includes('main')&&isHead(u))allowedPanels.unshift('main');
    const livePanels=allowedPanels.map(pid=>{
      const totals=flipTotals(pid,currentRound);
      const mode=flipMode(pid);
      const higher=totals.heads>totals.tails?'heads':totals.tails>totals.heads?'tails':'equal';
      const round=(D.flipCoinRounds||[]).find(x=>x.panelId===pid&&Number(x.roundNo)===currentRound);
      const provisional=mode==='heads'||mode==='tails'?mode:mode==='lower'&&higher!=='equal'?(higher==='heads'?'tails':'heads'):null;
      return {panelId:pid,...totals,higher,winningMode:mode,provisional,confirmed:round?.outcomeLocked?round.result:null,roundNo:currentRound};
    });
    return { livePanels, config: { ...(S(req).flipCoin||{}), winningMode:flipMode(req.panelId||'main'), enabled:true, multiplier:2 }, items: rows, totalBets: rows.length, totalWager, totalPayout, fees, lossShare: r2(rows.reduce((n,x)=>n+Number(x.lossShare||0),0)), platformNet };
  },
  'POST /api/admin/flip-coin': async (req, res, b, u) => {
    needAdmin(u); const old = S(req).flipCoin || {}; const next = { ...old };
    next.enabled = true; next.multiplier = 2;
    if (b.winningMode !== undefined) {
      if (!FLIP_MODES.includes(b.winningMode)) fail(400,'Invalid winning rule');
      next.winningMode=b.winningMode;
    }
    for (const [key,label,min,max] of [['minBet','Minimum bet',1,MAX_AMOUNT],['maxBet','Maximum bet',1,MAX_AMOUNT],['lossSharePct','Platform share of bet losses',0,100],['feePct','Per-bet platform fee percentage',0,10]]) {
      if (b[key] !== undefined) { const n = Number(b[key]); if (!Number.isFinite(n) || n < min || n > max) fail(400, `${label} must be between ${min} and ${max}.`); next[key] = n; }
    }
    if (next.minBet > next.maxBet) fail(400, 'Minimum bet cannot exceed maximum bet.');
    S(req).flipCoin = next; audit(u.email, 'flip-coin-settings', JSON.stringify(next)); await save(); return { config: next };
  },
  'GET /api/admin/overview': async (req, res, b, u) => {
    needAdmin(u); await settleAndSave();
    const users = panelRows(req, D.users.filter(x => !['admin','headAdmin','panelAdmin'].includes(x.role))), depRows = panelRows(req, D.deposits), wdRows = panelRows(req, D.withdrawals), tradeRows = panelRows(req, D.trades), posRows = panelRows(req, D.positions), ok = depRows.filter(d => d.status === 'Approved'), paid = wdRows.filter(w => w.status === 'Paid');
    const sum = a => a.reduce((s, x) => s + x.amount, 0);
    const sumPayout = a => a.reduce((s, x) => s + Number(x.netAmount == null ? x.amount : x.netAmount), 0);
    return {
      role: u.role, accountUid: String(u.uid || u.id), panel: { id: req.panel.id, slug: req.panel.slug, name: req.panel.name }, creditBalance: r2(req.panel.creditBalance || 0), creditsAllocated: r2(req.panel.creditsAllocated || 0), creditsUsed: r2(req.panel.creditsUsed || 0), users: users.length, razorpayConfigured: !!(E.RAZORPAY_KEY_ID && E.RAZORPAY_KEY_SECRET && E.RAZORPAY_WEBHOOK_SECRET), wallets: r2(users.reduce((s, x) => s + x.balance, 0)), trades: tradeRows.length, demoUsers: panelRows(req, D.demoUsers).length, demoWallets: r2(panelRows(req, D.demoUsers).reduce((s, x) => s + Number(x.balance || 0), 0)),
      depositsApproved: sum(ok), withdrawalsPaid: sumPayout(paid),
      pendingDeposits: depRows.filter(d => d.status === 'Pending').length, pendingWithdrawals: wdRows.filter(w => w.status === 'Pending').length,
      bonus: { active: posRows.filter(p => p.status === 'Active').length, activeAmount: sum(posRows.filter(p => p.status === 'Active')), profitPaid: r2(posRows.reduce((s, p) => s + (p.profit || 0), 0)), refPaid: r2(posRows.reduce((s, p) => s + (p.refPaid || 0), 0)), tradeRefPaid: r2(tradeRows.reduce((s, t) => s + (t.refPaid || 0), 0)) },
      storage: UP_URL ? 'upstash' : 'file', settings: S(req), min: { deposit: S(req).limits.minDeposit, withdraw: S(req).limits.minWithdraw, trade: S(req).limits.minTrade }
    };
  },
  'GET /api/admin/users': async (req, res, b, u) => { needAdmin(u); const rows = panelRows(req, D.users).map(x => ({ ...pubUser(x), panelId: x.panelId || 'main', blocked: !!x.blocked, refBy: x.refBy || null })); rows.sort((a, b) => Number(b.created || 0) - Number(a.created || 0)); return { users: rows, totalUsers: rows.filter(x => !['admin','headAdmin','panelAdmin'].includes(x.role)).length, scope: isHead(u) ? 'all-panels' : req.panelId }; },
  'GET /api/admin/demo-users': async (req, res, b, u) => { needAdmin(u); return { users: panelRows(req, D.demoUsers).map(x => ({ id: x.id, uid: String(x.uid || x.id), name: x.name, email: x.email, phone: x.phone, balance: x.balance, blocked: x.blocked, created: x.created, holdings: x.holdings || {}, trades: (x.trades || []).length })) }; },
  'POST /api/admin/demo-user': async (req, res, b, u) => {
    needAdmin(u); const action = str(b.action, 16);
    if (action === 'create') {
      const name = str(b.name, 60), email = normEmail(b.email), password = String(b.password || '');
      if (name.length < 2) fail(400, 'Enter a demo account name.');
      if (!emailOk(email)) fail(400, 'Enter a valid email.');
      if (password.length < 8 || password.length > 100) fail(400, 'Password must be 8–100 characters.');
      if (D.demoUsers.some(x => x.email === email) || D.users.some(x => x.email === email)) fail(409, 'Email already exists in real or demo accounts.');
      const x = { id: 'demo-' + nid(), uid: nextAccountUid('DEM'), name, email, phone: str(b.phone, 20), panelId: req.panelId || 'main', pass: hashPw(password), balance: 0, holdings: {}, trades: [], blocked: false, mode: 'demo', created: now() };
      D.demoUsers.push(x); audit(u.email, 'demo-create', x.id + ' ' + x.email); await save(); return { user: { id: x.id, name: x.name, email: x.email, balance: x.balance, created: x.created } };
    }
    const x = D.demoUsers.find(v => v.id === b.id); if (!x) fail(404, 'Demo account not found.'); assertPanelAccess(req, x);
    if (action === 'delete') D.demoUsers = D.demoUsers.filter(v => v.id !== x.id);
    else if (action === 'block') x.blocked = true;
    else if (action === 'unblock') x.blocked = false;
    else if (action === 'password') { const pw = String(b.password || ''); if (pw.length < 8) fail(400, 'Min 8 characters'); x.pass = hashPw(pw); }
    else if (action === 'adjust') { const amt = Number(b.amount); if (!Number.isInteger(amt) || Math.abs(amt) > MAX_AMOUNT || x.balance + amt < 0) fail(400, 'Invalid balance adjustment.'); x.balance = r2(x.balance + amt); }
    else if (action === 'reset') { x.balance = 0; x.holdings = {}; x.trades = []; }
    else fail(400, 'Bad action');
    audit(u.email, 'demo-' + action, x.id + ' ' + x.email); await save(); return { ok: true };
  },
  'GET /api/admin/deposits': async (req, res, b, u) => { needAdmin(u); return { items: [...panelRows(req, D.deposits)].sort((a, c) => c.ts - a.ts) }; },
  'GET /api/admin/credits': async (req, res, b, u) => { needAdmin(u); const ps = isHead(u) ? D.panels.filter(p => !p.deleted) : [req.panel]; return { items: (isHead(u) ? D.creditLedger : D.creditLedger.filter(x => String(x.panelId || 'main') === String(req.panelId || 'main'))).slice().reverse().slice(0, 1000), balance: r2(ps.reduce((n, p) => n + Number(p.creditBalance || 0), 0)), allocated: r2(ps.reduce((n, p) => n + Number(p.creditsAllocated || 0), 0)), used: r2(ps.reduce((n, p) => n + Number(p.creditsUsed || 0), 0)) }; },
  'GET /api/admin/withdrawals': async (req, res, b, u) => { needAdmin(u); return { items: [...panelRows(req, D.withdrawals)].sort((a, c) => c.ts - a.ts) }; },
  'GET /api/admin/trades': async (req, res, b, u) => { needAdmin(u); const demo = panelRows(req, D.demoUsers).flatMap(x => (x.trades || []).map(t => ({ ...t, mode: 'demo', email: t.email || x.email }))); const real = panelRows(req, D.trades).map(t => ({ ...t, mode: 'real' })); return { items: [...real, ...demo].sort((a, c) => c.ts - a.ts).slice(0, 1000) }; },
  'GET /api/admin/bonus': async (req, res, b, u) => { needAdmin(u); await settleAndSave(); return { config: S(req).bonusCoins[0] || BONUS_DEFAULT(), coins: S(req).bonusCoins, items: [...panelRows(req, D.positions)].sort((a, c) => c.ts - a.ts).slice(0, 500) }; },
  'POST /api/admin/bonuscoin': async (req, res, b, u) => {
    needAdmin(u);
    const action = str(b.action || 'save', 12), sym = str(b.symbol, 8).toUpperCase();
    if (action === 'delete') {
      const coin = S(req).bonusCoins.find(x => x.symbol === sym); if (!coin) fail(404, 'Bonus coin not found.');
      if (D.positions.some(p => p.symbol === sym && p.status === 'Active')) fail(409, 'This coin has active positions. Settle or refund them first.');
      S(req).bonusCoins = S(req).bonusCoins.filter(x => x.symbol !== sym); S(req).bonusCoin = S(req).bonusCoins[0] || BONUS_DEFAULT();
      audit(u.email, 'bonuscoin-delete', sym); await save(); return { ok: true, coins: S(req).bonusCoins };
    }
    const name = str(b.name, 40), ret = Number(b.returnPct), refp = Number(b.refPct), lock = Number(b.lockSeconds ?? (b.lockHours != null ? Number(b.lockHours) * 3600 : 60)), mn = Number(b.minAmount), mx = Number(b.maxAmount), startPrice = Number(b.startPrice ?? 1), chartPercent = Number(b.chartPercent ?? 0), chartMode = b.chartMode === 'graph' ? 'graph' : 'percent', chartHours = Number(b.chartHours ?? 24), chartAgeHours = Number(b.chartAgeHours ?? 24), candleVolatilityPct = Number(b.candleVolatilityPct ?? 2);
    if (!/^[A-Z0-9]{2,8}$/.test(sym)) fail(400, 'Symbol must be 2–8 letters/digits.');
    if (S(req).coins.some(c => c[0] === sym)) fail(400, 'Symbol clashes with a market coin.');
    if (name.length < 2) fail(400, 'Enter a coin name.');
    if (!(ret >= 0 && ret <= 100) || !(refp >= 0 && refp <= 100)) fail(400, 'Return and referral percentages must be 0–100.');
    if (!['profit','amount'].includes(b.refBase)) fail(400, 'Bad referral base.');
    if (!Number.isInteger(lock) || lock < 0 || lock > 604800) fail(400, 'Countdown must be 0–604800 seconds.');
    if (!Number.isInteger(mn) || mn < 1 || !Number.isInteger(mx) || mx < mn || mx > MAX_AMOUNT) fail(400, 'Check min / max amounts.');
    if (!Number.isFinite(startPrice) || startPrice <= 0 || startPrice > MAX_AMOUNT) fail(400, 'Starting price must be positive.');
    if (!Number.isFinite(chartPercent) || chartPercent < -95 || chartPercent > 500) fail(400, 'Chart target change must be between -95% and 500%.');
    if (!Number.isFinite(chartHours) || chartHours < 1 || chartHours > 8760) fail(400, 'Trend duration must be 1–8760 hours.');
    if (!Number.isFinite(chartAgeHours) || chartAgeHours < 1 || chartAgeHours > 8760) fail(400, 'Coin chart age must be 1–8760 hours.');
    if (!Number.isFinite(candleVolatilityPct) || candleVolatilityPct < 0 || candleVolatilityPct > 20) fail(400, 'Candle volatility must be 0–20%.');
    let coin = S(req).bonusCoins.find(x => x.symbol === sym);
    if (action === 'add' && coin) fail(409, 'Bonus coin already exists.');
    if (action !== 'add' && !coin && action !== 'save') fail(404, 'Bonus coin not found.');
    const old = coin || {};
    const chartAgeChanged = !old.id || Number(old.chartAgeHours || 24) !== chartAgeHours;
    const chartStartedAt = chartAgeChanged ? now() - chartAgeHours * 3600000 : (Number(old.chartStartedAt) || now() - chartAgeHours * 3600000);
    coin = { ...old, id: old.id || 'bc-' + sym, enabled: !!b.enabled, symbol: sym, name, returnPct: r2(ret), refPct: r2(refp), refBase: b.refBase, lockSeconds: lock, minAmount: mn, maxAmount: mx, startPrice, priceHistory: old.priceHistory || [], updatedAt: now(), chartStartedAt, chartAgeHours, priceMode: 'admin-simulated', chartMode, chartPercent, chartHours, candleVolatilityPct };
    if (!old.id) S(req).bonusCoins.push(coin); else S(req).bonusCoins = S(req).bonusCoins.map(x => x.symbol === sym ? coin : x);
    S(req).bonusCoin = S(req).bonusCoins[0] || BONUS_DEFAULT();
    audit(u.email, 'bonuscoin-' + action, JSON.stringify(coin)); await save(); return { ok: true, coin, coins: S(req).bonusCoins };
  },
  'POST /api/admin/position': async (req, res, b, u) => {
    needAdmin(u); const p = D.positions.find(x => x.id === b.id); if (!p) fail(404, 'Not found'); assertPanelAccess(req, p);
    if (p.status !== 'Active') fail(409, 'Already ' + p.status + '.');
    if (b.action === 'cancel') { const t = D.users.find(x => x.id === p.uid); if (t) t.balance = r2(t.balance + p.amount); p.status = 'Cancelled'; p.done = now(); }   // refund principal once
    else if (b.action === 'settle') settlePosition(p); else fail(400, 'Bad action');
    audit(u.email, 'position-' + b.action, `#${p.id} ₹${p.amount}`); await save(); return { item: p };
  },
  'GET /api/admin/report': async (req, res, b, u) => {      // per-day summary, last 14 days (IST)
    needAdmin(u); await settleAndSave();
    const day = ts => new Date(ts + 19800e3).toISOString().slice(0, 10), rows = {};
    const reportUsers = panelRows(req, D.users), reportDeposits = panelRows(req, D.deposits), reportWithdrawals = panelRows(req, D.withdrawals), reportTrades = panelRows(req, D.trades);
    for (let i = 0; i < 14; i++) { const k = day(now() - i * 864e5); rows[k] = { date: k, signups: 0, deposits: 0, depositAmt: 0, withdrawals: 0, withdrawAmt: 0, trades: 0, tradeVol: 0 }; }
    const add = (ts, f) => { const r = rows[day(ts)]; if (r) f(r); };
    reportUsers.filter(x => !['admin','headAdmin','panelAdmin'].includes(x.role)).forEach(x => add(x.created, r => r.signups++));
    reportDeposits.filter(x => x.status === 'Approved').forEach(x => add(x.done || x.ts, r => { r.deposits++; r.depositAmt += x.amount; }));
    reportWithdrawals.filter(x => x.status === 'Paid').forEach(x => add(x.done || x.ts, r => { r.withdrawals++; r.withdrawAmt += Number(x.netAmount == null ? x.amount : x.netAmount); }));
    reportTrades.forEach(x => add(x.ts, r => { r.trades++; r.tradeVol = r2(r.tradeVol + x.amount); }));
    return { rows: Object.values(rows).sort((a, c) => c.date.localeCompare(a.date)) };
  },
  'POST /api/admin/referral': async (req, res, b, u) => {
    needAdmin(u); const mx = Number(b.maxPerTrade || 0);
    const levels = Array.isArray(b.levels) ? b.levels.slice(0, 3).map(Number) : [Number(b.pct || 0), 0, 0];
    while (levels.length < 3) levels.push(0);
    if (levels.some(x => !Number.isFinite(x) || x < 0 || x > 100)) fail(400, 'Each level percent must be 0–100.');
    if (!(mx >= 0 && mx <= MAX_AMOUNT)) fail(400, 'Max per trade must be 0 or more.');
    S(req).tradeRef = { enabled: !!b.enabled, pct: r2(levels[0]), levels: levels.map(r2), maxPerTrade: r2(mx) };
    audit(u.email, 'trade-referral-settings', JSON.stringify(S(req).tradeRef)); await save(); return { ok: true };
  },
  'POST /api/admin/depositreferral': async (req, res, b, u) => {
    needAdmin(u);
    const levels = Array.isArray(b.levels) ? b.levels.slice(0, 3).map(Number) : [];
    while (levels.length < 3) levels.push(0);
    if (levels.some(x => !Number.isFinite(x) || x < 0 || x > 100)) fail(400, 'Each level percent must be 0–100.');
    S(req).depositRef = { enabled: !!b.enabled, levels: levels.map(r2) };
    audit(u.email, 'deposit-referral-settings', JSON.stringify(S(req).depositRef)); await save(); return { ok: true };
  },
  'POST /api/admin/coin': async (req, res, b, u) => {
    needAdmin(u);
    const sym = str(b.symbol, 10).toUpperCase();
    if (b.action === 'add') {
      const name = str(b.name, 40), id = str(b.id, 60).toLowerCase(), mark = str(b.mark, 2) || sym[0];
      if (!/^[A-Z0-9]{2,10}$/.test(sym)) fail(400, 'Symbol must be 2–10 letters/digits (e.g. MATIC).'); if (name.length < 2) fail(400, 'Enter the coin name.');
      if (!/^[a-z0-9-]{2,60}$/.test(id)) fail(400, 'Enter the CoinGecko id (e.g. polygon-ecosystem-token) — see coingecko.com coin page "API id".');
      if (S(req).coins.some(c => c[0] === sym || c[2] === id)) fail(409, 'This coin is already listed.');
      if ((S(req).bonusCoins || []).some(c => c.symbol === sym) || S(req).bonusCoin.symbol === sym) fail(409, 'Symbol clashes with a bonus coin.');
      try {   // verify the coin really exists on both price sources before listing it
        const r1 = await fetch(`${BINANCE_API}?symbols=${encodeURIComponent(JSON.stringify([sym + 'USDT']))}`, { signal: AbortSignal.timeout(8000) }); if (!r1.ok) throw new Error('not on Binance');
        const hdr = { Accept: 'application/json' }; if (E.COINGECKO_API_KEY) hdr['x-cg-demo-api-key'] = E.COINGECKO_API_KEY;
        const r2 = await fetch(`${PRICE_API}?vs_currency=usd&ids=${id}`, { headers: hdr, signal: AbortSignal.timeout(8000) }); const j2 = await r2.json(); if (!r2.ok || !Array.isArray(j2) || !j2.length) throw new Error('CoinGecko id not found');
      } catch (e) { fail(400, `Could not verify ${sym}: ${e.message}. Use the exact Binance symbol (${sym}USDT must exist) and the CoinGecko API id.`); }
      S(req).coins.push([sym, name, id, mark]); priceCache.ts = 0; audit(u.email, 'coin-add', `${sym} ${id}`);
    } else if (b.action === 'remove') {
      if (!S(req).coins.some(c => c[0] === sym)) fail(404, 'Coin not listed.');
      const holders = D.users.filter(x => String(x.panelId || 'main') === String(req.panelId || 'main') && (x.holdings && x.holdings[sym]) > 0).length;
      if (holders) fail(409, `${holders} user(s) still hold ${sym}. Removing it would trap their coins — wait until they sell, or adjust their balance first.`);
      if (S(req).coins.length <= 1) fail(400, 'Keep at least one coin.');
      S(req).coins = S(req).coins.filter(c => c[0] !== sym); priceCache.ts = 0; audit(u.email, 'coin-remove', sym);
    } else fail(400, 'Bad action');
    await save(); return { coins: S(req).coins };
  },
  'GET /api/admin/audit': async (req, res, b, u) => { needAdmin(u); return { items: (isHead(u) ? D.audit : D.audit.filter(x => x.panelId === req.panelId || !x.panelId && req.panelId === 'main')).slice().reverse().slice(0, 300) }; },
  'POST /api/admin/deposit': async (req, res, b, u) => {
    needAdmin(u); const d = D.deposits.find(x => x.id === b.id); if (!d) fail(404, 'Not found'); assertPanelAccess(req, d);
    if (d.status !== 'Pending') fail(409, 'Already ' + d.status + '.');     // credit exactly once
    if (b.action === 'approve') {
      if (d.provider === 'razorpay' && d.providerStatus !== 'captured') fail(403, 'Razorpay deposits can only be approved after verified payment capture.');
      const t = D.users.find(x => x.id === d.uid); if (!t) fail(404, 'User missing');
      const depositPanel = D.panels.find(p => p.slug === String(d.panelId || 'main') && !p.deleted); if (!depositPanel) fail(409, 'Deposit panel not found.');
      const depositSettings = depositPanel.settings || D.settings;
      const creditAmount = b.credits === undefined || b.credits === null || b.credits === '' ? Number(d.amount) : Number(b.credits);
      if (!Number.isInteger(creditAmount) || creditAmount < 1 || creditAmount > MAX_AMOUNT) fail(400, 'User credits must be a whole number between 1 and 10,000,000.');
      const cfg = depositSettings.depositRef || { enabled: false, levels: [0,0,0] };
      const referralCost = cfg.enabled && t.refBy ? previewDepositReferralTotal(t, d.amount, cfg.levels || [0,0,0]) : 0;
      const totalCost = r2(creditAmount + referralCost);
      if (Number(depositPanel.creditBalance || 0) < totalCost) fail(409, `Insufficient panel credits. Available: ${Number(depositPanel.creditBalance || 0)}; required: ${totalCost}. Ask Head Admin to allocate more credits.`);
      consumePanelCredits(depositPanel.slug, totalCost, u.email, 'deposit-credit', `deposit #${d.id}; user ${t.email}; credited ${creditAmount}; referral ${referralCost}`);
      t.balance = r2((t.balance || 0) + creditAmount); d.creditedAmount = creditAmount; d.creditsSpent = totalCost; d.status = 'Approved'; d.creditPending = false; delete d.creditError;
      if (cfg.enabled && t.refBy) { d.refPayments = payReferralLevels(t, d.amount, cfg.levels || [0,0,0], 'deposit'); d.refPaid = r2(d.refPayments.reduce((sum, x) => sum + x.amount, 0)); if (d.refPaid) audit('system', 'deposit-referral', `Deposit #${d.id}: ₹${d.refPaid} referral commission across ${d.refPayments.length} level(s)`); }
    }
    else if (b.action === 'reject') { if (d.provider === 'razorpay' && d.providerStatus === 'captured') fail(409, 'This payment is already captured. Allocate panel credits and complete the wallet credit; do not reject a captured payment.'); d.status = 'Rejected'; } else fail(400, 'Bad action');
    d.by = u.email; d.done = now(); audit(u.email, 'deposit-' + b.action, `#${d.id} ₹${d.amount}${d.creditedAmount ? ` → ${d.creditedAmount} credits` : ''}`); await save(); return { item: d, creditBalance: r2((D.panels.find(p => p.slug === String(d.panelId || 'main')) || req.panel).creditBalance || 0) };
  },
  'POST /api/admin/withdrawal': async (req, res, b, u) => {
    needAdmin(u); const w = D.withdrawals.find(x => x.id === b.id); if (!w) fail(404, 'Not found'); assertPanelAccess(req, w);
    if (w.status !== 'Pending') fail(409, 'Already ' + w.status + '.');
    if (b.action === 'paid') { w.status = 'Paid'; w.ref = str(b.ref, 40); w.payoutType = w.mode === 'demo' ? 'Simulated demo withdrawal' : 'Manual payout'; }
    else if (b.action === 'reject') { const t = D.users.find(x => x.id === w.uid) || D.demoUsers.find(x => x.id === w.uid); if (t) t.balance = r2((t.balance || 0) + w.amount); w.status = 'Rejected'; w.note = str(b.note, 120); w.rejectedAt = now(); w.cooldownHours = Number(S(req).withdrawalCooldownHours ?? 24); w.retryAt = w.rejectedAt + w.cooldownHours * 3600e3; } // refund once
    else fail(400, 'Bad action');
    w.by = u.email; w.done = now(); audit(u.email, 'withdrawal-' + b.action, `#${w.id} ₹${w.amount}`); await save(); return { item: w };
  },
  'POST /api/admin/user': async (req, res, b, u) => {
    needAdmin(u); const t = D.users.find(x => x.id === b.id); if (!t) fail(404, 'Not found'); assertPanelAccess(req, t);
    if (['admin','headAdmin','panelAdmin'].includes(t.role)) fail(400, 'Admin accounts cannot be changed here.');
    if (b.action === 'block') t.blocked = true; else if (b.action === 'unblock') t.blocked = false;
    else if (b.action === 'password') { const pw = String(b.password || ''); if (pw.length < 8) fail(400, 'Min 8 characters'); t.pass = hashPw(pw); }
    else if (b.action === 'delete') {
      const email = t.email, id = t.id; D.users = D.users.filter(x => x.id !== id);
      for (const row of [...D.deposits, ...D.withdrawals, ...D.trades, ...D.positions]) if (row.uid === id) row.userDeleted = true;
      audit(u.email, 'user-delete', `#${id} ${email}`); await save(); return { ok: true };
    }
    else if (b.action === 'addMoney') { // positive wallet credit, panel-scoped and auditable
      const amt = Number(b.amount), reason = str(b.reason, 120), operationKey = str(b.operationKey, 100);
      if (!Number.isInteger(amt) || amt < 1 || amt > MAX_AMOUNT) fail(400, 'Enter a positive whole amount between ₹1 and ₹10,000,000.');
      if (!reason) fail(400, 'A reason is required.');
      if (!operationKey) fail(400, 'A unique request key is required. Please retry from the Add Money button.');
      if (D.audit.some(x => x.action === 'add-money' && x.operationKey === operationKey)) fail(409, 'This Add Money request was already processed.');
      const targetPanelId = String(t.panelId || req.panelId || 'main');
      consumePanelCredits(targetPanelId, amt, u.email, 'wallet-add-money', `user #${t.id} ${t.email}; ${reason}`);
      t.balance = r2(t.balance + amt);
      const event = { who: u.email, action: 'add-money', detail: `UID ${t.uid || t.id} (${t.email}) +₹${amt}; ${reason}`, operationKey: operationKey || undefined };
      D.audit.push({ id: nid(), ts: now(), ...event }); if (D.audit.length > 2000) D.audit.splice(0, D.audit.length - 2000);
      await save(); return { ok: true, uid: String(t.uid || t.id), balance: r2(t.balance), creditBalance: r2((D.panels.find(p => p.slug === targetPanelId) || {}).creditBalance || 0) };
    }
    else if (b.action === 'adjust') {        // manual wallet correction, always logged with a reason
      const amt = Number(b.amount), reason = str(b.reason, 120);
      if (!Number.isInteger(amt) || amt === 0 || Math.abs(amt) > MAX_AMOUNT) fail(400, 'Enter a non-zero whole amount.');
      if (!reason) fail(400, 'A reason is required.'); if (t.balance + amt < 0) fail(400, 'Balance cannot go below zero.');
      if (amt > 0) consumePanelCredits(String(t.panelId || req.panelId || 'main'), amt, u.email, 'wallet-adjustment', `user #${t.id} ${t.email}; ${reason}`);
      t.balance = r2(t.balance + amt); audit(u.email, 'adjust', `#${t.id} ${amt > 0 ? '+' : ''}${amt} — ${reason}`); await save(); return { ok: true, uid: String(t.uid || t.id), balance: r2(t.balance), creditBalance: r2(req.panel.creditBalance || 0) };
    } else fail(400, 'Bad action');
    audit(u.email, 'user-' + b.action, `#${t.id} ${t.email}`); await save(); return { ok: true };
  },
  'POST /api/admin/settings': async (req, res, b, u) => {
    needAdmin(u); const s = S(req);
    if (b.withdrawalMode !== undefined) { if (!['all','profit'].includes(b.withdrawalMode)) fail(400, 'Invalid withdrawal policy.'); s.withdrawalMode = b.withdrawalMode; }
    if (b.withdrawalCooldownHours !== undefined) { const h = Number(b.withdrawalCooldownHours); if (!Number.isInteger(h) || h < 0 || h > 720) fail(400, 'Withdrawal retry delay must be 0–720 hours.'); s.withdrawalCooldownHours = h; }
    if (b.paymentMode !== undefined) { if (!['qr','razorpay'].includes(b.paymentMode)) fail(400, 'Invalid payment mode.'); if (b.paymentMode === 'razorpay' && !(E.RAZORPAY_KEY_ID && E.RAZORPAY_KEY_SECRET && E.RAZORPAY_WEBHOOK_SECRET)) fail(400, 'Configure RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET in Render before enabling Razorpay.'); s.paymentMode = b.paymentMode; }
    if (b.withdrawalFeeType !== undefined) { if (!['percent','fixed'].includes(b.withdrawalFeeType)) fail(400, 'Invalid withdrawal fee type.'); s.withdrawalFeeType = b.withdrawalFeeType; }
    if (b.withdrawalFeeValue !== undefined) { const n = Number(b.withdrawalFeeValue); if (!Number.isFinite(n) || n < 0 || n > 100000 || (s.withdrawalFeeType === 'percent' && n > 100)) fail(400, 'Withdrawal fee must be between 0 and 100% (or ₹100,000 fixed).'); s.withdrawalFeeValue = n; }
    if (b.withdrawalFeeLabel !== undefined) s.withdrawalFeeLabel = str(b.withdrawalFeeLabel, 40) || 'Platform Fee';
    s.upi = str(b.upi, 60); s.payee = str(b.payee, 60); s.support = str(b.support, 200); s.notice = str(b.notice, 300); s.bonus = str(b.bonus, 600); if (b.footerText !== undefined) s.footerText = str(b.footerText, 160);
    if (s.support && !/^https?:\/\//.test(s.support)) fail(400, 'Support link must start with http:// or https://');
    if (b.minDeposit !== undefined) {
      const md = Number(b.minDeposit), mw = Number(b.minWithdraw), mt = Number(b.minTrade);
      for (const [v, n] of [[md, 'deposit'], [mw, 'withdrawal'], [mt, 'trade']]) if (!Number.isInteger(v) || v < 1 || v > 1000000) fail(400, `Minimum ${n} must be a whole number between 1 and 10,00,000.`);
      s.limits = { minDeposit: md, minWithdraw: mw, minTrade: mt };
    }
    if (b.qr !== undefined) { const q = String(b.qr || ''); if (q && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(q) || q.length > 8_500_000)) fail(400, 'QR image is too large (maximum 6 MB).'); s.qr = q; }
    audit(u.email, 'settings', JSON.stringify(s.limits)); await save(); return { ok: true };
  },
  'GET /api/admin/panels': async (req, res, b, u) => {
    needHead(u);
    const panels = D.panels.filter(p => !p.deleted).map(p => {
      const users = D.users.filter(x => x.role === 'user' && String(x.panelId || 'main') === p.slug);
      const demos = D.demoUsers.filter(x => String(x.panelId || 'main') === p.slug);
      const deposits = D.deposits.filter(x => String(x.panelId || 'main') === p.slug);
      const withdrawals = D.withdrawals.filter(x => String(x.panelId || 'main') === p.slug);
      const admin = D.users.find(x => x.id === p.adminUserId);
      return { id: p.id, name: p.name, slug: p.slug, active: p.active !== false, created: p.created, creditBalance: r2(p.creditBalance || 0), creditsAllocated: r2(p.creditsAllocated || 0), creditsUsed: r2(p.creditsUsed || 0), link: p.slug === 'main' ? '/' : '/p/' + p.slug, adminEmail: admin && admin.email || '', adminUid: admin && (admin.uid || String(admin.id)) || '', users: users.length, demoUsers: demos.length, wallets: r2(users.reduce((n, x) => n + Number(x.balance || 0), 0)), deposits: deposits.length, pendingDeposits: deposits.filter(x => x.status === 'Pending').length, withdrawals: withdrawals.length };
    });
    return { panels, totalPanels: panels.length, totalUsers: D.users.filter(x => x.role === 'user').length, totalDemoUsers: D.demoUsers.length, totalWallets: r2(D.users.filter(x => x.role === 'user').reduce((n, x) => n + Number(x.balance || 0), 0)), totalCreditsAvailable: r2(panels.reduce((n, p) => n + Number(p.creditBalance || 0), 0)), totalCreditsAllocated: r2(panels.reduce((n, p) => n + Number(p.creditsAllocated || 0), 0)), totalCreditsUsed: r2(panels.reduce((n, p) => n + Number(p.creditsUsed || 0), 0)) };
  },
  'GET /api/admin/panel-login-diagnostics': async (req, res, b, u) => {
    needHead(u);
    const panels = D.panels.filter(p => p.slug !== 'main' && !p.deleted).map(p => {
      const admin = D.users.find(x => x.id === p.adminUserId && x.role === 'panelAdmin')
        || D.users.find(x => x.role === 'panelAdmin' && panelValueMatches(p, x.panelId));
      return { panel:p.slug, active:p.active !== false, adminFound:!!admin,
        email:admin?.email || null, passwordHashValid:!!(admin && /^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(String(admin.pass||''))),
        blocked:!!admin?.blocked, panelIdMatches:!!(admin && panelValueMatches(p,admin.panelId)),
        loginUrl:'/p/'+p.slug+'/admin' };
    });
    return { storage:UP_URL?'upstash':'local-file', persistentStorageConfigured:RENDER_DURABLE,
      warning:STORAGE_WARNING?'Render filesystem is ephemeral. Configure Upstash or a mounted disk (DATA_DIR and CB_PERSISTENT_DISK=true).':null, panels };
  },
  'POST /api/admin/panels': async (req, res, b, u) => {
    needHead(u);
    const action = str(b.action, 16);
    if (action === 'create') {
      if (STORAGE_WARNING) fail(503, 'Panel creation requires persistent storage on Render. Configure Upstash Redis or a mounted persistent disk first.');
      const name = str(b.name, 60), slug = str(b.slug, 48).toLowerCase().replace(/^\/+|\/+$/g, ''), email = normEmail(b.email), password = String(b.password || '');
      if (name.length < 2) fail(400, 'Panel name must have at least 2 characters.');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug === 'main' || slug === 'admin') fail(400, 'Link ID must use lowercase letters, numbers and hyphens; main/admin are reserved.');
      if (D.panels.some(p => p.slug === slug || (p.aliases || []).includes(slug))) fail(409, 'This panel link is already in use.');
      if (!emailOk(email)) fail(400, 'Enter a valid panel admin email.');
      if (password.length < 8 || password.length > 100) fail(400, 'Panel admin password must be 8–100 characters.');
      if (D.users.some(x => x.email === email) || D.demoUsers.some(x => x.email === email)) fail(409, 'This email is already in use.');
      const panel = { id: 'panel-' + crypto.randomBytes(6).toString('hex'), slug, aliases: [], name, active: true, deleted: false, created: now(), creditBalance: 0, creditsAllocated: 0, creditsUsed: 0, settings: clone(S(req)) };
      panel.settings.qr = ''; panel.settings.upi = ''; panel.settings.payee = ''; panel.settings.support = ''; panel.settings.notice = ''; panel.settings.bonus = ''; panel.settings.paymentMode = 'qr'; panel.settings.bonusCoins = []; panel.settings.bonusCoin = BONUS_DEFAULT();
      const admin = { id: nid(), uid: nextAccountUid('PAD'), name: name + ' Admin', email, phone: '', role: 'panelAdmin', panelId: slug, pass: hashPw(password), balance: 0, refCode: makeRef(), refBy: null, blocked: false, created: now() };
      if (!checkPw(password, admin.pass)) fail(500, 'Panel admin credential validation failed.');
      panel.adminUserId = admin.id; D.panels.push(panel); D.users.push(admin);
      try {
        await save();
      } catch (err) {
        D.panels = D.panels.filter(x => x.id !== panel.id);
        D.users = D.users.filter(x => x.id !== admin.id);
        throw new HttpError(503, 'Panel account could not be saved to persistent storage. Check database configuration before retrying.');
      }
      audit(u.email, 'panel-create', `${name} (${slug}) · admin ${email}`);
      return { ok: true, panel: { id: panel.id, name: panel.name, slug: panel.slug, link: '/p/' + panel.slug, adminLink: '/p/' + panel.slug + '/admin', adminEmail: email } };
    }
    if (action === 'allocate') {
      const panel = D.panels.find(p => p.id === b.id && !p.deleted);
      if (!panel) fail(404, 'Panel not found.');
      const amount = Number(b.amount), reason = str(b.reason || 'Head Admin allocation', 120);
      if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) fail(400, 'Enter whole credits between 1 and 10,000,000.');
      if (Number(panel.creditBalance || 0) + amount > MAX_AMOUNT) fail(400, 'Allocation would exceed the 10,000,000 available-credit limit.');
      panel.creditBalance = r2(Number(panel.creditBalance || 0) + amount);
      panel.creditsAllocated = r2(Number(panel.creditsAllocated || 0) + amount);
      recordCreditLedger(panel, amount, 'allocate', u.email, reason);
      audit(u.email, 'panel-credit-allocate', `${panel.name} (${panel.slug}) +${amount}; balance ${panel.creditBalance}; ${reason}`);
      await save();
      return { ok: true, panel: { id: panel.id, slug: panel.slug, creditBalance: panel.creditBalance, creditsAllocated: panel.creditsAllocated, creditsUsed: panel.creditsUsed } };
    }
    if (action === 'reclaim') {
      const panel = D.panels.find(p => p.id === b.id && p.slug !== 'main' && !p.deleted);
      if (!panel) fail(404, 'Panel not found.');
      const amount = Number(b.amount), available = r2(Number(panel.creditBalance || 0));
      const reason = str(b.reason || 'Head Admin reclaimed unused credits', 120);
      if (!Number.isInteger(amount) || amount < 1 || amount > available) fail(400, `Enter whole credits from 1 to ${available}. Only unused available credits can be reclaimed.`);
      panel.creditBalance = r2(available - amount);
      panel.creditsAllocated = Math.max(Number(panel.creditsUsed || 0), r2(Number(panel.creditsAllocated || 0) - amount));
      recordCreditLedger(panel, -amount, 'reclaim', u.email, reason);
      const mainPanel = D.panels.find(p => p.slug === 'main' && !p.deleted);
      if (mainPanel) {
        mainPanel.creditBalance = r2(Number(mainPanel.creditBalance || 0) + amount);
        mainPanel.creditsAllocated = r2(Number(mainPanel.creditsAllocated || 0) + amount);
        recordCreditLedger(mainPanel, amount, 'reclaim-return', u.email, `Unused credits returned from ${panel.slug}`);
      }
      audit(u.email, 'panel-credit-reclaim', `${panel.name} (${panel.slug}) -${amount}; remaining ${panel.creditBalance}; ${reason}`);
      await save();
      return { ok: true, panel: { id: panel.id, slug: panel.slug, creditBalance: panel.creditBalance, creditsAllocated: panel.creditsAllocated, creditsUsed: panel.creditsUsed }, reclaimed: amount };
    }
    if (action === 'reset-login') {
      const panel = D.panels.find(p => p.id === b.id && p.slug !== 'main' && !p.deleted);
      if (!panel) fail(404, 'Panel not found.');
      const admin = D.users.find(x => x.id === panel.adminUserId && x.role === 'panelAdmin') || D.users.find(x => x.role === 'panelAdmin' && String(x.panelId || '') === String(panel.slug));
      if (!admin) fail(404, 'Panel admin account not found.');
      const email = normEmail(b.email), password = String(b.password || '');
      if (!emailOk(email)) fail(400, 'Enter a valid admin email.');
      if (D.users.some(x => x.id !== admin.id && x.email === email) || D.demoUsers.some(x => x.email === email)) fail(409, 'This email is already in use.');
      if (password.length < 8 || password.length > 100) fail(400, 'Password must be 8–100 characters.');
      admin.email = email; admin.pass = hashPw(password); admin.panelId = panel.slug; admin.role = 'panelAdmin'; admin.blocked = false; panel.adminUserId = admin.id;
      audit(u.email, 'panel-admin-login-reset', `${panel.slug} admin login reset for ${email}`);
      await save();
      return { ok: true, panel: { id: panel.id, slug: panel.slug, adminEmail: email, adminLink: '/p/' + panel.slug + '/admin' } };
    }
    const panel = D.panels.find(p => p.id === b.id && p.slug !== 'main' && !p.deleted);
    if (!panel) fail(404, 'Panel not found.');
    if (action === 'edit') {
      if (STORAGE_WARNING) fail(503, 'Panel creation requires persistent storage on Render. Configure Upstash Redis or a mounted persistent disk first.');
      const name = str(b.name, 60), slug = str(b.slug, 48).toLowerCase().replace(/^\/+|\/+$/g, '');
      const admin = D.users.find(x => x.id === panel.adminUserId);
      const email = b.email !== undefined ? normEmail(b.email) : (admin && admin.email);
      const password = b.password ? String(b.password) : '';
      if (name.length < 2) fail(400, 'Panel name must have at least 2 characters.');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug === 'main' || slug === 'admin') fail(400, 'Invalid panel link ID.');
      if (D.panels.some(p => p.id !== panel.id && (p.slug === slug || (p.aliases || []).includes(slug)))) fail(409, 'This panel link is already in use.');
      if (b.email !== undefined && (!emailOk(email) || D.users.some(x => x.id !== (admin && admin.id) && x.email === email) || D.demoUsers.some(x => x.email === email))) fail(400, 'Panel admin email is invalid or already in use.');
      if (password && (password.length < 8 || password.length > 100)) fail(400, 'Password must be 8–100 characters.');
      // All inputs are validated before mutating any records.
      if (slug !== panel.slug) { panel.aliases = [...new Set([...(panel.aliases || []), panel.slug])]; const oldSlug = panel.slug; panel.slug = slug; for (const x of [...D.users, ...D.demoUsers, ...D.deposits, ...D.withdrawals, ...D.trades, ...D.positions]) if (String(x.panelId || 'main') === oldSlug) x.panelId = slug; for (const x of D.creditLedger) if (String(x.panelId || 'main') === oldSlug) x.panelId = slug; if (admin) admin.panelId = slug; }
      panel.name = name;
      if (b.email !== undefined && admin) admin.email = email;
      if (password && admin) admin.pass = hashPw(password);
      audit(u.email, 'panel-edit', `${panel.name} (${panel.slug})`); await save(); return { ok: true };
    }
    if (action === 'toggle') { panel.active = b.active !== false; audit(u.email, 'panel-toggle', `${panel.slug} active=${panel.active}`); await save(); return { ok: true, active: panel.active }; }
    if (action === 'delete') {
      // Atomic migration in memory before the single durable write: user identity, wallets and histories remain intact.
      const oldSlug = panel.slug;
      for (const x of [...D.users, ...D.demoUsers, ...D.deposits, ...D.withdrawals, ...D.trades, ...D.positions]) if (String(x.panelId || 'main') === oldSlug) x.panelId = 'main';
      const mainPanel = D.panels.find(p => p.slug === 'main' && !p.deleted);
      const unusedCredits = r2(Number(panel.creditBalance || 0));
      if (mainPanel && unusedCredits > 0) {
        mainPanel.creditBalance = r2(Number(mainPanel.creditBalance || 0) + unusedCredits);
        mainPanel.creditsAllocated = r2(Number(mainPanel.creditsAllocated || 0) + unusedCredits);
        panel.creditBalance = 0;
        recordCreditLedger(panel, -unusedCredits, 'panel-delete-return', u.email, `Unused credits returned to Head Admin Main from ${oldSlug}`);
        recordCreditLedger(mainPanel, unusedCredits, 'panel-delete-return', u.email, `Unused credits returned from ${oldSlug}`);
      } else panel.creditBalance = 0;
      const panelAdmin = D.users.find(x => x.id === panel.adminUserId); if (panelAdmin) panelAdmin.blocked = true;
      panel.deleted = true; panel.active = false; panel.deletedAt = now();
      audit(u.email, 'panel-delete-migrate', `${oldSlug} users and records moved to main panel; history retained`); await save();
      return { ok: true, migratedUsers: D.users.filter(x => x.role === 'user' && x.panelId === 'main').length, linkRedirectsToMain: true };
    }
    fail(400, 'Unknown panel action.');
  },
  'GET /api/admin/backup': async (req, res, b, u) => {
    needHead(u);
    const copy = JSON.parse(JSON.stringify(D)); delete copy.secret; copy.users.forEach(x => delete x.pass); if (Array.isArray(copy.demoUsers)) copy.demoUsers.forEach(x => delete x.pass);
    return { __download: 'cryptobridge-backup-' + new Date().toISOString().slice(0, 10) + '.json', data: copy };
  }
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 9_000_000) { reject(new HttpError(413, 'Request too large (max 9 MB).')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new HttpError(400, 'Bad JSON')); } });
    req.on('error', reject);
  });
}
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
function json(res, code, obj, extra = {}) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC, ...extra }); res.end(JSON.stringify(obj)); }

async function handleApi(req, res, pathname) {
  const requestedSlug = String(req.headers['x-panel-slug'] || 'main').toLowerCase();
  const panel = getPanel(requestedSlug);
  if (!panel) return json(res, 404, { error: 'Panel link unavailable. Ask Head Admin to verify its status and URL.' });
  req.panel = panel; req.panelId = panel.slug;
  const h = routes[req.method + ' ' + pathname];
  if (!h) return json(res, 404, { error: 'Not found' });
  try {
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) fail(403, 'Bad origin');   // CSRF guard
    }
    const body = req.method === 'POST' ? await readBody(req) : {};
    const user = authUser(req); req.user = user;
    // Login must be allowed to replace a stale cookie from another panel. Without
    // this exception, a browser previously used for Main/another panel can block
    // the new panel-admin login before the submitted credentials are checked.
    const isLoginRequest = req.method === 'POST' && pathname === '/api/login';
    if (!isLoginRequest && user && user.role !== 'headAdmin' && String(user.panelId || 'main') !== String(req.panelId || 'main')) fail(403, 'This account belongs to a different panel.');
    if (!isLoginRequest && user && user.role === 'panelAdmin' && String(user.panelId || '') !== String(req.panelId || '')) fail(403, 'Admin panel access denied.');
    const out = await h(req, res, body, user);
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
  if (pathname === '/api/razorpay/webhook') {
    if (req.method !== 'POST') { res.writeHead(405); return res.end('Method Not Allowed'); }
    const secret = E.RAZORPAY_WEBHOOK_SECRET; if (!secret) { res.writeHead(503); return res.end('Webhook not configured'); }
    const chunks = []; let total = 0; req.on('data', c => { total += c.length; if (total > 1024 * 1024) req.destroy(); else chunks.push(c); });
    req.on('end', async () => { try { const raw = Buffer.concat(chunks); const supplied = req.headers['x-razorpay-signature']; const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex'); if (!signatureMatches(expected, supplied)) { res.writeHead(400); return res.end('Invalid signature'); } const event = JSON.parse(raw.toString('utf8')); const entity = event.payload && event.payload.payment && event.payload.payment.entity; if (['payment.captured','order.paid'].includes(event.event) && entity && entity.order_id && entity.status === 'captured') { const d = D.deposits.find(x => x.provider === 'razorpay' && x.orderId === entity.order_id); if (d && d.status === 'Pending' && Number(entity.amount) === d.amount * 100 && entity.currency === 'INR') { creditDeposit(d, entity.id); await save(); } } res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('ok'); } catch (err) { console.error('Razorpay webhook processing failed', err.message); if (!res.headersSent) { res.writeHead(400); res.end('Invalid webhook'); } } }); return;
  }
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method Not Allowed'); }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  const panelRoute = pathname.match(/^\/p\/([a-z0-9-]+)(\/admin)?\/?$/i);
  if (panelRoute) pathname = panelRoute[2] ? '/admin.html' : '/index.html';
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
  if (!emailOk(email)) throw new Error('ADMIN_EMAIL must be a valid email address.');
  if (pw && (pw.length < 8 || pw.length > 100)) throw new Error('ADMIN_PASSWORD must be 8–100 characters.');
  let admin = D.users.find(u => ['admin','headAdmin'].includes(u.role) && u.email === email);
  if (!admin) {
    const generated = !pw; if (!pw) pw = crypto.randomBytes(9).toString('base64url');
    admin = { id: nid(), uid: nextAccountUid('HAD'), name: 'Head Admin', email, phone: '', role: 'headAdmin', panelId: 'main', pass: hashPw(pw), balance: 0, refCode: makeRef(), refBy: null, blocked: false, created: now() };
    D.users.push(admin); audit('system', 'admin-created', email); await save();
    console.log(`ADMIN CREATED: ${email}` + (generated ? `  password: ${pw}   (set ADMIN_EMAIL / ADMIN_PASSWORD env vars on Render to choose your own)` : ''));
  } else { if (admin.role === 'admin') admin.role = 'headAdmin'; admin.panelId = 'main'; if (E.ADMIN_PASSWORD && !checkPw(E.ADMIN_PASSWORD, admin.pass)) {
    admin.pass = hashPw(E.ADMIN_PASSWORD); audit('system', 'admin-password-from-env', email); await save();
  } }
  if (!D.panels.some(p => p.slug === 'main')) D.panels.unshift(defaultPanel());
  if (!D.panels.find(p => p.slug === 'main').settings) D.panels.find(p => p.slug === 'main').settings = clone(D.settings);
  D.settings = D.panels.find(p => p.slug === 'main').settings; syncCoins();
  await save();
}

if (require.main === module) {
  loadDB().then(seedAdmin).then(() => {
    setInterval(() => settleAndSave().catch(e => console.error(e.message)), 1000).unref();
    server.listen(PORT, HOST, () => console.log(`Crypto Bridge listening on ${HOST}:${PORT}`));
  }).catch(e => { console.error('Startup failed:', e.message); process.exit(1); });
}
module.exports = { server, loadDB, seedAdmin, MIN_DEPOSIT, MIN_WITHDRAW, _resetPrices: () => { priceCache.ts = 0; if (typeof priceCaches !== 'undefined') priceCaches.clear(); } };
