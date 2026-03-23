// ══════════════════════════════════════════════
// Supabase
const SB_URL = 'https://swgzevzmvznuwlfcuzde.supabase.co';
const SB_KEY = 'sb_publishable_lWvvvC4styQAak6jqmXk6g_ybaxrLeZ';

// EmailJS  ← fill in after creating account at emailjs.com
const EJS_PUBLIC_KEY = 'FV8LtsF3pGNr_6Jqo';          // Account → API Keys
const EJS_SERVICE_ID = 'srv-spasiteli.na.pohod';    // Email Services → Service ID
const EJS_TEMPLATE_ID = 'tmp-event.reg.confirm';          // Email Templates → Template ID

// Event
const EV_NAME = 'Благотворителен исторически поход „По стъпките на Караджов"';
const EV_DATE = '2026-04-18';                 // YYYY-MM-DD
const EV_DEADLINE_BEFORE_DUE_IN_DAYS = 5;                
// ══════════════════════════════════════════════

emailjs.init(EJS_PUBLIC_KEY);

const MAX = 29; // 29 additional + 1 organizer = 30 total
let uid = 0, editToken = null, editId = null;

// ── Boot ──────────────────────────────────────
addEventListener('DOMContentLoaded', async () => {
  document.getElementById('evName').textContent = EV_NAME;
  document.getElementById('evDate').textContent = fmt(EV_DATE);
  const token = new URLSearchParams(location.search).get('token');
  if (token) { editToken = token; await loadReg(token); }
});

// ── EGN ───────────────────────────────────────
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
  const r = new Date(ref); let a = r.getFullYear() - bd.getFullYear();
  const m = r.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && r.getDate() < bd.getDate())) a--;
  return a;
}

