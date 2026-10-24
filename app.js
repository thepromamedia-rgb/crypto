'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const state = { page: 'Home', query: '', me: null, cfg: { minDeposit: 1000, minWithdraw: 300 }, prices: [], updated: 0, stale: false, priceErr: '', deposits: [], withdrawals: [], referrals: 0, authMode: 'login', coin: '', side: 'buy', fx: 0, trades: [], positions: [], chartType: 'candle', interval: '1h', kl: {}, klErr: '', chartView: {}, chartDrawings: {}, drawMode: false, drawDraft: null, chartGestureActive: false };
const colors = ['#fff0d8', '#edf0ff', '#e4f8ee', '#e9f7ff', '#fff0f4'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const qtyFmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 });
const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
const pwField = (id, ac, extra = '') => `<div class="pw-wrap"><input id="${id}" type="password" autocomplete="${ac}" ${extra}><button type="button" class="eye" data-eye="${id}" aria-label="Show password">${EYE}</button></div>`;
const usd = n => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 4 : 2, minimumFractionDigits: n < 1 ? 4 : 2 });
const dt = ts => new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const PROTECTED = new Set(['Assets', 'Recharge', 'Withdrawal', 'Team', 'Invite', 'Games']);

function activePanelSlug() { const m = location.pathname.match(/^\/p\/([a-z0-9-]+)/i); return m ? m[1] : 'main'; }
async function api(path, body) {
  const headers = { 'X-Panel-Slug': activePanelSlug() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api/' + path, body === undefined ? { credentials: 'same-origin', headers } : { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body) });
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
const bonusCoins = () => (state.cfg && Array.isArray(state.cfg.bonusCoins) ? state.cfg.bonusCoins : ((state.cfg && state.cfg.bonusCoin && state.cfg.bonusCoin.enabled) ? [state.cfg.bonusCoin] : []));
const bonusCfg = (symbol = state.coin) => bonusCoins().find(c => c.symbol === symbol) || (state.cfg && state.cfg.bonusCoin) || { enabled: false };
const bonusSeconds = b => Number(b.lockSeconds ?? (Number(b.lockHours || 0) * 3600));
const bonusWaitLabel = b => bonusSeconds(b) <= 0 ? 'Instant' : bonusSeconds(b) + ' sec';
function bonusRow(q = '') {
  return bonusCoins().filter(b => b.enabled && (!q || (b.symbol + ' ' + b.name).toLowerCase().includes(q))).map(b => `<div class="asset-row bonus-row" data-coin="${esc(b.symbol)}" role="button" tabindex="0" style="cursor:pointer"><div class="asset-name"><span class="coin bonus-coin" aria-hidden="true">★</span><div><strong>${esc(b.symbol)}</strong><small>${esc(b.name)} · promotional coin</small></div></div><div class="asset-price">+${b.returnPct}% reward</div><div class="asset-change positive">${bonusWaitLabel(b)}</div></div>`).join('');
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
  try { const j = await api('me'); state.me = j.user; state.cfg = j.config; if (j.config && j.config.coins) COINS = j.config.coins; state.deposits = j.deposits; state.withdrawals = j.withdrawals; state.referrals = j.referrals; state.trades = j.trades || []; state.positions = j.positions || []; updateFooter(); }
  catch { state.me = null; try { state.cfg = await api('config'); if (state.cfg.coins) COINS = state.cfg.coins; updateFooter(); } catch {} }
  $('#account').textContent = state.me ? '₹ ' + Number(state.me.balance).toLocaleString('en-IN') : 'Login';
}
const updateFooter = () => { const el = $('#siteFooter'); if (el) el.textContent = (state.cfg && state.cfg.footerText) || 'India-focused platform'; };
const noticeBar = () => `${state.cfg.notice ? `<div class="notice-banner"><span>ⓘ</span><p>${esc(state.cfg.notice)}</p></div>` : ''}`;
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
    const sub = rw ? `${inr(r.amount)} @ +${r.returnPct}%${r.status === 'Active' ? ' · pays ' + dt(r.matureAt) : ''}` : `${r.utr ? ' · UTR ' + esc(r.utr) : ''}${r.provider === 'razorpay' ? ' · Razorpay · Fee ' + inr(r.fee || 0) + ' · Payout ' + inr(r.netAmount == null ? r.amount : r.netAmount) : ''}${r.upi ? ' · ' + esc(r.upi) : ''}${r.qty ? ' · ' + qtyFmt(r.qty) + ' @ ' + inr(r.price) : ''}`;
    return `<div><span class="activity-icon">${icon[r.kind]}</span><span><b>${rw ? esc(r.symbol) : r.kind}${!rw && r.symbol ? ' ' + esc(r.symbol) : ''} ${r.status ? `<span class="pill ${esc(r.status)}">${esc(r.status)}</span>` : ''}</b><small>${dt(r.ts)}${rw ? ' · ' : ''}${sub}</small></span><strong class="${cls}">${val}</strong></div>`;
  }).join('')}</div>`;
}

function holdingsList() {
  const h = Object.entries(state.me.holdings || {}); if (!h.length) return '<div class="empty-state">No coins yet. Tap any coin in Quotes to buy.</div>';
  return `<div class="asset-list">${h.map(([sym, q]) => {
    const a = state.prices.find(x => x.symbol === sym), fx = Number(state.fx || 0), value = a && fx ? q * a.price * fx : null;
    const cost = Number((state.me.cost || {})[sym] || 0), pnl = value == null ? null : value - cost;
    const pnlText = pnl == null ? 'P/L unavailable' : `${pnl >= 0 ? '+' : '−'}${inr(Math.abs(pnl))} unrealized`;
    const pnlClass = pnl == null ? '' : pnl >= 0 ? 'positive' : 'negative';
    return `<div class="asset-row" data-coin="${esc(sym)}" role="button" tabindex="0" style="cursor:pointer"><div class="asset-name"><span class="coin" aria-hidden="true">${esc(a ? a.mark : sym[0])}</span><div><strong>${esc(sym)}</strong><small>${qtyFmt(q)} · Cost ${inr(cost)}</small><small class="${pnlClass}">${pnlText}</small></div></div><div class="asset-price">${value == null ? '—' : inr(value)}<small style="display:block">Market value</small></div></div>`;
  }).join('')}</div>`;
}

function bonusBody() {
  const b = bonusCfg(state.coin), u = state.me; if (!b.enabled) return '<div class="empty-state">This coin is not open right now.</div>';
  const mine = state.positions.filter(p => p.status === 'Active');
  return `<article class="balance-card"><span>${esc(b.name)} · ${esc(b.symbol)}</span><strong>+${b.returnPct}% return</strong><small>${bonusSeconds(b) ? 'Countdown: ' + bonusSeconds(b) + ' seconds' : 'Paid instantly'} · Trade ${inr(b.minAmount)} – ${inr(b.maxAmount)}</small>${u ? `<div class="stat-grid"><div><small>Wallet</small><b>${inr(u.balance)}</b></div><div><small>Active trades</small><b>${mine.length} · ${inr(mine.reduce((s, p) => s + p.amount, 0))}</b></div></div>` : ''}</article>
  <article class="content-card chart-card"><div class="chart-bar"><div class="seg">${[['candle','Candles'],['line','Line']].map(([k,l])=>`<button type="button" data-ct="${k}" class="${state.chartType===k?'on':''}">${l}</button>`).join('')}</div><div class="seg">${[['1m','1m'],['3m','3m'],['5m','5m'],['15m','15m'],['1h','1H'],['1d','1D']].map(([k,l])=>`<button type="button" data-iv="${k}" class="${state.interval===k?'on':''}">${l}</button>`).join('')}</div><div class="chart-tools"><button type="button" data-zoom="in" aria-label="Zoom in">＋</button><button type="button" data-zoom="out" aria-label="Zoom out">−</button><button type="button" data-chart-home>Latest</button><button type="button" data-draw-line class="draw-tool">↗ Trend line</button><button type="button" data-draw-horizontal>— Price line</button><button type="button" data-clear-lines>Clear lines</button></div></div><div class="chart-hint" id="chartHint">Pinch or scroll to zoom · Drag to view older candles</div><div class="chart-info" id="chartInfo"></div><div class="chart-box" id="chartBox"></div></article>${u ? `<form id="bonusForm" class="demo-form"><label for="bAmt">Amount to trade (₹)</label><input id="bAmt" type="number" inputmode="numeric" step="1" min="${b.minAmount}" max="${b.maxAmount}" required placeholder="min ${b.minAmount}"><div class="quick">${[25, 50, 100].map(p => `<button type="button" data-bpct="${p}">${p === 100 ? 'Max' : p + '%'}</button>`).join('')}</div><p class="fine-print" id="bEst"></p><p class="fine-print">Wallet: <b>${inr(u.balance)}</b> · Your amount plus the ${b.returnPct}% return is credited to your wallet ${bonusSeconds(b) ? 'after ' + bonusSeconds(b) + ' seconds' : 'immediately'}.</p><p class="msg-err" id="bErr" role="alert"></p><button class="primary-btn" type="submit">Trade ${esc(b.symbol)}</button></form>`
  : `<div class="demo-form"><p class="fine-print">Login to trade ${esc(b.symbol)}.</p><button class="primary-btn" data-page="Auth">Login / Register</button></div>`}`;
}
function bindBonus() {
  const f = $('#bonusForm'); if (!f) return; const b = bonusCfg();
  const est = () => { const v = Number($('#bAmt').value); $('#bEst').textContent = v > 0 ? `You will receive ${inr(v + v * b.returnPct / 100)} (profit ${inr(v * b.returnPct / 100)})` : ''; };
  $$('[data-bpct]').forEach(x => x.onclick = () => { $('#bAmt').value = Math.min(b.maxAmount, Math.floor(state.me.balance * Number(x.dataset.bpct) / 100)); est(); });
  $('#bAmt').oninput = est;
  f.onsubmit = async e => {
    e.preventDefault(); $('#bErr').textContent = ''; const btn = e.submitter; btn.disabled = true;
    try { const j = await api('bonus/trade', { symbol: b.symbol, amount: Number($('#bAmt').value) }); await loadMe(); const p = j.position; showModal('Trade placed', `${inr(p.amount)} promotional position started for ${p.symbol}. Principal + ${p.returnPct}% promotional reward is scheduled after ${p.lockSeconds} seconds.`); renderPage('Coin', true); }
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
  if (c && Date.now() - c.ts < 5e3) return;
  try { state.kl[key] = { ts: Date.now(), candles: await fetchKlines(sym, iv) }; state.klErr = ''; } catch { if (!c) state.klErr = 'Chart data is not available right now.'; }
  if (state.page === 'Coin' && state.coin === sym && state.interval === iv) { if (state.chartGestureActive) state.chartPendingRedraw = true; else drawChart(); }
}
const pFmt = v => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v >= 1 ? v.toFixed(2) : v.toFixed(4);
function maSeries(d, p) { const o = []; let s = 0; d.forEach((x, i) => { s += x[4]; if (i >= p) s -= d[i - p][4]; o.push(i >= p - 1 ? s / p : null); }); return o; }
function drawChart() {
  const box = $('#chartBox'); if (!box) return; const key = state.coin + ':' + state.interval, c = state.kl[key];
  if (!c || c.candles.length < 2) { box.innerHTML = `<div class="empty-state">${state.klErr || 'Loading chart…'}</div>`; $('#chartInfo').innerHTML = ''; return; }
  const all = c.candles, total = all.length, view = state.chartView[key] || (state.chartView[key] = { count: 42, offset: 0 });
  view.count = Math.max(12, Math.min(total, view.count)); view.offset = Math.max(0, Math.min(total - view.count, view.offset));
  const end = total - view.offset, begin = Math.max(0, end - view.count), d = all.slice(begin, end), n = d.length, candle = state.chartType === 'candle';
  const MAS = [[5, '#f5a623'], [10, '#7b61ff'], [30, '#00a3d7']].map(([p, col]) => ({ p, col, v: maSeries(all, p).slice(begin, end) }));
  const W = Math.max(260, box.clientWidth || 340), L = 8, R = 62, T = 12, PH = 205, VG = 10, VH = 44, B = 24, H = T + PH + VG + VH + B, pw = W - L - R, vTop = T + PH + VG;
  let lo = Math.min(...d.map(x => candle ? x[3] : x[4])), hi = Math.max(...d.map(x => candle ? x[2] : x[4])); const pad = (hi - lo || hi * .01) * .08; lo -= pad; hi += pad;
  const vmax = Math.max(...d.map(x => x[5] || 0)) || 1;
  const X = i => L + (i + .5) * pw / n, Y = v => T + (hi - v) / (hi - lo) * PH, last = d[n - 1], up = last[4] >= d[0][4], col = up ? '#2bb78a' : '#e16b78';
  const tf = t => new Date(t).toLocaleString('en-IN', state.interval === '1d' ? { day: '2-digit', month: 'short' } : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#eef1f7"/><text x="${W - R + 5}" y="${y + 3}" font-size="10" fill="#8b94a9">${pFmt(v)}</text>`; }
  g += `<line x1="${L}" x2="${W - R}" y1="${vTop + VH}" y2="${vTop + VH}" stroke="#eef1f7"/><text x="${W - R + 5}" y="${vTop + 9}" font-size="9" fill="#8b94a9">VOL</text>`;
  [0, Math.floor((n - 1) / 2), n - 1].forEach((i, k) => { g += `<text x="${k === 0 ? L : k === 2 ? W - R : X(i)}" y="${H - 6}" font-size="10" fill="#8b94a9" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">${tf(d[i][0])}</text>`; });
  let body = ''; const bw = Math.max(2, Math.min(12, pw / n * .66));
  d.forEach((x, i) => { const cc = x[4] >= x[1] ? '#2bb78a' : '#e16b78', h = (x[5] || 0) / vmax * VH; body += `<rect x="${X(i) - bw / 2}" y="${vTop + VH - h}" width="${bw}" height="${h}" fill="${cc}" opacity=".55"/>`; });
  if (candle) {
    d.forEach((x, i) => { const cc = x[4] >= x[1] ? '#2bb78a' : '#e16b78', yt = Y(Math.max(x[1], x[4])), yb = Y(Math.min(x[1], x[4])); body += `<line x1="${X(i)}" x2="${X(i)}" y1="${Y(x[2])}" y2="${Y(x[3])}" stroke="${cc}" stroke-width="1.2"/><rect x="${X(i) - bw / 2}" y="${yt}" width="${bw}" height="${Math.max(1, yb - yt)}" fill="${cc}"/>`; });
    MAS.forEach(m => { const pts = m.v.map((v, i) => v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean).join(' '); if (pts) body += `<polyline points="${pts}" fill="none" stroke="${m.col}" stroke-width="1.2" stroke-linejoin="round" opacity=".8"/>`; });
  } else { const pts = d.map((x, i) => `${X(i).toFixed(1)},${Y(x[4]).toFixed(1)}`).join(' '); body += `<defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><polygon points="${X(0)},${T + PH} ${pts} ${X(n - 1)},${T + PH}" fill="url(#lg)"/><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`; }
  const drawings = state.chartDrawings[key] || [];
  drawings.forEach(line => { if (line.horizontal) { body += `<line x1="${L}" y1="${Y(line.p1)}" x2="${W-R}" y2="${Y(line.p1)}" stroke="#4263eb" stroke-width="2" stroke-dasharray="5 3"/>`; return; } const ia = d.findIndex(x => x[0] === line.t1), ib = d.findIndex(x => x[0] === line.t2); if (ia >= 0 && ib >= 0) body += `<line x1="${X(ia)}" y1="${Y(line.p1)}" x2="${X(ib)}" y2="${Y(line.p2)}" stroke="#4263eb" stroke-width="2" stroke-linecap="round"/><circle cx="${X(ia)}" cy="${Y(line.p1)}" r="3" fill="#4263eb"/><circle cx="${X(ib)}" cy="${Y(line.p2)}" r="3" fill="#4263eb"/>`; });
  const ly = Y(last[4]);
  box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${state.coin} ${candle ? 'candlestick' : 'line'} chart"><rect x="${L}" y="${T}" width="${pw}" height="${PH + VG + VH}" fill="#fff"/>${g}${body}<line x1="${L}" x2="${W - R}" y1="${ly}" y2="${ly}" stroke="${col}" stroke-dasharray="3 3" opacity=".7"/><rect x="${W - R + 1}" y="${ly - 8}" width="${R - 2}" height="16" rx="4" fill="${col}"/><text x="${W - R + 5}" y="${ly + 3.5}" font-size="10" font-weight="700" fill="#fff">${pFmt(last[4])}</text><line id="xh" y1="${T}" y2="${vTop + VH}" stroke="#9aa3b5" stroke-dasharray="2 3" visibility="hidden"/><rect id="ov" x="${L}" y="${T}" width="${pw}" height="${PH + VG + VH}" fill="transparent" style="touch-action:none;cursor:${state.drawMode ? 'crosshair' : 'grab'}"/></svg>`;
  const vf = v => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(1);
  const info = i => { const x = d[i], ch = (x[4] - x[1]) / (x[1] || 1) * 100, cc = ch >= 0 ? '#159d72' : '#df5b67'; $('#chartInfo').innerHTML = `<span>${tf(x[0])}</span>` + (candle ? `<span>O <b>${pFmt(x[1])}</b></span><span>H <b>${pFmt(x[2])}</b></span><span>L <b>${pFmt(x[3])}</b></span>` : '') + `<span>C <b>${pFmt(x[4])}</b></span><span style="color:${cc}"><b>${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</b></span><span>Vol <b>${vf(x[5] || 0)}</b></span>` + (candle ? '<span class="ma-row">' + MAS.map(m => m.v[i] == null ? '' : `<span style="color:${m.col}">MA${m.p} <b style="color:${m.col}">${pFmt(m.v[i])}</b></span>`).join('') + '</span>' : ''); };
  info(n - 1); const xh = $('#xh'), ov = $('#ov'), svg = box.querySelector('svg'); if (svg) { svg.style.transformOrigin = 'center center'; svg.style.willChange = 'transform'; } let drag = null;
  const point = e => { const r = ov.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W, py = (e.clientY - r.top) / r.height * H; return { i: Math.max(0, Math.min(n - 1, Math.floor((px - L) / pw * n))), price: hi - (py - T) / PH * (hi - lo) }; };
  const activePointers = new Map(); let pinchStart = null; let gestureChanged = false;
  const finishGesture = () => {
    state.chartGestureActive = false;
    if (svg) svg.style.transform = '';
    drawChart();
    state.chartPendingRedraw = false;
  };
  ov.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { ov.setPointerCapture(e.pointerId); } catch (_) {}
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 1) gestureChanged = false;
    state.chartGestureActive = true;
    if (activePointers.size === 2) {
      drag = null;
      const pts = [...activePointers.values()];
      pinchStart = { distance: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, count: view.count, changed: false };
      return;
    }
    if (state.drawMode) {
      const q = point(e), candlePoint = d[q.i];
      if (state.drawMode === 'horizontal') {
        (state.chartDrawings[key] ||= []).push({ horizontal: true, p1: Math.max(lo, Math.min(hi, q.price)) });
        state.drawMode = false; state.drawDraft = null;
        $$('[data-draw-line],[data-draw-horizontal]').forEach(b => b.classList.remove('on'));
        $('#chartHint').textContent = 'Pinch or scroll to zoom · Drag to view older candles';
        state.chartGestureActive = false; drawChart(); return;
      }
      if (!state.drawDraft) {
        state.drawDraft = { t: candlePoint[0], p: Math.max(lo, Math.min(hi, q.price)) };
        $('#chartHint').textContent = 'Tap/click a second point to finish the trend line.';
      } else {
        (state.chartDrawings[key] ||= []).push({ t1: state.drawDraft.t, p1: state.drawDraft.p, t2: candlePoint[0], p2: Math.max(lo, Math.min(hi, q.price)) });
        state.drawDraft = null; state.drawMode = false;
        $$('[data-draw-line],[data-draw-horizontal]').forEach(b => b.classList.remove('on'));
        $('#chartHint').textContent = 'Pinch or scroll to zoom · Drag to view older candles';
        state.chartGestureActive = false; drawChart();
      }
      return;
    }
    drag = { x: e.clientX, offset: view.offset, moved: false };
    ov.style.cursor = 'grabbing';
  });
  ov.addEventListener('pointermove', e => {
    if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size >= 2 && pinchStart) {
      e.preventDefault();
      const pts = [...activePointers.values()], dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      view.count = Math.max(12, Math.min(total, Math.round(pinchStart.count * pinchStart.distance / dist)));
      view.offset = Math.max(0, Math.min(total - view.count, view.offset));
      pinchStart.changed = true; gestureChanged = true;
      return;
    }
    if (drag && !state.drawMode) {
      e.preventDefault();
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 2) { drag.moved = true; gestureChanged = true; }
      if (drag.moved) {
        // Commit the logical candle offset while dragging; SVG transform is only a smooth visual preview.
        view.offset = Math.max(0, Math.min(total - view.count, drag.offset + Math.round(dx / Math.max(1, pw) * view.count * -1)));
        if (svg) svg.style.transform = `translate3d(${dx}px,0,0)`;
      }
      return;
    }
    const q = point(e);
    xh.setAttribute('x1', X(q.i)); xh.setAttribute('x2', X(q.i)); xh.setAttribute('visibility', 'visible'); info(q.i);
  });
  const endPointer = e => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    const wasPinching = !!pinchStart;
    const pinchChanged = !!(pinchStart && pinchStart.changed);
    if (activePointers.size < 2) pinchStart = null;
    const moved = !!(drag && drag.moved);
    drag = null;
    if (activePointers.size === 0) {
      if (moved || gestureChanged || (wasPinching && pinchChanged) || state.chartPendingRedraw) finishGesture();
      else { state.chartGestureActive = false; if (svg) svg.style.transform = ''; if (ov.isConnected) ov.style.cursor = state.drawMode ? 'crosshair' : 'grab'; }
      gestureChanged = false;
    }
  };
  ov.addEventListener('pointerup', endPointer);
  ov.addEventListener('pointercancel', endPointer);
  ov.addEventListener('lostpointercapture', endPointer);
  ov.addEventListener('pointerleave', () => { if (!drag) { xh.setAttribute('visibility', 'hidden'); info(n - 1); } });
  ov.addEventListener('wheel', e => { e.preventDefault(); view.count = Math.max(12, Math.min(total, view.count + (e.deltaY < 0 ? -Math.max(3, Math.round(view.count * .18)) : Math.max(3, Math.round(view.count * .18))))); view.offset = Math.min(view.offset, total - view.count); drawChart(); }, { passive: false });
}
function bindChart() {
  $$('[data-ct]').forEach(b => b.onclick = () => { state.chartType = b.dataset.ct; $$('[data-ct]').forEach(x => x.classList.toggle('on', x === b)); drawChart(); });
  $$('[data-iv]').forEach(b => b.onclick = () => { state.interval = b.dataset.iv; $$('[data-iv]').forEach(x => x.classList.toggle('on', x === b)); loadChart(true); });
  $$('[data-zoom]').forEach(b => b.onclick = () => { const key = state.coin + ':' + state.interval, c = state.kl[key]; if (!c) return; const v = state.chartView[key] || (state.chartView[key] = { count: 42, offset: 0 }); v.count = Math.max(12, Math.min(c.candles.length, v.count + (b.dataset.zoom === 'in' ? -8 : 8))); v.offset = Math.min(v.offset, c.candles.length - v.count); drawChart(); });
  $$('[data-chart-home]').forEach(b => b.onclick = () => { const v = state.chartView[state.coin + ':' + state.interval]; if (v) v.offset = 0; drawChart(); });
  $$('[data-draw-line]').forEach(b => b.onclick = () => { state.drawMode = state.drawMode === 'trend' ? false : 'trend'; state.drawDraft = null; $$('[data-draw-line]').forEach(x => x.classList.toggle('on', state.drawMode === 'trend')); $$('[data-draw-horizontal]').forEach(x => x.classList.remove('on')); $('#chartHint').textContent = state.drawMode ? 'Tap/click two points to draw a trend line.' : 'Pinch or scroll to zoom · Drag to view older candles'; drawChart(); });
  $$('[data-draw-horizontal]').forEach(b => b.onclick = () => { state.drawMode = state.drawMode === 'horizontal' ? false : 'horizontal'; state.drawDraft = null; $$('[data-draw-horizontal]').forEach(x=>x.classList.toggle('on',state.drawMode==='horizontal')); $$('[data-draw-line]').forEach(x=>x.classList.remove('on')); $('#chartHint').textContent = state.drawMode ? 'Tap/click the chart to add a horizontal price line.' : 'Pinch or scroll to zoom · Drag to view older candles'; drawChart(); });
  $$('[data-clear-lines]').forEach(b => b.onclick = () => { state.chartDrawings[state.coin + ':' + state.interval] = []; state.drawDraft = null; state.drawMode = false; $$('[data-draw-line],[data-draw-horizontal]').forEach(x => x.classList.remove('on')); drawChart(); });
  loadChart(true);
}
window.addEventListener('resize', () => { if (state.page === 'Coin') drawChart(); });

