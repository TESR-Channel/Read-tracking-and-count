/* ==========================================================
   TESR Track Count — parser
   อ่านข้อความจากใบปะหน้าพัสดุ (PDF) → เลขพัสดุ + จำนวนสินค้า
   ใช้ได้ทั้งในเบราว์เซอร์และ Node (ไม่มี dependency)
   ========================================================== */

/* หน่วยนับที่ใช้ตรวจจำนวน เช่น (2ตัว) (1 ชิ้น) (3 ชุด) */
export const UNIT_WORDS = [
  'ตัว','ชิ้น','ชุด','อัน','เครื่อง','กล่อง','แพ็ค','แพ็ก','แพค','ถุง','ขวด',
  'คู่','ม้วน','แผ่น','เส้น','ลูก','ใบ','ด้าม','หลอด','โคม','แผง','pcs','pc','units','unit','sets','set','ea'
];
const UNIT_RE = UNIT_WORDS.join('|');

/* รูปแบบเลขพัสดุที่รองรับ */
export const TRACKING_PATTERNS = [
  { name: 'ไปรษณีย์ไทย / EMS', re: /\b[A-Z]{2}\d{9}[A-Z]{2}\b/g },
  { name: 'Flash / SPX / Kerry / Lazada / Ninja', re: /\b(?:TH|SPX|SPXTH|KER|KEX|KBK|LEX|LZD|NJV|NV|BEST|JT)[A-Z0-9]{8,18}\b/g },
];
/* ป้ายกำกับที่มักอยู่หน้าเลขพัสดุ (ใช้เป็นตัวช่วยกรณีรูปแบบไม่ตรงด้านบน) */
const LABELLED_TRACKING = /(?:tracking\s*(?:no\.?|number|#)?|เลขพัสดุ|หมายเลขพัสดุ|เลขที่พัสดุ|เลขติดตาม(?:พัสดุ)?)\s*[:：#]?\s*([A-Z0-9]{8,24})/gi;

const ITEM_LABEL = /(รายการสินค้า|รายละเอียดสินค้า|ชื่อสินค้า|สินค้า|product(?:s|\s*name)?|items?|description|contents?|sku)\s*[:：]\s*/i;
/* หัวตาราง เช่น "ชื่อสินค้า   SKU   จำนวน" / "Product Name ... Qty" (ไม่มีโคลอน) */
const TABLE_HEAD = /^\s*(?:ลำดับ\s+|no\.?\s+|#\s+)?(?:รายการสินค้า|ชื่อสินค้า|รายการ|สินค้า|product(?:\s*name)?|item(?:\s*name)?|description)\b.*\b(?:จำนวน|qty|quantity|amount)\b/i;
const LABELS = 'โทร|เบอร์|ผู้รับ|ชื่อผู้รับ|ผู้ส่ง|ชื่อผู้ส่ง|COD|เก็บเงิน|วันที่|เลขที่|หมายเหตุ|ที่อยู่|น้ำหนัก|ราคา|ยอด|ชำระ|รวม|สั่งซื้อ|คำสั่งซื้อ|ขนส่ง|บริการ|ค่าส่ง|ค่าจัดส่ง|ส่วนลด|ผู้ขาย|ร้านค้า|ลงชื่อ|tracking|order|ref|from|to|ship\\s*to|sender|recipient|buyer|seller|date|remark|note|weight|price|total|subtotal|shipping|payment|tel|phone|page';
/* หัวข้อฟิลด์ถัดไป — ต้องอยู่ "ต้นบรรทัด" เท่านั้น
   (ไม่จับคำกลางบรรทัด: ชื่อสินค้าอย่าง "ดัมเบลยกน้ำหนัก" ต้องไม่ถูกตัดเป็นฟิลด์น้ำหนัก) */
const STOP_FIELD = new RegExp('^\\s*(?:' + LABELS + ')(?:[^\\s:：]{0,20}\\s*[:：]|\\s*[:：.]|\\s|$)', 'i');
// บรรทัดที่มีวันที่ (เช่น 27/11/2026) ไม่ใช่ชื่อสินค้า
const DATE_RE = /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/;
const PHONE_RE = /(?:^|[^\d])0\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}(?!\d)/;
const ADDR_RE = /(?:^|\s)(?:ต\.|อ\.|จ\.|แขวง|เขต|จังหวัด|ตำบล|อำเภอ)\S|\b\d{5}\s*$/;
const NOISE_RE = /^[\d\s]{8,}$|^\s*(?:หน้า|page)\s*\d+|^\s*[-_=*.]{4,}\s*$/i;
/* เครื่องหมายจำนวนท้ายรายการ: (2)  x2  ×2  *2  Qty 2  จำนวน 2  2 ชิ้น */
const QTY_END = new RegExp('(?:\\(\\s*[x×]?\\s*\\d{1,4}\\s*\\)|\\[\\s*[x×]\\s*\\d{1,4}\\s*\\]|(?:^|\\s)[x×*]\\s*\\d{1,4}|(?:qty|quantity|จำนวน)\\s*[:：]?\\s*\\d{1,4}(?:\\s*(?:' + UNIT_RE + '))?|\\d{1,4}\\s*(?:' + UNIT_RE + ')\\.?)\\s*$', 'i');
/* ยอดรวมจำนวนชิ้นบนใบปะหน้า (ใช้ตรวจทาน) */
const TOTAL_RE = new RegExp('(?:จำนวน(?:สินค้า)?(?:ทั้งหมด|รวม)|รวม(?:ทั้งหมด)?|total\\s*(?:qty|quantity|items?)|(?:qty|quantity)\\s*total|items?\\s*total)\\s*[:：]?\\s*(\\d{1,4})\\s*(?:' + UNIT_RE + '|รายการ)?(?![\\d.,])', 'i');
const TABLE_QTY = /\s{3,}\d{1,4}\s*$/;
const BULLET = /^\s*(?:\d{1,2}\s*[.)]|[-•*·▪●○])\s+/;

/* ---------- 1) pdf.js text items → บรรทัด ---------- */
export function itemsToLines(items) {
  const pts = [];
  for (const it of items) {
    if (!it || typeof it.str !== 'string' || it.str.trim() === '') continue;
    const t = it.transform || [1, 0, 0, 1, 0, 0];
    pts.push({ s: it.str, x: t[4], y: t[5], w: it.width || 0, h: Math.abs(t[3]) || it.height || 8 });
  }
  pts.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const p of pts) {
    let L = null;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 4; i--) {
      const l = lines[i];
      if (Math.abs(l.y - p.y) <= Math.max(1.5, Math.min(l.h, p.h) * 0.45)) { L = l; break; }
    }
    if (!L) { L = { y: p.y, h: p.h, parts: [] }; lines.push(L); }
    L.parts.push(p);
  }
  return lines.map(l => {
    l.parts.sort((a, b) => a.x - b.x);
    let out = '', end = null;
    for (const p of l.parts) {
      if (end !== null) {
        const gap = p.x - end;
        if (gap > p.h * 0.22 && !/\s$/.test(out) && !/^\s/.test(p.s)) out += gap > p.h * 2.5 ? '   ' : ' ';
      }
      out += p.s;
      end = p.x + p.w;
    }
    return out.replace(/\s+$/, '');
  });
}

