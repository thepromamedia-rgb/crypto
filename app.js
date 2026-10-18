'use strict';

const assets = [
  {symbol:'BTC', name:'Bitcoin', mark:'₿', price:'67,421.80', change:2.34},
  {symbol:'ETH', name:'Ethereum', mark:'Ξ', price:'3,521.40', change:1.82},
  {symbol:'ETC', name:'Ethereum Classic', mark:'E', price:'26.18', change:-0.46},
  {symbol:'TRX', name:'TRON', mark:'T', price:'0.1182', change:0.91},
  {symbol:'DOGE', name:'Dogecoin', mark:'Ð', price:'0.1648', change:3.22},
  {symbol:'BCH', name:'Bitcoin Cash', mark:'B', price:'412.65', change:-0.73},
  {symbol:'COMP', name:'Compound', mark:'C', price:'58.20', change:0.67},
  {symbol:'DASH', name:'Dash', mark:'D', price:'31.44', change:1.16},
  {symbol:'ADA', name:'Cardano', mark:'A', price:'0.4521', change:2.08},
  {symbol:'LINK', name:'Chainlink', mark:'L', price:'17.82', change:1.43},
  {symbol:'LTC', name:'Litecoin', mark:'Ł', price:'84.10', change:-0.28},
  {symbol:'BNB', name:'BNB', mark:'B', price:'592.30', change:0.87},
  {symbol:'XRP', name:'XRP', mark:'X', price:'0.5320', change:1.71},
  {symbol:'SOL', name:'Solana', mark:'S', price:'153.70', change:4.06}
];
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const state = {page:'Home', query:'', language:'EN'};
const colors = ['#fff0d8','#edf0ff','#e4f8ee','#e9f7ff','#fff0f4'];