function coinBody() {
  const a = state.prices.find(x => x.symbol === state.coin); if (!a) return '';
  const hold = (state.me && state.me.holdings && state.me.holdings[a.symbol]) || 0, unit = state.fx ? a.price * state.fx : 0, c = state.cfg;
  const buy = state.side === 'buy';
  return `<article class="balance-card"><span>${esc(a.name)} · ${esc(a.symbol)}</span><strong id="coinPrice">${unit ? inr(unit) : usd(a.price)}</strong><small id="coinSub">${usd(a.price)} · <span class="${a.change < 0 ? 'negative' : 'positive'}" style="color:inherit">${changeLabel(a.change)} (24h)</span></small>${state.me ? `<div class="stat-grid"><div><small>You hold</small><b>${qtyFmt(hold)} ${esc(a.symbol)}</b></div><div><small>Value</small><b>${unit ? inr(hold * unit) : '—'}</b></div></div>` : ''}</article>
  <article class="content-card chart-card"><div class="chart-bar"><div class="seg">${[['candle', 'Candles'], ['line', 'Line']].map(([k, l]) => `<button type="button" data-ct="${k}" class="${state.chartType === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="seg">${[['1m', '1m'], ['3m', '3m'], ['5m', '5m'], ['15m', '15m'], ['1h', '1H'], ['1d', '1D']].map(([k, l]) => `<button type="button" data-iv="${k}" class="${state.interval === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="chart-tools"><button type="button" data-zoom="in" aria-label="Zoom in">＋</button><button type="button" data-zoom="out" aria-label="Zoom out">−</button><button type="button" data-chart-home>Latest</button><button type="button" data-draw-line class="draw-tool">↗ Trend line</button><button type="button" data-draw-horizontal>— Price line</button><button type="button" data-clear-lines>Clear lines</button></div></div><div class="chart-hint" id="chartHint">Pinch or scroll to zoom · Drag to view older candles</div><div class="chart-info" id="chartInfo"></div><div class="chart-box" id="chartBox"></div></article>
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
      await loadMe(); const t = j.trade; showModal(t.side === 'buy' ? 'Bought' : 'Sold', `${qtyFmt(t.qty)} ${t.symbol} at ${inr(t.price)} = ${inr(t.amount)}` + (t.profit != null ? (t.profit >= 0 ? ` · Profit ${inr(t.profit)}` : ` · Loss ${inr(-t.profit)}`) : '')); renderPage('Coin', true);
    } catch (x) { $('#tErr').textContent = x.message; btn.disabled = false; }
  };
}

