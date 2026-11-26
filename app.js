/* TESR Track Count — UI */
import { itemsToLines, parseDocument, groupParcels } from './parser.js';
import { QC_URL, session, login, logout, toOrders, pushOrders, packedStatus } from './sync.js';

export const APP_VERSION = 'v1.2';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38';
let pdfjsLib = null;
async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(`${PDFJS}/legacy/build/pdf.min.mjs`);
  pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/legacy/build/pdf.worker.min.mjs`;
  return pdfjsLib;
}

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  files: [],              // {id,name,size,status,pages,err}
  sort: 'tracking',
  overrides: new Map(),   // tracking -> qty ที่แก้เอง
  packed: new Set(),      // tracking ที่ติ๊กแพ็คแล้ว
  editing: new Set(),
  products: [], parcels: [], warnings: [],
  qc: {},                 // tracking -> {at,tagger,url,result} จากระบบ QC (อัดหลักฐานแล้ว)
};
let seq = 0;

/* ---------- อ่าน PDF ---------- */
async function readPdf(f) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await f.arrayBuffer());
  const doc = await lib.getDocument({
    data, cMapUrl: `${PDFJS}/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${PDFJS}/standard_fonts/`,
  }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const tc = await pg.getTextContent();
    pages.push({ file: f.name, page: i, lines: itemsToLines(tc.items) });
    pg.cleanup();
  }
  await doc.destroy();
  return pages;
}

async function addFiles(list) {
  const pdfs = [...list].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!pdfs.length) { toast('รองรับเฉพาะไฟล์ PDF'); return; }
  for (const f of pdfs) {
    if (state.files.some(x => x.name === f.name && x.size === f.size)) { toast(`ไฟล์ ${f.name} ถูกเพิ่มไปแล้ว`); continue; }
    const rec = { id: ++seq, name: f.name, size: f.size, status: 'busy', pages: [] };
    state.files.push(rec);
    renderFiles();
    try {
      rec.pages = await readPdf(f);
      rec.status = 'ok';
    } catch (e) {
      console.error(e);
      rec.status = 'err';
      rec.err = /password/i.test(e?.name || e?.message) ? 'ไฟล์มีรหัสผ่าน' : 'เปิดไฟล์ไม่ได้';
    }
    renderFiles();
    analyse();
  }
}

/* ---------- วิเคราะห์ ---------- */
function analyse() {
  const pages = state.files.filter(f => f.status === 'ok').flatMap(f => f.pages);
  const { parcels, warnings } = parseDocument(pages, { customPattern: $('customRe').value.trim() || null });
  for (const p of parcels) {
    if (state.overrides.has(p.tracking)) p.qty = state.overrides.get(p.tracking);
  }
  state.parcels = parcels;
  state.warnings = warnings;
  state.products = groupParcels(parcels, state.sort);
  render();
  scheduleSync();
}

/* ---------- Render ---------- */
function renderFiles() {
  $('files').innerHTML = state.files.map(f => `
    <span class="chip ${f.status === 'busy' ? 'busy' : ''}">
      ${f.status === 'busy' ? '<span class="spin"></span>' : f.status === 'err' ? '⚠️' : '📄'}
      <span class="n" title="${esc(f.name)}">${esc(f.name)}</span>
      <span class="m">${f.status === 'busy' ? 'กำลังอ่าน…' : f.status === 'err' ? esc(f.err) : f.pages.length + ' หน้า'}</span>
      <button data-rm="${f.id}" aria-label="ลบไฟล์">✕</button>
    </span>`).join('');
  $('drop').classList.toggle('compact', state.files.length > 0);
}

function unitOf(g, p) { return p?.unit || g.unit || 'ชิ้น'; }

function render() {
  const has = state.parcels.length > 0;
  $('results').classList.toggle('show', has || state.warnings.length > 0);
  const units = state.parcels.reduce((a, b) => a + b.qty, 0);
  const unsure = state.parcels.filter(p => !p.sure && !state.overrides.has(p.tracking)).length;
  const groupsN = state.products.reduce((a, g) => a + g.groups.length, 0);
  const mainUnit = state.products[0]?.unit || 'ชิ้น';
  $('sParcels').innerHTML = `${state.parcels.length}<small>กล่อง</small>`;
  $('sUnits').innerHTML = `${units}<small>${state.products.length > 1 ? 'ชิ้น' : esc(mainUnit)}</small>`;
  $('sGroups').innerHTML = `${groupsN}<small>กลุ่ม</small>`;
  $('sCheck').textContent = unsure;
  $('sCheckBox').classList.toggle('w', unsure > 0);

  const okFiles = state.files.filter(f => f.status === 'ok').map(f => f.name.replace(/\.pdf$/i, ''));
  $('heroSub').textContent = okFiles.length ? `จากไฟล์ ${okFiles.join(', ')}` : 'วางใบปะหน้าพัสดุ ระบบจะแยก Tracking ตามจำนวนสินค้าในแต่ละกล่องให้ทันที';

  // warnings
  const w = state.warnings;
  $('warns').classList.toggle('show', w.length > 0);
  $('warns').innerHTML = w.length ? `<b>⚠️ มี ${w.length} รายการที่ควรตรวจ</b><ul>${w.slice(0, 12).map(x => `<li>${esc(x.file)} · หน้า ${x.page} — ${esc(x.msg)}</li>`).join('')}${w.length > 12 ? `<li>…และอีก ${w.length - 12} รายการ</li>` : ''}</ul>` : '';

  const multi = state.products.length > 1;
  $('out').innerHTML = state.products.map((g, gi) => `
    <section class="product">
      <h2>${g.groups.some(q => q.parcels.some(p => p.items.length > 1)) ? '<span class="mixtag">📦 หลายสินค้าในกล่องเดียว</span> ' : ''}${esc(g.name)} <span class="tag">${g.totalParcels} กล่อง · ${g.totalUnits} ${esc(g.unit)}</span></h2>
      <div class="groups">
        ${g.groups.map((q, qi) => `
          <article class="grp">
            <div class="grp-h">
              <div class="qty"><div><b>${q.qty}</b><i>${esc(q.unit)}</i></div></div>
              <div class="ti">
                <div class="a"><svg width="18" height="18" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#1f9d55"/><path d="m6.5 12.5 3.5 3.5 7.5-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>${q.qty} ${esc(q.unit)} — ${q.parcels.length} ออเดอร์</div>
                <div class="b">รวม ${q.qty * q.parcels.length} ${esc(q.unit)}${multi ? ' · ' + esc(g.name) : ''}</div>
              </div>
              <button class="icon-btn" data-copy="${gi}:${qi}" title="คัดลอกเลข Tracking กลุ่มนี้">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>คัดลอก
              </button>
            </div>
            <table>
              <thead><tr><th class="no">ลำดับ</th><th>Tracking</th><th class="q">จำนวน</th></tr></thead>
              <tbody>
                ${q.parcels.map((p, i) => row(p, i, q)).join('')}
              </tbody>
            </table>
            <div class="grp-f"><span>แพ็คแล้ว ${q.parcels.filter(p => isPacked(p.tracking)).length}/${q.parcels.length}</span><span>${q.parcels.length} กล่อง × ${q.qty} ${esc(q.unit)}</span></div>
          </article>`).join('')}
      </div>
    </section>`).join('');

  if (state.editing.size) {
    const inp = document.querySelector('.qin[data-focus]');
    if (inp) { inp.focus(); inp.select(); }
  }
}

function row(p, i, q) {
  const unsure = !p.sure && !state.overrides.has(p.tracking);
  const edit = unsure || state.editing.has(p.tracking);
  const sub = [p.recipient, `หน้า ${p.page}`].filter(Boolean).join(' · ');
  const qtyCell = edit
    ? `<input class="qin" type="number" min="0" inputmode="numeric" value="${p.qty}" data-qty="${esc(p.tracking)}" ${state.editing.has(p.tracking) ? 'data-focus' : ''} title="แก้จำนวน">${unsure ? ' <span class="qb unsure" title="อ่านจำนวนจาก PDF ไม่ได้ — ตรวจด้วยตา">?</span>' : ''}`
    : `<span class="qb" data-edit="${esc(p.tracking)}" title="แตะเพื่อแก้จำนวน">✓ ${p.qty} ${esc(p.unit || q.unit)}</span>`;
  const qc = state.qc[p.tracking];
  const qcTag = qc ? ` <a class="qcb" href="${esc(qc.url || QC_URL)}" target="_blank" rel="noopener" title="มีหลักฐานในระบบ QC — ${esc(qc.tagger || '')}">🎥 ${esc(hhmm(qc.at))}</a>` : '';
  return `<tr class="${isPacked(p.tracking) ? 'packed' : ''}" data-pack="${esc(p.tracking)}" title="${esc(p.product)}${p.order ? ' · Order ' + esc(p.order) : ''}">
    <td class="no">${i + 1}</td>
    <td class="tk mono"><span class="tick"><svg width="11" height="11" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>${esc(p.tracking)}${qcTag}<span class="sub">${esc(sub)}</span>${p.items.length > 1 ? `<span class="mix">📦 ${p.items.length} รายการในกล่องนี้:${p.items.map(x => `<i>${x.qty} ${esc(x.unit || 'ชิ้น')} · ${esc(x.name)}</i>`).join('')}</span>` : ''}</td>
    <td class="q">${qtyCell}</td>
  </tr>`;
}

/* ---------- Export ---------- */
function summaryText() {
  const lines = [];
  const files = state.files.filter(f => f.status === 'ok').map(f => f.name.replace(/\.pdf$/i, ''));
  if (files.length) lines.push(`📦 ${files.join(', ')}`);
  const multi = state.products.length > 1;
  for (const g of state.products) {
    lines.push('');
    if (multi || g.name) lines.push(`🔹 ${g.name}`);
    for (const q of g.groups) {
      lines.push(`✅ ${q.qty} ${q.unit} — ${q.parcels.length} ออเดอร์`);
      q.parcels.forEach((p, i) => lines.push(`${i + 1}. ${p.tracking}`));
      lines.push('');
    }
    lines.push(`รวม ${g.totalParcels} กล่อง · ${g.totalUnits} ${g.unit}`);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function downloadCsv() {
  const head = ['สินค้า', 'กลุ่มจำนวน', 'ลำดับ', 'Tracking', 'จำนวน', 'หน่วย', 'ผู้รับ', 'เลขคำสั่งซื้อ', 'COD', 'แพ็คแล้ว', 'ไฟล์', 'หน้า'];
  const rows = [head];
  for (const g of state.products) for (const q of g.groups) q.parcels.forEach((p, i) =>
    rows.push([g.name, `${q.qty} ${q.unit}`, i + 1, p.tracking, p.qty, p.unit || q.unit, p.recipient, p.order, p.cod, isPacked(p.tracking) ? (state.qc[p.tracking] ? 'อัดหลักฐานแล้ว' : 'ใช่') : '', p.file, p.page]));
  const csv = '﻿' + rows.map(r => r.map(v => {
    v = String(v ?? '');
    if (/^\d{10,}$/.test(v)) v = `="${v}"`; // กัน Excel แปลงเลขยาวเป็น 1.78E+12
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',')).join('\r\n');
  const name = (state.files.find(f => f.status === 'ok')?.name || 'tracking').replace(/\.pdf$/i, '');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name} - tracking count.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  toast(msg || 'คัดลอกแล้ว');
}

let tt;
function toast(s) {
  const el = $('toast');
  el.textContent = s; el.classList.add('show');
  clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------- Events ---------- */
$('file').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('fpd').classList.add('show'); $('drop').classList.add('over'); });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('fpd').classList.remove('show'); $('drop').classList.remove('over'); } });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0;
  $('fpd').classList.remove('show'); $('drop').classList.remove('over');
  addFiles(e.dataTransfer.files);
});

$('files').addEventListener('click', e => {
  const b = e.target.closest('[data-rm]'); if (!b) return;
  state.files = state.files.filter(f => f.id !== +b.dataset.rm);
  renderFiles(); analyse();
});

$('out').addEventListener('click', e => {
  const c = e.target.closest('[data-copy]');
  if (c) {
    const [gi, qi] = c.dataset.copy.split(':').map(Number);
    const q = state.products[gi].groups[qi];
    copy(q.parcels.map(p => p.tracking).join('\n'), `คัดลอก ${q.parcels.length} เลข (${q.qty} ${q.unit}) แล้ว`);
    c.classList.add('done'); setTimeout(() => c.classList.remove('done'), 1200);
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) { e.stopPropagation(); state.editing.add(ed.dataset.edit); render(); return; }
  if (e.target.closest('.qin')) return;
  const r = e.target.closest('[data-pack]');
  if (r) {
    const t = r.dataset.pack;
    state.packed.has(t) ? state.packed.delete(t) : state.packed.add(t);
    render();
  }
});

function commitQty(inp) {
  const t = inp.dataset.qty;
  const n = Math.max(0, parseInt(inp.value, 10));
  state.editing.delete(t);
  if (Number.isFinite(n)) state.overrides.set(t, n);
  analyse();
}
$('out').addEventListener('change', e => { if (e.target.matches('.qin')) commitQty(e.target); });
$('out').addEventListener('keydown', e => {
  if (!e.target.matches('.qin')) return;
  if (e.key === 'Enter') e.target.blur();
  if (e.key === 'Escape') { state.editing.delete(e.target.dataset.qty); render(); }
});
$('out').addEventListener('focusout', e => {
  if (e.target.matches('.qin') && state.editing.has(e.target.dataset.qty)) setTimeout(() => { if (state.editing.has(e.target.dataset.qty)) { state.editing.delete(e.target.dataset.qty); render(); } }, 120);
});

$('copyAll').addEventListener('click', () => copy(summaryText(), 'คัดลอกสรุปทั้งหมดแล้ว — วางใน LINE ได้เลย'));
$('csv').addEventListener('click', downloadCsv);
$('print').addEventListener('click', () => window.print());
$('clear').addEventListener('click', () => {
  state.files = []; state.overrides.clear(); state.packed.clear(); state.editing.clear(); state.qc = {}; lastSent = '';
  renderFiles(); analyse();
});
document.querySelectorAll('.seg [data-sort]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.seg [data-sort]').forEach(x => x.classList.toggle('on', x === b));
  state.sort = b.dataset.sort; analyse();
}));
let reT;
$('customRe').addEventListener('input', () => { clearTimeout(reT); reT = setTimeout(analyse, 350); });

/* ---------- Sync กับสถานีแพ็ค (TESR Logistics QC) ---------- */
function isPacked(t) { return state.packed.has(t) || !!state.qc[t]; }
function hhmm(iso) { const d = new Date(iso); return isNaN(d) ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
let syncT = 0, lastSent = '', pollT = 0;
function setSync(cls, html) { const el = $('sync'); el.className = 'sync ' + cls; el.innerHTML = html; }
function renderAuth() {
  const s = session();
  $('who').textContent = s ? (s.name || s.email) : '';
  $('logoutBtn').hidden = !s;
  $('loginBox').hidden = !!s;
  if (!s) setSync('warn', 'ยังไม่ได้เข้าสู่ระบบ — ออเดอร์จะยังไม่ถูกส่งให้สถานีแพ็ค');
}
function scheduleSync() { clearTimeout(syncT); if (state.parcels.length) syncT = setTimeout(syncNow, 900); }
async function syncNow() {
  if (!state.parcels.length) return;
  if (!session()) { renderAuth(); return; }
  const orders = toOrders(state.parcels, state.overrides);
  const sig = JSON.stringify(orders.map(o => [o.tracking, o.qty, o.unit, o.items]));
  try {
    if (sig !== lastSent) {
      setSync('busy', '<span class="spin"></span> กำลังส่งออเดอร์เข้าระบบแพ็ค…');
      const r = await pushOrders(orders); lastSent = sig;
      toast(`ส่งเข้าระบบแพ็คแล้ว ${orders.length} ออเดอร์`);
      void r;
    }
    await refreshStatus();
  } catch (e) {
    if (e.auth) { renderAuth(); setSync('err', 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่แล้วจะส่งให้อัตโนมัติ'); return; }
    setSync('err', `ส่งไม่สำเร็จ: ${esc(e.message)} <button class="linkb" id="retrySync">ลองใหม่</button>`);
    $('retrySync').onclick = syncNow;
  }
}
async function refreshStatus() {
  if (!state.parcels.length || !session()) return;
  const st = await packedStatus(state.parcels.map(p => p.tracking));
  state.qc = st; render();
  const done = state.parcels.filter(p => st[p.tracking]).length;
  const d = new Date();
  setSync('ok', `☁ ส่งเข้าระบบแพ็คแล้ว <b>${state.parcels.length}</b> ออเดอร์ · อัดหลักฐานแล้ว <b>${done}</b>/${state.parcels.length} · อัปเดต ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · <a href="${QC_URL}" target="_blank" rel="noopener">เปิดสถานีแพ็ค</a>`);
  clearTimeout(pollT); pollT = setTimeout(() => { if (document.visibilityState === 'visible') refreshStatus().catch(() => {}); else pollT = setTimeout(refreshStatus, 30000); }, 30000);
}
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const b = $('loginGo'); b.disabled = true; $('loginErr').textContent = '';
  try { await login($('lgEmail').value, $('lgPhone').value); $('lgPhone').value = ''; renderAuth(); toast('เข้าสู่ระบบแล้ว'); syncNow(); }
  catch (err) { $('loginErr').textContent = err.message; }
  finally { b.disabled = false; }
});
$('logoutBtn').addEventListener('click', () => { logout(); renderAuth(); });
window.addEventListener('storage', e => { if (e.key === 'tl:session') { renderAuth(); if (session()) syncNow(); } });   // login ในแท็บ QC → ใช้ได้ทันที
try { $('lgEmail').value = JSON.parse(localStorage.getItem('tl:lastEmail') || '""'); } catch {}
$('ver').textContent = APP_VERSION; document.title = `TESR Track Count ${APP_VERSION} — อ่านเลขพัสดุ & นับจำนวนจาก PDF`;
renderAuth();

// โหลด pdf.js ล่วงหน้าเพื่อให้เปิดไฟล์แรกเร็วขึ้น
(window.requestIdleCallback || setTimeout)(() => loadPdfJs().catch(() => {}));