function coinIcon(asset, index) {
  const tone = asset.symbol === 'ETH' || asset.symbol === 'ADA' ? 'eth' : (asset.symbol === 'ETC' || asset.symbol === 'TRX' ? 'etc' : '');
  return `<span class="coin ${tone}" style="--coin-bg:${colors[index % colors.length]}" aria-hidden="true">${asset.mark}</span>`;
}
function sparkline(index) {
  const points = Array.from({length:8}, (_,x) => `${x*14},${18 + Math.sin((x+index)*1.2)*8 + (x%3)*2}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 100 38" preserveAspectRatio="none" aria-label="Illustrative trend line"><polyline points="${points}" fill="none" stroke="${index%4===2?'#e16b78':'#2bb78a'}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function changeLabel(value) { return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`; }
function assetRow(asset, index) {
  return `<div class="asset-row"><div class="asset-name">${coinIcon(asset,index)}<div><strong>${asset.symbol}</strong><small>${asset.name}</small></div></div><div class="asset-price">$${asset.price}</div><div class="asset-change ${asset.change < 0 ? 'negative' : 'positive'}">${changeLabel(asset.change)}</div></div>`;
}
function renderHome() {
  $('#appMain').innerHTML = `
    <div class="notice-banner"><span>ⓘ</span><p><strong>Prototype only.</strong> Market values are samples. No real accounts, wallets, deposits, withdrawals or trading are connected.</p></div>
    <section class="welcome"><div><span class="eyebrow">YOUR MARKET AT A GLANCE</span><h1>Explore digital markets</h1><p>Track sample prices and explore the dashboard experience.</p><button class="welcome-cta" data-page="Quotes">Explore markets <span>↗</span></button></div><div class="coin-art" aria-hidden="true">₿</div><div class="hero-orb orb-one"></div><div class="hero-orb orb-two"></div></section>
    <section class="actions" aria-label="Quick actions"><button data-page="Recharge"><span class="action-icon blue">↗</span><span>Recharge</span></button><button data-page="Withdrawal"><span class="action-icon violet">↙</span><span>Withdrawal</span></button><button data-page="Signal"><span class="action-icon mint">⌁</span><span>Signal</span></button><button data-page="Service"><span class="action-icon amber">☏</span><span>Service</span></button><button data-page="Invite"><span class="action-icon pink">♧</span><span>Invite</span></button></section>
    <section class="promo-grid"><article class="promo"><div><span class="eyebrow">GET STARTED</span><h2>BNV Guide</h2><p>Learn how this demo dashboard is organized.</p><button class="light-btn" data-page="Guide">View guide ↗</button></div><div class="promo-icon">✦</div></article><article class="promo orange"><div><span class="eyebrow">REWARDS</span><h2>Reward center</h2><p>Preview example tasks and reward cards.</p><button class="light-btn" data-page="Bonus">Explore rewards ↗</button></div><div class="promo-icon">🎁</div></article></section>
    <section class="section-head"><div><span class="eyebrow">MARKET OVERVIEW</span><h2>Trending markets</h2></div><button class="text-btn" data-page="Quotes">See all ↗</button></section>
    <section class="market-cards" id="marketCards" aria-label="Featured sample markets">${assets.slice(0,3).map((a,i)=>`<article class="market-card"><div class="asset-top">${coinIcon(a,i)}<div><strong>${a.name}</strong><small>${a.symbol} / USDT</small></div></div><div class="price">$${a.price}</div><span class="${a.change<0?'negative':'positive'}">${changeLabel(a.change)} today</span>${sparkline(i)}</article>`).join('')}</section>
    <section class="section-head list-head"><div><span class="eyebrow">SAMPLE VALUES · NOT LIVE</span><h2>Trending assets</h2></div><span class="demo-pill">DEMO DATA</span></section><section class="asset-list" id="assetList" aria-label="Sample asset prices">${assets.map(assetRow).join('')}</section>`;
}
function renderPage(page) {
  state.page = page;
  $$('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  const main = $('#appMain');
  if (page === 'Home') { renderHome(); window.scrollTo({top:0,behavior:'smooth'}); return; }
  if (page === 'Quotes') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">MARKET EXPLORER</span><h1>Quotes</h1><p>Illustrative crypto prices for interface preview only.</p></section><div class="search-wrap"><span>⌕</span><input id="assetSearch" type="search" placeholder="Search by name or symbol…" aria-label="Search assets" value="${escapeHTML(state.query)}"><button id="clearSearch" type="button">Clear</button></div><section class="asset-list" id="quoteList">${renderAssetRows(state.query)}</section><p class="fine-print">Prices and percentage changes are fictional sample values, not live market data.</p>`;
    $('#assetSearch').addEventListener('input', e => { state.query=e.target.value; $('#quoteList').innerHTML=renderAssetRows(state.query); });
    $('#clearSearch').addEventListener('click', () => { state.query=''; $('#assetSearch').value=''; $('#quoteList').innerHTML=renderAssetRows(''); $('#assetSearch').focus(); });
  } else if (page === 'Assets') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">WALLET PREVIEW</span><h1>Assets</h1><p>Sample account overview. This demo cannot hold or transfer money.</p></section><article class="balance-card"><span>Illustrative total balance</span><strong>$12,480.00</strong><small>Demo balance · not withdrawable</small><div class="balance-actions"><button data-page="Recharge">Recharge preview</button><button data-page="Withdrawal">Withdrawal preview</button></div></article><section class="section-head"><div><span class="eyebrow">EXAMPLE RECORDS</span><h2>Recent activity</h2></div><span class="demo-pill">SAMPLE</span></section><div class="activity-list"><div><span class="activity-icon">↗</span><span><b>Demo credit</b><small>Sample record · 12 Oct 2026</small></span><strong class="positive">+$250.00</strong></div><div><span class="activity-icon">✦</span><span><b>Demo reward</b><small>Sample record · 10 Oct 2026</small></span><strong class="positive">+$12.00</strong></div><div><span class="activity-icon">↙</span><span><b>Demo withdrawal</b><small>Illustrative only · 08 Oct 2026</small></span><strong>−$50.00</strong></div></div>`;
  } else if (page === 'Team') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">COMMUNITY</span><h1>Team</h1><p>Preview a referral dashboard layout.</p></section><article class="balance-card team-card"><span>Sample team members</span><strong>08</strong><small>Illustrative count only</small><div class="stat-grid"><div><small>Level 1</small><b>05 members</b></div><div><small>Level 2</small><b>03 members</b></div></div></article><article class="content-card"><h2>Your demo referral code</h2><div class="copy-row"><code>CB-DEMO-2026</code><button class="primary-btn compact" id="copyCode" type="button">Copy code</button></div><p class="fine-print">This is a sample code. It does not track real referrals or earn commissions.</p></article>`;
    $('#copyCode').addEventListener('click', async () => { try { await navigator.clipboard.writeText('CB-DEMO-2026'); showToast('Demo code copied.'); } catch { showToast('Demo referral code: CB-DEMO-2026'); } });
  } else if (page === 'Bonus') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">REWARD CENTER</span><h1>Bonus & tasks</h1><p>Example reward cards to preview the interface. No reward can be claimed.</p></section><div class="task-list"><article class="task-card"><span class="task-icon">🎁</span><div><h2>Daily check-in</h2><p>Preview a daily reward task.</p><small>Sample reward: 5 points</small></div><button data-demo="Daily check-in">Preview</button></article><article class="task-card"><span class="task-icon">👥</span><div><h2>Invite a friend</h2><p>Example referral task card.</p><small>Sample reward: 20 points</small></div><button data-page="Invite">View invite</button></article><article class="task-card"><span class="task-icon">📘</span><div><h2>Read the guide</h2><p>Learn about this prototype.</p><small>Sample reward: 2 points</small></div><button data-page="Guide">Open guide</button></article></div>`;
  } else if (page === 'Recharge' || page === 'Withdrawal') {
    const isRecharge = page === 'Recharge';
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">DEMO WALLET</span><h1>${isRecharge?'Recharge preview':'Withdrawal preview'}</h1><p>This is a non-functional UI preview. Do not enter payment details, wallet addresses, passwords or other sensitive information.</p></section><article class="content-card warning-card"><span class="warning-icon">ⓘ</span><div><h2>No payment integration</h2><p>Real ${isRecharge?'deposits':'withdrawals'} are disabled. No funds move and no transaction will be created.</p></div></article><form id="demoActionForm" class="demo-form"><label for="demoAmount">Illustrative amount (USD)</label><input id="demoAmount" name="amount" type="number" min="1" max="10000" step="1" placeholder="e.g. 100" required><p class="fine-print">For interface testing only. This amount is not sent or saved.</p><button class="primary-btn" type="submit">Preview ${isRecharge?'recharge':'withdrawal'}</button><button class="secondary-btn" type="button" data-page="Assets">Back to assets</button></form>`;
    $('#demoActionForm').addEventListener('submit', e => { e.preventDefault(); const amount=Number($('#demoAmount').value); if (!Number.isFinite(amount)||amount<1||amount>10000) { showToast('Enter a sample amount from $1 to $10,000.'); return; } showModal('Demo preview only', `You entered a sample amount of $${amount.toLocaleString('en-US')}. No ${isRecharge?'deposit':'withdrawal'} was made. Payment functionality is not connected.`); });
  } else if (page === 'Signal') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">MARKET INSIGHTS</span><h1>Signals</h1><p>Illustrative trend cards only. These are not financial advice or trading signals.</p></section><div class="signal-grid"><article class="signal-card"><span class="signal-status up">SAMPLE TREND</span><h2>BTC / USDT</h2><strong>$67,421.80</strong><p class="positive">+2.34% sample change</p><div class="signal-bar"><i style="width:68%"></i></div></article><article class="signal-card"><span class="signal-status down">SAMPLE TREND</span><h2>ETC / USDT</h2><strong>$26.18</strong><p class="negative">−0.46% sample change</p><div class="signal-bar"><i style="width:34%"></i></div></article></div><p class="fine-print">Values are fictional and must not be used to make financial decisions.</p>`;
  } else if (page === 'Service') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">HELP CENTER</span><h1>Service</h1><p>Find answers about this prototype.</p></section><div class="faq-list"><details open><summary>Is this a live exchange?</summary><p>No. This is a static front-end demo with sample values only.</p></details><details><summary>Can I deposit or withdraw money?</summary><p>No. No payment provider, wallet or backend is connected.</p></details><details><summary>Are prices real-time?</summary><p>No. Prices are hard-coded examples for layout testing.</p></details><details><summary>How do I deploy it?</summary><p>Upload the files to a GitHub repository and connect that repository to a Render Static Site. Use a blank build command and publish directory “.”.</p></details></div>`;
  } else if (page === 'Invite') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">SHARE THE DEMO</span><h1>Invite friends</h1><p>Preview how an invite page may look.</p></section><article class="invite-card"><div class="invite-art">♧</div><h2>Share the experience</h2><p>Invite code for layout testing:</p><div class="copy-row"><code>CB-DEMO-2026</code><button class="primary-btn compact" id="copyInvite" type="button">Copy code</button></div><p class="fine-print">This code is not connected to any referral program.</p></article>`;
    $('#copyInvite').addEventListener('click', async () => { try { await navigator.clipboard.writeText('CB-DEMO-2026'); showToast('Demo code copied.'); } catch { showToast('Demo referral code: CB-DEMO-2026'); } });
  } else if (page === 'Guide') {
    main.innerHTML = `<section class="page-intro"><span class="eyebrow">QUICK START</span><h1>Demo guide</h1><p>Explore the screens without using real financial information.</p></section><div class="faq-list"><details open><summary>1. Explore market quotes</summary><p>Open Quotes and search by symbol or asset name. All prices are sample values.</p></details><details><summary>2. Review the wallet layout</summary><p>Assets shows an illustrative balance and fake activity records to demonstrate the design.</p></details><details><summary>3. Preview action screens</summary><p>Recharge and Withdrawal only demonstrate the interface. They do not accept transactions.</p></details><details><summary>4. Production requirements</summary><p>A real financial service needs a secure backend, authentication, audit logs, verified payment/wallet integrations and legal/compliance review.</p></details></div>`;
  }
  $$('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  window.scrollTo({top:0,behavior:'smooth'});
}
function renderAssetRows(query='') {
  const q=query.trim().toLowerCase();
  const filtered=assets.filter(a=>a.symbol.toLowerCase().includes(q)||a.name.toLowerCase().includes(q));
  return filtered.length ? filtered.map(assetRow).join('') : '<div class="empty-state">No sample assets match that search.</div>';
}
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function showModal(title, text) { $('#modalTitle').textContent=title; $('#modalBody').innerHTML=''; const p=document.createElement('p'); p.textContent=text; $('#modalBody').appendChild(p); $('#modal').hidden=false; $('#okModal').focus(); }
function hideModal() { $('#modal').hidden=true; }
function showToast(message) { const toast=$('#toast'); toast.textContent=message; toast.hidden=false; window.clearTimeout(showToast.timer); showToast.timer=window.setTimeout(()=>{toast.hidden=true;},2600); }

document.addEventListener('click', event => {
  const pageButton=event.target.closest('[data-page]');
  if (pageButton) { event.preventDefault(); renderPage(pageButton.dataset.page); return; }
  const demoButton=event.target.closest('[data-demo]');
  if (demoButton) { showModal('Demo task', `${demoButton.dataset.demo} is a sample task only. No points or rewards are issued.`); }
});
$('#closeModal').addEventListener('click', hideModal);
$('#okModal').addEventListener('click', hideModal);
$('#modal').addEventListener('click', event => { if(event.target === $('#modal')) hideModal(); });
document.addEventListener('keydown', event => { if(event.key==='Escape' && !$('#modal').hidden) hideModal(); });
$('#language').addEventListener('click', () => { showModal('Language', 'This demo currently supports English only. The language selector is a visual prototype.'); });
renderHome();