async function renderPage(page, quiet) {
  if (PROTECTED.has(page) && !state.me) return needLogin(page);
  state.page = page;
  const route = page === 'Coin' && state.coin ? `#Coin:${encodeURIComponent(state.coin)}` : `#${encodeURIComponent(page)}`;
  if (location.hash !== route) history.replaceState(null, '', route);
  $$('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const main = $('#appMain'), c = state.cfg;
  if (page === 'Home') renderHome();
  else if (page === 'Coin') {
    main.innerHTML = `<section class="page-intro"><button class="link-btn" data-page="Quotes">← Back to quotes</button></section><div id="coinWrap">${bonusCoins().some(b => b.enabled && state.coin === b.symbol) ? bonusBody() : coinBody() || '<div class="empty-state">Price not loaded yet.</div>'}</div>`;
    if (bonusCoins().some(b => b.enabled && state.coin === b.symbol)) { bindBonus(); if ($('#chartBox')) bindChart(); } else { bindCoin(); if ($('#chartBox')) bindChart(); }
  }
  else if (page === 'Auth') { if (state.me) return renderPage('Profile'); authPage(); }
  else if (page === 'Profile') {
    const u = state.me; if (!u) return needLogin('Profile');
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">ACCOUNT</span><h1>${esc(u.name)}</h1><p>${esc(u.email)}</p><p class="fine-print">Account UID: <code>${esc(u.uid || u.id)}</code></p></section>
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
    main.innerHTML = `${noticeBar()}<section class="page-intro"><span class="eyebrow">WALLET</span><h1>Assets</h1><p>Your wallet balance in Indian rupees.</p><p class="fine-print">Account UID: <code>${esc(state.me.uid || state.me.id)}</code></p></section><article class="balance-card"><span>Available balance</span><strong>${inr(state.me.balance)}</strong><small>Min deposit ${inr(c.minDeposit)} · Min withdrawal ${inr(c.minWithdraw)}</small><div class="balance-actions"><button data-page="Recharge">Recharge</button><button data-page="Withdrawal">Withdrawal</button><button data-page="Quotes">Buy / Sell</button></div><div class="balance-actions"><button data-page="Profile">Change password</button><button id="logoutBtn" type="button">Logout</button></div>${['admin','headAdmin','panelAdmin'].includes(state.me.role) ? `<div class="balance-actions"><a class="primary-btn" style="display:block;text-align:center;text-decoration:none;flex:1" href="${state.me.role === 'panelAdmin' ? '/p/' + esc(String(state.me.panelId || activePanelSlug())) + '/admin' : '/admin'}">Open Admin Panel ↗</a></div>` : ''}</article><section class="section-head"><div><span class="eyebrow">YOUR COINS</span><h2>Holdings</h2></div></section>${holdingsList()}<section class="section-head"><div><span class="eyebrow">YOUR RECORDS</span><h2>Recent activity</h2></div></section>${txList()}`;
    $('#logoutBtn').onclick = doLogout;
  } else if (page === 'Team' || page === 'Invite') {
    const code = state.me.refCode, invitePanel = String(state.me.role === 'panelAdmin' ? (state.me.panelId || activePanelSlug()) : activePanelSlug()).toLowerCase(), inviteBase = invitePanel && invitePanel !== 'main' ? '/p/' + encodeURIComponent(invitePanel) + '/' : '/', link = location.origin + inviteBase + '?ref=' + encodeURIComponent(code);
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">INVITE</span><h1>${page}</h1><p>Share your invite code with friends.</p></section><article class="balance-card team-card"><span>People who joined with your code</span><strong>${state.referrals}</strong>${state.cfg.tradeRef && state.cfg.tradeRef.enabled && state.cfg.tradeRef.pct ? `<div class="stat-grid"><div><small>Your commission</small><b>${state.cfg.tradeRef.pct}% of the profit your friends make on their market trades</b></div><div><small>Total earned</small><b>${inr(state.me.refEarned)}</b></div></div>` : ''}${bonusCfg().enabled && bonusCfg().refPct ? `<div class="stat-grid"><div><small>Your commission</small><b>${bonusCfg().refPct}% of ${bonusCfg().refBase === 'amount' ? 'their ' + esc(bonusCfg().symbol) + ' trade amount' : 'their ' + esc(bonusCfg().symbol) + ' trade return'}</b></div><div><small>Total earned</small><b>${inr(state.me.refEarned)}</b></div></div>` : `<div class="stat-grid"><div><small>Total earned</small><b>${inr(state.me.refEarned)}</b></div></div>`}</article><article class="content-card"><h2>Your invite code</h2><div class="copy-row"><code>${esc(code)}</code><button class="primary-btn compact" id="copyCode" type="button">Copy link</button></div></article>`;
    $('#copyCode').onclick = async () => { try { await navigator.clipboard.writeText(link); showToast('Invite link copied.'); } catch { showToast('Your invite code: ' + code); } };
  } else if (page === 'Games') {
    if (!state.me) return needLogin('Games');
    let gameData = null;
    try { gameData = await api('games/flip-coin'); } catch (e) { showToast(e.message); }
    const fc = (gameData && gameData.config) || { enabled:true, minBet:10, maxBet:10000, multiplier:2, feePct:0 };
    const history = (gameData && gameData.history) || [];
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">PLAY ZONE</span><h1>Games</h1><p>Games are separate from Assets and crypto trading.</p></section><article class="content-card" style="max-width:560px;margin:0 auto"><div style="text-align:center"><div id="flipCoinVisual" class="flip-coin-visual" aria-label="Coin"><span class="coin-face">COIN</span></div><h2 style="margin:6px 0">Flip Coin</h2><p>Available Wallet: <b id="gameBalance">${inr(state.me.balance)}</b></p><div id="flipOutcome" class="flip-outcome" aria-live="polite">Win 2× your bet</div></div><form id="flipForm" class="demo-form"><label for="flipBet">Bet Amount (₹)</label><input id="flipBet" type="number" min="${fc.minBet}" max="${fc.maxBet}" step="0.01" required value="${esc(localStorage.getItem('cryptoBridgeFlipBetAmount') || String(fc.minBet))}"><div class="balance-actions"><button type="button" class="primary-btn" data-side="heads" aria-pressed="false" style="flex:1">🟡 HEADS<br><small>Tap to Bet</small></button><button type="button" class="primary-btn" data-side="tails" aria-pressed="false" style="flex:1">🔵 TAILS<br><small>Tap to Bet</small></button></div><input type="hidden" id="flipSide" value="heads"><p id="flipErr" class="msg-err" role="alert"></p><button class="primary-btn" id="flipPlay" type="submit" style="display:none" aria-hidden="true" tabindex="-1">Flip coin</button></form></article><section class="section-head"><div><span class="eyebrow">RECENT ACTIVITY</span><h2>My game history</h2></div></section><div class="content-card" id="flipHistory"><div id="flipHistoryRows"></div><div class="flip-history-pages" id="flipHistoryPages" style="display:none"><button type="button" id="flipHistoryPrev" class="secondary-btn">← Newer 10</button><span id="flipHistoryPageLabel">1 / 1</span><button type="button" id="flipHistoryNext" class="secondary-btn">Older 10 →</button></div></div>`;
    let flipHistoryPage = 0;
    const renderFlipHistory = () => {
      const rows = $('#flipHistoryRows'), pages = $('#flipHistoryPages');
      if (!rows || !pages) return;
      const pageSize = 10, totalPages = Math.max(1, Math.ceil(history.length / pageSize));
      flipHistoryPage = Math.max(0, Math.min(flipHistoryPage, totalPages - 1));
      const visible = history.slice(flipHistoryPage * pageSize, (flipHistoryPage + 1) * pageSize);
      rows.innerHTML = visible.length ? `<div class="tbl"><table><tr><th>Round</th><th>Time</th><th>Bet</th><th>Pick</th><th>Result</th><th>Net</th></tr>${visible.map((x,i)=>`<tr><td>#${history.length - (flipHistoryPage * pageSize + i)}</td><td>${dt(x.ts)}</td><td>${inr(x.amount)}</td><td>${esc(x.side)}</td><td>${esc(x.result)} · ${x.won?'Won':'Lost'}</td><td style="color:${Number(x.net)>=0?'#16805a':'#c0392b'}">${Number(x.net)>0?'+':''}${inr(x.net)}</td></tr>`).join('')}</table></div>` : 'No game history yet.';
      pages.style.display = history.length > pageSize ? 'flex' : 'none';
      $('#flipHistoryPageLabel').textContent = `${flipHistoryPage + 1} / ${totalPages}`;
      $('#flipHistoryPrev').disabled = flipHistoryPage === 0;
      $('#flipHistoryNext').disabled = flipHistoryPage >= totalPages - 1;
    };
    renderFlipHistory();
    $('#flipHistoryPrev').onclick = () => { if (flipHistoryPage > 0) { flipHistoryPage--; renderFlipHistory(); } };
    $('#flipHistoryNext').onclick = () => { if ((flipHistoryPage + 1) * 10 < history.length) { flipHistoryPage++; renderFlipHistory(); } };
    const form = $('#flipForm'); if (form) {
      const soundKey = 'cryptoBridgeFlipSound';
      let soundOn = localStorage.getItem(soundKey) !== 'off';
      const soundBtn = $('#flipSoundToggle');
      const updateSoundButton = () => { if (soundBtn) { soundBtn.textContent = soundOn ? '🔊 Sound: ON' : '🔇 Sound: OFF'; soundBtn.setAttribute('aria-pressed', String(soundOn)); } };
      const playFlipSound = () => { if (!soundOn) return; try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; const ctx = new AC(); const start = ctx.currentTime; const master = ctx.createGain(); master.gain.value = 0.16; master.connect(ctx.destination); for (let i=0;i<7;i++) { const osc=ctx.createOscillator(), gain=ctx.createGain(), t=start+i*0.075; osc.type='triangle'; osc.frequency.setValueAtTime(1500-i*115,t); osc.frequency.exponentialRampToValueAtTime(Math.max(420,700-i*35),t+0.065); gain.gain.setValueAtTime(0.0001,t); gain.gain.exponentialRampToValueAtTime(0.22,t+0.008); gain.gain.exponentialRampToValueAtTime(0.0001,t+0.07); osc.connect(gain); gain.connect(master); osc.start(t); osc.stop(t+0.075); } const ping=ctx.createOscillator(), pg=ctx.createGain(); ping.type='sine'; ping.frequency.setValueAtTime(1100,start+0.55); ping.frequency.exponentialRampToValueAtTime(650,start+0.82); pg.gain.setValueAtTime(0.0001,start+0.55); pg.gain.exponentialRampToValueAtTime(0.3,start+0.57); pg.gain.exponentialRampToValueAtTime(0.0001,start+0.85); ping.connect(pg); pg.connect(master); ping.start(start+0.55); ping.stop(start+0.86); ping.onended=()=>setTimeout(()=>ctx.close(),100); } catch {} };
      updateSoundButton();
      if (soundBtn) soundBtn.onclick = () => { soundOn = !soundOn; localStorage.setItem(soundKey, soundOn ? 'on' : 'off'); updateSoundButton(); };
      const betInput = $('#flipBet');
      if (betInput) betInput.addEventListener('input', () => localStorage.setItem('cryptoBridgeFlipBetAmount', betInput.value));
      $$('#flipForm [data-side]').forEach(btn => btn.onclick = () => {
        $('#flipSide').value = btn.dataset.side;
        $$('#flipForm [data-side]').forEach(x=>{x.classList.toggle('primary-btn', x===btn);x.setAttribute('aria-pressed',String(x===btn));});
        if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', {cancelable:true}));
      });
      form.onsubmit = async e => { e.preventDefault(); const btn=$('#flipPlay'); if (btn.disabled) return; btn.disabled=true; $('#flipErr').textContent=''; const coin=$('#flipCoinVisual'), outcome=$('#flipOutcome'); coin.classList.remove('flip-spin','flip-win','flip-loss'); void coin.offsetWidth; coin.classList.add('flip-spin'); outcome.className='flip-outcome'; outcome.textContent='Flipping…'; try { const r=await api('games/flip-coin',{amount:Number($('#flipBet').value),side:$('#flipSide').value}); await new Promise(resolve=>setTimeout(resolve,850)); coin.classList.remove('flip-spin'); coin.classList.add(r.bet.won?'flip-win':'flip-loss'); coin.innerHTML=`<span class="coin-face">${r.bet.result.toUpperCase()}</span>`; outcome.className='flip-outcome '+(r.bet.won?'is-win':'is-loss'); outcome.innerHTML=`<strong>${r.bet.won?'🎉 YOU WON':'💔 YOU LOST'}</strong><span>${r.bet.result.toUpperCase()} · Net ${r.bet.net>=0?'+':''}${inr(r.bet.net)}</span>`; playFlipSound(); await loadMe(); $('#gameBalance').textContent=inr(r.balance); try { const fresh=await api('games/flip-coin'); history.splice(0, history.length, ...(fresh.history || [])); flipHistoryPage=0; renderFlipHistory(); } catch {} btn.disabled=false; btn.textContent=Number(r.balance)<Number($('#flipBet').value)+Number(fc.feePct||0)*Number($('#flipBet').value)/100?'Insufficient balance':'Flip coin'; if(btn.textContent==='Insufficient balance') btn.disabled=true; } catch(x) { coin.classList.remove('flip-spin'); coin.innerHTML='<span class="coin-face">COIN</span>'; outcome.textContent=''; $('#flipErr').textContent=x.message; btn.disabled=false; } };
    }
  } else if (page === 'Bonus') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">OFFERS</span><h1>Bonus</h1><p>Announcements from Crypto Bridge.</p></section>${c.bonus ? `<article class="content-card"><p style="white-space:pre-wrap">${esc(c.bonus)}</p></article>` : '<div class="empty-state">No active offers right now.</div>'}`;
  } else if (page === 'Recharge') {
    const razor = c.paymentMode === 'razorpay';
    const pay = razor ? !!c.razorpayEnabled : !!(c.upi || c.qr);
    const pendingDep = state.deposits.filter(d => d.status === 'Pending' && d.provider !== 'razorpay').sort((a,b) => b.ts-a.ts)[0];
    const countdownCard = pendingDep && !razor ? `<article class="content-card"><h2>Deposit review timer</h2><p>Your QR deposit request is pending admin verification.</p><strong class="deposit-countdown" data-deposit-countdown="${Number(pendingDep.ts) + 30 * 60 * 1000}">30:00</strong><p class="fine-print">This is a review timer, not payment confirmation. Your balance is credited only after an admin verifies the payment.</p></article>` : '';
    main.innerHTML = `${noticeBar()}<section class="page-intro"><span class="eyebrow">WALLET</span><h1>Recharge</h1><p>Minimum deposit ${inr(c.minDeposit)}. ${razor ? 'Pay securely using Razorpay. Captured payments are verified by the server.' : 'Pay by UPI QR and submit your UTR for admin verification.'}</p></section>${countdownCard}
    ${razor ? (pay ? `<article class="content-card"><h2>Razorpay Checkout</h2><p>Your payment is verified automatically after Razorpay confirms capture. Do not close the page until Checkout reports the result.</p><p class="fine-print">Deposits are credited only after server-side payment verification.</p></article>` : `<article class="content-card warning-card"><span class="warning-icon">ⓘ</span><div><h2>Razorpay is not configured</h2><p>The administrator must configure Razorpay credentials in Render Environment.</p></div></article>`) : (pay ? `<article class="content-card"><h2>Pay to</h2>${c.qr ? `<img class="qr-img" alt="Payment QR" src="${esc(c.qr)}">` : ''}${c.upi ? `<div class="copy-row"><code>${esc(c.upi)}</code><button class="primary-btn compact" id="copyUpi" type="button">Copy</button></div>` : ''}${c.payee ? `<p class="fine-print">Payee: ${esc(c.payee)}</p>` : ''}</article>` : '<article class="content-card warning-card"><span class="warning-icon">ⓘ</span><div><h2>Deposits not open</h2><p>Payment details have not been set up yet. Please contact support.</p></div></article>')}
    <form id="depForm" class="demo-form"><label for="dAmt">${razor ? 'Deposit amount (₹)' : 'Amount paid (₹)'}</label><input id="dAmt" type="number" inputmode="numeric" min="${c.minDeposit}" step="1" required placeholder="${c.minDeposit}">${razor ? '' : '<label for="dUtr">UTR / transaction reference</label><input id="dUtr" required maxlength="30" autocomplete="off" placeholder="12-digit UTR">'}<p class="msg-err" id="depErr" role="alert"></p><button class="primary-btn" type="submit" ${pay ? '' : 'disabled'}>${razor ? 'Pay securely with Razorpay' : 'Submit for verification'}</button><button class="secondary-btn" type="button" data-page="Assets">Back to assets</button></form>`;
    const cu = $('#copyUpi'); if (cu) cu.onclick = async () => { try { await navigator.clipboard.writeText(c.upi); showToast('UPI ID copied.'); } catch { showToast(c.upi); } };
    $('#depForm').onsubmit = async e => {
      e.preventDefault(); $('#depErr').textContent = ''; const btn = e.submitter; btn.disabled = true;
      try {
        const amount = Number($('#dAmt').value);
        if (razor) {
          const order = await api('razorpay/order', { amount });
          if (!window.Razorpay) await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.onload = resolve; script.onerror = () => reject(new Error('Could not load Razorpay Checkout. Please retry.')); document.head.appendChild(script); });
          const verification = await new Promise((resolve, reject) => {
            let finished = false;
            const checkout = new window.Razorpay({ key: order.keyId, amount: order.amount, currency: order.currency, name: order.name, description: order.description, order_id: order.orderId, handler: async response => { try { const result = await api('razorpay/verify', response); finished = true; resolve(result); } catch (err) { reject(err); } }, modal: { ondismiss: () => { if (!finished) reject(new Error('Checkout closed. If you paid, your deposit will update after Razorpay webhook verification.')); } }, theme: { color: '#245ce8' } });
            checkout.on('payment.failed', response => reject(new Error(response.error && response.error.description || 'Payment failed. Please retry.'))); checkout.open();
          });
          await loadMe();
          if (verification && verification.waitingForCredits) showModal('Payment verified · credit pending', 'Your payment was verified. The panel is waiting for Head Admin to allocate enough credits before your wallet can be credited. Your payment request is saved.');
          else showModal('Payment verified', 'Razorpay confirmed your payment and your wallet deposit was credited.');
          renderPage('Assets');
        } else {
          await api('deposit', { amount, utr: $('#dUtr').value }); await loadMe(); showDepositCountdown(); renderPage('Assets');
        }
      } catch (x) { $('#depErr').textContent = x.message; btn.disabled = false; }
    };
  } else if (page === 'Withdrawal') {
    main.innerHTML = `${noticeBar()}<section class="page-intro"><span class="eyebrow">WALLET</span><h1>Withdrawal</h1><p>Minimum withdrawal ${inr(c.minWithdraw)}. Available: <b>${inr(state.me.balance)}</b>. ${state.me.mode === 'demo' ? 'Demo withdrawals are simulated and do not send real money.' : ''} ${c.withdrawalMode === 'profit' ? 'Profit-only policy is enabled: only recorded realized profits can be requested. Contact support to request principal release.' : 'Full-balance withdrawals are enabled, subject to admin review.'} The amount is held while your request is pending. ${state.withdrawals.some(w => w.status === 'Rejected' && Number(w.retryAt || 0) > Date.now()) ? `Retry available after ${new Date(Math.max(...state.withdrawals.filter(w => w.status === 'Rejected' && Number(w.retryAt || 0) > Date.now()).map(w => w.retryAt))).toLocaleString()}.` : ''}</p></section>
    <form id="wdForm" class="demo-form"><label for="wAmt">Amount (₹)</label><input id="wAmt" type="number" inputmode="numeric" min="${c.minWithdraw}" max="${state.me.balance}" step="1" required placeholder="${c.minWithdraw}"><div class="content-card" style="margin:12px 0"><p>Withdrawal amount: <b id="wdGross">—</b></p><p>${esc(c.withdrawalFeeLabel || 'Platform Fee')}: <b id="wdFee">—</b></p><p>Estimated payout: <b id="wdNet">—</b></p><small class="fine-print">Fee settings are set by the administrator. The full requested amount is held; if rejected, the gross amount is refunded.</small></div><label for="wUpi">${state.me.mode === 'demo' ? 'Demo payout reference / UPI ID' : 'Your UPI ID'}</label><input id="wUpi" required maxlength="60" autocomplete="off" placeholder="name@bank"><p class="msg-err" id="wdErr" role="alert"></p><button class="primary-btn" type="submit">Request withdrawal</button><button class="secondary-btn" type="button" data-page="Assets">Back to assets</button></form>`;
    const updateWdPreview = () => { const gross = Math.max(0, Number($('#wAmt').value) || 0); const val = Math.max(0, Number(c.withdrawalFeeValue || 0)); const fee = Math.min(gross, c.withdrawalFeeType === 'fixed' ? val : Math.round(gross * val) / 100); $('#wdGross').textContent = inr(gross); $('#wdFee').textContent = inr(fee); $('#wdNet').textContent = inr(Math.max(0, gross - fee)); }; $('#wAmt').addEventListener('input', updateWdPreview); updateWdPreview();
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
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">QUICK START</span><h1>Guide</h1><p>Get going in three steps.</p></section><div class="faq-list"><details open><summary>1. Register or login</summary><p>Create an account with your email and a password of at least 8 characters.</p></details><details open><summary>2. Recharge</summary><p>Minimum ${inr(c.minDeposit)}. ${(c.paymentMode === 'razorpay' && c.razorpayEnabled) ? 'Pay securely using Razorpay Checkout. Your wallet is credited after server-side payment verification.' : 'Pay via the displayed UPI QR/ID, submit the UTR, and wait for admin verification.'}</p></details><details open><summary>3. Withdraw</summary><p>Minimum ${inr(c.minWithdraw)}. Requests are reviewed and paid to your UPI ID. The configured ${esc(c.withdrawalFeeLabel || 'Platform Fee')} is deducted from the gross request; the net payout is shown before submission.</p></details></div>`;
  }
  if (!quiet) window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function doLogout() { try { await api('logout', {}); } catch {} state.me = null; state.deposits = state.withdrawals = state.trades = state.positions = []; await loadMe(); showToast('Logged out.'); renderPage('Home'); }
