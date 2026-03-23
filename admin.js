// ══════════════════════════════════════════════
// Config — same Supabase project as app.js
const SB_URL = 'https://swgzevzmvznuwlfcuzde.supabase.co';
const SB_ANON_KEY = 'sb_publishable_lWvvvC4styQAak6jqmXk6g_ybaxrLeZ';

// Event date — used for EGN age calculation
const EV_DATE = '2026-04-18';

const MAX_PARTICIPANTS = 29; // 29 additional + 1 organizer = 30 total
// ══════════════════════════════════════════════

let adminKey = null;      // set after successful validation
let allRegs = [];
let allParts = [];
let activeFilter = 'all';
let adminUid = 0;
let currentEditId = null;
let currentEditStatus = null;

// ── Boot ──────────────────────────────────────
addEventListener('DOMContentLoaded', () => {
  // Restore from sessionStorage so page refresh doesn't require re-entry.
  // sessionStorage is tab-scoped and never sent to servers or written to disk history.
  const stored = sessionStorage.getItem('adminKey');
  if (stored) {
    validateAndLogin(stored, /* silent= */ true);
    return;
  }
  // Support ?key= for first-time deep-linking (e.g. from a password manager).
  // After validation the key moves to sessionStorage and the param is stripped from the URL.
  const urlKey = new URLSearchParams(location.search).get('key');
  if (urlKey) {
    history.replaceState(null, '', location.pathname); // strip key from URL immediately
    validateAndLogin(urlKey);
  }
});

// ── Auth ──────────────────────────────────────
document.getElementById('gateBtn').addEventListener('click', () => {
  const val = document.getElementById('gatePass').value.trim();
  if (val) validateAndLogin(val);
});

document.getElementById('gatePass').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const val = document.getElementById('gatePass').value.trim();
    if (val) validateAndLogin(val);
  }
});

async function validateAndLogin(key, silent = false) {
  const btn = document.getElementById('gateBtn');
  if (!silent) { btn.disabled = true; btn.textContent = 'Проверява се...'; }

  try {
    const res = await rpc('check_admin_key', { p_key: key });
    if (!res.ok) throw new Error('Грешка при връзка');
    const valid = await res.json();
    if (valid === true) {
      adminKey = key;
      sessionStorage.setItem('adminKey', key); // survive page refresh, not browser history
      document.getElementById('gate').style.display = 'none';
      document.getElementById('adminApp').style.display = '';
      loadAll();
    } else {
      sessionStorage.removeItem('adminKey');
      if (!silent) showGateError('Невалиден ключ.');
    }
  } catch (e) {
    sessionStorage.removeItem('adminKey');
    if (!silent) showGateError('Грешка: ' + e.message);
  } finally {
    if (!silent) { btn.disabled = false; btn.textContent = 'Влез'; }
  }
}

function showGateError(msg) {
  const err = document.getElementById('gateErr');
  err.textContent = msg;
  document.getElementById('gatePass').value = '';
  document.getElementById('gatePass').focus();
  setTimeout(() => { err.textContent = ''; }, 4000);
}

