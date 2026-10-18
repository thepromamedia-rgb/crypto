'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const state = { page: 'Home', query: '', me: null, cfg: { minDeposit: 1000, minWithdraw: 300 }, prices: [], updated: 0, stale: false, priceErr: '', deposits: [], withdrawals: [], referrals: 0, authMode: 'login', coin: '', side: 'buy', fx: 0, trades: [], positions: [], chartType: 'candle', interval: '1h', kl: {}, klErr: '' };
const colors = ['#fff0d8', '#edf0ff', '#e4f8ee', '#e9f7ff', '#fff0f4'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const qtyFmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 });
const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
const pwField = (id, ac, extra = '') => `<div class="pw-wrap"><input id="${id}" type="password" autocomplete="${ac}" ${extra}><button type="button" class="eye" data-eye="${id}" aria-label="Show password">${EYE}</button></div>`;
const usd = n => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 4 : 2, minimumFractionDigits: n < 1 ? 4 : 2 });
const dt = ts => new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const PROTECTED = new Set(['Assets', 'Recharge', 'Withdrawal', 'Team', 'Invite']);

async function api(path, body) {
  const r = await fetch('/api/' + path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Request failed'); e.status = r.status; throw e; }
  return j;
}

// ---------- prices ----------
function coinIcon(a, i) {
  const tone = a.symbol === 'ETH' || a.symbol === 'ADA' ? 'eth' : (a.symbol === 'ETC' || a.symbol === 'TRX' ? 'etc' : '');
  return `<span class="coin ${tone}" style="--coin-bg:${colors[i % colors.length]}" aria-hidden="true">${esc(a.mark)}</span>`;
}
function sparkline(a) {
  const s = a.spark || []; if (s.length < 2) return '';
  const min = Math.min(...s), max = Math.max(...s), span = max - min || 1;
  const pts = s.map((v, i) => `${(i / (s.length - 1) * 100).toFixed(1)},${(34 - (v - min) / span * 30).toFixed(1)}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 100 38" preserveAspectRatio="none" aria-label="7-day price trend"><polyline points="${pts}" fill="none" stroke="${a.change < 0 ? '#e16b78' : '#2bb78a'}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
const changeLabel = v => `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`;
function assetRow(a, i) {
  return `<div class="asset-row" data-coin="${esc(a.symbol)}" role="button" tabindex="0" style="cursor:pointer"><div class="asset-name">${coinIcon(a, i)}<div><strong>${esc(a.symbol)}</strong><small>${esc(a.name)}</small></div></div><div class="asset-price">${usd(a.price)}</div><div class="asset-change ${a.change < 0 ? 'negative' : 'positive'}">${changeLabel(a.change)}</div>${sparkline(a)}</div>`;
}
const bonusCfg = () => (state.cfg && state.cfg.bonusCoin) || { enabled: false };
function bonusRow(q = '') {
  const b = bonusCfg(); if (!b.enabled || (q && !(b.symbol + ' ' + b.name).toLowerCase().includes(q))) return '';
  return `<div class="asset-row bonus-row" data-coin="${esc(b.symbol)}" role="button" tabindex="0" style="cursor:pointer"><div class="asset-name"><span class="coin bonus-coin" aria-hidden="true">★</span><div><strong>${esc(b.symbol)}</strong><small>${esc(b.name)}</small></div></div><div class="asset-price">+${b.returnPct}% return</div><div class="asset-change positive">${b.lockHours ? b.lockHours + 'h' : 'Instant'}</div></div>`;
}
function renderAssetRows(q = '') {
  q = q.trim().toLowerCase(); const br = bonusRow(q);
  if (!state.prices.length) return br + `<div class="empty-state">${state.priceErr ? 'Live prices could not load. Retrying… <br><small>' + esc(state.priceErr) + '</small>' : 'Loading live prices…'}</div>`;
  const f = state.prices.filter(a => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  return br + (f.length ? f.map(assetRow).join('') : (br ? '' : '<div class="empty-state">No assets match that search.</div>'));
}
const staleNote = () => state.prices.length ? `<p class="stale">${state.stale ? '⚠ Showing last known prices — live feed delayed. ' : ''}Updated ${new Date(state.updated).toLocaleTimeString('en-IN')} · ${state.source || 'live'} · refreshes every 20s</p>` : '';
let COINS = [['BTC','Bitcoin','bitcoin','₿'],['ETH','Ethereum','ethereum','Ξ'],['ETC','Ethereum Classic','ethereum-classic','E'],['TRX','TRON','tron','T'],['DOGE','Dogecoin','dogecoin','Ð'],['BCH','Bitcoin Cash','bitcoin-cash','B'],['COMP','Compound','compound-governance-token','C'],['DASH','Dash','dash','D'],['ADA','Cardano','cardano','A'],['LINK','Chainlink','chainlink','L'],['LTC','Litecoin','litecoin','Ł'],['BNB','BNB','binancecoin','B'],['XRP','XRP','ripple','X'],['SOL','Solana','solana','S']];
async function getJSON(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
// Backup: browser fetches the public price APIs directly (both allow CORS) when our server can't.
async function directPrices() {
  const errs = [];
  try {
    const rows = await getJSON('https://api.binance.com/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(COINS.map(c => c[0] + 'USDT'))));
    return { prices: rows.map(x => { const c = COINS.find(k => k[0] + 'USDT' === x.symbol); return { symbol: c[0], name: c[1], mark: c[3], price: Number(x.lastPrice), change: Number(x.priceChangePercent), spark: [] }; }), source: 'Binance' };
  } catch (e) { errs.push('Binance ' + e.message); }
  try {
    const rows = await getJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + COINS.map(c => c[2]).join(',') + '&sparkline=true');
    return { prices: COINS.map(([symbol, name, id, mark]) => { const x = rows.find(r => r.id === id); if (!x) return null; const sp = x.sparkline_in_7d?.price || [], st = Math.max(1, Math.floor(sp.length / 28)); return { symbol, name, mark, price: x.current_price, change: x.price_change_percentage_24h || 0, spark: sp.filter((_, i) => i % st === 0) }; }).filter(Boolean), source: 'CoinGecko' };
  } catch (e) { errs.push('CoinGecko ' + e.message); }
  throw new Error(errs.join(' | '));
}
async function pullPrices() {
  let serverErr = '';
  try { const j = await api('prices'); state.prices = j.prices; state.updated = j.updated; state.stale = j.stale; state.source = j.source; if (j.fx) state.fx = j.fx; state.priceErr = ''; }
  catch (e) {
    serverErr = e.message;
    try { const j = await directPrices(); state.prices = j.prices; state.updated = Date.now(); state.stale = false; state.source = j.source + ' (direct)'; state.priceErr = ''; }
    catch (e2) { state.priceErr = 'Server: ' + serverErr + ' | Browser: ' + e2.message; }
  }
  if (state.page === 'Coin') updateCoinLive();
  else if (['Home', 'Quotes', 'Signal'].includes(state.page) && document.activeElement !== $('#assetSearch')) refreshPriceViews();
}
function refreshPriceViews() {
  const L = $('#assetList') || $('#quoteList') || $('#moverList'); if (!L) return;
  if (state.page === 'Quotes') L.innerHTML = renderAssetRows(state.query);
  else if (state.page === 'Home') { L.innerHTML = renderAssetRows(); const m = $('#marketCards'); if (m) m.innerHTML = marketCards(); }
  else if (state.page === 'Signal') renderPage('Signal', true);
  const s = $('#staleNote'); if (s) s.innerHTML = staleNote();
}
const marketCards = () => state.prices.slice(0, 3).map((a, i) => `<article class="market-card" data-coin="${esc(a.symbol)}" role="button" tabindex="0" style="cursor:pointer"><div class="asset-top">${coinIcon(a, i)}<div><strong>${esc(a.name)}</strong><small>${esc(a.symbol)} / USD</small></div></div><div class="price">${usd(a.price)}</div><div class="asset-change ${a.change < 0 ? 'negative' : 'positive'}">${changeLabel(a.change)}</div>${sparkline(a)}</article>`).join('');

// ---------- session ----------
async function loadMe() {
  try { const j = await api('me'); state.me = j.user; state.cfg = j.config; if (j.config && j.config.coins) COINS = j.config.coins; state.deposits = j.deposits; state.withdrawals = j.withdrawals; state.referrals = j.referrals; state.trades = j.trades || []; state.positions = j.positions || []; }
  catch { state.me = null; try { state.cfg = await api('config'); if (state.cfg.coins) COINS = state.cfg.coins; } catch {} }
  $('#account').textContent = state.me ? '₹ ' + Number(state.me.balance).toLocaleString('en-IN') : 'Login';
}
const noticeBar = () => state.cfg.notice ? `<div class="notice-banner"><span>ⓘ</span><p>${esc(state.cfg.notice)}</p></div>` : '';
const needLogin = page => { state.after = page; renderPage('Auth'); };

// ---------- pages ----------
function renderHome() {
  const hello = state.me ? `Welcome, ${esc(state.me.name.split(' ')[0])}` : 'Explore digital markets';
  $('#appMain').innerHTML = `${noticeBar()}
    <section class="welcome"><div><span class="eyebrow">YOUR MARKET AT A GLANCE</span><h1>${hello}</h1><p>Live digital asset prices, updated every 20 seconds.</p><button class="welcome-cta" data-page="${state.me ? 'Assets' : 'Auth'}">${state.me ? 'Open wallet' : 'Login / Register'} <span>↗</span></button></div><div class="coin-art" aria-hidden="true">₿</div><div class="hero-orb orb-one"></div><div class="hero-orb orb-two"></div></section>
    <section class="actions" aria-label="Quick actions"><button data-page="Recharge"><span class="action-icon blue">↗</span><span>Recharge</span></button><button data-page="Withdrawal"><span class="action-icon violet">↙</span><span>Withdrawal</span></button><button data-page="Signal"><span class="action-icon mint">⌁</span><span>Movers</span></button><button data-page="Service"><span class="action-icon amber">☏</span><span>Service</span></button><button data-page="Invite"><span class="action-icon pink">♧</span><span>Invite</span></button></section>
    <section class="promo-grid"><article class="promo"><div><span class="eyebrow">GET STARTED</span><h2>Guide</h2><p>How deposits and withdrawals work.</p><button class="light-btn" data-page="Guide">View guide ↗</button></div><div class="promo-icon">✦</div></article><article class="promo orange"><div><span class="eyebrow">OFFERS</span><h2>Bonus</h2><p>Current announcements and offers.</p><button class="light-btn" data-page="Bonus">View ↗</button></div><div class="promo-icon">🎁</div></article></section>
    <section class="section-head"><div><span class="eyebrow">MARKET OVERVIEW</span><h2>Trending markets</h2></div><button class="text-btn" data-page="Quotes">See all ↗</button></section>
    <section class="market-cards" id="marketCards">${marketCards()}</section>
    <section class="section-head list-head"><div><span class="eyebrow">LIVE MARKET DATA</span><h2>Trending assets</h2></div></section><div id="staleNote">${staleNote()}</div>
    <section class="asset-list" id="assetList">${renderAssetRows()}</section>`;
}

function authPage() {
  const reg = state.authMode === 'register', ref = new URLSearchParams(location.search).get('ref') || '';
  $('#appMain').innerHTML = `<section class="page-intro"><span class="eyebrow">ACCOUNT</span><h1>${reg ? 'Create account' : 'Login'}</h1><p>${reg ? 'Register to deposit, withdraw and track your wallet.' : 'Login to your Crypto Bridge wallet.'}</p></section>
  <form id="authForm" class="demo-form" autocomplete="on">
    ${reg ? '<label for="aName">Full name</label><input id="aName" autocomplete="name" required maxlength="60">' : ''}
    <label for="aEmail">Email</label><input id="aEmail" type="email" autocomplete="email" required>
    ${reg ? '<label for="aPhone">Mobile (optional)</label><input id="aPhone" type="tel" autocomplete="tel" maxlength="20">' : ''}
    <label for="aPass">Password ${reg ? '(min 8 characters)' : ''}</label>${pwField('aPass', reg ? 'new-password' : 'current-password', `required minlength="${reg ? 8 : 1}"`)}
    ${reg ? `<label for="aRef">Invite code (optional)</label><input id="aRef" value="${esc(ref)}" maxlength="20">` : ''}
    <p class="msg-err" id="authErr" role="alert"></p>
    <button class="primary-btn" type="submit">${reg ? 'Register' : 'Login'}</button>
    <button class="link-btn" type="button" id="swapAuth">${reg ? 'Already have an account? Login' : 'New here? Create an account'}</button>
  </form>`;
  $('#swapAuth').onclick = () => { state.authMode = reg ? 'login' : 'register'; authPage(); };
  $('#authForm').onsubmit = async e => {
    e.preventDefault(); const btn = e.submitter; btn.disabled = true; $('#authErr').textContent = '';
    try {
      await api(reg ? 'register' : 'login', reg ? { name: $('#aName').value, email: $('#aEmail').value, phone: $('#aPhone').value, password: $('#aPass').value, ref: $('#aRef').value } : { email: $('#aEmail').value, password: $('#aPass').value });
      await loadMe(); const go = state.after || 'Assets'; state.after = null; showToast(reg ? 'Account created.' : 'Welcome back.'); renderPage(go);
    } catch (err) { $('#authErr').textContent = err.message; btn.disabled = false; }
  };
}

function txList() {
  const bc = bonusCfg(), rows = [...state.deposits.map(d => ({ ...d, kind: 'Deposit' })), ...state.withdrawals.map(w => ({ ...w, kind: 'Withdrawal' })), ...state.trades.map(t => ({ ...t, kind: t.side === 'buy' ? 'Buy' : 'Sell' })), ...state.positions.map(p => ({ ...p, kind: 'Reward' }))].sort((a, b) => b.ts - a.ts).slice(0, 40);
  if (!rows.length) return '<div class="empty-state">No transactions yet.</div>';
  const icon = { Deposit: '↗', Withdrawal: '↙', Buy: '＋', Sell: '−', Reward: '★' }, plus = { Deposit: 1, Sell: 1 };
  return `<div class="activity-list">${rows.map(r => {
    const rw = r.kind === 'Reward', val = rw && r.status === 'Settled' ? '+' + inr(r.profit) : (plus[r.kind] ? '+' : '−') + inr(r.amount), cls = (plus[r.kind] || (rw && r.status === 'Settled')) ? 'positive' : '';
    const sub = rw ? `${inr(r.amount)} @ +${r.returnPct}%${r.status === 'Active' ? ' · pays ' + dt(r.matureAt) : ''}` : `${r.utr ? ' · UTR ' + esc(r.utr) : ''}${r.upi ? ' · ' + esc(r.upi) : ''}${r.qty ? ' · ' + qtyFmt(r.qty) + ' @ ' + inr(r.price) : ''}`;
    return `<div><span class="activity-icon">${icon[r.kind]}</span><span><b>${rw ? esc(r.symbol) : r.kind}${!rw && r.symbol ? ' ' + esc(r.symbol) : ''} ${r.status ? `<span class="pill ${esc(r.status)}">${esc(r.status)}</span>` : ''}</b><small>${dt(r.ts)}${rw ? ' · ' : ''}${sub}</small></span><strong class="${cls}">${val}</strong></div>`;
  }).join('')}</div>`;
}

function holdingsList() {
  const h = Object.entries(state.me.holdings || {}); if (!h.length) return '<div class="empty-state">No coins yet. Tap any coin in Quotes to buy.</div>';
  return `<div class="asset-list">${h.map(([sym, q]) => { const a = state.prices.find(x => x.symbol === sym); const val = a && state.fx ? inr(q * a.price * state.fx) : ''; return `<div class="asset-row" data-coin="${esc(sym)}" role="button" tabindex="0" style="cursor:pointer"><div class="asset-name"><span class="coin" aria-hidden="true">${esc(a ? a.mark : sym[0])}</span><div><strong>${esc(sym)}</strong><small>${qtyFmt(q)}</small></div></div><div class="asset-price">${val}</div></div>`; }).join('')}</div>`;
}

function bonusBody() {
  const b = bonusCfg(), u = state.me; if (!b.enabled) return '<div class="empty-state">This coin is not open right now.</div>';
  const mine = state.positions.filter(p => p.status === 'Active');
  return `<article class="balance-card"><span>${esc(b.name)} · ${esc(b.symbol)}</span><strong>+${b.returnPct}% return</strong><small>${b.lockHours ? 'Paid after ' + b.lockHours + ' hours' : 'Paid instantly'} · Trade ${inr(b.minAmount)} – ${inr(b.maxAmount)}</small>${u ? `<div class="stat-grid"><div><small>Wallet</small><b>${inr(u.balance)}</b></div><div><small>Active trades</small><b>${mine.length} · ${inr(mine.reduce((s, p) => s + p.amount, 0))}</b></div></div>` : ''}</article>
  ${u ? `<form id="bonusForm" class="demo-form"><label for="bAmt">Amount to trade (₹)</label><input id="bAmt" type="number" inputmode="numeric" step="1" min="${b.minAmount}" max="${b.maxAmount}" required placeholder="min ${b.minAmount}"><div class="quick">${[25, 50, 100].map(p => `<button type="button" data-bpct="${p}">${p === 100 ? 'Max' : p + '%'}</button>`).join('')}</div><p class="fine-print" id="bEst"></p><p class="fine-print">Wallet: <b>${inr(u.balance)}</b> · Your amount plus the ${b.returnPct}% return is credited to your wallet ${b.lockHours ? 'after ' + b.lockHours + ' hours' : 'immediately'}.</p><p class="msg-err" id="bErr" role="alert"></p><button class="primary-btn" type="submit">Trade ${esc(b.symbol)}</button></form>`
  : `<div class="demo-form"><p class="fine-print">Login to trade ${esc(b.symbol)}.</p><button class="primary-btn" data-page="Auth">Login / Register</button></div>`}`;
}
function bindBonus() {
  const f = $('#bonusForm'); if (!f) return; const b = bonusCfg();
  const est = () => { const v = Number($('#bAmt').value); $('#bEst').textContent = v > 0 ? `You will receive ${inr(v + v * b.returnPct / 100)} (profit ${inr(v * b.returnPct / 100)})` : ''; };
  $$('[data-bpct]').forEach(x => x.onclick = () => { $('#bAmt').value = Math.min(b.maxAmount, Math.floor(state.me.balance * Number(x.dataset.bpct) / 100)); est(); });
  $('#bAmt').oninput = est;
  f.onsubmit = async e => {
    e.preventDefault(); $('#bErr').textContent = ''; const btn = e.submitter; btn.disabled = true;
    try { const j = await api('bonus/trade', { amount: Number($('#bAmt').value) }); await loadMe(); const p = j.position; showModal('Trade placed', `${inr(p.amount)} traded. ${inr(p.amount + p.amount * p.returnPct / 100)} will be credited ${p.lockHours ? 'after ' + p.lockHours + ' hours' : 'now'}.`); renderPage('Coin', true); }
    catch (x) { $('#bErr').textContent = x.message; btn.disabled = false; }
  };
}

// ---------- candlestick / line chart (own SVG, no libraries) ----------
async function fetchKlines(sym, iv) {
  try { return (await api(`klines?symbol=${sym}&interval=${iv}`)).candles; }
  catch (e) { const rows = await getJSON(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${iv}&limit=130`); return rows.map(r => [r[0], +r[1], +r[2], +r[3], +r[4], +r[5]]); }
}
async function loadChart(initial) {
  const sym = state.coin, iv = state.interval, key = sym + ':' + iv, c = state.kl[key];
  if (initial) drawChart();
  if (c && Date.now() - c.ts < 30e3) return;
  try { state.kl[key] = { ts: Date.now(), candles: await fetchKlines(sym, iv) }; state.klErr = ''; } catch { if (!c) state.klErr = 'Chart data is not available right now.'; }
  if (state.page === 'Coin' && state.coin === sym && state.interval === iv) drawChart();
}
const pFmt = v => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v >= 1 ? v.toFixed(2) : v.toFixed(4);
function maSeries(d, p) { const o = []; let s = 0; d.forEach((x, i) => { s += x[4]; if (i >= p) s -= d[i - p][4]; o.push(i >= p - 1 ? s / p : null); }); return o; }
function drawChart() {
  const box = $('#chartBox'); if (!box) return; const c = state.kl[state.coin + ':' + state.interval];
  if (!c || c.candles.length < 2) { box.innerHTML = `<div class="empty-state">${state.klErr || 'Loading chart…'}</div>`; $('#chartInfo').innerHTML = ''; return; }
  const all = c.candles, st = Math.max(0, all.length - 90), d = all.slice(st), n = d.length, candle = state.chartType === 'candle';
  const MAS = [[5, '#f5a623'], [10, '#7b61ff'], [30, '#00a3d7']].map(([p, col]) => ({ p, col, v: maSeries(all, p).slice(st) }));
  const W = Math.max(260, box.clientWidth || 340), L = 6, R = 56, T = 10, PH = 205, VG = 10, VH = 50, B = 22, H = T + PH + VG + VH + B, pw = W - L - R, vTop = T + PH + VG;
  let lo = Math.min(...d.map(x => candle ? x[3] : x[4])), hi = Math.max(...d.map(x => candle ? x[2] : x[4])); const pad = (hi - lo || hi * .01) * .08; lo -= pad; hi += pad;
  const vmax = Math.max(...d.map(x => x[5] || 0)) || 1;
  const X = i => L + (i + .5) * pw / n, Y = v => T + (hi - v) / (hi - lo) * PH, last = d[n - 1], up = last[4] >= d[0][4], col = up ? '#2bb78a' : '#e16b78';
  const tf = t => new Date(t).toLocaleString('en-IN', state.interval === '1d' ? { day: '2-digit', month: 'short' } : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#eef1f7"/><text x="${W - R + 5}" y="${y + 3}" font-size="10" fill="#8b94a9">${pFmt(v)}</text>`; }
  g += `<line x1="${L}" x2="${W - R}" y1="${vTop + VH}" y2="${vTop + VH}" stroke="#eef1f7"/><text x="${W - R + 5}" y="${vTop + 9}" font-size="9" fill="#8b94a9">VOL</text>`;
  [0, Math.floor((n - 1) / 2), n - 1].forEach((i, k) => { g += `<text x="${k === 0 ? L : k === 2 ? W - R : X(i)}" y="${H - 6}" font-size="10" fill="#8b94a9" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">${tf(d[i][0])}</text>`; });
  let body = ''; const bw = Math.max(1.5, pw / n * .68);
  d.forEach((x, i) => { const cc = x[4] >= x[1] ? '#2bb78a' : '#e16b78', h = (x[5] || 0) / vmax * VH; body += `<rect x="${X(i) - bw / 2}" y="${vTop + VH - h}" width="${bw}" height="${h}" fill="${cc}" opacity=".55"/>`; });
  if (candle) {
    d.forEach((x, i) => { const cc = x[4] >= x[1] ? '#2bb78a' : '#e16b78', yt = Y(Math.max(x[1], x[4])), yb = Y(Math.min(x[1], x[4])); body += `<line x1="${X(i)}" x2="${X(i)}" y1="${Y(x[2])}" y2="${Y(x[3])}" stroke="${cc}" stroke-width="1.2"/><rect x="${X(i) - bw / 2}" y="${yt}" width="${bw}" height="${Math.max(1, yb - yt)}" fill="${cc}"/>`; });
    MAS.forEach(m => { const pts = m.v.map((v, i) => v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean).join(' '); if (pts) body += `<polyline points="${pts}" fill="none" stroke="${m.col}" stroke-width="1.3" stroke-linejoin="round"/>`; });
  } else { const pts = d.map((x, i) => `${X(i).toFixed(1)},${Y(x[4]).toFixed(1)}`).join(' '); body += `<defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".25"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><polygon points="${X(0)},${T + PH} ${pts} ${X(n - 1)},${T + PH}" fill="url(#lg)"/><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`; }
  const ly = Y(last[4]);
  box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${state.coin} ${candle ? 'candlestick' : 'line'} chart">${g}${body}<line x1="${L}" x2="${W - R}" y1="${ly}" y2="${ly}" stroke="${col}" stroke-dasharray="3 3" opacity=".7"/><rect x="${W - R + 1}" y="${ly - 8}" width="${R - 2}" height="16" rx="4" fill="${col}"/><text x="${W - R + 5}" y="${ly + 3.5}" font-size="10" font-weight="700" fill="#fff">${pFmt(last[4])}</text><line id="xh" y1="${T}" y2="${vTop + VH}" stroke="#9aa3b5" stroke-dasharray="2 3" visibility="hidden"/><rect id="ov" x="${L}" y="${T}" width="${pw}" height="${vTop + VH - T}" fill="transparent" style="touch-action:pan-y"/></svg>`;
  const vf = v => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(1);
  const info = i => { const x = d[i], ch = (x[4] - x[1]) / x[1] * 100, cc = ch >= 0 ? '#159d72' : '#df5b67';
    $('#chartInfo').innerHTML = `<span>${tf(x[0])}</span>` + (candle ? `<span>O <b>${pFmt(x[1])}</b></span><span>H <b>${pFmt(x[2])}</b></span><span>L <b>${pFmt(x[3])}</b></span>` : '') + `<span>C <b>${pFmt(x[4])}</b></span><span style="color:${cc}"><b>${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</b></span><span>Vol <b>${vf(x[5] || 0)}</b></span>` + (candle ? '<span class="ma-row">' + MAS.map(m => m.v[i] == null ? '' : `<span style="color:${m.col}">MA${m.p} <b style="color:${m.col}">${pFmt(m.v[i])}</b></span>`).join('') + '</span>' : ''); };
  info(n - 1);
  const xh = $('#xh'), ov = $('#ov'), at = e => { const r = ov.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left) / r.width * n))); xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('visibility', 'visible'); info(i); };
  ov.addEventListener('pointermove', at); ov.addEventListener('pointerdown', at); ov.addEventListener('pointerleave', () => { xh.setAttribute('visibility', 'hidden'); info(n - 1); });
}
function bindChart() {
  $$('[data-ct]').forEach(b => b.onclick = () => { state.chartType = b.dataset.ct; $$('[data-ct]').forEach(x => x.classList.toggle('on', x === b)); drawChart(); });
  $$('[data-iv]').forEach(b => b.onclick = () => { state.interval = b.dataset.iv; $$('[data-iv]').forEach(x => x.classList.toggle('on', x === b)); loadChart(true); });
  loadChart(true);
}
window.addEventListener('resize', () => { if (state.page === 'Coin') drawChart(); });