function onEgn(input, ageId, birthId) {
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

// ── Participant row ───────────────────────────
function makeRow(idx) {
  const id = ++uid;
  const d = document.createElement('div');
  d.className = 'p-row';
  d.dataset.pid = id;
  d.innerHTML = `
      <div class="p-idx">${idx}</div>

      <div class="p-row-fields">
          <div class="field p-name-f" style="flex: auto">
            <input name="n${id}" placeholder="Три имена" required>
            <span class="err">Задължително</span>
          </div>

          <div class="p-row-field-inline-group">
            <div class="field">
              <input name="e${id}" placeholder="ЕГН" maxlength="10"
                oninput="onEgn(this,'a${id}','b${id}')" required>
              <span class="err">Невалидно</span>
            </div>

            <input id="a${id}" 
                  class="p-age-field" 
                  readonly 
                  placeholder="Години" 
                  style="width:72px;height:37px;flex-shrink:0;">

            <input type="hidden" id="b${id}">
          </div>

      </div>

      <button type="button" class="p-del-btn" onclick="delRow(${id})">✕</button>
    `;
  return d;
}

const pList = document.getElementById('pList');

function reindex() {
  pList.querySelectorAll('.p-row').forEach((r, i) => r.querySelector('.p-idx').textContent = i + 1);
  const n = pList.children.length;
  document.getElementById('pCount').textContent = n;
  document.getElementById('btnAdd').style.display = n >= MAX ? 'none' : 'flex';
}

function addRow() {
  if (pList.children.length >= MAX) return null;
  const row = makeRow(pList.children.length + 1);
  pList.appendChild(row); reindex(); return row;
}

function delRow(id) {
  pList.querySelector(`[data-pid="${id}"]`)?.remove(); reindex();
}

document.getElementById('btnAdd').addEventListener('click', addRow);

// ── Collect ───────────────────────────────────
function collectParticipants() {
  const rows = [];
  const orgEgn = v('orgEgn'), orgBd = egnParse(orgEgn);
  rows.push({
    is_head: true,
    name: v('orgName'),
    egn: orgEgn,
    birth_date: orgBd ? orgBd.toISOString().slice(0, 10) : null,
    age: orgBd ? egnAge(orgBd, EV_DATE) : null,
    phone: v('orgPhone'),
    email: v('orgEmail'),
  });
  pList.querySelectorAll('.p-row').forEach(row => {
    const pid = row.dataset.pid;
    const egn = row.querySelector(`[name=e${pid}]`).value.trim();
    const bd = egnParse(egn);
    rows.push({
      is_head: false,
      name: row.querySelector(`[name=n${pid}]`).value.trim(),
      egn,
      birth_date: bd ? bd.toISOString().slice(0, 10) : null,
      age: bd ? egnAge(bd, EV_DATE) : null,
      phone: null,
      email: null,
    });
  });
  return rows;
}

function v(name) { return (document.querySelector(`[name=${name}]`)?.value || '').trim(); }

// ── Validate ──────────────────────────────────
function validate() {
  let ok = true;
  document.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
  document.querySelectorAll('.decl.invalid').forEach(d => d.classList.remove('invalid'));

  ['orgName', 'orgPhone', 'orgEmail'].forEach(n => {
    const el = document.querySelector(`[name=${n}]`);
    if (!el.value.trim()) { el.closest('.field').classList.add('invalid'); ok = false; }
  });
  const em = document.querySelector('[name=orgEmail]');
  if (em.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.value)) {
    em.closest('.field').classList.add('invalid'); ok = false;
  }
  const orgEgnEl = document.querySelector('[name=orgEgn]');
  if (!egnParse(orgEgnEl.value.trim())) { orgEgnEl.closest('.field').classList.add('invalid'); ok = false; }

  pList.querySelectorAll('.p-row').forEach(row => {
    const pid = row.dataset.pid;
    const nm = row.querySelector(`[name=n${pid}]`);
    const eg = row.querySelector(`[name=e${pid}]`);
    if (!nm.value.trim()) { nm.closest('.field').classList.add('invalid'); ok = false; }
    if (!egnParse(eg.value.trim())) { eg.closest('.field').classList.add('invalid'); ok = false; }
  });

  if (!document.getElementById('dInsurance').checked) {
    document.getElementById('dInsuranceEl').classList.add('invalid'); ok = false;
  }
  if (!document.getElementById('dTerms').checked) {
    document.getElementById('dTermsEl').classList.add('invalid'); ok = false;
  }

  return ok;
}

// ── Submit ────────────────────────────────────
document.getElementById('form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!validate()) { toast('Провери маркираните полета', 'error'); return; }
  const btn = document.getElementById('btnSubmit');
  btn.disabled = true; btn.textContent = 'Записва се...';
  try {
    if (editToken) {
      await doUpdate();
      toast('✓ Промените са запазени!', 'success');
      btn.textContent = '✓ Запазено!';
      setTimeout(() => { btn.disabled = false; btn.textContent = '💾 Запази промените'; }, 2500);
    } else {
      await doInsert();
    }
  } catch (err) {
    console.error(err);
    toast('Грешка: ' + (err.message || 'опитай отново'), 'error');
    btn.disabled = false;
    btn.textContent = editToken ? '💾 Запази промените' : 'Изпрати записването';
  }
});

// ── Insert ────────────────────────────────────
async function doInsert() {
  const regRes = await sb('POST', '/rest/v1/registrations',
    { event: EV_NAME, event_date: EV_DATE, status: 'pending', notes: v('notes') || null },
    { 'Prefer': 'return=representation' });
  if (!regRes.ok) throw new Error((await regRes.json()).message);
  const [reg] = await regRes.json();
  const parts = collectParticipants().map(p => ({ ...p, registration_id: reg.id }));
  const pRes = await sb('POST', '/rest/v1/participants', parts);
  if (!pRes.ok) throw new Error('Грешка при запис на участниците');

  await sendConfirmationEmail(reg, parts);

  toast(`✓ Записани ${parts.length} участник${parts.length !== 1 ? 'а' : ''}! Провери имейла.`, 'success');
  document.getElementById('btnSubmit').textContent = '✓ Записано!';
  document.getElementById('form').reset();
  pList.innerHTML = ''; uid = 0;
}

