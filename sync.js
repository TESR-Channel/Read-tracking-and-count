/* TESR Track Count — ส่งออเดอร์เข้าระบบ TESR Logistics QC (สถานีแพ็ค) + ดึงสถานะว่าแพ็ค/อัดหลักฐานแล้วหรือยัง
   ใช้ session เดียวกับ https://tesr-channel.github.io/Logistic-tracking-and-evidence/ (โดเมนเดียวกัน → login ครั้งเดียวใช้ได้ทั้งสองโปรแกรม) */
export const QC_URL = 'https://tesr-channel.github.io/Logistic-tracking-and-evidence/';
const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwCh3teWYeVpXZH6Z5xZHNQZABv2iyq-Ag8YIvsixjDyJTGbYodo_Vgb6nKgUfa4dMa/exec';
const LS = {
  get(k, d) { try { const v = localStorage.getItem('tl:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tl:' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('tl:' + k); } catch {} },
};
export const session = () => { const s = LS.get('session', null); return s && s.token && !s.demo ? s : null; };
const endpoint = () => LS.get('endpoint', '') || DEFAULT_ENDPOINT;

async function call(action, body = {}) {
  const s = session();
  const res = await fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action }, body, s ? { token: s.token } : {})) });
  let j; try { j = JSON.parse(await res.text()); } catch { throw new Error('ระบบหลังบ้านตอบกลับผิดรูปแบบ'); }
  if (!j.ok) { const e = new Error(String(j.error || 'error').replace(/^AUTH:\s*/, '')); e.auth = !!j.auth; if (e.auth) LS.del('session'); throw e; }
  return j;
}
export async function login(email, phone) {
  const j = await call('login', { method: 'password', email: String(email).trim(), password: phone });
  LS.set('session', { token: j.token, email: j.email, role: j.role, name: j.name || '', config: j.config, demo: false });
  LS.set('lastEmail', j.email);
  return j;
}
export function logout() { LS.del('session'); }

/* parcels from parser → orders payload (เลขพัสดุ จำนวน สินค้า เลขคำสั่งซื้อ — ไม่ส่งชื่อ/ที่อยู่/เบอร์ผู้รับ) */
export function toOrders(parcels, overrides) {
  return parcels.map(p => {
    const over = overrides.has(p.tracking);
    return { tracking: p.tracking, qty: p.qty, unit: p.unit || '', sure: !!(p.sure || over), order: p.order || '', file: p.file, page: p.page,
      items: (p.items && p.items.length ? p.items : [{ name: p.product, qty: p.qty, unit: p.unit }])
        .map(i => ({ name: i.name, qty: (over && p.items.length === 1) ? p.qty : i.qty, unit: i.unit || p.unit || '' })) };
  });
}
export async function pushOrders(orders) {
  let added = 0, updated = 0;
  for (let i = 0; i < orders.length; i += 300) { const j = await call('ordersPut', { orders: orders.slice(i, i + 300) }); added += j.added; updated += j.updated; }
  return { added, updated };
}
export async function packedStatus(trackings) {
  const out = {};
  for (let i = 0; i < trackings.length; i += 1500) Object.assign(out, (await call('orders', { trackings: trackings.slice(i, i + 1500) })).status || {});
  return out;
}