/* ---------- 2) หาเลขพัสดุในบรรทัด ---------- */
export function findTrackings(line, extraRe) {
  const found = [];
  const up = line.toUpperCase();
  const pats = TRACKING_PATTERNS.map(p => p.re);
  if (extraRe) pats.unshift(extraRe);
  for (const re of pats) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(up))) {
      const code = m[0];
      if ((code.match(/\d/g) || []).length < 6) continue;
      if (!found.includes(code)) found.push(code);
    }
  }
  if (!found.length) {
    LABELLED_TRACKING.lastIndex = 0;
    let m;
    while ((m = LABELLED_TRACKING.exec(line))) {
      const code = m[1].toUpperCase();
      if (/\d/.test(code) && /[A-Z]/.test(code) && !found.includes(code)) found.push(code);
    }
  }
  return found;
}

/* ---------- 3) แยกจำนวนจากชื่อสินค้า 1 รายการ ---------- */
export function parseProduct(raw) {
  let s = raw.replace(/\s+/g, ' ').trim().replace(BULLET, '');
  let unitQty = null, unit = null, mult = null, m;

  // ตัวคูณท้ายรายการ: (1)  (x2)  [x2]  x2  ×2  *2  Qty: 2  จำนวน 2 (ชิ้น)  หรือคอลัมน์จำนวนในตาราง
  const tails = [
    /\(\s*[x×]?\s*(\d{1,4})\s*\)\s*$/i,
    /\[\s*[x×]\s*(\d{1,4})\s*\]\s*$/i,
    /(?:\s|^)[x×*]\s*(\d{1,4})\s*$/i,
    new RegExp('(?:qty|quantity|จำนวน)\\s*[:：]?\\s*(\\d{1,4})\\s*(?:(' + UNIT_RE + ')\\.?)?\\s*$', 'i'),
    /\s{3,}(\d{1,4})\s*$/,                       // ตาราง: คอลัมน์จำนวนท้ายบรรทัด
  ];
  for (const re of tails) {
    if ((m = s.match(re))) { mult = +m[1]; if (m[2]) unit = m[2]; s = s.slice(0, m.index).trim(); break; }
  }

  // จำนวนต่อชุดในวงเล็บ เช่น (2ตัว) (1 ชิ้น) — คูณกับตัวคูณ
  const inParen = new RegExp('\\(\\s*(\\d{1,4})\\s*(' + UNIT_RE + ')[^)]*\\)', 'gi');
  let last = null;
  while ((m = inParen.exec(s))) last = m;
  if (last) {
    unitQty = +last[1]; unit = last[2];
    s = (s.slice(0, last.index) + s.slice(last.index + last[0].length)).trim();
  } else {
    // "2 ตัว" ท้ายชื่อ = จำนวน (ใช้เมื่อไม่มีตัวคูณอื่น — ถ้ามีตัวคูณแล้ว ถือเป็นคำบรรยาย เช่น "ชุดไขควง 3 ชิ้น(1)")
    const loose = new RegExp('(\\d{1,4})\\s*(' + UNIT_RE + ')(?![ก-๙a-z])\\.?\\s*$', 'i');
    if (mult === null && (m = s.match(loose))) { unitQty = +m[1]; unit = m[2]; s = s.slice(0, m.index).trim(); }
  }

  const sure = unitQty !== null || mult !== null;
  const qty = Math.max(1, (unitQty ?? 1) * (mult ?? 1));
  const name = s.replace(/[\s,;:\-–|]+$/, '').replace(/\(\s*\)/g, '').trim() || 'สินค้า';
  return { raw: raw.trim(), name, qty, unit: unit ? normUnit(unit) : null, sure };
}