// ── EmailJS send ──────────────────────────────
async function sendConfirmationEmail(reg, parts) {
  const head = parts.find(p => p.is_head);
  const total = parts.length;
  const evFmt = fmt(reg.event_date);
  const editUrl = `${location.origin}${location.pathname}?token=${reg.edit_token}`;
  const deadlineDate = new Date(reg.event_date); 
  deadlineDate.setDate(deadlineDate.getDate() - EV_DEADLINE_BEFORE_DUE_IN_DAYS);
  const editDeadline = fmt(deadlineDate.toISOString().slice(0, 10));
  const refId = reg.id.slice(0, 8).toUpperCase();
  const totalLabel = total !== 1 ? 'участника' : 'участник';

  const participantRows = parts.map((p, i) => `
    <tr style="border-bottom:1px solid #e8e5de;">
      <td style="padding:8px 12px;color:#9ba89a;font-size:11px;">${i + 1}</td>
      <td style="padding:8px 12px;font-weight:${p.is_head ? '600' : '400'};font-size:13px;color:#1a1f17;">
        ${p.name}${p.is_head ? ' <span style="color:#3a6b3a;font-size:10px;letter-spacing:.05em;text-transform:uppercase;">(орг.)</span>' : ''}
      </td>
      <td style="padding:8px 12px;font-family:monospace;font-size:11px;color:#6b7468;">${p.egn}</td>
      <td style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7468;">${p.age ?? '—'}</td>
    </tr>`).join('');

  await emailjs.send(EJS_SERVICE_ID, EJS_TEMPLATE_ID, {
    to_email: head.email,
    to_name: head.name,
    event: EV_NAME,
    event_date: evFmt,
    total: total,
    total_label: totalLabel,
    ref_id: refId,
    edit_url: editUrl,
    edit_deadline: editDeadline,
    participants_rows: participantRows,
  });
}

// ── Update ────────────────────────────────────
async function doUpdate() {
  const parts = collectParticipants();
  const res = await sb('POST', '/rest/v1/rpc/update_registration_by_token',
    { p_token: editToken, p_notes: v('notes') || null, p_participants: parts });
  if (!res.ok) throw new Error((await res.json()).message);
}