function coinBody() {
  const a = state.prices.find(x => x.symbol === state.coin); if (!a) return '';
  const hold = (state.me && state.me.holdings && state.me.holdings[a.symbol]) || 0, unit = state.fx ? a.price * state.fx : 0, c = state.cfg;
  const buy = state.side === 'buy';
  return `<article class="balance-card"><span>${esc(a.name)} · ${esc(a.symbol)}</span><strong id="coinPrice">${unit ? inr(unit) : usd(a.price)}</strong><small id="coinSub">${usd(a.price)} · <span class="${a.change < 0 ? 'negative' : 'positive'}" style="color:inherit">${changeLabel(a.change)} (24h)</span></small>${state.me ? `<div class="stat-grid"><div><small>You hold</small><b>${qtyFmt(hold)} ${esc(a.symbol)}</b></div><div><small>Value</small><b>${unit ? inr(hold * unit) : '—'}</b></div></div>` : ''}</article>
  <article class="content-card chart-card"><div class="chart-bar"><div class="seg">${[['candle', 'Candles'], ['line', 'Line']].map(([k, l]) => `<button type="button" data-ct="${k}" class="${state.chartType === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="seg">${[['1m', '1m'], ['3m', '3m'], ['5m', '5m'], ['15m', '15m'], ['1h', '1H'], ['1d', '1D']].map(([k, l]) => `<button type="button" data-iv="${k}" class="${state.interval === k ? 'on' : ''}">${l}</button>`).join('')}</div></div><div class="chart-info" id="chartInfo"></div><div class="chart-box" id="chartBox"></div></article>
  ${state.me ? `<div class="tabs2"><button type="button" data-side="buy" class="${buy ? 'on' : ''}">Buy</button><button type="button" data-side="sell" class="${buy ? '' : 'on'}">Sell</button></div>
  <form id="tradeForm" class="demo-form"><label for="tAmt">${buy ? 'Amount to spend (₹)' : 'Quantity to sell (' + esc(a.symbol) + ')'}</label><input id="tAmt" type="number" inputmode="decimal" step="any" min="0" required placeholder="${buy ? 'min ' + c.minTrade : '0.00'}">
  <div class="quick">${buy ? [25, 50, 100].map(p => `<button type="button" data-pct="${p}">${p}%</button>`).join('') : [25, 50, 100].map(p => `<button type="button" data-pct="${p}">${p === 100 ? 'Max' : p + '%'}</button>`).join('')}</div>
  <p class="fine-print" id="tEst"></p><p class="fine-print">${buy ? 'Wallet' : 'Holding'}: <b>${buy ? inr(state.me.balance) : qtyFmt(hold) + ' ' + esc(a.symbol)}</b> · Price is fixed by the server at the moment you confirm. No trading fee.</p>
  <p class="msg-err" id="tErr" role="alert"></p><button class="primary-btn" type="submit">${buy ? 'Buy' : 'Sell'} ${esc(a.symbol)}</button></form>`
  : `<div class="demo-form"><p class="fine-print">Login to buy or sell ${esc(a.symbol)}.</p><button class="primary-btn" data-page="Auth">Login / Register</button></div>`}`;
}
function tradeEstimate() {
  const a = state.prices.find(x => x.symbol === state.coin), el = $('#tEst'), v = Number($('#tAmt') && $('#tAmt').value);
  if (!a || !el || !state.fx) return; const unit = a.price * state.fx;
  el.textContent = v > 0 ? (state.side === 'buy' ? `You get ≈ ${qtyFmt(Math.floor(v / unit * 1e8) / 1e8)} ${a.symbol}` : `You get ≈ ${inr(v * unit)}`) : '';
}
function updateCoinLive() {
  const a = state.prices.find(x => x.symbol === state.coin), p = $('#coinPrice'); if (a && !p) return renderPage('Coin', true); if (!a || !p) return;
  p.textContent = state.fx ? inr(a.price * state.fx) : usd(a.price); $('#coinSub').innerHTML = `${usd(a.price)} · ${changeLabel(a.change)} (24h)`; tradeEstimate(); loadChart();
}
function bindCoin() {
  const f = $('#tradeForm'); if (!f) return;
  $$('[data-side]').forEach(b => b.onclick = () => { state.side = b.dataset.side; renderPage('Coin', true); });
  const a = () => state.prices.find(x => x.symbol === state.coin);
  $$('[data-pct]').forEach(b => b.onclick = () => {
    const pct = Number(b.dataset.pct) / 100, c = a(); if (!c) return;
    if (state.side === 'buy') $('#tAmt').value = Math.floor(state.me.balance * pct * 100) / 100;
    else { const h = state.me.holdings[state.coin] || 0; $('#tAmt').value = pct === 1 ? h : Math.floor(h * pct * 1e8) / 1e8; f.dataset.all = pct === 1 ? '1' : ''; }
    tradeEstimate();
  });
  $('#tAmt').oninput = () => { f.dataset.all = ''; tradeEstimate(); };
  f.onsubmit = async e => {
    e.preventDefault(); $('#tErr').textContent = ''; const btn = e.submitter; btn.disabled = true; const v = Number($('#tAmt').value);
    try {
      const j = await api('trade', state.side === 'buy' ? { symbol: state.coin, side: 'buy', amount: v } : { symbol: state.coin, side: 'sell', qty: v, all: f.dataset.all === '1' });
      await loadMe(); const t = j.trade; showModal(t.side === 'buy' ? 'Bought' : 'Sold', `${qtyFmt(t.qty)} ${t.symbol} at ${inr(t.price)} = ${inr(t.amount)}`); renderPage('Coin', true);
    } catch (x) { $('#tErr').textContent = x.message; btn.disabled = false; }
  };
}

function renderPage(page, quiet) {
  if (PROTECTED.has(page) && !state.me) return needLogin(page);
  state.page = page;
  $$('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const main = $('#appMain'), c = state.cfg;
  if (page === 'Home') renderHome();
  else if (page === 'Coin') {
    main.innerHTML = `<section class="page-intro"><button class="link-btn" data-page="Quotes">← Back to quotes</button></section><div id="coinWrap">${bonusCfg().enabled && state.coin === bonusCfg().symbol ? bonusBody() : coinBody() || '<div class="empty-state">Price not loaded yet.</div>'}</div>`;
    if (bonusCfg().enabled && state.coin === bonusCfg().symbol) bindBonus(); else { bindCoin(); if ($('#chartBox')) bindChart(); }
  }
  else if (page === 'Auth') { if (state.me) return renderPage('Profile'); authPage(); }
  else if (page === 'Profile') {
    const u = state.me; if (!u) return needLogin('Profile');
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">ACCOUNT</span><h1>${esc(u.name)}</h1><p>${esc(u.email)}</p></section>
    ${u.role === 'admin' ? '<article class="content-card"><h2>Admin</h2><p class="fine-print">You are signed in as an administrator.</p><a class="primary-btn" style="display:block;text-align:center;text-decoration:none" href="/admin">Open Admin Panel</a></article>' : ''}
    <form id="pwForm" class="demo-form"><h2 style="margin-top:0;font-size:16px">Change password</h2><label for="pwC">Current password</label>${pwField('pwC', 'current-password', 'required')}<label for="pwN">New password (min 8)</label>${pwField('pwN', 'new-password', 'minlength="8" required')}<p class="msg-err" id="pwErr"></p><button class="primary-btn" type="submit">Update password</button></form>
    <div class="demo-form" style="margin-top:14px"><button class="secondary-btn" id="logout" type="button">Logout</button></div>`;
    $('#pwForm').onsubmit = async e => { e.preventDefault(); try { await api('password', { current: $('#pwC').value, password: $('#pwN').value }); e.target.reset(); showToast('Password updated.'); } catch (x) { $('#pwErr').textContent = x.message; } };
    $('#logout').onclick = doLogout;
  } else if (page === 'Quotes') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">MARKET EXPLORER</span><h1>Quotes</h1><p>Live crypto prices in USD with 24h change and 7-day trend.</p></section><div class="search-wrap"><span>⌕</span><input id="assetSearch" type="search" placeholder="Search by name or symbol…" value="${esc(state.query)}" aria-label="Search assets"><button id="clearSearch" type="button" aria-label="Clear search">×</button></div><div id="staleNote">${staleNote()}</div><section class="asset-list" id="quoteList">${renderAssetRows(state.query)}</section>`;
    $('#assetSearch').addEventListener('input', e => { state.query = e.target.value; $('#quoteList').innerHTML = renderAssetRows(state.query); });
    $('#clearSearch').addEventListener('click', () => { state.query = ''; $('#assetSearch').value = ''; $('#quoteList').innerHTML = renderAssetRows(''); $('#assetSearch').focus(); });
  } else if (page === 'Assets') {
    main.innerHTML = `${noticeBar()}<section class="page-intro"><span class="eyebrow">WALLET</span><h1>Assets</h1><p>Your wallet balance in Indian rupees.</p></section><article class="balance-card"><span>Available balance</span><strong>${inr(state.me.balance)}</strong><small>Min deposit ${inr(c.minDeposit)} · Min withdrawal ${inr(c.minWithdraw)}</small><div class="balance-actions"><button data-page="Recharge">Recharge</button><button data-page="Withdrawal">Withdrawal</button><button data-page="Quotes">Buy / Sell</button></div><div class="balance-actions"><button data-page="Profile">Change password</button><button id="logoutBtn" type="button">Logout</button></div></article><section class="section-head"><div><span class="eyebrow">YOUR COINS</span><h2>Holdings</h2></div></section>${holdingsList()}<section class="section-head"><div><span class="eyebrow">YOUR RECORDS</span><h2>Recent activity</h2></div></section>${txList()}`;
    $('#logoutBtn').onclick = doLogout;
  } else if (page === 'Team' || page === 'Invite') {
    const code = state.me.refCode, link = location.origin + '/?ref=' + code;
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">INVITE</span><h1>${page}</h1><p>Share your invite code with friends.</p></section><article class="balance-card team-card"><span>People who joined with your code</span><strong>${state.referrals}</strong>${bonusCfg().enabled && bonusCfg().refPct ? `<div class="stat-grid"><div><small>Your commission</small><b>${bonusCfg().refPct}% of ${bonusCfg().refBase === 'amount' ? 'their ' + esc(bonusCfg().symbol) + ' trade amount' : 'their ' + esc(bonusCfg().symbol) + ' trade return'}</b></div><div><small>Total earned</small><b>${inr(state.me.refEarned)}</b></div></div>` : `<div class="stat-grid"><div><small>Total earned</small><b>${inr(state.me.refEarned)}</b></div></div>`}</article><article class="content-card"><h2>Your invite code</h2><div class="copy-row"><code>${esc(code)}</code><button class="primary-btn compact" id="copyCode" type="button">Copy link</button></div></article>`;
    $('#copyCode').onclick = async () => { try { await navigator.clipboard.writeText(link); showToast('Invite link copied.'); } catch { showToast('Your invite code: ' + code); } };
  } else if (page === 'Bonus') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">OFFERS</span><h1>Bonus</h1><p>Announcements from Crypto Bridge.</p></section>${c.bonus ? `<article class="content-card"><p style="white-space:pre-wrap">${esc(c.bonus)}</p></article>` : '<div class="empty-state">No active offers right now.</div>'}`;
  } else if (page === 'Recharge') {
    const pay = c.upi || c.qr;
    main.innerHTML = `${noticeBar()}<section class="page-intro"><span class="eyebrow">WALLET</span><h1>Recharge</h1><p>Minimum deposit ${inr(c.minDeposit)}. Pay by UPI, then submit your UTR. Balance is credited after admin verification.</p></section>
    ${pay ? `<article class="content-card"><h2>Pay to</h2>${c.qr ? `<img class="qr-img" alt="Payment QR" src="${esc(c.qr)}">` : ''}${c.upi ? `<div class="copy-row"><code>${esc(c.upi)}</code><button class="primary-btn compact" id="copyUpi" type="button">Copy</button></div>` : ''}${c.payee ? `<p class="fine-print">Payee: ${esc(c.payee)}</p>` : ''}</article>` : '<article class="content-card warning-card"><span class="warning-icon">ⓘ</span><div><h2>Deposits not open</h2><p>Payment details have not been set up yet. Please contact support.</p></div></article>'}
    <form id="depForm" class="demo-form"><label for="dAmt">Amount paid (₹)</label><input id="dAmt" type="number" inputmode="numeric" min="${c.minDeposit}" step="1" required placeholder="${c.minDeposit}"><label for="dUtr">UTR / transaction reference</label><input id="dUtr" required maxlength="30" autocomplete="off" placeholder="12-digit UTR"><p class="msg-err" id="depErr" role="alert"></p><button class="primary-btn" type="submit" ${pay ? '' : 'disabled'}>Submit for verification</button><button class="secondary-btn" type="button" data-page="Assets">Back to assets</button></form>`;
    const cu = $('#copyUpi'); if (cu) cu.onclick = async () => { try { await navigator.clipboard.writeText(c.upi); showToast('UPI ID copied.'); } catch { showToast(c.upi); } };
    $('#depForm').onsubmit = async e => {
      e.preventDefault(); $('#depErr').textContent = ''; const btn = e.submitter; btn.disabled = true;
      try { await api('deposit', { amount: Number($('#dAmt').value), utr: $('#dUtr').value }); await loadMe(); showModal('Submitted', 'Your deposit is pending verification. It will be credited once an admin confirms the payment.'); renderPage('Assets'); }
      catch (x) { $('#depErr').textContent = x.message; btn.disabled = false; }
    };
  } else if (page === 'Withdrawal') {
    main.innerHTML = `${noticeBar()}<section class="page-intro"><span class="eyebrow">WALLET</span><h1>Withdrawal</h1><p>Minimum withdrawal ${inr(c.minWithdraw)}. Available: <b>${inr(state.me.balance)}</b>. The amount is held when you request and paid to your UPI after admin approval.</p></section>
    <form id="wdForm" class="demo-form"><label for="wAmt">Amount (₹)</label><input id="wAmt" type="number" inputmode="numeric" min="${c.minWithdraw}" max="${state.me.balance}" step="1" required placeholder="${c.minWithdraw}"><label for="wUpi">Your UPI ID</label><input id="wUpi" required maxlength="60" autocomplete="off" placeholder="name@bank"><p class="msg-err" id="wdErr" role="alert"></p><button class="primary-btn" type="submit">Request withdrawal</button><button class="secondary-btn" type="button" data-page="Assets">Back to assets</button></form>`;
    $('#wdForm').onsubmit = async e => {
      e.preventDefault(); $('#wdErr').textContent = ''; const btn = e.submitter; btn.disabled = true;
      try { await api('withdraw', { amount: Number($('#wAmt').value), upi: $('#wUpi').value }); await loadMe(); showModal('Requested', 'Your withdrawal request is pending. You can follow its status in Assets.'); renderPage('Assets'); }
      catch (x) { $('#wdErr').textContent = x.message; btn.disabled = false; }
    };
  } else if (page === 'Signal') {
    const sorted = [...state.prices].sort((a, b) => b.change - a.change);
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">MARKET MOVERS</span><h1>Movers</h1><p>Biggest 24h moves among tracked assets, from live data. Not financial advice.</p></section><div id="staleNote">${staleNote()}</div><section class="asset-list" id="moverList">${sorted.length ? sorted.map(assetRow).join('') : renderAssetRows()}</section>`;
  } else if (page === 'Service') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">HELP CENTER</span><h1>Service</h1><p>Answers and support.</p></section>${c.support ? `<a class="primary-btn" style="display:block;text-align:center;text-decoration:none;margin-bottom:14px" target="_blank" rel="noopener" href="${esc(c.support)}">Contact support ↗</a>` : ''}<div class="faq-list"><details open><summary>How do I deposit?</summary><p>Open Recharge, pay the shown UPI/QR (minimum ${inr(c.minDeposit)}), then submit amount and UTR. Your balance updates after admin verification.</p></details><details><summary>How do I withdraw?</summary><p>Open Withdrawal, enter an amount (minimum ${inr(c.minWithdraw)}, up to your balance) and your UPI ID. If rejected, the amount returns to your balance.</p></details><details><summary>Are prices live?</summary><p>Yes, prices come from CoinGecko and refresh about every 20 seconds. They can be slightly delayed.</p></details></div>`;
  } else if (page === 'Guide') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">QUICK START</span><h1>Guide</h1><p>Get going in three steps.</p></section><div class="faq-list"><details open><summary>1. Register or login</summary><p>Create an account with your email and a password of at least 8 characters.</p></details><details open><summary>2. Recharge</summary><p>Minimum ${inr(c.minDeposit)}. Pay via UPI, submit the UTR, wait for verification.</p></details><details open><summary>3. Withdraw</summary><p>Minimum ${inr(c.minWithdraw)}. Requests are reviewed and paid to your UPI ID.</p></details></div>`;
  }
  if (!quiet) window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function doLogout() { try { await api('logout', {}); } catch {} state.me = null; state.deposits = state.withdrawals = state.trades = state.positions = []; await loadMe(); showToast('Logged out.'); renderPage('Home'); }