/* แถวตาราง: คอลัมน์คั่นด้วยช่องว่างยาว — ชื่อสินค้า | SKU | ... | จำนวน */
function parseTableRow(raw) {
  const cols = raw.trim().replace(BULLET, '').split(/\s{3,}|\t|\s\|\s/).map(c => c.trim()).filter(Boolean);
  const lastCol = cols[cols.length - 1] || '';
  if (cols.length >= 2 && /^\d{1,4}$/.test(lastCol)) {
    const qty = +lastCol;
    const nameCols = cols.slice(0, -1).filter((c, k) => k === 0 || !/^[A-Z0-9][A-Z0-9\-_./]*$/i.test(c));
    const nameCols2 = nameCols.filter((c, k) => !(k > 0 && /^[\d.,฿]+$/.test(c)));   // ตัดคอลัมน์ราคา
    return { raw: raw.trim(), name: nameCols2.join(' · ') || 'สินค้า', qty: Math.max(1, qty), unit: null, sure: qty > 0 };
  }
  return parseProduct(raw);
}

function normUnit(u) {
  u = u.toLowerCase();
  if (['pcs', 'pc', 'ea', 'unit', 'units'].includes(u)) return 'ชิ้น';
  if (['set', 'sets'].includes(u)) return 'ชุด';
  if (['แพ็ก', 'แพค'].includes(u)) return 'แพ็ค';
  return u;
}

/* แยกหลายสินค้าในพัสดุเดียว: ตัดหลังวงเล็บตัวเลข (n) ที่ตามด้วย , ; หรือข้อความใหม่ */
export function splitProducts(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  // ตัดหลัง (n) ที่ตามด้วยข้อความใหม่ หรือหลัง xN / N ชิ้น ที่ตามด้วย , ;
  const parts = t
    .split(/(?<=\(\s*[x×]?\s*\d{1,4}\s*\))\s*[,;、]?\s*(?=\S)/i)
    .flatMap(p => p.split(new RegExp('(?<=(?:[x×]\\s*\\d{1,4}|\\d{1,4}\\s*(?:' + UNIT_RE + ')))\\s*[,;、]\\s*(?=\\S)', 'i')));
  return parts.map(p => p.replace(/^[,;\s]+|[,;\s]+$/g, '')).filter(Boolean);
}