// ── Supabase helpers ──────────────────────────
function sbAnon(method, path, body, extra = {}) {
  const opts = {
    method,
    headers: { 'apikey': SB_ANON_KEY, 'Authorization': `Bearer ${SB_ANON_KEY}`, 'Content-Type': 'application/json', ...extra }
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  return fetch(SB_URL + path, opts);
}

// All write operations go through SECURITY DEFINER RPCs — no service_role key needed.
function rpc(name, params) {
  return fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'apikey': SB_ANON_KEY, 'Authorization': `Bearer ${SB_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

// ── Load all ──────────────────────────────────
async function loadAll() {
  showOverlay(true);
  try {
    const [rRes, pRes] = await Promise.all([
      rpc('admin_get_all_registrations', { p_admin_key: adminKey }),
      rpc('admin_get_all_participants', { p_admin_key: adminKey }),
    ]);
    if (!rRes.ok) throw new Error('Грешка при зареждане на записванията');
    if (!pRes.ok) throw new Error('Грешка при зареждане на участниците');
    allRegs = await rRes.json();
    allParts = await pRes.json();
    renderStats();
    renderList();
  } catch (e) {
    toast('Грешка: ' + e.message, 'error');
  } finally {
    showOverlay(false);
  }
}

document.getElementById('btnRefresh').addEventListener('click', loadAll);

// ── Stats ──────────────────────────────────────
function renderStats() {
  document.getElementById('statTotal').textContent = allRegs.length;
  document.getElementById('statParticipants').textContent = allParts.length;
  document.getElementById('statPending').textContent = allRegs.filter(r => r.status === 'pending').length;
  document.getElementById('statConfirmed').textContent = allRegs.filter(r => r.status === 'confirmed').length;
  document.getElementById('statCancelled').textContent = allRegs.filter(r => r.status === 'cancelled').length;
}

// ── Filter tabs ───────────────────────────────
document.querySelectorAll('.filter-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderList();
  });
});

// ── Render list ───────────────────────────────
function renderList() {
  const filtered = activeFilter === 'all' ? allRegs : allRegs.filter(r => r.status === activeFilter);
  const container = document.getElementById('regList');

  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state">Няма записвания</div>';
    return;
  }

  container.innerHTML = filtered.map(reg => {
    const parts = allParts.filter(p => p.registration_id === reg.id);
    const head = parts.find(p => p.is_head) || parts[0];
    const ref = reg.id.slice(0, 8).toUpperCase();
    const created = new Date(reg.created_at).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short', year: 'numeric' });

    const pillClass = statusPillClass(reg.status);
    const pillText = statusPillText(reg.status);

    const partsHtml = parts.map((p, i) => `
      <tr>
        <td class="pt-num">${i + 1}</td>
        <td class="pt-name">${esc(p.name)}${p.is_head ? ' <span class="head-badge">орг.</span>' : ''}</td>
        <td class="pt-egn">${esc(p.egn)}</td>
        <td class="pt-age">${p.age ?? '—'}</td>
        <td class="pt-phone">${esc(p.phone || '—')}</td>
        <td class="pt-email">${esc(p.email || '—')}</td>
      </tr>`).join('');

    const actionConfirm = reg.status !== 'confirmed'
      ? `<button class="btn-action btn-action-confirm" onclick="setStatus('${reg.id}','confirmed')">✓ Потвърди</button>` : '';
    const actionCancel = reg.status !== 'cancelled'
      ? `<button class="btn-action btn-action-cancel" onclick="setStatus('${reg.id}','cancelled')">✗ Откажи</button>` : '';
    const actionPending = reg.status !== 'pending'
      ? `<button class="btn-action btn-action-pending" onclick="setStatus('${reg.id}','pending')">↺ Изчаква</button>` : '';

    return `
    <div class="reg-card" data-id="${reg.id}" data-status="${reg.status}">
      <div class="reg-card-header" onclick="toggleCard('${reg.id}')">
        <div class="reg-card-left">
          <span class="reg-ref">#${ref}</span>
          <div class="reg-info">
            <strong>${esc(head?.name || '—')}</strong>
            <span class="reg-contact">${esc(head?.email || '')}${head?.phone ? ' · ' + esc(head.phone) : ''}</span>
            ${reg.notes ? `<span class="reg-notes">${esc(reg.notes)}</span>` : ''}
          </div>
        </div>
        <div class="reg-card-right">
          <span class="reg-count">${parts.length} уч.</span>
          <span class="status-pill ${pillClass}">${pillText}</span>
          <span class="reg-date">${created}</span>
          <span class="expand-icon">▼</span>
        </div>
      </div>
      <div class="reg-card-body" id="body-${reg.id}">
        <div class="parts-table-wrap">
          <table class="parts-table">
            <thead>
              <tr><th>#</th><th>Имена</th><th>ЕГН</th><th>Год.</th><th>Телефон</th><th>Имейл</th></tr>
            </thead>
            <tbody>${partsHtml}</tbody>
          </table>
        </div>
        <div class="reg-actions">
          <button class="btn-action btn-action-edit" onclick="openEditModal('${reg.id}')">✏ Редактирай</button>
          ${actionConfirm}
          ${actionCancel}
          ${actionPending}
        </div>
      </div>
    </div>`;
  }).join('');
}

function statusPillClass(status) {
  if (status === 'confirmed') return 'pill-confirmed';
  if (status === 'cancelled') return 'pill-cancelled';
  return 'pill-pending';
}

function statusPillText(status) {
  if (status === 'confirmed') return '✓ потвърдено';
  if (status === 'cancelled') return '✗ отказано';
  return '● изчаква';
}

function toggleCard(id) {
  document.getElementById('body-' + id).closest('.reg-card').classList.toggle('open');
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Set status (via RPC) ──────────────────────
async function setStatus(id, status) {
  showOverlay(true);
  try {
    const res = await rpc('admin_set_status', { p_admin_key: adminKey, p_reg_id: id, p_status: status });
    if (!res.ok) throw new Error((await res.json())?.message || 'Грешка');
    const reg = allRegs.find(r => r.id === id);
    if (reg) reg.status = status;
    renderStats();
    renderList();
    toast('✓ Статусът е обновен.', 'success');
  } catch (e) {
    toast('Грешка: ' + e.message, 'error');
  } finally {
    showOverlay(false);
  }
}

// ── EGN helpers ───────────────────────────────
function egnParse(egn) {
  if (!/^\d{10}$/.test(egn)) return null;
  let yy = +egn.slice(0, 2), mm = +egn.slice(2, 4), dd = +egn.slice(4, 6), yyyy;
  if (mm >= 40) { mm -= 40; yyyy = 2000 + yy; }
  else if (mm >= 20) { mm -= 20; yyyy = 1800 + yy; }
  else { yyyy = 1900 + yy; }
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const d = new Date(yyyy, mm - 1, dd);
  return isNaN(d.getTime()) ? null : d;
}

function egnAge(bd, ref) {
  const r = new Date(ref);
  let a = r.getFullYear() - bd.getFullYear();
  const m = r.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && r.getDate() < bd.getDate())) a--;
  return a;
}

function adminOnEgn(input, ageId, birthId) {
  const bd = egnParse(input.value.trim());
  const el = document.getElementById(ageId);
  if (bd) {
    const a = egnAge(bd, EV_DATE);
    el.value = a + ' г.';
    el.classList.add('has-val');
    if (birthId) document.getElementById(birthId).value = bd.toISOString().slice(0, 10);
    input.closest('.field')?.classList.remove('invalid');
  } else {
    el.value = '';
    el.classList.remove('has-val');
    if (birthId) document.getElementById(birthId).value = '';
  }
}

// ── Participant rows (modal) ──────────────────
const adminPList = document.getElementById('adminPList');

function adminMakeRow(idx) {
  const id = ++adminUid;
  const d = document.createElement('div');
  d.className = 'p-row';
  d.dataset.pid = id;
  d.innerHTML = `
    <div class="p-idx">${idx}</div>
    <div class="p-row-fields">
      <div class="field p-name-f" style="flex: auto">
        <input name="an${id}" placeholder="Три имена" required>
        <span class="err">Задължително</span>
      </div>
      <div class="p-row-field-inline-group">
        <div class="field">
          <input name="ae${id}" placeholder="ЕГН" maxlength="10"
            oninput="adminOnEgn(this,'aa${id}','ab${id}')" required>
          <span class="err">Невалидно</span>
        </div>
        <input id="aa${id}" class="p-age-field" readonly placeholder="Години" style="width:72px;height:37px;flex-shrink:0;">
        <input type="hidden" id="ab${id}">
      </div>
    </div>
    <button type="button" class="p-del-btn" onclick="adminDelRow(${id})">✕</button>`;
  return d;
}

function adminReindex() {
  adminPList.querySelectorAll('.p-row').forEach((r, i) => r.querySelector('.p-idx').textContent = i + 1);
  document.getElementById('adminPCount').textContent = adminPList.children.length;
  document.getElementById('adminBtnAdd').style.display = adminPList.children.length >= MAX_PARTICIPANTS ? 'none' : 'flex';
}

function adminAddRow() {
  if (adminPList.children.length >= MAX_PARTICIPANTS) return null;
  const row = adminMakeRow(adminPList.children.length + 1);
  adminPList.appendChild(row);
  adminReindex();
  return row;
}

function adminDelRow(id) {
  adminPList.querySelector(`[data-pid="${id}"]`)?.remove();
  adminReindex();
}

document.getElementById('adminBtnAdd').addEventListener('click', adminAddRow);

// ── Edit modal ────────────────────────────────
function mval(name) {
  return (document.querySelector(`#editModal [name="${name}"]`)?.value || '').trim();
}

function mset(name, val) {
  const el = document.querySelector(`#editModal [name="${name}"]`);
  if (el) el.value = val || '';
}

function openEditModal(id) {
  const reg = allRegs.find(r => r.id === id);
  const parts = allParts.filter(p => p.registration_id === id);
  const head = parts.find(p => p.is_head);
  const rest = parts.filter(p => !p.is_head);

  currentEditId = id;
  adminPList.innerHTML = '';
  adminUid = 0;

  mset('orgName', head?.name);
  mset('orgPhone', head?.phone);
  mset('orgEmail', head?.email);
  const egnEl = document.querySelector('#editModal [name="orgEgn"]');
  egnEl.value = head?.egn || '';
  adminOnEgn(egnEl, 'modalOrgAgeF', 'modalOrgBirthH');

  mset('notes', reg.notes);

  rest.forEach(p => {
    const row = adminAddRow();
    if (!row) return;
    const pid = row.dataset.pid;
    row.querySelector(`[name="an${pid}"]`).value = p.name || '';
    const pEgnEl = row.querySelector(`[name="ae${pid}"]`);
    pEgnEl.value = p.egn || '';
    adminOnEgn(pEgnEl, `aa${pid}`, `ab${pid}`);
  });

  setActiveStatusBtn(reg.status);

  document.getElementById('modalTitle').textContent = `Редакция — #${id.slice(0, 8).toUpperCase()}`;
  document.getElementById('editModal').style.display = '';
  document.querySelector('#editModal .modal-box').scrollTop = 0;
}

function setActiveStatusBtn(status) {
  currentEditStatus = status;
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === status);
  });
}

