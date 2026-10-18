'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const dt = ts => ts ? new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
let tab = 'over', ov = null, q = '';
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
async function api(path, body) {
  const r = await fetch('/api/' + path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'Failed'); e.status = r.status; throw e; } return j;
}
function loginView(msg) {
  $('#root').innerHTML = `<form class="box login" id="lf"><h1 style="margin-top:0">Admin login</h1><label>Email</label><input id="e" type="email" autocomplete="username" required><label>Password</label><div class="pw-wrap"><input id="p" type="password" autocomplete="current-password" required><button type="button" class="eye" id="eye" aria-label="Show password">👁</button></div><p class="msg-err" id="err">${esc(msg || '')}</p><button class="primary-btn" type="submit">Login</button></form>`;
  $('#eye').onclick = () => { const i = $('#p'); i.type = i.type === 'password' ? 'text' : 'password'; };
  $('#lf').onsubmit = async ev => { ev.preventDefault(); try { const j = await api('login', { email: $('#e').value, password: $('#p').value }); if (j.user.role !== 'admin') { await api('logout', {}); return loginView('Not an admin account.'); } start(); } catch (x) { $('#err').textContent = x.message; } };
}
async function start() {
  try { ov = await api('admin/overview'); } catch (x) { return loginView(x.status === 403 ? 'Not an admin account.' : ''); }
  draw();
}
async function draw() {
  ov = await api('admin/overview').catch(() => ov);
  const tabs = [['over', 'Overview'], ['dep', 'Deposits', ov.pendingDeposits], ['wd', 'Withdrawals', ov.pendingWithdrawals], ['trd', 'Trades'], ['coins', 'Coins'], ['bonus', 'Bonus Coin', ov.bonus && ov.bonus.active], ['users', 'Users'], ['rep', 'Reports'], ['ref', 'Referral'], ['set', 'Settings'], ['log', 'Audit log']];
  $('#root').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><h1 style="margin:0">Crypto Bridge Admin</h1><div><a class="sm" href="/" style="text-decoration:none">Site</a><button class="sm" id="out">Logout</button></div></div>
  <div class="tabs">${tabs.map(t => `<button data-t="${t[0]}" class="${tab === t[0] ? 'on' : ''}">${t[1]}${t[2] ? `<span class="dot">${t[2]}</span>` : ''}</button>`).join('')}</div><div id="body"></div>`;
  document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; q = ''; draw(); });
  $('#out').onclick = async () => { await api('logout', {}); loginView(); };
  const body = $('#body');
  if (tab === 'over') {
    body.innerHTML = `${ov.storage === 'file' ? '<div class="notice-banner"><span>⚠</span><p><b>Database is a local file.</b> On Render this is wiped at every deploy/restart. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN so data is preserved.</p></div>' : ''}
    <div class="stats">${[['Users', ov.users], ['Wallet liabilities', inr(ov.wallets)], ['Deposits approved', inr(ov.depositsApproved)], ['Withdrawals paid', inr(ov.withdrawalsPaid)], ['Pending deposits', ov.pendingDeposits], ['Pending withdrawals', ov.pendingWithdrawals], ['Trades', ov.trades], ['Bonus coin active', ov.bonus.active + ' · ' + inr(ov.bonus.activeAmount)], ['Bonus returns paid', inr(ov.bonus.profitPaid)], ['Referral paid (bonus coin)', inr(ov.bonus.refPaid)], ['Referral paid (trade profit)', inr(ov.bonus.tradeRefPaid)]].map(s => `<div class="stat"><small>${s[0]}</small><b>${s[1]}</b></div>`).join('')}</div>
    <div class="box"><b>Rules</b><p class="fine-print">Minimum deposit ${inr(ov.min.deposit)} · Minimum withdrawal ${inr(ov.min.withdraw)} · Minimum buy ${inr(ov.min.trade)} (change in Settings) · Storage: ${ov.storage}</p><button class="sm" id="bk">Download backup (JSON)</button></div>`;
    $('#bk').onclick = async () => { const d = await api('admin/backup'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'cryptobridge-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); };
  } else if (tab === 'dep' || tab === 'wd') {
    const dep = tab === 'dep', { items } = await api(dep ? 'admin/deposits' : 'admin/withdrawals');
    body.innerHTML = `<input id="s" placeholder="Search email, ${dep ? 'UTR' : 'UPI'}, status" value="${esc(q)}" style="width:100%;padding:11px;border:1px solid #dce3f0;border-radius:10px;margin-bottom:10px"><div class="tbl"><table><tr><th>#</th><th>Date</th><th>User</th><th>Amount</th>${dep ? '<th>Referral paid</th>' : ''}<th>${dep ? 'UTR' : 'UPI'}</th><th>Status</th><th>Action</th></tr>${items.filter(i => !q || [i.email, i.utr, i.upi, i.status].join(' ').toLowerCase().includes(q.toLowerCase())).map(i => `<tr><td>${i.id}</td><td>${dt(i.ts)}</td><td>${esc(i.email)}</td><td><b>${inr(i.amount)}</b></td>${dep ? `<td>${inr(i.refPaid || 0)}</td>` : ''}<td>${esc(i.utr || i.upi)}</td><td><span class="pill ${esc(i.status)}">${esc(i.status)}</span></td><td>${i.status === 'Pending' ? (dep ? `<button class="sm ok" data-a="approve" data-id="${i.id}">Approve</button><button class="sm no" data-a="reject" data-id="${i.id}">Reject</button>` : `<button class="sm ok" data-a="paid" data-id="${i.id}">Mark paid</button><button class="sm no" data-a="reject" data-id="${i.id}">Reject + refund</button>`) : esc(i.by || '')}</td></tr>`).join('')}</table></div>`;
    $('#s').oninput = e => { q = e.target.value; const p = e.target.selectionStart; draw().then(() => { const n = $('#s'); n.focus(); n.setSelectionRange(p, p); }); };
    body.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const a = b.dataset.a, id = Number(b.dataset.id); let extra = {};
      if (a === 'paid') { const r = prompt('Payout reference / UTR (optional):'); if (r === null) return; extra.ref = r; }
      else if (!confirm(`${a === 'approve' ? 'Approve and credit' : 'Reject'} #${id}?`)) return;
      try { await api(dep ? 'admin/deposit' : 'admin/withdrawal', { id, action: a, ...extra }); toast('Done'); } catch (x) { toast(x.message); } draw();
    });
  } else if (tab === 'trd') {
    const { items } = await api('admin/trades');
    body.innerHTML = `<div class="tbl"><table><tr><th>#</th><th>Time</th><th>User</th><th>Side</th><th>Coin</th><th>Qty</th><th>Price ₹</th><th>Amount</th></tr>${items.map(t => `<tr><td>${t.id}</td><td>${dt(t.ts)}</td><td>${esc(t.email)}</td><td>${esc(t.side)}</td><td>${esc(t.symbol)}</td><td>${t.qty}</td><td>${inr(t.price)}</td><td><b>${inr(t.amount)}</b></td></tr>`).join('') || '<tr><td colspan="8">No trades yet.</td></tr>'}</table></div>`;
  } else if (tab === 'coins') {
    const list = ov.settings.coins || [];
    body.innerHTML = `<div class="box"><b>Listed market coins (${list.length})</b><p class="fine-print">Add as many supported market coins as needed. Coins require a valid Binance USDT pair and CoinGecko API ID for live pricing. A coin can be removed only when no user holds it.</p><div class="tbl"><table><tr><th>Symbol</th><th>Name</th><th>CoinGecko id</th><th>Action</th></tr>${list.map(c => `<tr><td><b>${esc(c[0])}</b></td><td>${esc(c[1])}</td><td>${esc(c[2])}</td><td><button class="sm no" data-rm="${esc(c[0])}">Remove</button></td></tr>`).join('')}</table></div></div>
    <form class="box" id="cf"><b>Add a coin</b><p class="fine-print">Must exist on Binance as SYMBOLUSDT and on CoinGecko. It is checked before adding.</p><label>Symbol (e.g. MATIC)</label><input id="c_sym" maxlength="10" required><label>Name</label><input id="c_name" maxlength="40" required><label>CoinGecko API id (e.g. matic-network)</label><input id="c_id" maxlength="60" required><label>Icon letter (optional)</label><input id="c_mark" maxlength="2"><button class="primary-btn" type="submit">Add coin</button></form>`;
    $('#cf').onsubmit = async e => { e.preventDefault(); try { await api('admin/coin', { action: 'add', symbol: $('#c_sym').value, name: $('#c_name').value, id: $('#c_id').value, mark: $('#c_mark').value }); toast('Coin added'); } catch (x) { toast(x.message); } draw(); };
    body.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (!confirm('Remove ' + b.dataset.rm + ' from the site?')) return; try { await api('admin/coin', { action: 'remove', symbol: b.dataset.rm }); toast('Removed'); } catch (x) { toast(x.message); } draw(); });
  } else if (tab === 'bonus') {
    const { config: c, items } = await api('admin/bonus');
    body.innerHTML = `<form class="box" id="bf"><b>Bonus coin settings</b><p class="fine-print">Users trade this coin from their wallet. After the lock time they get the amount back plus the return %. If they joined with a referral code, the referrer earns a commission. Open trades keep the rates they were placed with.</p>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="b_en" style="width:auto" ${c.enabled ? 'checked' : ''}> Coin is open for trading</label>
    <label>Coin symbol</label><input id="b_sym" value="${esc(c.symbol)}" maxlength="8"><label>Coin name</label><input id="b_name" value="${esc(c.name)}" maxlength="40">
    <label>User return % (profit on each trade)</label><input id="b_ret" type="number" step="0.01" min="0" max="100" value="${c.returnPct}">
    <label>Referral commission % (paid to the referrer)</label><input id="b_ref" type="number" step="0.01" min="0" max="100" value="${c.refPct}">
    <label>Referral commission is calculated on</label><select id="b_base" style="width:100%;padding:11px;border:1px solid #dce3f0;border-radius:10px"><option value="profit" ${c.refBase === 'profit' ? 'selected' : ''}>The user's return (profit)</option><option value="amount" ${c.refBase === 'amount' ? 'selected' : ''}>The user's trade amount</option></select>
    <label>Lock time in hours (0 = pay instantly)</label><input id="b_lock" type="number" step="1" min="0" max="720" value="${c.lockHours}">
    <label>Minimum trade (₹)</label><input id="b_min" type="number" step="1" min="1" value="${c.minAmount}"><label>Maximum trade (₹)</label><input id="b_max" type="number" step="1" min="1" value="${c.maxAmount}">
    <button class="primary-btn" type="submit">Save bonus coin settings</button></form>
    <h3 style="margin:18px 0 8px">Bonus coin trades</h3><div class="tbl"><table><tr><th>#</th><th>Time</th><th>User</th><th>Amount</th><th>Return</th><th>Pays at</th><th>Referral paid</th><th>Status</th><th>Action</th></tr>${items.map(p => `<tr><td>${p.id}</td><td>${dt(p.ts)}</td><td>${esc(p.email)}</td><td><b>${inr(p.amount)}</b></td><td>${p.returnPct}%${p.profit != null ? ' = ' + inr(p.profit) : ''}</td><td>${dt(p.matureAt)}</td><td>${p.refPaid ? inr(p.refPaid) : ''}</td><td><span class="pill ${esc(p.status)}">${esc(p.status)}</span></td><td>${p.status === 'Active' ? `<button class="sm ok" data-p="settle" data-id="${p.id}">Pay now</button><button class="sm no" data-p="cancel" data-id="${p.id}">Cancel + refund</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9">No trades yet.</td></tr>'}</table></div>`;
    $('#bf').onsubmit = async e => { e.preventDefault(); try { await api('admin/bonuscoin', { enabled: $('#b_en').checked, symbol: $('#b_sym').value, name: $('#b_name').value, returnPct: Number($('#b_ret').value), refPct: Number($('#b_ref').value), refBase: $('#b_base').value, lockHours: Number($('#b_lock').value), minAmount: Number($('#b_min').value), maxAmount: Number($('#b_max').value) }); toast('Saved'); } catch (x) { toast(x.message); } draw(); };
    body.querySelectorAll('[data-p]').forEach(b => b.onclick = async () => { if (!confirm(b.dataset.p === 'settle' ? 'Pay principal + return now?' : 'Cancel and refund the amount?')) return; try { await api('admin/position', { id: Number(b.dataset.id), action: b.dataset.p }); toast('Done'); } catch (x) { toast(x.message); } draw(); });
  } else if (tab === 'rep') {
    const { rows } = await api('admin/report'), tot = k => rows.reduce((s, r) => s + r[k], 0);
    body.innerHTML = `<div class="stats" style="margin-bottom:12px">${[['Sign-ups (14d)', tot('signups')], ['Deposits (14d)', inr(tot('depositAmt'))], ['Withdrawals (14d)', inr(tot('withdrawAmt'))], ['Net in (14d)', inr(tot('depositAmt') - tot('withdrawAmt'))], ['Trade volume (14d)', inr(tot('tradeVol'))]].map(s => `<div class="stat"><small>${s[0]}</small><b>${s[1]}</b></div>`).join('')}</div>
    <div class="tbl"><table><tr><th>Date (IST)</th><th>Sign-ups</th><th>Deposits</th><th>Deposit ₹</th><th>Withdrawals</th><th>Withdraw ₹</th><th>Trades</th><th>Trade volume ₹</th></tr>${rows.map(r => `<tr><td>${r.date}</td><td>${r.signups}</td><td>${r.deposits}</td><td>${inr(r.depositAmt)}</td><td>${r.withdrawals}</td><td>${inr(r.withdrawAmt)}</td><td>${r.trades}</td><td>${inr(r.tradeVol)}</td></tr>`).join('')}</table></div>
    <div class="box"><b>Export CSV</b><p class="fine-print">Download full records for your accounts.</p>${[['deposits', 'Deposits'], ['withdrawals', 'Withdrawals'], ['trades', 'Trades'], ['users', 'Users']].map(x => `<button class="sm" data-csv="${x[0]}">${x[1]}</button>`).join('')}</div>`;
    body.querySelectorAll('[data-csv]').forEach(b => b.onclick = async () => {
      const k = b.dataset.csv, j = await api('admin/' + k), list = (j.items || j.users || []).map(o => { const r = { ...o }; delete r.holdings; delete r.pass; return r; });
      const cols = [...new Set(list.flatMap(o => Object.keys(o)))], cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const csv = [cols.join(','), ...list.map(o => cols.map(cn => cell(o[cn])).join(','))].join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'cryptobridge-' + k + '-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    });
  } else if (tab === 'users') {
    const { users } = await api('admin/users');
    body.innerHTML = `<div class="tbl"><table><tr><th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Balance</th><th>Referred by</th><th>Ref earned</th><th>Joined</th><th>Actions</th></tr>${users.filter(u => u.role !== 'admin').map(u => `<tr><td>${u.id}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone)}</td><td><b>${inr(u.balance)}</b></td><td>${esc((users.find(x => x.id === u.refBy) || {}).email || '')}</td><td>${inr(u.refEarned)}</td><td>${dt(u.created)}</td><td><button class="sm ${u.blocked ? 'ok' : 'no'}" data-u="${u.blocked ? 'unblock' : 'block'}" data-id="${u.id}">${u.blocked ? 'Unblock' : 'Block'}</button><button class="sm" data-u="password" data-id="${u.id}">Set password</button><button class="sm" data-u="adjust" data-id="${u.id}">Adjust</button></td></tr>`).join('')}</table></div>`;
    body.querySelectorAll('[data-u]').forEach(b => b.onclick = async () => {
      const a = b.dataset.u, id = Number(b.dataset.id); let p = { id, action: a };
      if (a === 'password') { p.password = prompt('New password (min 8):'); if (!p.password) return; }
      else if (a === 'adjust') { p.amount = Number(prompt('Amount to add (negative to deduct), whole ₹:')); if (!p.amount) return; p.reason = prompt('Reason (required, logged):'); if (!p.reason) return; }
      else if (!confirm(a + ' user #' + id + '?')) return;
      try { await api('admin/user', p); toast('Done'); } catch (x) { toast(x.message); } draw();
    });
  } else if (tab === 'set') {
    const s = ov.settings;
    body.innerHTML = `<form class="box" id="sf"><b>Limits</b><label>Minimum deposit (₹)</label><input id="minDep" type="number" step="1" min="1" value="${ov.min.deposit}"><label>Minimum withdrawal (₹)</label><input id="minWd" type="number" step="1" min="1" value="${ov.min.withdraw}"><label>Minimum buy order (₹)</label><input id="minTr" type="number" step="1" min="1" value="${ov.min.trade}"><b style="display:block;margin-top:16px">Payment details</b><label>UPI ID (for deposits)</label><input id="upi" value="${esc(s.upi)}" maxlength="60"><label>Payee name</label><input id="payee" value="${esc(s.payee)}" maxlength="60"><label>Payment QR image (PNG/JPG/WEBP, under 250 KB)</label>${s.qr ? `<img class="qr-img" style="margin:0 0 8px" src="${esc(s.qr)}" alt="QR"><label style="font-weight:600"><input type="checkbox" id="rmqr" style="width:auto"> Remove current QR</label>` : ''}<input id="qr" type="file" accept="image/png,image/jpeg,image/webp"><label>Support link (https://…)</label><input id="sup" value="${esc(s.support)}" maxlength="200"><label>Site notice (shown on top of pages)</label><input id="notice" value="${esc(s.notice)}" maxlength="300"><label>Bonus / offers text</label><textarea id="bonus" rows="4" maxlength="600">${esc(s.bonus)}</textarea><button class="primary-btn" type="submit">Save settings</button></form>`;
    $('#sf').onsubmit = async e => {
      e.preventDefault(); const p = { upi: $('#upi').value, payee: $('#payee').value, support: $('#sup').value, notice: $('#notice').value, bonus: $('#bonus').value, minDeposit: Number($('#minDep').value), minWithdraw: Number($('#minWd').value), minTrade: Number($('#minTr').value) };
      const f = $('#qr').files[0];
      if (f) { if (f.size > 250000) return toast('QR image too large'); p.qr = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }); }
      else if ($('#rmqr') && $('#rmqr').checked) p.qr = '';
      try { await api('admin/settings', p); toast('Saved'); } catch (x) { toast(x.message); } draw();
    };
  } else if (tab === 'ref') {
    const r = ov.settings.tradeRef || { enabled: false, levels: [5, 0, 0], maxPerTrade: 0 };
    const tr = Array.isArray(r.levels) ? r.levels : [Number(r.pct || 0), 0, 0];
    const d = ov.settings.depositRef || { enabled: false, levels: [0, 0, 0] };
    const dr = Array.isArray(d.levels) ? d.levels : [0, 0, 0];
    body.innerHTML = `<form class="box" id="df"><b>Referral commission on approved deposits</b><p class="fine-print">Commission is paid only after an admin approves a deposit, and only once. Each level's percentage is calculated from that user's approved deposit amount.</p>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="d_en" style="width:auto" ${d.enabled ? 'checked' : ''}> Deposit referral commission is on</label>
    ${[1,2,3].map((n,i)=>`<label>Level ${n} commission (%)</label><input id="d_l${n}" type="number" step="0.01" min="0" max="100" value="${Number(dr[i] || 0)}">`).join('')}
    <button class="primary-btn" type="submit">Save deposit referral settings</button></form>
    <form class="box" id="rf"><b>Referral commission on realised trading profit</b><p class="fine-print">When a user sells a market coin at a real realised profit, commissions are paid to their Level 1, Level 2 and Level 3 upline using each level's configured percentage of that profit. No commission is paid on buys, losses or unrealised price changes. These are referral commissions, not guaranteed daily returns.</p>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="r_en" style="width:auto" ${r.enabled ? 'checked' : ''}> Trading-profit referral commission is on</label>
    ${[1,2,3].map((n,i)=>`<label>Level ${n} commission (% of realised profit)</label><input id="r_l${n}" type="number" step="0.01" min="0" max="100" value="${Number(tr[i] || 0)}">`).join('')}
    <label>Maximum commission per level per trade in ₹ (0 = no cap)</label><input id="r_max" type="number" step="1" min="0" value="${r.maxPerTrade || 0}">
    <button class="primary-btn" type="submit">Save trading referral settings</button></form>`;
    $('#df').onsubmit = async e => { e.preventDefault(); const levels = [1,2,3].map(n => Number($('#d_l'+n).value)); try { await api('admin/depositreferral', { enabled: $('#d_en').checked, levels }); toast('Deposit referral settings saved'); } catch (x) { toast(x.message); } draw(); };
    $('#rf').onsubmit = async e => { e.preventDefault(); const levels = [1,2,3].map(n => Number($('#r_l'+n).value)); try { await api('admin/referral', { enabled: $('#r_en').checked, levels, maxPerTrade: Number($('#r_max').value) }); toast('Trading referral settings saved'); } catch (x) { toast(x.message); } draw(); };
  } else if (tab === 'log') {
    const { items } = await api('admin/audit');
    body.innerHTML = `<div class="tbl"><table><tr><th>Time</th><th>Who</th><th>Action</th><th>Detail</th></tr>${items.map(i => `<tr><td>${dt(i.ts)}</td><td>${esc(i.who)}</td><td>${esc(i.action)}</td><td>${esc(i.detail)}</td></tr>`).join('')}</table></div>`;
  }
}
start();