/* ---------- 4) อ่านข้อมูลจาก 1 ใบปะหน้า ---------- */
function extractFields(lines) {
  const out = { items: [], recipient: '', order: '', cod: '' };
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!out.recipient) {
      const m = L.match(/^\s*(?:ผู้รับ|ชื่อผู้รับ|to|ship to)\s*[:：]?\s*(.+)$/i);
      if (m) out.recipient = m[1].replace(/\s*(?:โทร|tel\b|phone\b|เบอร์).*$/i, '').replace(/\(?\+?\d[\d\s\-]{7,}\)?/g, '').replace(/\s+/g, ' ').trim();
    }
    if (!out.order) {
      const m = L.match(/(?:เลขที่คำสั่งซื้อ|คำสั่งซื้อ|order\s*(?:no\.?|id|number|#)?)\s*[:：#]?\s*([A-Z0-9\-]{5,})/i);
      if (m) out.order = m[1];
    }
    if (!out.cod) {
      const m = L.match(/COD\s*[:：]?\s*([\d,\.]+)/i);
      if (m) out.cod = m[1];
    }
    if (!out.items.length && !out._itemsDone) {
      const im = L.match(ITEM_LABEL);
      const table = !im && TABLE_HEAD.test(L);
      if (im || table) {
        out._itemsDone = true;
        const r = readItems(lines, i, im ? L.slice(im.index + im[0].length) : '', table);
        out.items = r.items; out._block = r.end;
      }
    }
    if (!out.total) {
      const m = L.match(TOTAL_RE);
      if (m && !/(?:บาท|฿|thb|cod)/i.test(L)) out.total = +m[1];
    }
  }
  // ตรวจทานกับยอดรวมบนใบปะหน้า
  if (out.total) {
    const sum = out.items.reduce((a, b) => a + b.qty, 0);
    if (!out.items.length) out.items = [{ raw: '', name: 'สินค้า', qty: out.total, unit: null, sure: true }];
    else if (sum !== out.total) out.items.forEach(x => { x.sure = false; });
    else out.items.forEach(x => { x.sure = true; });
  }
  delete out._itemsDone; delete out._block;
  return out;
}

/* อ่านบล็อกรายการสินค้า: ต่อบรรทัดที่ถูกตัด, แยกรายการตามเลขลำดับ/จำนวน, หยุดที่ฟิลด์ถัดไป */
const isJunk = nx => !nx.trim() || STOP_FIELD.test(nx) || TOTAL_RE.test(nx) || DATE_RE.test(nx) || PHONE_RE.test(nx) || ADDR_RE.test(nx) || NOISE_RE.test(nx) || findTrackings(nx).length > 0;
const openEnd = t => /[,，+;&]\s*$/.test(t) || /\band\s*$/i.test(t);

function readItems(lines, i, first, table) {
  const entries = [];
  let cur = first.trim();
  const push = () => { if (cur.trim()) entries.push(cur.trim()); cur = ''; };
  let j = i + 1, cut = false;
  for (; j < lines.length && j <= i + 15; j++) {
    const nx = lines[j];
    if (!nx.trim()) { if (cur && !openEnd(cur)) break; continue; }
    if (findTrackings(nx).length) break;
    if (isJunk(nx) && !openEnd(cur)) break;
    if (table && TABLE_HEAD.test(nx)) continue;
    const t = nx.trim();
    if (BULLET.test(t)) { push(); cur = t; continue; }               // 1. / 2) / - / •  = รายการใหม่
    if (!cur) { cur = t; continue; }
    if (table) { if (TABLE_QTY.test(cur) || QTY_END.test(cur)) { push(); cur = t; } else cur += ' ' + t; continue; }
    if (openEnd(cur)) { cur += ' ' + t; continue; }                  // บรรทัดก่อนลงท้าย , = ยังไม่จบ
    if (QTY_END.test(t)) { if (QTY_END.test(cur)) { push(); cur = t; } else cur += ' ' + t; continue; }
    if (!QTY_END.test(cur)) { cur += ' ' + t; continue; }            // ชื่อยาวถูกตัดขึ้นบรรทัดใหม่
    break;                                                           // รายการจบแล้ว + บรรทัดไม่ใช่สินค้า
  }
  if (openEnd(cur)) cut = true;
  push();
  const items = [];
  for (const e of entries) {
    for (const part of (table ? [e] : splitProducts(e))) {
      const it = table ? parseTableRow(part) : parseProduct(part);
      if (!it.name || it.name === 'สินค้า' && !it.sure) continue;
      if (STOP_FIELD.test(it.name) || DATE_RE.test(it.name)) continue;
      items.push(it);
    }
  }
  // รายการลงท้ายด้วย , แต่ไม่มีบรรทัดต่อ = อาจอ่านไม่ครบ → ให้คนตรวจ
  if (cut) items.forEach(x => { x.sure = false; });
  return { items, end: j };
}

/* ---------- 5) ทั้งเอกสาร: pages = [{ file, page, lines:[...] }] ---------- */
export function parseDocument(pages, opts = {}) {
  const parcels = [];
  const warnings = [];
  const extraRe = opts.customPattern ? safeRegex(opts.customPattern) : null;

  for (const pg of pages) {
    const hits = [];
    pg.lines.forEach((line, idx) => {
      for (const code of findTrackings(line, extraRe)) {
        if (!hits.some(h => h.code === code)) hits.push({ code, idx });
      }
    });
    if (!hits.length) {
      if (pg.lines.join('').trim() === '') warnings.push({ type: 'scan', file: pg.file, page: pg.page, msg: 'หน้านี้ไม่มีข้อความ (อาจเป็นไฟล์สแกน/รูปภาพ)' });
      else warnings.push({ type: 'notrack', file: pg.file, page: pg.page, msg: 'ไม่พบเลขพัสดุในหน้านี้' });
      continue;
    }
    hits.sort((a, b) => a.idx - b.idx);
    hits.forEach((h, k) => {
      const from = k === 0 ? 0 : h.idx;
      const to = k + 1 < hits.length ? hits[k + 1].idx : pg.lines.length;
      const seg = pg.lines.slice(from, to);
      const f = extractFields(seg);
      const qty = f.items.length ? f.items.reduce((a, b) => a + b.qty, 0) : 1;
      const sure = f.items.length > 0 && f.items.every(x => x.sure);
      parcels.push({
        tracking: h.code, file: pg.file, page: pg.page, seq: parcels.length,
        items: f.items, qty, autoQty: qty, sure,
        unit: (f.items.find(x => x.unit) || {}).unit || null,
        product: f.items.length ? f.items.map(x => x.name).join(' + ') : '(ไม่พบชื่อสินค้า)',
        recipient: f.recipient, order: f.order, cod: f.cod,
      });
    });
  }

  // ตัดเลขซ้ำ (เช่น อัปโหลดไฟล์ซ้ำ)
  const seen = new Map();
  const unique = [];
  for (const p of parcels) {
    if (seen.has(p.tracking)) {
      warnings.push({ type: 'dup', file: p.file, page: p.page, msg: `เลข ${p.tracking} ซ้ำกับ ${seen.get(p.tracking).file} หน้า ${seen.get(p.tracking).page} — นับครั้งเดียว` });
      continue;
    }
    seen.set(p.tracking, p);
    unique.push(p);
  }
  return { parcels: unique, warnings };
}

function safeRegex(src) {
  try { return new RegExp(src, 'g'); } catch { return null; }
}

/* ---------- 6) จัดกลุ่ม: สินค้า → จำนวน ---------- */
export function groupParcels(parcels, sortBy = 'tracking') {
  const byProduct = new Map();
  for (const p of parcels) {
    const key = p.product.replace(/\s+/g, '').toLowerCase();
    if (!byProduct.has(key)) byProduct.set(key, { name: p.product, parcels: [] });
    byProduct.get(key).parcels.push(p);
  }
  const products = [...byProduct.values()].map(g => {
    const byQty = new Map();
    for (const p of g.parcels) {
      if (!byQty.has(p.qty)) byQty.set(p.qty, []);
      byQty.get(p.qty).push(p);
    }
    const groups = [...byQty.entries()].sort((a, b) => a[0] - b[0]).map(([qty, list]) => {
      list.sort(sortBy === 'tracking' ? (a, b) => a.tracking.localeCompare(b.tracking) : (a, b) => a.seq - b.seq);
      const unit = mostCommon(list.map(x => x.unit).filter(Boolean)) || 'ชิ้น';
      return { qty, unit, parcels: list };
    });
    const unit = mostCommon(g.parcels.map(x => x.unit).filter(Boolean)) || 'ชิ้น';
    return { name: g.name, unit, groups, totalParcels: g.parcels.length, totalUnits: g.parcels.reduce((a, b) => a + b.qty, 0) };
  });
  products.sort((a, b) => b.totalParcels - a.totalParcels);
  return products;
}

function mostCommon(arr) {
  const c = {};
  let best = null;
  for (const x of arr) { c[x] = (c[x] || 0) + 1; if (!best || c[x] > c[best]) best = x; }
  return best;
}