function showModal(title, text) { $('#modalTitle').textContent = title; $('#modalBody').innerHTML = ''; const p = document.createElement('p'); p.textContent = text; $('#modalBody').appendChild(p); $('#modal').hidden = false; $('#okModal').focus(); }
function hideModal() { $('#modal').hidden = true; }
function showToast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(showToast.t); showToast.t = setTimeout(() => { t.hidden = true; }, 2600); }

document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-coin]')) { e.preventDefault(); e.target.click(); } });
document.addEventListener('click', e => {
  const eye = e.target.closest('[data-eye]'); if (eye) { const i = document.getElementById(eye.dataset.eye), show = i.type === 'password'; i.type = show ? 'text' : 'password'; eye.innerHTML = show ? EYE_OFF : EYE; eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); return; }
  const cn = e.target.closest('[data-coin]'); if (cn) { state.coin = cn.dataset.coin; renderPage('Coin'); return; } const b = e.target.closest('[data-page]'); if (b) { e.preventDefault(); renderPage(b.dataset.page); } });
$('#closeModal').addEventListener('click', hideModal);
$('#okModal').addEventListener('click', hideModal);
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) hideModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) hideModal(); });
$('#account').addEventListener('click', () => renderPage(state.me ? 'Profile' : 'Auth'));

(async function init() {
  const ref = new URLSearchParams(location.search).get('ref');
  await loadMe();
  renderPage(ref && !state.me ? 'Auth' : 'Home');
  if (ref && !state.me) { state.authMode = 'register'; authPage(); }
  pullPrices(); setInterval(pullPrices, 20000);
})();