function showModal(title, text) { $('#modalTitle').textContent = title; $('#modalBody').innerHTML = ''; const p = document.createElement('p'); p.textContent = text; $('#modalBody').appendChild(p); $('#modal').hidden = false; $('#okModal').focus(); }
function showDepositCountdown() {
  $('#modalTitle').textContent = 'Deposit submitted';
  $('#modalBody').innerHTML = '<p>Your deposit request has been received.</p><p class="fine-print">Estimated review timer</p><strong class="deposit-countdown" id="depositModalCountdown">30:00</strong><p class="fine-print">This timer does not confirm payment or guarantee automatic credit. Your balance will be credited only after an admin verifies the payment.</p>';
  $('#modal').hidden = false; $('#okModal').focus(); updateDepositCountdowns();
}
function updateDepositCountdowns() {
  const nodes = document.querySelectorAll('[data-deposit-countdown], #depositModalCountdown');
  nodes.forEach(node => {
    let end = Number(node.dataset.depositCountdown);
    if (!end) { const pending = state.deposits.filter(d => d.status === 'Pending').sort((a,b) => b.ts-a.ts)[0]; end = pending ? Number(pending.ts) + 30 * 60 * 1000 : Date.now() + 30 * 60 * 1000; node.dataset.depositCountdown = String(end); }
    const left = Math.max(0, end - Date.now()); const mins = Math.floor(left / 60000); const secs = Math.floor((left % 60000) / 1000);
    node.textContent = left > 0 ? `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}` : 'Review time elapsed';
  });
}
setInterval(updateDepositCountdowns, 1000);
// Refresh the open chart so admin-simulated coins visibly update while the page is open.
setInterval(() => { if (state.page === 'Coin') { const key = state.coin + ':' + state.interval; if (state.kl[key]) state.kl[key].ts = 0; loadChart(false); } }, 5000);
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
  const route = decodeURIComponent(location.hash.slice(1) || 'Home');
  let initialPage = route.split(':')[0];
  if (route.startsWith('Coin:')) state.coin = route.slice(5);
  const allowedPages = new Set(['Home','Quotes','Signal','Assets','Recharge','Withdrawal','Team','Invite','Bonus','Games','Service','Guide','Coin','Auth','Profile']);
  if (!allowedPages.has(initialPage)) initialPage = 'Home';
  if (ref && !state.me) initialPage = 'Auth';
  renderPage(initialPage);
  if (ref && !state.me) { state.authMode = 'register'; authPage(); }
  window.addEventListener('hashchange', async () => {
    const next = decodeURIComponent(location.hash.slice(1) || 'Home');
    const page = next.split(':')[0];
    if (next.startsWith('Coin:')) state.coin = next.slice(5);
    if (allowedPages.has(page) && page !== state.page) { await loadMe(); renderPage(page); }
  });
  pullPrices(); setInterval(pullPrices, 20000);
  // Refresh a signed-in user's wallet when an admin changes their balance in another session.
  const syncWallet = async () => {
    if (!state.me) return;
    const previous = Number(state.me.balance || 0);
    await loadMe();
    if (state.me && Number(state.me.balance || 0) !== previous && state.page === 'Assets') renderPage('Assets', true);
  };
  window.addEventListener('focus', syncWallet);
  setInterval(syncWallet, 15000);
})();
