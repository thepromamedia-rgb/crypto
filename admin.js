'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const dt = ts => ts ? new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
let tab = 'over', ov = null, q = '';
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
async function api(path, body) {
  const r = await fetch('/api/' + path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'Failed'); e.status = r.status; throw e; } return j;
}
function loginView(msg) {
  $('#root').innerHTML = `<form class="box login" id="lf"><h1 style="margin-top:0">Admin login</h1><label>Email</label><input id="e" type="email" autocomplete="username" required><label>Password</label><input id="p" type="password" autocomplete="current-password" required><p class="msg-err" id="err">${esc(msg || '')}</p><button class="primary-btn" type="submit">Login</button></form>`;
  $('#lf').onsubmit = async ev => { ev.preventDefault(); try { const j = await api('login', { email: $('#e').value, password: $('#p').value }); if (j.user.role !== 'admin') { await api('logout', {}); return loginView('Not an admin account.'); } start(); } catch (x) { $('#err').textContent = x.message; } };
}
async function start() {
  try { ov = await api('admin/overview'); } catch (x) { return loginView(x.status === 403 ? 'Not an admin account.' : ''); }
  draw();
}
async function draw() {
  ov = await api('admin/overview').catch(() => ov);
  const tabs = [['over', 'Overview'], ['dep', 'Deposits', ov.pendingDeposits], ['wd', 'Withdrawals', ov.pendingWithdrawals], ['users', 'Users'], ['set', 'Settings'], ['log', 'Audit log']];
  $('#root').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><h1 style="margin:0">Crypto Bridge Admin</h1><div><a class="sm" href="/" style="text-decoration:none">Site</a><button class="sm" id="out">Logout</button></div></div>
  <div class="tabs">${tabs.map(t => `<button data-t="${t[0]}" class="${tab === t[0] ? 'on' : ''}">${t[1]}${t[2] ? `<span class="dot">${t[2]}</span>` : ''}</button>`).join('')}</div><div id="body"></div>`;
  document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; q = ''; draw(); });
  $('#out').onclick = async () => { await api('logout', {}); loginView(); };
  const body = $('#body');
  if (tab === 'over') {
    body.innerHTML = `${ov.storage === 'file' ? '<div class="notice-banner"><span>⚠</span><p><b>Database is a local file.</b> On Render this is wiped at every deploy/restart. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN so data is preserved.</p></div>' : ''}
    <div class="stats">${[['Users', ov.users], ['Wallet liabilities', inr(ov.wallets)], ['Deposits approved', inr(ov.depositsApproved)], ['Withdrawals paid', inr(ov.withdrawalsPaid)], ['Pending deposits', ov.pendingDeposits], ['Pending withdrawals', ov.pendingWithdrawals]].map(s => `<div class="stat"><small>${s[0]}</small><b>${s[1]}</b></div>`).join('')}</div>
    <div class="box"><b>Rules</b><p class="fine-print">Minimum deposit ${inr(ov.min.deposit)} · Minimum withdrawal ${inr(ov.min.withdraw)} · Storage: ${ov.storage}</p><button class="sm" id="bk">Download backup (JSON)</button></div>`;
    $('#bk').onclick = async () => { const d = await api('admin/backup'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'cryptobridge-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); };
  } else if (tab === 'dep' || tab === 'wd') {
    const dep = tab === 'dep', { items } = await api(dep ? 'admin/deposits' : 'admin/withdrawals');
    body.innerHTML = `<input id="s" placeholder="Search email, ${dep ? 'UTR' : 'UPI'}, status" value="${esc(q)}" style="width:100%;padding:11px;border:1px solid #dce3f0;border-radius:10px;margin-bottom:10px"><div class="tbl"><table><tr><th>#</th><th>Date</th><th>User</th><th>Amount</th><th>${dep ? 'UTR' : 'UPI'}</th><th>Status</th><th>Action</th></tr>${items.filter(i => !q || [i.email, i.utr, i.upi, i.status].join(' ').toLowerCase().includes(q.toLowerCase())).map(i => `<tr><td>${i.id}</td><td>${dt(i.ts)}</td><td>${esc(i.email)}</td><td><b>${inr(i.amount)}</b></td><td>${esc(i.utr || i.upi)}</td><td><span class="pill ${esc(i.status)}">${esc(i.status)}</span></td><td>${i.status === 'Pending' ? (dep ? `<button class="sm ok" data-a="approve" data-id="${i.id}">Approve</button><button class="sm no" data-a="reject" data-id="${i.id}">Reject</button>` : `<button class="sm ok" data-a="paid" data-id="${i.id}">Mark paid</button><button class="sm no" data-a="reject" data-id="${i.id}">Reject + refund</button>`) : esc(i.by || '')}</td></tr>`).join('')}</table></div>`;
    $('#s').oninput = e => { q = e.target.value; const p = e.target.selectionStart; draw().then(() => { const n = $('#s'); n.focus(); n.setSelectionRange(p, p); }); };
    body.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const a = b.dataset.a, id = Number(b.dataset.id); let extra = {};
      if (a === 'paid') { const r = prompt('Payout reference / UTR (optional):'); if (r === null) return; extra.ref = r; }
      else if (!confirm(`${a === 'approve' ? 'Approve and credit' : 'Reject'} #${id}?`)) return;
      try { await api(dep ? 'admin/deposit' : 'admin/withdrawal', { id, action: a, ...extra }); toast('Done'); } catch (x) { toast(x.message); } draw();
    });
  } else if (tab === 'users') {
    const { users } = await api('admin/users');
    body.innerHTML = `<div class="tbl"><table><tr><th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Balance</th><th>Joined</th><th>Actions</th></tr>${users.filter(u => u.role !== 'admin').map(u => `<tr><td>${u.id}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone)}</td><td><b>${inr(u.balance)}</b></td><td>${dt(u.created)}</td><td><button class="sm ${u.blocked ? 'ok' : 'no'}" data-u="${u.blocked ? 'unblock' : 'block'}" data-id="${u.id}">${u.blocked ? 'Unblock' : 'Block'}</button><button class="sm" data-u="password" data-id="${u.id}">Set password</button><button class="sm" data-u="adjust" data-id="${u.id}">Adjust</button></td></tr>`).join('')}</table></div>`;
    body.querySelectorAll('[data-u]').forEach(b => b.onclick = async () => {
      const a = b.dataset.u, id = Number(b.dataset.id); let p = { id, action: a };
      if (a === 'password') { p.password = prompt('New password (min 8):'); if (!p.password) return; }
      else if (a === 'adjust') { p.amount = Number(prompt('Amount to add (negative to deduct), whole ₹:')); if (!p.amount) return; p.reason = prompt('Reason (required, logged):'); if (!p.reason) return; }
      else if (!confirm(a + ' user #' + id + '?')) return;
      try { await api('admin/user', p); toast('Done'); } catch (x) { toast(x.message); } draw();
    });
  } else if (tab === 'set') {
    const s = ov.settings;
    body.innerHTML = `<form class="box" id="sf"><label>UPI ID (for deposits)</label><input id="upi" value="${esc(s.upi)}" maxlength="60"><label>Payee name</label><input id="payee" value="${esc(s.payee)}" maxlength="60"><label>Payment QR image (PNG/JPG/WEBP, under 250 KB)</label>${s.qr ? `<img class="qr-img" style="margin:0 0 8px" src="${esc(s.qr)}" alt="QR"><label style="font-weight:600"><input type="checkbox" id="rmqr" style="width:auto"> Remove current QR</label>` : ''}<input id="qr" type="file" accept="image/png,image/jpeg,image/webp"><label>Support link (https://…)</label><input id="sup" value="${esc(s.support)}" maxlength="200"><label>Site notice (shown on top of pages)</label><input id="notice" value="${esc(s.notice)}" maxlength="300"><label>Bonus / offers text</label><textarea id="bonus" rows="4" maxlength="600">${esc(s.bonus)}</textarea><button class="primary-btn" type="submit">Save settings</button></form>`;
    $('#sf').onsubmit = async e => {
      e.preventDefault(); const p = { upi: $('#upi').value, payee: $('#payee').value, support: $('#sup').value, notice: $('#notice').value, bonus: $('#bonus').value };
      const f = $('#qr').files[0];
      if (f) { if (f.size > 250000) return toast('QR image too large'); p.qr = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }); }
      else if ($('#rmqr') && $('#rmqr').checked) p.qr = '';
      try { await api('admin/settings', p); toast('Saved'); } catch (x) { toast(x.message); } draw();
    };
  } else if (tab === 'log') {
    const { items } = await api('admin/audit');
    body.innerHTML = `<div class="tbl"><table><tr><th>Time</th><th>Who</th><th>Action</th><th>Detail</th></tr>${items.map(i => `<tr><td>${dt(i.ts)}</td><td>${esc(i.who)}</td><td>${esc(i.action)}</td><td>${esc(i.detail)}</td></tr>`).join('')}</table></div>`;
  }
}
start();