document.querySelectorAll('.status-btn').forEach(btn => {
  btn.addEventListener('click', () => setActiveStatusBtn(btn.dataset.status));
});

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalCancelBtn').addEventListener('click', closeModal);

function closeModal() {
  document.getElementById('editModal').style.display = 'none';
  currentEditId = null;
  document.querySelectorAll('#editModal .field.invalid').forEach(f => f.classList.remove('invalid'));
}

// ── Save edit (via RPCs) ──────────────────────
document.getElementById('modalSaveBtn').addEventListener('click', async () => {
  if (!validateModal()) { toast('Провери маркираните полета', 'error'); return; }

  const btn = document.getElementById('modalSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Записва се...';

  try {
    const participants = collectAdminParticipants();

    // 1. Update registration (status + notes) — bypasses 5-day RLS via SECURITY DEFINER
    const regRes = await rpc('admin_update_registration', {
      p_admin_key: adminKey,
      p_reg_id: currentEditId,
      p_status: currentEditStatus,
      p_notes: mval('notes') || null,
    });
    if (!regRes.ok) throw new Error((await regRes.json())?.message || 'Грешка при обновяване');

    // 2. Atomically replace participants
    const partsRes = await rpc('admin_replace_participants', {
      p_admin_key: adminKey,
      p_reg_id: currentEditId,
      p_participants: participants,
    });
    if (!partsRes.ok) throw new Error((await partsRes.json())?.message || 'Грешка при участниците');

    // Update local state
    const regIdx = allRegs.findIndex(r => r.id === currentEditId);
    if (regIdx >= 0) {
      allRegs[regIdx].notes = mval('notes') || null;
      allRegs[regIdx].status = currentEditStatus;
    }
    allParts = allParts.filter(p => p.registration_id !== currentEditId)
      .concat(participants.map(p => ({ ...p, registration_id: currentEditId })));

    renderStats();
    renderList();
    closeModal();
    toast('✓ Промените са запазени!', 'success');
  } catch (e) {
    toast('Грешка: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Запази промените';
  }
});

function collectAdminParticipants() {
  const orgEgn = mval('orgEgn');
  const orgBd = egnParse(orgEgn);
  const rows = [{
    is_head: true,
    name: mval('orgName'),
    egn: orgEgn,
    birth_date: orgBd ? orgBd.toISOString().slice(0, 10) : null,
    age: orgBd ? egnAge(orgBd, EV_DATE) : null,
    phone: mval('orgPhone'),
    email: mval('orgEmail'),
  }];
  adminPList.querySelectorAll('.p-row').forEach(row => {
    const pid = row.dataset.pid;
    const egn = row.querySelector(`[name="ae${pid}"]`).value.trim();
    const bd = egnParse(egn);
    rows.push({
      is_head: false,
      name: row.querySelector(`[name="an${pid}"]`).value.trim(),
      egn,
      birth_date: bd ? bd.toISOString().slice(0, 10) : null,
      age: bd ? egnAge(bd, EV_DATE) : null,
      phone: null,
      email: null,
    });
  });
  return rows;
}

function validateModal() {
  let ok = true;
  document.querySelectorAll('#editModal .field.invalid').forEach(f => f.classList.remove('invalid'));

  ['orgName', 'orgPhone', 'orgEmail'].forEach(n => {
    const el = document.querySelector(`#editModal [name="${n}"]`);
    if (!el.value.trim()) { el.closest('.field').classList.add('invalid'); ok = false; }
  });

  const em = document.querySelector('#editModal [name="orgEmail"]');
  if (em.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.value)) {
    em.closest('.field').classList.add('invalid'); ok = false;
  }

  const orgEgnEl = document.querySelector('#editModal [name="orgEgn"]');
  if (!egnParse(orgEgnEl.value.trim())) { orgEgnEl.closest('.field').classList.add('invalid'); ok = false; }

  adminPList.querySelectorAll('.p-row').forEach(row => {
    const pid = row.dataset.pid;
    const nm = row.querySelector(`[name="an${pid}"]`);
    const eg = row.querySelector(`[name="ae${pid}"]`);
    if (!nm.value.trim()) { nm.closest('.field').classList.add('invalid'); ok = false; }
    if (!egnParse(eg.value.trim())) { eg.closest('.field').classList.add('invalid'); ok = false; }
  });

  return ok;
}

// ── Helpers ───────────────────────────────────
function showOverlay(show) {
  document.getElementById('overlay').classList.toggle('show', show);
}

function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => { t.className = ''; }, 4500);
}