// ── Confirm ───────────────────────────────────
async function confirmReg() {
  const btn = document.getElementById('btnConfirm');
  btn.disabled = true; btn.textContent = 'Потвърждава се...';
  try {
    const res = await sb('POST', '/rest/v1/rpc/set_registration_status_by_token',
      { p_token: editToken, p_status: 'confirmed' });
    if (!res.ok) throw new Error((await res.json()).message);
    btn.textContent = '✓ Потвърдено!';
    document.getElementById('statusPill').className = 'status-pill pill-confirmed';
    document.getElementById('statusPill').textContent = '✓ потвърдено';
    document.getElementById('btnCancel')?.remove();
    toast('✓ Участието е потвърдено!', 'success');
  } catch (e) {
    toast('Грешка при потвърждаване: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = '✓ Потвърди участието';
  }
}

// ── Cancel ────────────────────────────────────
async function cancelReg() {
  if (!confirm('Сигурен/а ли си, че искаш да откажеш участието?')) return;
  const btn = document.getElementById('btnCancel');
  btn.disabled = true; btn.textContent = 'Отказва се...';
  try {
    const res = await sb('POST', '/rest/v1/rpc/set_registration_status_by_token',
      { p_token: editToken, p_status: 'cancelled' });
    if (!res.ok) throw new Error((await res.json()).message);
    btn.textContent = '✗ Отказано';
    document.getElementById('statusPill').className = 'status-pill pill-cancelled';
    document.getElementById('statusPill').textContent = '✗ отказано';
    document.getElementById('btnConfirm')?.remove();
    document.getElementById('btnSubmit').disabled = true;
    toast('Участието е отказано.', 'error');
  } catch (e) {
    toast('Грешка при отказване: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = '✗ Откажи участието';
  }
}

// ── Load for edit ─────────────────────────────
async function loadReg(token) {
  document.getElementById('overlay').classList.add('show');
  try {
    const res = await sb('POST', '/rest/v1/rpc/get_registration_by_token', { p_token: token });
    if (!res.ok) throw new Error('Грешка при зареждане');
    const rows = await res.json();
    if (!rows.length) throw new Error('Невалиден линк.');
    const reg = rows[0];
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + 5);
    if (new Date(reg.event_date) <= cutoff)
      throw new Error('Линкът е изтекъл.');
    editId = reg.id;
    const pRes = await sb('POST', '/rest/v1/rpc/get_participants_by_token', { p_token: token });
    if (!pRes.ok) throw new Error('Грешка при зареждане на участниците');
    const parts = await pRes.json();
    fillForm(parts, reg);
    showEditBanner(reg);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    document.getElementById('overlay').classList.remove('show');
  }
}

function fillForm(parts, reg) {
  const head = parts.find(p => p.is_head);
  const rest = parts.filter(p => !p.is_head);
  if (head) {
    set('orgName', head.name); set('orgPhone', head.phone); set('orgEmail', head.email);
    const egnEl = document.querySelector('[name=orgEgn]');
    egnEl.value = head.egn || ''; onEgn(egnEl, 'orgAgeF', 'orgBirthH');
  }
  if (reg?.notes) { const el = document.querySelector('[name=notes]'); if (el) el.value = reg.notes; }
  rest.forEach(p => {
    const row = addRow(); if (!row) return;
    const pid = row.dataset.pid;
    row.querySelector(`[name=n${pid}]`).value = p.name || '';
    const egnEl = row.querySelector(`[name=e${pid}]`);
    egnEl.value = p.egn || ''; onEgn(egnEl, `a${pid}`, `b${pid}`);
  });
}

function showEditBanner(reg) {
  document.getElementById('heroSub').textContent = 'Редакция на записване';
  document.getElementById('editBanner').classList.add('show');
  const deadline = new Date(reg.event_date); deadline.setDate(deadline.getDate() - 5);
  document.getElementById('editDetail').textContent = `Редакцията е възможна до ${fmt(deadline.toISOString().slice(0, 10))}.`;
  if (reg.status === 'confirmed') {
    document.getElementById('statusPill').className = 'status-pill pill-confirmed';
    document.getElementById('statusPill').textContent = '✓ потвърдено';
  } else if (reg.status === 'cancelled') {
    document.getElementById('statusPill').className = 'status-pill pill-cancelled';
    document.getElementById('statusPill').textContent = '✗ отказано';
  }
  const isPending = reg.status === 'pending';
  const isCancelled = reg.status === 'cancelled';
  document.getElementById('saveArea').innerHTML = `<button type="submit" class="btn-submit" id="btnSubmit" ${isCancelled ? 'disabled' : ''}>💾 Запази промените</button>`;
  document.getElementById('confirmCancelArea').innerHTML = `
    ${isPending
      ? `<button type="button" class="btn-confirm" id="btnConfirm" onclick="confirmReg()">✓ Потвърди участието</button>`
      : ''}
    ${!isCancelled
      ? `<button type="button" class="btn-cancel" id="btnCancel" onclick="cancelReg()">✗ Откажи участието</button>`
      : ''}`;
}

// ── Helpers ───────────────────────────────────
function sb(method, path, body, extra = {}) {
  const opts = { method, headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY} `, 'Content-Type': 'application/json', ...extra } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  return fetch(SB_URL + path, opts);
}
function set(name, val) { const el = document.querySelector(`[name = ${name}]`); if (el) el.value = val || ''; }
function fmt(iso) { return new Date(iso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' }); }
function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `show ${type}`;
  setTimeout(() => t.className = '', 4500);
}
