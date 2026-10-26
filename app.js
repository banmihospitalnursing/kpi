/* =====================================================================
 * KPI กลุ่มการพยาบาล — Firebase Realtime Database + Google Sign-in
 * โครงสร้างข้อมูล (Realtime Database)
 *   meta/wards/{wid}      {name, group, order}
 *   meta/dims/d{key}      {key, name, order}
 *   meta/kpis/{KPI_ID}    {name, dim, mult, target, dir, unit, num, den, allWards, wards:{wid:true}, defN, defD, note, order}
 *   results/y{ปี}/{wid}/m01..m12/{KPI_ID}   {n, d, v, by, email, at}      (m01 = ต.ค. … m12 = ก.ย.)
 *   log/y{ปี}/{pushId}    {ts, action, by, email, wid, ward, month, kpiId, kpiName, n, d, v, old}
 *   users/{email แทน . ด้วย ,}  {email, name, role: admin|editor|viewer, allWards, wards:{wid:true}}
 * ===================================================================== */

/* ================= Utilities ================= */
const CFG = window.KPI_CONFIG || { firebase: {}, superAdmins: [] };
const $ = id => document.getElementById(id);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MONTHS = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];
const MK = MONTHS.map((_, i) => 'm' + String(i + 1).padStart(2, '0'));
const M2K = Object.fromEntries(MONTHS.map((m, i) => [m, MK[i]]));
const K2M = Object.fromEntries(MK.map((k, i) => [k, MONTHS[i]]));
const STATUS = { pass: 'ผ่านเกณฑ์', fail: 'ไม่ผ่านเกณฑ์', wait: 'ยังไม่บันทึก', none: 'ไม่มีเกณฑ์' };
const COLORS = { pass: '#0f8b8d', fail: '#ef4444', wait: '#f59e0b', none: '#94a3b8' };
const TS = { '.sv': 'timestamp' };            // เวลาจากเซิร์ฟเวอร์ Firebase
/** แก้ข้อมูลพื้นฐาน (meta) + ประทับเวลา meta/_sync ให้สคริปต์ซิงก์ในชีตรู้ว่าต้องดึงค่าใหม่ */
const metaCommit = u => BE.commit(Object.assign({}, u, { 'meta/_sync': { at: TS, by: USER ? USER.email : '', source: 'web' } }));
const SUPER = (CFG.superAdmins || []).map(e => String(e).toLowerCase().trim());
const ICON = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>'
};

const fmt = v => v === '' || v == null || isNaN(v) ? '—' : (Math.round(v * 100) / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const toNum = s => { s = String(s ?? '').replace(/,/g, '').trim(); return s === '' ? '' : Number(s); };
const byNum = (a, b) => ((+a) - (+b)) || String(a).localeCompare(String(b), 'th');
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const ekey = e => String(e || '').toLowerCase().trim().replace(/\./g, ',');
const fmtTs = ms => ms ? new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
function fyNow() { const d = new Date(); return String(d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0)); }
function lastMonth() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return { year: String(d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0)), month: MONTHS[(d.getMonth() + 3) % 12] }; }
const store = { get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const okKey = s => !!s && !/[.#$\[\]\/]/.test(s);

function loading(on, txt) { $('loader').classList.toggle('hide', !on); if (txt) $('loaderTxt').textContent = txt; }
function toast(t, err) { const el = $('toast'); el.textContent = t; el.className = 'toast show' + (err ? ' err' : ''); clearTimeout(el._t); el._t = setTimeout(() => el.className = 'toast', 3800); }
function errMsg(e) {
  const s = String((e && (e.code || e.message)) || e);
  if (/PERMISSION_DENIED|permission/i.test(s)) return 'ไม่มีสิทธิ์ทำรายการนี้ (ตรวจสิทธิ์ผู้ใช้ หรือกฎฐานข้อมูล)';
  if (/popup-closed|cancelled-popup/.test(s)) return 'ยกเลิกการเข้าสู่ระบบ';
  if (/unauthorized-domain/.test(s)) return 'โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase Authentication → Settings → Authorized domains';
  if (/network/i.test(s)) return 'เชื่อมต่ออินเทอร์เน็ตไม่ได้';
  return (e && e.message) || s;
}
function loadScript(src) {
  return new Promise((res, rej) => { if ([...document.scripts].some(s => s.src === src)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลดไลบรารีไม่สำเร็จ: ' + src)); document.head.appendChild(s); });
}
const loadXLSX = () => window.XLSX ? Promise.resolve() : loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

function parseTarget(t, dir) {
  t = norm(t); dir = norm(dir); if (!t) return null;
  const n = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number); if (!n.length) return null;
  const s = dir ? dir + ' ' + t : t;
  if (n.length >= 2 && /\d\s*[-–—]\s*\d/.test(t)) return { op: 'between', v: n[0], v2: n[1] };
  if (/มากกว่าหรือเท่ากับ|ไม่น้อยกว่า|≥|>=|สูงกว่าหรือเท่ากับ/.test(s)) return { op: '>=', v: n[0] };
  if (/น้อยกว่าหรือเท่ากับ|ไม่เกิน|ไม่มากกว่า|≤|<=|ต่ำกว่าหรือเท่ากับ/.test(s)) return { op: '<=', v: n[0] };
  if (/มากกว่า|สูงกว่า|>/.test(s)) return { op: '>', v: n[0] };
  if (/น้อยกว่า|ต่ำกว่า|</.test(s)) return { op: '<', v: n[0] };
  if (n[0] === 0) return { op: '<=', v: 0 };
  return { op: '>=', v: n[0] };
}
const OPTXT = { '>=': '≥', '<=': '≤', '>': '>', '<': '<' };
const tgtText = t => !t ? 'ไม่มีเกณฑ์ (ไม่ประเมินผ่าน/ไม่ผ่าน)' : t.op === 'between' ? `ผ่านเมื่อผลอยู่ระหว่าง ${t.v} – ${t.v2}` : `ผ่านเมื่อผล ${OPTXT[t.op]} ${t.v}`;
function statusOf(k, v) {
  if (v === '' || v == null || isNaN(v)) return 'wait';
  const t = k && k.tgt; if (!t) return 'none';
  v = Math.round(v * 100) / 100;
  const ok = t.op === 'between' ? (v >= t.v && v <= t.v2) : t.op === '<=' ? v <= t.v : t.op === '<' ? v < t.v : t.op === '>' ? v > t.v : v >= t.v;
  return ok ? 'pass' : 'fail';
}

/* ================= Backends ================= */
let BE = null;

/** โหมดตัวอย่าง: ฐานข้อมูลจำลองในหน่วยความจำ ใช้ API เดียวกับ Firebase */
function makeDemo(seed) {
  const tree = seed, watchers = new Set(); let seq = 0;
  const getP = p => p.split('/').filter(Boolean).reduce((o, k) => o == null ? undefined : o[k], tree);
  const setP = (p, v) => {
    const ks = p.split('/').filter(Boolean); let o = tree;
    ks.slice(0, -1).forEach(k => { if (typeof o[k] !== 'object' || o[k] == null) o[k] = {}; o = o[k]; });
    if (v == null) delete o[ks.at(-1)]; else o[ks.at(-1)] = v;
  };
  const resolveTS = v => v && typeof v === 'object' ? (v['.sv'] === 'timestamp' ? Date.now() : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveTS(x)]))) : v;
  const emit = w => { let v = clone(getP(w.p)); if (w.opt && w.opt.last && v) { const ks = Object.keys(v).sort().slice(-w.opt.last); v = Object.fromEntries(ks.map(k => [k, v[k]])); } w.cb(v ?? null); };
  return {
    demo: true,
    onAuth(cb) { setTimeout(() => cb({ uid: 'demo', email: SUPER[0] || 'admin@demo', displayName: 'ผู้ดูแล (ตัวอย่าง)', emailVerified: true }), 50); },
    async signIn() { }, async signOut() { location.reload(); },
    watch(p, cb, opt) { const w = { p, cb, opt }; watchers.add(w); setTimeout(() => emit(w), 0); return () => watchers.delete(w); },
    async commit(u) { await sleep(250); Object.entries(u).forEach(([p, v]) => setP(p, resolveTS(clone(v)))); watchers.forEach(emit); },
    newKey() { return 'L' + String(Date.now()).padStart(15, '0') + String(seq++).padStart(5, '0'); }
  };
}

/** Firebase จริง (โหลด SDK จาก gstatic) */
async function makeFirebase(cfg) {
  const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const [{ initializeApp }, A, D] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-database.js')]);
  const app = initializeApp(cfg), auth = A.getAuth(app), db = D.getDatabase(app);
  D.onValue(D.ref(db, '.info/connected'), s => $('live').classList.toggle('off', s.val() !== true));
  A.getRedirectResult(auth).catch(e => toast(errMsg(e), true));
  return {
    onAuth: cb => A.onAuthStateChanged(auth, cb),
    async signIn() {
      const p = new A.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
      try { await A.signInWithPopup(auth, p); }
      catch (e) { if (/popup-blocked|operation-not-supported/.test(e.code || '')) await A.signInWithRedirect(auth, p); else throw e; }
    },
    signOut: () => A.signOut(auth),
    watch(p, cb, opt) {
      const r = opt && opt.last ? D.query(D.ref(db, p), D.limitToLast(opt.last)) : D.ref(db, p);
      return D.onValue(r, s => cb(s.val()), e => { console.error(p, e); if (opt && opt.onError) opt.onError(e); else toast(errMsg(e), true); });
    },
    commit: u => D.update(D.ref(db), u),
    newKey: p => D.push(D.ref(db, p)).key
  };
}

/* ================= State ================= */
let USER = null, PROFILE = null, ROLE = '', STARTED = false;
let RAW = { meta: null, results: null, log: null, users: null };
let S = { wards: [], groups: [], dims: {}, kpis: [], results: [] };
let YEAR = fyNow();
let RIDX = {}, WARD = {}, KPI = {}, selGroup = '', selWard = '', statusFilter = 'all', chMain, chDonut, chTrend;
let VIEW = 'dash', lMode = 'rec', lShown = 100, SEL = new Set(), DEL_ITEMS = [], eDirty = 0;
const UNSUB = {};

const isAdmin = () => ROLE === 'admin';
const canEditAny = () => ROLE === 'admin' || ROLE === 'editor';
const canEditWard = w => ROLE === 'admin' || (ROLE === 'editor' && PROFILE && (PROFILE.allWards || (PROFILE.wards && PROFILE.wards[w])));
const editableWards = () => S.wards.filter(w => canEditWard(w.id)).map(w => w.id);

/* ---------- meta → S ---------- */
function buildMeta(m) {
  m = m || {};
  const wards = Object.entries(m.wards || {}).map(([id, w]) => ({ id, name: norm(w.name) || id, group: norm(w.group) || 'อื่น ๆ', order: +w.order || 0 }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'th'));
  WARD = Object.fromEntries(wards.map(w => [w.id, w]));
  const groups = []; wards.forEach(w => { if (!groups.includes(w.group)) groups.push(w.group); });
  const dims = {}; Object.values(m.dims || {}).sort((a, b) => (+a.order || 0) - (+b.order || 0) || byNum(a.key, b.key)).forEach(d => dims[String(d.key)] = d.name || ('มิติที่ ' + d.key));
  const all = wards.map(w => w.id);
  const kpis = Object.entries(m.kpis || {}).map(([id, k]) => {
    const unit = norm(k.unit), mult = k.mult === '' || k.mult == null || isNaN(+k.mult) ? (unit === 'ร้อยละ' ? 100 : 1) : +k.mult;
    const dim = String(k.dim ?? '0'); if (!dims[dim]) dims[dim] = dim === '0' ? 'ไม่ระบุมิติ' : 'มิติที่ ' + dim;
    return { id, name: k.name || id, dim, mult, multRaw: k.mult ?? '', target: k.target || '', dir: k.dir || '', unit, num: k.num || '', den: k.den || '',
      allWards: !!k.allWards, wardSet: k.wards || {}, wards: k.allWards ? all.slice() : Object.keys(k.wards || {}).filter(w => WARD[w]),
      defN: k.defN || '', defD: k.defD || '', note: k.note || '', order: +k.order || 0, mode: k.den ? 'ratio' : 'value', tgt: parseTarget(k.target, k.dir) };
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  KPI = Object.fromEntries(kpis.map(k => [k.id, k]));
  Object.assign(S, { wards, groups, dims, kpis });
  if (selWard && !WARD[selWard]) selWard = '';
  if (selGroup && !groups.includes(selGroup)) selGroup = '';
}
/* ---------- results → S.results + RIDX ---------- */
function buildResults(r) {
  const out = []; RIDX = {};
  Object.entries(r || {}).forEach(([wid, byM]) => Object.entries(byM || {}).forEach(([mk, byK]) => Object.entries(byK || {}).forEach(([id, x]) => {
    const rec = { wid, mk, month: K2M[mk], id, n: x.n ?? '', d: x.d ?? '', v: x.v ?? '', by: x.by || '', email: x.email || '', ts: x.at || 0, at: fmtTs(x.at) };
    out.push(rec); (RIDX[wid + '|' + id] ??= {})[rec.month] = rec;
  })));
  S.results = out;
  SEL.forEach(k => { if (!out.some(r => recKey(r) === k)) SEL.delete(k); });
}
const recKey = r => [r.wid, r.mk, r.id].join('|');
const kpisForWard = w => S.kpis.filter(k => k.wards.includes(w));
const wardsInGroup = (g, list) => (list ? S.wards.filter(w => list.includes(w.id)) : S.wards).filter(w => !g || w.group === g).map(w => w.id);
const wname = w => WARD[w] ? WARD[w].name : '(หน่วยงานที่ถูกลบ)';
const dimName = d => S.dims[d] || ('มิติที่ ' + d);
const dimShort = d => 'มิติ ' + d;

/* ---------- data subscriptions ---------- */
function watchYear() {
  UNSUB.res && UNSUB.res(); UNSUB.log && UNSUB.log(); UNSUB.log = null; RAW.log = null;
  UNSUB.res = BE.watch('results/y' + YEAR, v => { RAW.results = v; buildResults(v); onData('results'); });
  if (VIEW === 'log' && lMode === 'hist') watchLog();
}
function watchLog() {
  if (UNSUB.log || !canEditAny()) return;
  UNSUB.log = BE.watch('log/y' + YEAR, v => { RAW.log = v; if (VIEW === 'log') renderLog(); }, { last: 5000 });
}
let firstData = { meta: false, results: false };
function onData(kind) {
  firstData[kind] = true;
  if (!firstData.meta || !firstData.results) return;
  loading(false);
  setupFilters();
  renderDash();
  const eb = $('eList').dataset.built;
  if (eb && !eDirty) refreshEntry(true); else if (eb) markRemoteChanges();
  else if (VIEW === 'entry') openEntry();
  if (VIEW === 'log') renderLog();
  if (VIEW === 'set' && kind === 'meta') renderSet();
}

/* ================= Filters ================= */
function fillSelect(el, items, allLabel, keep = true) {
  const cur = el.value;
  el.innerHTML = (allLabel != null ? `<option value="">${allLabel}</option>` : '') + items.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  if (keep && [...el.options].some(o => o.value === cur)) el.value = cur;
}
function yearOptions() { const fy = +fyNow(); return [fy + 1, fy, fy - 1, fy - 2, fy - 3].map(String).concat(YEAR).filter((v, i, a) => a.indexOf(v) === i).sort().reverse().map(y => [y, y]); }
function setupFilters() {
  $$('[data-year]').forEach(el => { fillSelect(el, yearOptions(), null); el.value = YEAR; });
  fillSelect($('fMonth'), MONTHS.map(m => [m, m]), 'ทั้งปี (สะสม)');
  fillSelect($('fDim'), Object.keys(S.dims).sort(byNum).map(d => [d, dimName(d)]), 'ทุกมิติ');
  fillSelect($('lWard'), S.wards.map(w => [w.id, w.name]), 'ทุกหน่วยงาน');
  fillSelect($('lMonth'), MONTHS.map(m => [m, m]), 'ทุกเดือน');
  $('dlGroups').innerHTML = S.groups.map(g => `<option value="${esc(g)}">`).join('');
}
async function setYear(y) {
  if (y === YEAR) return;
  YEAR = y; firstData.results = false; loading(true, 'กำลังโหลดปีงบประมาณ ' + y);
  watchYear();
}

/* ================= Tabs & permissions ================= */
function applyRoleUI() {
  $$('#tabs .tab').forEach(t => { const need = t.dataset.need; t.hidden = need === 'edit' ? !canEditAny() : need === 'admin' ? !isAdmin() : false; });
  $('btnWardEntry').hidden = !canEditAny();
  const name = PROFILE && PROFILE.name || (USER && USER.displayName) || (USER && USER.email) || '';
  $('meName').textContent = name; $('meRole').textContent = ROLE; $('meEmail').textContent = USER ? USER.email : '';
  $('meAv').textContent = (name || '?').trim().slice(0, 1).toUpperCase();
  if (VIEW !== 'dash' && document.querySelector(`.tab[data-v="${VIEW}"]`).hidden) showView('dash');
}
function showView(v) {
  if (VIEW === 'entry' && v !== 'entry' && eDirty) { /* เก็บค่าที่กรอกไว้ แสดงจุดเตือนที่แท็บ */ }
  VIEW = v;
  $$('#tabs .tab').forEach(t => t.classList.toggle('on', t.dataset.v === v));
  $('vDash').hidden = v !== 'dash'; $('vEntry').hidden = v !== 'entry'; $('vLog').hidden = v !== 'log'; $('vSet').hidden = v !== 'set';
  if (v === 'dash') renderDash();
  if (v === 'entry' && !$('eList').dataset.built) openEntry();
  if (v === 'log') { if (lMode === 'hist') watchLog(); renderLog(); }
  if (v === 'set') renderSet();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ================= 1. Dashboard ================= */
function valueOf(k, w, m) {
  const by = RIDX[w + '|' + k.id]; if (!by) return null;
  if (m) { const r = by[m]; return r && r.v !== '' && r.v != null ? r : null; }
  const recs = Object.values(by).filter(r => r.v !== '' && r.v != null);
  if (!recs.length) return null;
  if (k.mode === 'ratio') { let N = 0, D = 0; recs.forEach(r => { N += +r.n || 0; D += +r.d || 0; }); return { n: N, d: D, v: D ? Math.round(N / D * k.mult * 100) / 100 : 0, months: recs.length }; }
  const sum = recs.reduce((a, r) => a + (+r.v), 0);
  return { v: k.unit === 'จำนวน' ? sum : Math.round(sum / recs.length * 100) / 100, months: recs.length };
}
function kpiFilter(k) { const dim = $('fDim').value, q = $('fSearch').value.trim().toLowerCase(); return (!dim || k.dim === dim) && (!q || (k.name + ' ' + k.id).toLowerCase().includes(q)); }
function pairsFor(wards) {
  const m = $('fMonth').value, set = new Set(wards), out = [];
  S.kpis.forEach(k => { if (!kpiFilter(k)) return; k.wards.forEach(w => { if (set.has(w)) { const val = valueOf(k, w, m); out.push({ k, w, val, s: statusOf(k, val ? val.v : '') }); } }); });
  return out;
}
function countOf(P) { const c = { pass: 0, fail: 0, wait: 0, none: 0, all: P.length }; P.forEach(p => c[p.s]++); c.ev = c.pass + c.fail; c.rate = c.ev ? Math.round(c.pass / c.ev * 100) : null; return c; }
const rateColor = r => r == null ? '#94a3b8' : r >= 80 ? '#0f8b8d' : r >= 50 ? '#f59e0b' : '#ef4444';

function renderDash() { if (!chMain) return; renderGroups(); renderTiles(); renderSummary(); renderMatrix(); }
function renderGroups() {
  $('gChips').innerHTML = [['', 'ทุกกลุ่มงาน'], ...S.groups.map(g => [g, g])].map(([v, t]) => `<button class="chip${selGroup === v ? ' on' : ''}" data-g="${esc(v)}">${esc(t)}</button>`).join('');
}
function renderTiles() {
  const m = $('fMonth').value;
  $('tiles').innerHTML = wardsInGroup(selGroup).map(w => {
    const c = countOf(pairsFor([w])), col = rateColor(c.rate), tot = c.all || 1;
    const seg = s => `<i style="width:${c[s] / tot * 100}%;background:${COLORS[s]}"></i>`;
    return `<button type="button" class="tile${w === selWard ? ' on' : ''}" data-w="${esc(w)}" style="--acc:${col}">
      <div class="tn">${esc(WARD[w].name)}</div><div class="tg2">${esc(WARD[w].group)}</div>
      <div class="pct">${c.rate == null ? '—' : c.rate + '%'}<small>ผ่านเกณฑ์</small></div>
      <div class="sbar">${seg('pass')}${seg('fail')}${seg('none')}</div>
      <div class="meta"><span>บันทึกแล้ว ${c.all - c.wait}/${c.all}</span><span>${m ? 'เดือน ' + m : 'สะสมทั้งปี'}</span></div></button>`;
  }).join('') || '<div class="empty">ยังไม่มีหน่วยงาน — ผู้ดูแลเพิ่มได้ที่แท็บ ④ ตั้งค่า</div>';
}
function renderSummary() {
  const wards = selWard ? [selWard] : wardsInGroup(selGroup);
  const P = pairsFor(wards), c = countOf(P), m = $('fMonth').value;
  $('scopeTitle').textContent = selWard ? WARD[selWard].name : (selGroup ? 'กลุ่มงาน' + selGroup : 'ภาพรวมทุกหน่วยงาน');
  $('scopeTag').textContent = `ปีงบประมาณ ${YEAR} · ${m ? 'เดือน ' + m : 'สะสมทั้งปี'}` + (selWard ? ' · ' + WARD[selWard].group : '');
  $('btnClear').hidden = !selWard && !selGroup;
  $('nAll').textContent = c.all.toLocaleString(); $('nPass').textContent = c.pass; $('nFail').textContent = c.fail; $('nWait').textContent = c.wait;
  $('dRate').textContent = c.rate == null ? '—' : c.rate + '%';
  chDonut.data.datasets[0].data = [c.pass, c.fail, c.none, c.wait]; chDonut.update();
  let g;
  if (selWard) {
    g = [...new Set(P.map(p => p.k.dim))].sort(byNum).map(d => ({ label: dimShort(d), full: dimName(d), ...countOf(P.filter(p => p.k.dim === d)) }));
    $('chTitle').textContent = 'ร้อยละผ่านเกณฑ์ รายมิติ'; chMain.options.indexAxis = 'x';
  } else {
    g = wards.map(w => ({ label: WARD[w].name, full: WARD[w].name, ward: w, ...countOf(P.filter(p => p.w === w)) }));
    $('chTitle').textContent = 'ร้อยละผ่านเกณฑ์ รายหน่วยงาน (กดแท่งเพื่อดูค่า KPI)'; chMain.options.indexAxis = 'y';
  }
  chMain.$meta = g; chMain.data.labels = g.map(x => x.label);
  chMain.data.datasets[0].data = g.map(x => x.rate ?? 0);
  chMain.data.datasets[0].backgroundColor = g.map(x => x.rate == null ? '#cbd5e1' : rateColor(x.rate));
  chMain.update();
}
function renderMatrix() {
  $('kpiPick').hidden = !!selWard; $('kpiBox').hidden = !selWard;
  if (!selWard) return;
  const w = selWard, m = $('fMonth').value, ks = kpisForWard(w).filter(kpiFilter);
  $('btnWardEntry').hidden = !canEditWard(w);
  $('kTitle').textContent = `ค่าตัวชี้วัด · ${WARD[w].name} (${ks.length} ตัว)`;
  const rows = ks.map(k => { const val = valueOf(k, w, m); return { k, val, s: statusOf(k, val ? val.v : '') }; }).filter(p => statusFilter === 'all' || p.s === statusFilter);
  const head = `<thead><tr><th class="kc1">ตัวชี้วัด</th><th class="tgc">เป้าหมาย</th>${MONTHS.map(x => `<th class="${x === m ? 'cur' : ''}">${x}</th>`).join('')}<th>${m ? 'เดือน ' + m : 'สะสม'}</th><th>สถานะ</th></tr></thead>`;
  let body = '', lastDim = null;
  rows.forEach(p => {
    const k = p.k, by = RIDX[w + '|' + k.id] || {};
    if (k.dim !== lastDim) { lastDim = k.dim; body += `<tr class="dimr"><td colspan="${MONTHS.length + 4}">${esc(dimName(k.dim))}</td></tr>`; }
    const cells = MONTHS.map(x => {
      const r = by[x], has = r && r.v !== '' && r.v != null, s = has ? statusOf(k, r.v) : 'wait';
      const tip = has ? `${k.mode === 'ratio' ? fmt(r.n) + ' / ' + fmt(r.d) + ' · ' : ''}บันทึกโดย ${r.by || '-'} ${r.at || ''}` : '';
      return `<td class="c-${s}" title="${esc(tip)}">${has ? fmt(r.v) : '·'}</td>`;
    }).join('');
    body += `<tr class="row" data-id="${esc(k.id)}"><td class="kc1"><div class="kname">${esc(k.name)}</div><div class="sub">${esc(k.id)} · ${esc(k.unit || '')}</div></td>
      <td class="tgc">${k.target ? esc(k.target) : '—'}</td>${cells}<td class="tot">${p.val ? fmt(p.val.v) : '—'}</td><td><span class="pill ${p.s}">${STATUS[p.s]}</span></td></tr>`;
  });
  $('mx').innerHTML = head + '<tbody>' + (body || `<tr><td colspan="${MONTHS.length + 4}" class="empty">ไม่พบตัวชี้วัดตามเงื่อนไขที่เลือก</td></tr>`) + '</tbody>';
}
function selectWard(w, scroll) {
  selWard = (w === selWard) ? '' : w; store.set('kpiWard', selWard);
  if (selWard && selGroup && WARD[selWard].group !== selGroup) selGroup = WARD[selWard].group;
  renderDash();
  if (selWard && scroll) document.querySelector('.scope').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function initCharts() {
  Chart.defaults.font.family = "'Sarabun',sans-serif"; Chart.defaults.color = '#5f7684';
  chMain = new Chart($('cMain'), {
    type: 'bar', data: { labels: [], datasets: [{ data: [], borderRadius: 6, maxBarThickness: 28 }] },
    options: { maintainAspectRatio: false, indexAxis: 'y', scales: {},
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: c => chMain.$meta[c[0].dataIndex].full,
        label: c => { const m = chMain.$meta[c.dataIndex]; return m.ev ? [` ผ่านเกณฑ์ ${m.rate}% (${m.pass}/${m.ev})`, ` บันทึกแล้ว ${m.all - m.wait}/${m.all} ตัวชี้วัด`] : ` ยังไม่มีผลที่ประเมินได้ (บันทึก ${m.all - m.wait}/${m.all})`; } } } },
      onHover: (e, els) => { e.native.target.style.cursor = els.length && !selWard ? 'pointer' : 'default'; },
      onClick: (e, els) => { if (els.length && !selWard) selectWard(chMain.$meta[els[0].index].ward, true); } }
  });
  const pct = { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: '#edf3f5' } };
  const cat = { grid: { display: false }, ticks: { autoSkip: false, font: { size: 12 } } };
  const up = chMain.update.bind(chMain);
  chMain.update = function () { const h = this.options.indexAxis === 'y'; this.options.scales = { x: h ? pct : cat, y: h ? cat : pct }; up(); };
  chDonut = new Chart($('cDonut'), { type: 'doughnut', data: { labels: ['ผ่านเกณฑ์', 'ไม่ผ่านเกณฑ์', 'ไม่มีเกณฑ์', 'ยังไม่บันทึก'],
    datasets: [{ data: [0, 0, 0, 0], backgroundColor: [COLORS.pass, COLORS.fail, COLORS.none, COLORS.wait], borderWidth: 0, hoverOffset: 6 }] },
    options: { maintainAspectRatio: false, cutout: '72%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 12 } } } } });
}
function openDetail(k, w) {
  const by = RIDX[w + '|' + k.id] || {}, total = valueOf(k, w, ''), st = statusOf(k, total ? total.v : '');
  $('dTitle').textContent = k.name; $('dSub').textContent = `${k.id} · ${WARD[w].name} · ${dimName(k.dim)} · ปีงบประมาณ ${YEAR}`;
  const def = [k.num && `<b>ตัวตั้ง:</b> ${esc(k.num)}${k.defN ? ` <span class="sub">(${esc(k.defN)})</span>` : ''}`,
    k.den && `<b>ตัวหาร:</b> ${esc(k.den)}${k.defD ? ` <span class="sub">(${esc(k.defD)})</span>` : ''}`,
    k.mode === 'ratio' && `<b>สูตร:</b> (ตัวตั้ง ÷ ตัวหาร) × ${k.mult}`, k.note && `<b>หมายเหตุ:</b> ${esc(k.note)}`].filter(Boolean);
  $('dBody').innerHTML = `
    <div class="dgrid"><div class="dbox"><small>เป้าหมาย</small><b>${k.target ? esc(k.target) : 'ยังไม่กำหนด'}</b></div>
      <div class="dbox"><small>ผลงานสะสมทั้งปี</small><b>${total ? fmt(total.v) : '—'}</b> <span class="sub">${esc(k.unit)}</span></div>
      <div class="dbox"><small>สถานะ</small><span class="pill ${st}">${STATUS[st]}</span></div></div>
    ${def.length ? `<div class="def">${def.join('<br>')}</div>` : ''}
    <div class="trend"><canvas id="cTrend"></canvas></div>
    <table class="mtab"><thead><tr><th>เดือน</th>${k.mode === 'ratio' ? '<th>ตัวตั้ง</th><th>ตัวหาร</th>' : ''}<th>ผลงาน</th><th>สถานะ</th><th>ผู้บันทึก / เวลา</th></tr></thead><tbody>
    ${MONTHS.filter(m => by[m]).map(m => { const r = by[m], s = statusOf(k, r.v); return `<tr><td>${m}</td>${k.mode === 'ratio' ? `<td>${fmt(r.n)}</td><td>${fmt(r.d)}</td>` : ''}<td><b>${fmt(r.v)}</b></td><td><span class="pill ${s}">${STATUS[s]}</span></td><td class="sub">${esc(r.by || '-')}<br>${esc(r.at || '')}</td></tr>`; }).join('')
      || '<tr><td colspan="6" class="empty">ยังไม่มีการบันทึกผลงานในปีงบประมาณนี้</td></tr>'}
    </tbody></table>
    ${canEditWard(w) ? `<div style="text-align:right;margin-top:14px"><button class="btn btn-primary" type="button" id="dEntry">บันทึก / แก้ไขผลงานตัวชี้วัดนี้</button></div>` : ''}`;
  $('mDetail').classList.add('open');
  if (chTrend) chTrend.destroy();
  const vals = MONTHS.map(m => by[m] && by[m].v !== '' ? by[m].v : null);
  const ds = [{ label: 'ผลงาน', data: vals, borderColor: '#0f8b8d', backgroundColor: 'rgba(15,139,141,.12)', fill: true, tension: .3, spanGaps: true, pointRadius: 5,
    pointBackgroundColor: vals.map(v => v == null ? '#fff' : statusOf(k, v) === 'fail' ? COLORS.fail : COLORS.pass) }];
  if (k.tgt) { ds.push({ label: 'เป้าหมาย', data: MONTHS.map(() => k.tgt.v), borderColor: '#ef4444', borderDash: [6, 5], pointRadius: 0, borderWidth: 1.5 });
    if (k.tgt.op === 'between') ds.push({ label: 'เป้าหมาย (สูงสุด)', data: MONTHS.map(() => k.tgt.v2), borderColor: '#ef4444', borderDash: [6, 5], pointRadius: 0, borderWidth: 1.5 }); }
  chTrend = new Chart($('cTrend'), { type: 'line', data: { labels: MONTHS, datasets: ds },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } }, scales: { y: { beginAtZero: true, grid: { color: '#edf3f5' } }, x: { grid: { display: false } } } } });
  if ($('dEntry')) $('dEntry').onclick = () => { closeModal('mDetail'); goEntry({ ward: w, month: $('fMonth').value || '', id: k.id }); };
}

/* ================= 2. Entry ================= */
function entryWards() { return editableWards(); }
function fillEntryGroups() { const ws = entryWards(); fillSelect($('eGroup'), S.groups.filter(g => wardsInGroup(g, ws).length).map(g => [g, g]), null); }
function fillEntryWards() { fillSelect($('eWard'), wardsInGroup($('eGroup').value, entryWards()).map(w => [w, WARD[w].name]), null); }
function fillEntryKpis() {
  const ks = kpisForWard($('eWard').value), cur = $('eKpi').value;
  $('eKpi').innerHTML = `<option value="">ทุกตัวชี้วัดของหน่วยงาน (${ks.length} ตัว)</option>` +
    [...new Set(ks.map(k => k.dim))].sort(byNum).map(d => `<optgroup label="${esc(dimName(d))}">` + ks.filter(k => k.dim === d).map(k => `<option value="${esc(k.id)}">${esc(k.id)} · ${esc(k.name)}</option>`).join('') + '</optgroup>').join('');
  if ([...$('eKpi').options].some(o => o.value === cur)) $('eKpi').value = cur;
}
async function goEntry(o = {}) {
  if (o.ward && !canEditWard(o.ward)) return toast('คุณไม่มีสิทธิ์ลงข้อมูลของหน่วยงานนี้', true);
  const built = $('eList').dataset.built;
  const same = built && o.ward === $('eWard').value && (!o.month || o.month === $('eMonth').value) && (!o.year || o.year === YEAR);
  if (!same && !confirmDiscard()) return;
  if (o.year && o.year !== YEAR) await setYear(o.year);
  openEntry(o.ward, o.id, o.month, same);
  showView('entry');
  if (o.id) setTimeout(() => { const c = $('eList').querySelector(`.kc[data-id="${CSS.escape(o.id)}"]`); if (c) { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); const i = c.querySelector('input'); i && i.focus(); } }, 350);
}
function openEntry(ward, kpiId, month, keep) {
  if (keep) { $('eKpi').value = kpiId || ''; showEntryKpi(); return; }
  const ws = entryWards();
  ward = ward || (ws.includes(selWard) ? selWard : '') || (ws.includes(store.get('kpiEWard')) ? store.get('kpiEWard') : '') || ws[0] || '';
  fillEntryGroups(); if (WARD[ward]) $('eGroup').value = WARD[ward].group;
  fillEntryWards(); if (ward) $('eWard').value = ward;
  fillSelect($('eMonth'), MONTHS.map(m => [m, m]), null, false);
  const lm = lastMonth(); $('eMonth').value = month || $('fMonth').value || (lm.year === YEAR ? lm.month : MONTHS[0]);
  fillEntryKpis(); $('eKpi').value = kpiId || '';
  buildEntry();
}
function refreshEntry(remote) { const keep = $('eKpi').value; fillEntryGroups(); fillEntryWards(); fillEntryKpis(); buildEntry(); $('eKpi').value = keep; showEntryKpi(); }
function buildEntry() {
  const w = $('eWard').value, m = $('eMonth').value, ks = w ? kpisForWard(w) : []; eDirty = 0;
  store.set('kpiEWard', w);
  $('eList').dataset.built = '1';
  if (!entryWards().length) { $('eList').innerHTML = '<div class="empty">บัญชีนี้ยังไม่ได้รับสิทธิ์ลงข้อมูลหน่วยงานใด แจ้งผู้ดูแลระบบ</div>'; updateEntryFoot(); return; }
  $('eList').innerHTML = [...new Set(ks.map(k => k.dim))].sort(byNum).map(d => {
    const items = ks.filter(k => k.dim === d);
    return `<div class="dimh" data-dim="${esc(d)}">${esc(dimName(d))} <small>· ${items.length} ตัวชี้วัด</small></div>` + items.map(k => {
      const r = (RIDX[w + '|' + k.id] || {})[m] || {};
      const tg = k.target ? `<span class="tg">เป้า: ${esc(k.target)}</span>` : '<span class="tg no">ไม่มีเกณฑ์</span>';
      const inp = (f, val) => { const s = val === '' || val == null ? '' : String(val); return `<input data-f="${f}" inputmode="decimal" value="${esc(s)}" data-orig="${esc(s)}" placeholder="กรอกตัวเลข">`; };
      const body = k.mode === 'ratio'
        ? `<div class="kc-in ratio"><label><span>ตัวตั้ง</span>${inp('n', r.n)}<small title="${esc(k.num)}">${esc(k.num)}</small></label><div class="opx">÷</div>
           <label><span>ตัวหาร</span>${inp('d', r.d)}<small title="${esc(k.den)}">${esc(k.den)}</small></label><div class="opx eq">${k.mult !== 1 ? '× ' + k.mult + ' ' : ''}=</div>
           <div class="res"><b class="rv">—</b><span class="pill wait">ยังไม่บันทึก</span></div></div>`
        : `<div class="kc-in value"><label><span>ผลงาน ${k.unit ? '(' + esc(k.unit) + ')' : ''}</span>${inp('v', r.v)}${k.num ? `<small>${esc(k.num)}</small>` : ''}</label>
           <div class="res"><b class="rv">—</b><span class="pill wait">ยังไม่บันทึก</span></div></div>`;
      const stamp = r.by || r.at ? `<div class="stamp">${ICON.clock}บันทึกล่าสุดโดย <b>${esc(r.by || '-')}</b> · ${esc(r.at || '')}</div>` : '';
      return `<div class="kc" data-id="${esc(k.id)}" data-dim="${esc(d)}"><div class="kc-h"><div><div class="kname">${esc(k.name)}</div><div class="sub">${esc(k.id)} · หน่วย ${esc(k.unit || '-')}</div></div>${tg}</div>${body}${stamp}</div>`;
    }).join('');
  }).join('') || '<div class="empty">ไม่พบตัวชี้วัดของหน่วยงานนี้ — ผู้ดูแลเพิ่มได้ที่แท็บ ④ ตั้งค่า → ตัวชี้วัด</div>';
  $$('#eList .kc').forEach(calcCard);
  showEntryKpi(); updateEntryFoot();
}
function markRemoteChanges() { /* มีคนอื่นบันทึกขณะที่เรากำลังกรอก: แจ้งเตือนเบา ๆ ไม่ทับค่าที่กรอก */
  toast('มีการอัปเดตข้อมูลจากผู้ใช้อื่น ค่าที่คุณกรอกไว้ยังอยู่ กดบันทึกเพื่อยืนยัน');
}
function showEntryKpi() {
  const id = $('eKpi').value, cards = $$('#eList .kc');
  cards.forEach(c => c.hidden = !!id && c.dataset.id !== id);
  $$('#eList .dimh').forEach(h => h.hidden = !cards.some(c => !c.hidden && c.dataset.dim === h.dataset.dim));
}
function calcCard(card) {
  const k = KPI[card.dataset.id]; if (!k) return;
  const g = f => { const el = card.querySelector(`[data-f="${f}"]`); return el ? toNum(el.value) : ''; };
  let v = '', bad = false;
  if (k.mode === 'ratio') {
    const n = g('n'), d = g('d');
    if ((n !== '' && isNaN(n)) || (d !== '' && isNaN(d))) bad = true;
    else if (n !== '' && d !== '') { if (d === 0 && n !== 0) bad = true; else v = d === 0 ? 0 : Math.round(n / d * k.mult * 100) / 100; }
    else if (n !== '' || d !== '') bad = true;
  } else { v = g('v'); if (v !== '' && isNaN(v)) { bad = true; v = ''; } }
  const s = bad ? 'fail' : statusOf(k, v);
  card.querySelector('.rv').textContent = bad ? '!' : fmt(v);
  const pill = card.querySelector('.res .pill'); pill.className = 'pill ' + s; pill.textContent = bad ? 'ข้อมูลไม่ครบ/ไม่ถูกต้อง' : STATUS[s];
  card.classList.toggle('bad', bad); card._filled = v !== '' && !bad; card._bad = bad; card._v = v;
  card.classList.toggle('dirty', [...card.querySelectorAll('input')].some(i => i.value.replace(/,/g, '').trim() !== i.dataset.orig));
}
function updateEntryFoot() {
  const cards = $$('#eList .kc'), filled = cards.filter(c => c._filled).length;
  eDirty = cards.filter(c => c.classList.contains('dirty')).length;
  const w = $('eWard').value;
  $('eProgTxt').textContent = `กรอกแล้ว ${filled} / ${cards.length} ตัวชี้วัด · ${w ? wname(w) : '-'} · เดือน ${$('eMonth').value} ${YEAR}`;
  $('eProg').style.width = (cards.length ? filled / cards.length * 100 : 0) + '%';
  $('btnSave').disabled = !eDirty; $('btnReset').disabled = !eDirty;
  $('btnSaveTxt').textContent = eDirty ? `บันทึก ${eDirty} รายการ` : 'บันทึก';
  document.querySelector('.tab[data-v="entry"]').classList.toggle('has-dirty', !!eDirty);
}
function getBy(firstId, lastId) {
  const f = $(firstId), l = $(lastId), a = f.value.trim(), b = l.value.trim();
  f.classList.toggle('err', !a); l.classList.toggle('err', !b);
  if (!a || !b) { (a ? l : f).focus(); return ''; }
  store.set('kpiFirst', a); store.set('kpiLast', b);
  return (a + ' ' + b).slice(0, 100);
}
const valText = r => !r ? '' : (r.n !== '' && r.n != null && r.d !== '' && r.d != null) ? `${r.n} / ${r.d} = ${r.v}` : (r.v === '' || r.v == null ? '' : String(r.v));
function logEntry(action, k, wid, month, rec, old, by) {
  const o = { ts: TS, action, by, email: USER.email, wid, ward: wname(wid), month, kpiId: k.id, kpiName: k.name, old: old || '' };
  if (rec) { if (rec.n !== '' && rec.n != null) o.n = rec.n; if (rec.d !== '' && rec.d != null) o.d = rec.d; if (rec.v !== '' && rec.v != null) o.v = rec.v; }
  return o;
}
async function saveEntry() {
  const by = getBy('eFirst', 'eLast');
  if (!by) { window.scrollTo({ top: 0, behavior: 'smooth' }); return toast('กรุณากรอกชื่อและนามสกุลผู้บันทึกก่อน', true); }
  if (by.length < 3) return toast('ชื่อ-นามสกุลสั้นเกินไป', true);
  const cards = $$('#eList .kc.dirty'), bad = cards.filter(c => c._bad);
  if (bad.length) { $('eKpi').value = ''; showEntryKpi(); bad[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); return toast(`มี ${bad.length} รายการที่ข้อมูลไม่ครบหรือไม่ถูกต้อง`, true); }
  const wid = $('eWard').value, month = $('eMonth').value, mk = M2K[month], y = 'y' + YEAR;
  const updates = {}, st = { added: 0, updated: 0, deleted: 0 };
  cards.forEach(c => {
    const k = KPI[c.dataset.id], val = f => { const i = c.querySelector(`[data-f="${f}"]`); return i ? toNum(i.value) : ''; };
    const n = k.mode === 'ratio' ? val('n') : '', d = k.mode === 'ratio' ? val('d') : '', v = c._v;
    const old = (RIDX[wid + '|' + k.id] || {})[month];
    const path = `results/${y}/${wid}/${mk}/${k.id}`, lk = `log/${y}/${BE.newKey('log/' + y)}`;
    if (v === '') {
      if (!old) return;
      updates[path] = null; updates[lk] = logEntry('ลบ', k, wid, month, null, valText(old), by); st.deleted++;
    } else {
      const rec = { v, by, email: USER.email, at: TS }; if (n !== '') rec.n = n; if (d !== '') rec.d = d;
      updates[path] = rec; updates[lk] = logEntry(old ? 'แก้ไข' : 'เพิ่ม', k, wid, month, rec, old ? valText(old) : '', by); old ? st.updated++ : st.added++;
    }
  });
  if (!Object.keys(updates).length) { refreshEntry(); return toast('ไม่มีค่าที่เปลี่ยนแปลง'); }
  $('btnSave').disabled = true; $('btnSaveTxt').textContent = 'กำลังบันทึก…';
  try {
    await BE.commit(updates);
    eDirty = 0; refreshEntry();
    const parts = [st.added && `เพิ่ม ${st.added}`, st.updated && `แก้ไข ${st.updated}`, st.deleted && `ลบ ${st.deleted}`].filter(Boolean);
    toast(`✓ ${wname(wid)} เดือน ${month}: ${parts.join(' · ')} — บันทึกโดย ${by}`);
  } catch (e) { toast('บันทึกไม่สำเร็จ: ' + errMsg(e), true); updateEntryFoot(); }
}
function confirmDiscard() { return !eDirty || confirm('มีข้อมูลที่กรอกไว้แต่ยังไม่ได้บันทึก ต้องการทิ้งข้อมูลนั้นหรือไม่?'); }

/* ================= 3. Log ================= */
function logRows() {
  if (lMode === 'rec') return S.results.map(r => ({ ...r, ward: wname(r.wid), name: (KPI[r.id] || {}).name || r.id }));
  return Object.values(RAW.log || {}).map(l => ({ ...l, month: l.month || K2M[l.mk] || '', ts: l.ts || 0, at: fmtTs(l.ts), name: l.kpiName || (KPI[l.kpiId] || {}).name || l.kpiId, id: l.kpiId, val: valText(l) }));
}
function logFilter(r) {
  const w = $('lWard').value, m = $('lMonth').value, b = $('lBy').value, q = $('lSearch').value.trim().toLowerCase();
  return (!w || r.wid === w) && (!m || r.month === m) && (!b || r.by === b) && (!q || [r.name, r.id, r.by, r.ward, r.email].join(' ').toLowerCase().includes(q));
}
function renderLog() {
  if (lMode === 'hist' && !RAW.log && UNSUB.log) { $('lt').innerHTML = '<tbody><tr><td class="empty">กำลังโหลดประวัติ…</td></tr></tbody>'; }
  const src = logRows();
  fillSelect($('lBy'), [...new Set(src.map(r => r.by).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th')).map(n => [n, n]), 'ทุกคน');
  const rows = src.filter(logFilter).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const show = rows.slice(0, lShown);
  $('btnLMore').hidden = rows.length <= lShown; $('btnLMore').textContent = `แสดงเพิ่มเติม (เหลืออีก ${rows.length - lShown} รายการ)`;
  $('lSum').textContent = `${rows.length.toLocaleString()} รายการ · ผู้ลงข้อมูล ${new Set(rows.map(r => r.by).filter(Boolean)).size} คน · ปีงบประมาณ ${YEAR}`;
  const whoCell = r => `<span class="who-badge" title="${esc(r.email || '')}"><span class="avatar">${esc(String(r.by || '?').trim().slice(0, 1))}</span>${esc(r.by || '-')}</span>`;
  if (lMode === 'rec') {
    $('lt').innerHTML = `<thead><tr><th class="c"><input type="checkbox" id="chkAll" title="เลือกทั้งหมดที่แสดง"></th><th>บันทึกเมื่อ</th><th>ผู้บันทึก</th><th>หน่วยงาน</th><th>เดือน</th><th>ตัวชี้วัด</th><th class="c">ตัวตั้ง / ตัวหาร</th><th class="c">ผลลัพธ์</th><th class="c">สถานะ</th><th class="c">จัดการ</th></tr></thead><tbody>` +
      (show.map(r => {
        const k = KPI[r.id] || { name: r.id }, s = statusOf(k, r.v), key = recKey(r), on = SEL.has(key), can = canEditWard(r.wid);
        return `<tr class="${on ? 'sel' : ''}" data-key="${esc(key)}"><td class="c">${can ? `<input type="checkbox" class="chk" ${on ? 'checked' : ''}>` : ''}</td>
          <td class="nw">${esc(r.at || '-')}</td><td class="nw">${whoCell(r)}</td><td>${esc(r.ward)}</td><td class="nw">${esc(r.month)} ${esc(YEAR)}</td>
          <td class="kn"><div class="kname">${esc(k.name)}</div><div class="sub">${esc(r.id)}</div></td>
          <td class="c nw">${r.n !== '' && r.d !== '' ? fmt(r.n) + ' / ' + fmt(r.d) : '—'}</td><td class="c num">${fmt(r.v)}</td>
          <td class="c"><span class="pill ${s}">${STATUS[s]}</span></td>
          <td>${can ? `<div class="acts"><button class="ibtn" data-act="edit" title="แก้ไข">${ICON.edit}</button><button class="ibtn del" data-act="del" title="ลบ">${ICON.del}</button></div>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="10" class="empty">ยังไม่มีข้อมูลที่บันทึกตามเงื่อนไขนี้</td></tr>') + '</tbody>';
    const vis = show.filter(r => canEditWard(r.wid)).map(recKey); $('chkAll').checked = vis.length && vis.every(k => SEL.has(k));
  } else {
    const cls = { 'เพิ่ม': 'act-add', 'แก้ไข': 'act-edit', 'ลบ': 'act-del' };
    $('lt').innerHTML = `<thead><tr><th>เวลา</th><th class="c">การดำเนินการ</th><th>ผู้ดำเนินการ</th><th>หน่วยงาน</th><th>เดือน</th><th>ตัวชี้วัด</th><th>ค่าใหม่</th><th>ค่าเดิม</th></tr></thead><tbody>` +
      (show.map(r => `<tr><td class="nw">${esc(r.at)}</td><td class="c"><span class="pill ${cls[r.action] || 'none'}">${esc(r.action)}</span></td><td class="nw">${whoCell(r)}</td>
          <td>${esc(r.ward || wname(r.wid))}</td><td class="nw">${esc(r.month)} ${esc(YEAR)}</td>
          <td class="kn"><div class="kname">${esc(r.name)}</div><div class="sub">${esc(r.id)}</div></td>
          <td class="nw num">${esc(r.val || '—')}</td><td class="nw ${r.old ? 'oldv' : ''}">${esc(r.old || '—')}</td></tr>`).join('')
        || `<tr><td colspan="8" class="empty">${RAW.log ? 'ยังไม่มีประวัติตามเงื่อนไขนี้' : 'กำลังโหลดประวัติ…'}</td></tr>`) + '</tbody>';
  }
  $('selBar').hidden = lMode !== 'rec' || !SEL.size; $('selTxt').textContent = `เลือก ${SEL.size} รายการ`;
}
const findRec = key => S.results.find(r => recKey(r) === key);
function askDelete(keys) {
  DEL_ITEMS = keys.map(findRec).filter(r => r && canEditWard(r.wid));
  if (!DEL_ITEMS.length) return;
  $('delTitle').textContent = `ยืนยันการลบ ${DEL_ITEMS.length} รายการ`;
  $('delList').innerHTML = DEL_ITEMS.slice(0, 50).map(r => `<li><b>${esc((KPI[r.id] || {}).name || r.id)}</b><div class="sub">${esc(wname(r.wid))} · เดือน ${esc(r.month)} ${esc(YEAR)} · ผลลัพธ์ ${fmt(r.v)} · บันทึกโดย ${esc(r.by || '-')}</div></li>`).join('') +
    (DEL_ITEMS.length > 50 ? `<li class="sub">… และอีก ${DEL_ITEMS.length - 50} รายการ</li>` : '');
  $('dFirst').value = $('eFirst').value || store.get('kpiFirst'); $('dLast').value = $('eLast').value || store.get('kpiLast');
  $('dFirst').classList.remove('err'); $('dLast').classList.remove('err');
  $('mDel').classList.add('open');
}
async function doDelete() {
  const by = getBy('dFirst', 'dLast'); if (!by) return toast('กรุณากรอกชื่อและนามสกุลผู้ลบ', true);
  $('eFirst').value = $('eFirst').value || $('dFirst').value; $('eLast').value = $('eLast').value || $('dLast').value;
  const y = 'y' + YEAR, u = {};
  DEL_ITEMS.forEach(r => { const k = KPI[r.id] || { id: r.id, name: r.id }; u[`results/${y}/${r.wid}/${r.mk}/${r.id}`] = null; u[`log/${y}/${BE.newKey('log/' + y)}`] = logEntry('ลบ', k, r.wid, r.month, null, valText(r), by); });
  $('btnDelOk').disabled = true;
  try { await BE.commit(u); DEL_ITEMS.forEach(r => SEL.delete(recKey(r))); closeModal('mDel'); renderLog(); toast(`✓ ลบแล้ว ${DEL_ITEMS.length} รายการ — โดย ${by}`); }
  catch (e) { toast('ลบไม่สำเร็จ: ' + errMsg(e), true); }
  finally { $('btnDelOk').disabled = false; }
}
async function exportLogXlsx() {
  await loadXLSX();
  const rows = logRows().filter(logFilter).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const data = lMode === 'rec'
    ? rows.map(r => ({ 'บันทึกเมื่อ': r.at, 'ผู้บันทึก': r.by, 'อีเมล': r.email, 'หน่วยงาน': r.ward, 'ปีงบประมาณ': YEAR, 'เดือน': r.month, 'KPI_ID': r.id, 'ตัวชี้วัด': r.name, 'ตัวตั้ง': r.n, 'ตัวหาร': r.d, 'ผลลัพธ์': r.v, 'ผลการประเมิน': STATUS[statusOf(KPI[r.id], r.v)] }))
    : rows.map(r => ({ 'เวลา': r.at, 'การดำเนินการ': r.action, 'ผู้ดำเนินการ': r.by, 'อีเมล': r.email, 'หน่วยงาน': r.ward, 'ปีงบประมาณ': YEAR, 'เดือน': r.month, 'KPI_ID': r.id, 'ตัวชี้วัด': r.name, 'ค่าใหม่': r.val, 'ค่าเดิม': r.old }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), lMode === 'rec' ? 'ผลงาน' : 'Log');
  XLSX.writeFile(wb, `KPI-${lMode === 'rec' ? 'ผลงาน' : 'Log'}-${YEAR}.xlsx`);
}

/* ================= 4. ตั้งค่า (admin) ================= */
let sTab = 'ward', WEDIT = null, DEDIT = null, kShown = 100, KM_ID = null, UM_KEY = null;
function renderSet() {
  if (!isAdmin()) return;
  ['ward', 'dim', 'kpi', 'user', 'io'].forEach(t => $('s' + t[0].toUpperCase() + t.slice(1)).hidden = sTab !== t);
  if (sTab === 'ward') renderWardTbl();
  if (sTab === 'dim') renderDimTbl();
  if (sTab === 'kpi') renderKpiTbl();
  if (sTab === 'user') { if (!UNSUB.users) UNSUB.users = BE.watch('users', v => { RAW.users = v; if (VIEW === 'set' && sTab === 'user') renderUserTbl(); }); renderUserTbl(); }
}
const kpiCountOfWard = w => S.kpis.filter(k => !k.allWards && k.wardSet[w]).length;

/* ---------- หน่วยงาน ---------- */
function renderWardTbl(reset) {
  if (!WEDIT || reset) WEDIT = S.wards.map(w => ({ ...w }));
  $('wardTbl').innerHTML = `<thead><tr><th style="width:90px">ลำดับ</th><th>ชื่อหน่วยงาน</th><th>กลุ่มงาน</th><th class="c">ตัวชี้วัดเฉพาะ</th><th class="c">ลบ</th></tr></thead><tbody>` +
    WEDIT.map((w, i) => `<tr class="${w._del ? 'gone' : ''}" data-i="${i}"><td><input type="number" data-f="order" value="${w.order}"></td>
      <td><input data-f="name" value="${esc(w.name)}"></td><td><input data-f="group" list="dlGroups" value="${esc(w.group)}"></td>
      <td class="c">${kpiCountOfWard(w.id)}</td><td class="c"><button class="ibtn ${w._del ? '' : 'del'}" data-act="tgl" title="${w._del ? 'ยกเลิกการลบ' : 'ลบ'}">${w._del ? ICON.undo : ICON.del}</button></td></tr>`).join('') + '</tbody>';
}
async function saveWards() {
  const live = WEDIT.filter(w => !w._del), names = live.map(w => norm(w.name));
  if (names.some(n => !n)) return toast('ชื่อหน่วยงานห้ามว่าง', true);
  if (new Set(names).size !== names.length) return toast('มีชื่อหน่วยงานซ้ำกัน', true);
  if (live.some(w => !norm(w.group))) return toast('กลุ่มงานห้ามว่าง', true);
  const dels = WEDIT.filter(w => w._del);
  if (dels.length && !confirm(`ลบ ${dels.length} หน่วยงาน: ${dels.map(w => w.name).join(', ')}\nตัวชี้วัดเฉพาะของหน่วยงานเหล่านี้จะถูกลบด้วย ผลงานเดิมจะไม่แสดงในแดชบอร์ด\nยืนยัน?`)) return;
  const u = {};
  live.forEach(w => u['meta/wards/' + w.id] = { name: norm(w.name), group: norm(w.group), order: +w.order || 0 });
  dels.forEach(w => {
    u['meta/wards/' + w.id] = null;
    S.kpis.forEach(k => { if (!k.allWards && k.wardSet[w.id]) { const left = Object.keys(k.wardSet).filter(x => x !== w.id && !dels.some(d => d.id === x)); if (left.length) u[`meta/kpis/${k.id}/wards/${w.id}`] = null; else u['meta/kpis/' + k.id] = null; } });
  });
  try { await metaCommit(u); WEDIT = null; toast('✓ บันทึกหน่วยงานแล้ว'); } catch (e) { toast(errMsg(e), true); }
}
function openNewWard() {
  $('nwName').value = ''; $('nwGroup').value = selGroup || ''; $('nwPrefix').value = '';
  fillSelect($('nwCopy'), S.wards.map(w => [w.id, `${w.name} (${kpiCountOfWard(w.id)} ตัว)`]), '— ไม่คัดลอก (เพิ่มตัวชี้วัดเองภายหลัง) —', false);
  $('nwPrefixBox').hidden = true; $('mWard').classList.add('open'); setTimeout(() => $('nwName').focus(), 50);
}
function nwPrefixHint() {
  const src = $('nwCopy').value; $('nwPrefixBox').hidden = !src; if (!src) return;
  const p = $('nwPrefix').value.trim(), n = kpiCountOfWard(src);
  $('nwPrefixEx').textContent = p ? `จะสร้าง ${n} ตัวชี้วัด: ${p}01 … ${p}${String(n).padStart(2, '0')}` : `ระบบจะสร้างรหัสใหม่ ${n} ตัว เช่น KVIP01, KVIP02 …`;
}
async function addWard() {
  const name = norm($('nwName').value), group = norm($('nwGroup').value), src = $('nwCopy').value, p = $('nwPrefix').value.trim();
  if (!name || !group) return toast('กรอกชื่อหน่วยงานและกลุ่มงาน', true);
  if (S.wards.some(w => w.name === name)) return toast('มีหน่วยงานชื่อนี้แล้ว', true);
  const wid = newId('w'), u = { ['meta/wards/' + wid]: { name, group, order: Math.max(0, ...S.wards.map(w => w.order)) + 1 } };
  if (src) {
    if (!/^[A-Za-z0-9_-]{2,20}$/.test(p)) return toast('รหัสนำหน้าใช้ได้เฉพาะ A-Z 0-9 _ - ยาว 2–20 ตัว', true);
    const ks = S.kpis.filter(k => !k.allWards && k.wardSet[src]); let ord = Math.max(0, ...S.kpis.map(k => k.order));
    const ids = ks.map((_, i) => p + String(i + 1).padStart(2, '0'));
    const dup = ids.filter(id => KPI[id]); if (dup.length) return toast('รหัสซ้ำกับที่มีอยู่: ' + dup.slice(0, 3).join(', '), true);
    ks.forEach((k, i) => { u['meta/kpis/' + ids[i]] = kpiToDb({ ...k, id: ids[i], allWards: false, wardSet: { [wid]: true }, order: ++ord }); });
  }
  try { await metaCommit(u); closeModal('mWard'); WEDIT = null; toast(`✓ เพิ่มหน่วยงาน ${name}` + (src ? ` พร้อมตัวชี้วัด ${Object.keys(u).length - 1} ตัว` : '')); }
  catch (e) { toast(errMsg(e), true); }
}

/* ---------- มิติ ---------- */
function renderDimTbl(reset) {
  if (!DEDIT || reset) DEDIT = Object.entries(RAW.meta && RAW.meta.dims || {}).map(([dk, d]) => ({ dk, key: String(d.key), name: d.name, order: +d.order || 0 })).sort((a, b) => a.order - b.order || byNum(a.key, b.key));
  const used = d => S.kpis.filter(k => k.dim === d).length;
  $('dimTbl').innerHTML = `<thead><tr><th style="width:90px">ลำดับ</th><th style="width:120px">รหัสมิติ</th><th>ชื่อมิติ</th><th class="c">ตัวชี้วัด</th><th class="c">ลบ</th></tr></thead><tbody>` +
    DEDIT.map((d, i) => `<tr class="${d._del ? 'gone' : d._new ? 'new' : ''}" data-i="${i}"><td><input type="number" data-f="order" value="${d.order}"></td>
      <td><input data-f="key" value="${esc(d.key)}" ${d._new ? '' : 'readonly title="รหัสเดิมแก้ไม่ได้ เพราะตัวชี้วัดอ้างถึง"'}></td><td><input data-f="name" value="${esc(d.name)}"></td>
      <td class="c">${used(d.key)}</td><td class="c"><button class="ibtn ${d._del ? '' : 'del'}" data-act="tgl">${d._del ? ICON.undo : ICON.del}</button></td></tr>`).join('') + '</tbody>';
}
async function saveDims() {
  const live = DEDIT.filter(d => !d._del), keys = live.map(d => norm(d.key));
  if (keys.some(k => !/^[A-Za-z0-9_-]{1,10}$/.test(k))) return toast('รหัสมิติใช้ได้เฉพาะตัวเลข/อักษรอังกฤษ ยาวไม่เกิน 10', true);
  if (new Set(keys).size !== keys.length) return toast('รหัสมิติซ้ำกัน', true);
  const blocked = DEDIT.filter(d => d._del && S.kpis.some(k => k.dim === d.key));
  if (blocked.length) return toast(`ลบมิติ ${blocked.map(d => d.key).join(', ')} ไม่ได้ เพราะยังมีตัวชี้วัดใช้อยู่ — ย้ายตัวชี้วัดไปมิติอื่นก่อน`, true);
  const obj = {}; live.forEach(d => obj['d' + norm(d.key)] = { key: norm(d.key), name: norm(d.name) || 'มิติที่ ' + norm(d.key), order: +d.order || 0 });
  try { await metaCommit({ 'meta/dims': obj }); DEDIT = null; toast('✓ บันทึกมิติแล้ว'); } catch (e) { toast(errMsg(e), true); }
}

/* ---------- ตัวชี้วัด ---------- */
function kpiToDb(k) {
  const o = { name: norm(k.name), dim: String(k.dim), order: +k.order || 0 };
  ['target', 'dir', 'unit', 'num', 'den', 'defN', 'defD', 'note'].forEach(f => { const v = norm(k[f]); if (v) o[f] = v; });
  const m = k.multRaw !== undefined ? k.multRaw : k.mult; if (m !== '' && m != null && !isNaN(+m)) o.mult = +m;
  if (k.allWards) o.allWards = true; else o.wards = { ...k.wardSet };
  return o;
}
function renderKpiTbl() {
  fillSelect($('kWard'), S.wards.map(w => [w.id, w.name]), 'ทุกหน่วยงาน');
  fillSelect($('kDim'), Object.keys(S.dims).sort(byNum).map(d => [d, dimName(d)]), 'ทุกมิติ');
  const w = $('kWard').value, d = $('kDim').value, q = $('kSearch').value.trim().toLowerCase();
  const list = S.kpis.filter(k => (!w || k.wards.includes(w)) && (!d || k.dim === d) && (!q || (k.id + ' ' + k.name).toLowerCase().includes(q)));
  $('kpiCount').textContent = S.kpis.length;
  const wsum = k => k.allWards ? '<span class="role">ทุกหน่วยงาน</span>' : k.wards.length === 1 ? esc(wname(k.wards[0])) : k.wards.length ? `${k.wards.length} หน่วยงาน` : '<span style="color:var(--red)">ยังไม่ระบุ</span>';
  $('kpiTbl').innerHTML = `<thead><tr><th>KPI_ID</th><th>ชื่อตัวชี้วัด</th><th>มิติ</th><th>เป้าหมาย</th><th>หน่วย</th><th>หน่วยงาน</th><th class="c">แก้ไข</th></tr></thead><tbody>` +
    (list.slice(0, kShown).map(k => `<tr data-id="${esc(k.id)}"><td class="nw"><b>${esc(k.id)}</b></td><td>${esc(k.name)}</td><td class="nw">${esc(dimShort(k.dim))}</td>
      <td>${k.target ? esc(k.target) : '<span class="sub">—</span>'}</td><td class="nw">${esc(k.unit)}</td><td>${wsum(k)}</td>
      <td class="c"><button class="ibtn" data-act="edit">${ICON.edit}</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">ไม่พบตัวชี้วัด</td></tr>') + '</tbody>';
  $('btnKMore').hidden = list.length <= kShown; $('btnKMore').textContent = `แสดงเพิ่มเติม (เหลืออีก ${list.length - kShown})`;
}
function wardChecks(boxId, set) {
  $(boxId).innerHTML = S.groups.map(g => `<div class="wgrp"><label><input type="checkbox" data-g="${esc(g)}"> ${esc(g)}</label><div class="ws">` +
    wardsInGroup(g).map(w => `<label><input type="checkbox" value="${esc(w)}" ${set[w] ? 'checked' : ''}> ${esc(WARD[w].name)}</label>`).join('') + '</div></div>').join('');
  syncGroupChecks(boxId);
}
function syncGroupChecks(boxId) { $$(`#${boxId} .wgrp`).forEach(gr => { const cs = [...gr.querySelectorAll('.ws input')], on = cs.filter(c => c.checked).length; const g = gr.querySelector('[data-g]'); g.checked = on && on === cs.length; g.indeterminate = on > 0 && on < cs.length; }); }
const checkedWards = boxId => Object.fromEntries($$(`#${boxId} .ws input:checked`).map(c => [c.value, true]));
function openKpi(id) {
  const k = id ? KPI[id] : null; KM_ID = id || null;
  $('kmTitle').textContent = k ? 'แก้ไขตัวชี้วัด' : 'เพิ่มตัวชี้วัดใหม่'; $('kmSub').textContent = k ? k.id : 'กรอกข้อมูลแล้วกดบันทึก';
  $('kmId').value = k ? k.id : ''; $('kmId').readOnly = !!k;
  fillSelect($('kmDim'), Object.keys(S.dims).sort(byNum).map(d => [d, dimName(d)]), null, false); $('kmDim').value = k ? k.dim : ($('kDim').value || Object.keys(S.dims)[0] || '');
  const f = { kmName: 'name', kmTarget: 'target', kmUnit: 'unit', kmNum: 'num', kmDen: 'den', kmDefN: 'defN', kmDefD: 'defD', kmNote: 'note' };
  Object.entries(f).forEach(([el, p]) => $(el).value = k ? k[p] : '');
  $('kmMult').value = k ? (k.multRaw === '' ? '' : k.multRaw) : '';
  $('kmAll').checked = k ? k.allWards : false;
  wardChecks('kmWards', k ? k.wardSet : ($('kWard').value ? { [$('kWard').value]: true } : {}));
  $('kmWards').style.opacity = $('kmAll').checked ? .4 : 1;
  $('btnKmDel').hidden = !k; kmTgtPreview();
  $('mKpi').classList.add('open');
}
function kmTgtPreview() { const t = parseTarget($('kmTarget').value); $('kmTgtP').innerHTML = `<span class="pill ${t ? 'pass' : 'none'}">${esc(tgtText(t))}</span>`; }
async function saveKpi() {
  const id = norm($('kmId').value);
  if (!okKey(id)) return toast('KPI_ID ห้ามว่าง และห้ามมีอักขระ . # $ [ ] /', true);
  if (!KM_ID && KPI[id]) return toast('มี KPI_ID นี้แล้ว', true);
  if (!norm($('kmName').value)) return toast('กรอกชื่อตัวชี้วัด', true);
  const all = $('kmAll').checked, set = checkedWards('kmWards');
  if (!all && !Object.keys(set).length) return toast('เลือกหน่วยงานที่ใช้ตัวชี้วัดนี้อย่างน้อย 1 หน่วยงาน', true);
  if ($('kmMult').value.trim() && isNaN(+$('kmMult').value)) return toast('ตัวคูณต้องเป็นตัวเลข', true);
  const old = KM_ID ? KPI[KM_ID] : null;
  const obj = kpiToDb({ name: $('kmName').value, dim: $('kmDim').value, order: old ? old.order : Math.max(0, ...S.kpis.map(k => k.order)) + 1, target: $('kmTarget').value, dir: old ? old.dir : '',
    unit: $('kmUnit').value, num: $('kmNum').value, den: $('kmDen').value, defN: $('kmDefN').value, defD: $('kmDefD').value, note: $('kmNote').value, multRaw: $('kmMult').value.trim(), allWards: all, wardSet: set });
  try { await metaCommit({ ['meta/kpis/' + id]: obj }); closeModal('mKpi'); toast(`✓ บันทึกตัวชี้วัด ${id} แล้ว`); } catch (e) { toast(errMsg(e), true); }
}
async function deleteKpi() {
  if (!KM_ID || !confirm(`ลบตัวชี้วัด ${KM_ID}?\nผลงานที่เคยบันทึกของตัวชี้วัดนี้จะไม่แสดงในแดชบอร์ด`)) return;
  try { await metaCommit({ ['meta/kpis/' + KM_ID]: null }); closeModal('mKpi'); toast('✓ ลบตัวชี้วัดแล้ว'); } catch (e) { toast(errMsg(e), true); }
}

/* ---------- ผู้ใช้งาน ---------- */
function renderUserTbl() {
  const users = Object.entries(RAW.users || {}).map(([k, u]) => ({ k, ...u })).sort((a, b) => (a.role || '').localeCompare(b.role || '') || a.email.localeCompare(b.email));
  const ws = u => u.role === 'admin' ? '<span class="sub">ทั้งหมด</span>' : u.role === 'viewer' ? '<span class="sub">ดูอย่างเดียว</span>' : u.allWards ? '<span class="role">ทุกหน่วยงาน</span>' : Object.keys(u.wards || {}).filter(w => WARD[w]).map(wname).map(esc).join(', ') || '<span style="color:var(--red)">ยังไม่กำหนด</span>';
  $('userTbl').innerHTML = `<thead><tr><th>อีเมล</th><th>ชื่อเรียก</th><th>สิทธิ์</th><th>หน่วยงานที่ลงข้อมูลได้</th><th class="c">แก้ไข</th></tr></thead><tbody>` +
    SUPER.map(e => `<tr><td><b>${esc(e)}</b></td><td class="sub">ผู้ดูแลหลัก (กำหนดใน config.js และ rules)</td><td><span class="role admin">admin</span></td><td class="sub">ทั้งหมด</td><td></td></tr>`).join('') +
    (users.map(u => `<tr data-k="${esc(u.k)}"><td><b>${esc(u.email)}</b></td><td>${esc(u.name || '')}</td><td><span class="role ${esc(u.role)}">${esc(u.role)}</span></td><td>${ws(u)}</td>
      <td class="c"><button class="ibtn" data-act="edit">${ICON.edit}</button></td></tr>`).join('') || (RAW.users === null ? '' : '<tr><td colspan="5" class="empty">ยังไม่มีผู้ใช้ กด "+ เพิ่มผู้ใช้"</td></tr>')) + '</tbody>';
}
function openUser(k) {
  const u = k ? (RAW.users || {})[k] : null; UM_KEY = k || null;
  $('umTitle').textContent = u ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้';
  $('umEmail').value = u ? u.email : ''; $('umEmail').readOnly = !!u; $('umName').value = u ? u.name || '' : '';
  $('umRole').value = u ? u.role : 'editor'; $('umAll').checked = !!(u && u.allWards);
  wardChecks('umWards', u && u.wards || {}); umRoleUI(); $('btnUmDel').hidden = !u;
  $('mUser').classList.add('open'); setTimeout(() => (u ? $('umName') : $('umEmail')).focus(), 50);
}
function umRoleUI() { $('umWardBox').hidden = $('umRole').value !== 'editor'; $('umWards').style.opacity = $('umAll').checked ? .4 : 1; }
async function saveUser() {
  const email = $('umEmail').value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('อีเมลไม่ถูกต้อง', true);
  const k = ekey(email); if (!UM_KEY && RAW.users && RAW.users[k]) return toast('มีอีเมลนี้แล้ว', true);
  const role = $('umRole').value, o = { email, name: norm($('umName').value), role };
  if (role === 'editor') { if ($('umAll').checked) o.allWards = true; else { o.wards = checkedWards('umWards'); if (!Object.keys(o.wards).length) return toast('เลือกหน่วยงานที่ลงข้อมูลได้อย่างน้อย 1 หน่วยงาน', true); } }
  try { await BE.commit({ ['users/' + k]: o }); closeModal('mUser'); toast(`✓ บันทึกสิทธิ์ ${email} แล้ว`); } catch (e) { toast(errMsg(e), true); }
}
async function deleteUser() {
  if (!UM_KEY || !confirm(`ลบสิทธิ์ของ ${RAW.users[UM_KEY].email}?`)) return;
  try { await BE.commit({ ['users/' + UM_KEY]: null }); closeModal('mUser'); toast('✓ ลบผู้ใช้แล้ว'); } catch (e) { toast(errMsg(e), true); }
}

/* ---------- นำเข้า / ส่งออก Excel ---------- */
let IMPORT = null;
function colMap(headers, spec, sheet) {
  const H = headers.map(norm), map = {}, missing = [];
  Object.entries(spec).forEach(([key, s]) => {
    let idx = -1;
    for (const n of s.names) { idx = H.indexOf(n); if (idx >= 0) break; }
    if (idx < 0 && !s.exact) for (const n of s.names) { idx = H.findIndex(h => h.indexOf(n) === 0); if (idx >= 0) break; }
    map[key] = idx; if (idx < 0 && s.req) missing.push(s.names[0]);
  });
  if (missing.length) throw new Error(`แท็บ "${sheet}" ไม่พบคอลัมน์: ${missing.join(', ')}`);
  return map;
}
const cell = (r, i) => i < 0 ? '' : r[i];
async function readXlsx(file) {
  await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = name => { const n = wb.SheetNames.find(s => norm(s).toLowerCase() === name.toLowerCase()); return n ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true }) : null; };
  const kRows = sheet('KPI'); if (!kRows) throw new Error('ไม่พบแท็บ "KPI" ในไฟล์');
  const wRows = sheet('Wards'), dRows = sheet('มิติ'), rRows = sheet('ผลงาน'), warn = [];
  // หน่วยงาน — ใช้รหัสเดิมถ้าชื่อตรงกัน เพื่อให้ผลงานเดิมยังเชื่อมกันอยู่
  const byName = Object.fromEntries(S.wards.map(w => [w.name, w.id]));
  const wards = {}, wardByName = {}, groupMap = {};
  const addWard = (name, group) => { if (wardByName[name]) return wardByName[name]; const id = byName[name] || newId('w'); wards[id] = { name, group: group || 'อื่น ๆ', order: Object.keys(wards).length + 1 }; wardByName[name] = id; (groupMap[wards[id].group] ??= []).push(id); return id; };
  if (wRows) { const c = colMap(wRows[0], { ward: { names: ['หน่วยงาน', 'วอร์ด', 'หอผู้ป่วย', 'Ward'], exact: true, req: true }, group: { names: ['กลุ่มงาน', 'กลุ่ม', 'Group'], exact: true } }, 'Wards');
    wRows.slice(1).forEach(r => { const n = norm(r[c.ward]); if (n) addWard(n, norm(cell(r, c.group))); }); }
  else warn.push('ไม่พบแท็บ Wards — หน่วยงานจะสร้างจากคอลัมน์ "หน่วยงานที่ใช้" และอยู่กลุ่ม "อื่น ๆ"');
  const c = colMap(kRows[0], { id: { names: ['KPI_ID', 'รหัสตัวชี้วัด', 'รหัส'], req: true }, name: { names: ['ชื่อตัวชี้วัด', 'ตัวชี้วัด'], req: true }, dim: { names: ['มิติ', 'หมวด'], exact: true },
    mult: { names: ['ตัวคูณ'] }, target: { names: ['เป้าหมาย', 'เกณฑ์'] }, dir: { names: ['ทิศทาง'] }, unit: { names: ['หน่วย', 'หน่วยนับ'], exact: true }, num: { names: ['ชื่อตัวตั้ง', 'ตัวตั้ง'] },
    den: { names: ['ชื่อตัวหาร', 'ตัวหาร'] }, wards: { names: ['หน่วยงานที่ใช้', 'หน่วยงาน'] }, defN: { names: ['นิยามตัวตั้ง'] }, defD: { names: ['นิยามตัวหาร'] }, note: { names: ['หมายเหตุ'] } }, 'KPI');
  const kpis = {}, dimsUsed = new Set(); let bad = 0, noTgt = 0;
  kRows.slice(1).forEach((r, i) => {
    const id = norm(r[c.id]); if (!id) return;
    if (!okKey(id)) { bad++; return; }
    const toks = String(cell(r, c.wards) || '').split(/[,\/]/).map(norm).filter(Boolean);
    let allWards = false, set = {};
    if (!toks.length) allWards = true;
    else { const ws = toks.filter(t => wardByName[t]); if (ws.length) ws.forEach(t => set[wardByName[t]] = true);
      else toks.forEach(t => { if (groupMap[t]) groupMap[t].forEach(w => set[w] = true); else set[addWard(t)] = true; }); }
    const dim = norm(cell(r, c.dim)).replace(/\.0+$/, '') || '0'; dimsUsed.add(dim);
    const k = { name: norm(r[c.name]), dim, order: i + 1, target: cell(r, c.target), dir: cell(r, c.dir), unit: cell(r, c.unit), num: cell(r, c.num), den: cell(r, c.den),
      defN: cell(r, c.defN), defD: cell(r, c.defD), note: cell(r, c.note), multRaw: cell(r, c.mult), allWards, wardSet: set };
    if (!norm(k.target)) noTgt++;
    kpis[id] = kpiToDb(k);
  });
  // มิติ
  const dims = {}, cur = Object.values(RAW.meta && RAW.meta.dims || {});
  if (dRows) { const cd = colMap(dRows[0], { dim: { names: ['มิติ', 'หมวด', 'รหัสมิติ'], exact: true, req: true }, name: { names: ['ชื่อมิติ', 'ชื่อหมวด', 'ชื่อ'], exact: true, req: true } }, 'มิติ');
    dRows.slice(1).forEach((r, i) => { const d = norm(r[cd.dim]).replace(/\.0+$/, ''); if (d) dims['d' + d] = { key: d, name: norm(r[cd.name]) || 'มิติที่ ' + d, order: i + 1 }; }); }
  [...dimsUsed].sort(byNum).forEach(d => { if (!dims['d' + d]) { const old = cur.find(x => String(x.key) === d); dims['d' + d] = { key: d, name: old ? old.name : (DEFAULT_DIMS[d] || 'มิติที่ ' + d), order: +d || 99 }; } });
  // ผลงาน (ถ้ามี)
  const results = [];
  if (rRows && rRows.length > 1) {
    const cr = colMap(rRows[0], { year: { names: ['ปีงบประมาณ'], req: true }, month: { names: ['เดือน'], req: true }, ward: { names: ['หน่วยงาน'], exact: true, req: true }, id: { names: ['KPI_ID'], req: true },
      n: { names: ['ตัวตั้ง'], exact: true }, d: { names: ['ตัวหาร'], exact: true }, v: { names: ['ผลลัพธ์'], req: true }, by: { names: ['ผู้บันทึก'] } }, 'ผลงาน');
    rRows.slice(1).forEach(r => { const y = norm(r[cr.year]).replace(/\.0+$/, ''), m = norm(r[cr.month]), wn = norm(r[cr.ward]), id = norm(r[cr.id]), v = r[cr.v];
      if (!y || !M2K[m] || !wardByName[wn] || !kpis[id] || v === '' || isNaN(+v)) return;
      const o = { y, mk: M2K[m], wid: wardByName[wn], id, v: +v, by: norm(cell(r, cr.by)) || 'นำเข้าจาก Google Sheet' };
      const n = cell(r, cr.n), d = cell(r, cr.d); if (n !== '' && !isNaN(+n)) o.n = +n; if (d !== '' && !isNaN(+d)) o.d = +d; if (o.by.length < 3) o.by = 'นำเข้าจาก Google Sheet';
      results.push(o); });
  }
  if (bad) warn.push(`ข้าม ${bad} แถวที่ KPI_ID มีอักขระต้องห้าม (. # $ [ ] /)`);
  if (noTgt) warn.push(`ตัวชี้วัด ${noTgt} ตัวยังไม่มีเป้าหมาย จะแสดงเป็น "ไม่มีเกณฑ์" (เติมภายหลังได้ที่แท็บตัวชี้วัด)`);
  const lost = S.wards.filter(w => !wards[w.id]); if (lost.length) warn.push(`หน่วยงานเดิม ${lost.length} แห่งไม่มีในไฟล์ จะถูกลบออก: ${lost.map(w => w.name).join(', ')}`);
  return { meta: { wards, dims, kpis }, results, groups: Object.keys(groupMap), warn };
}
const DEFAULT_DIMS = { 1: 'มิติที่ 1 การนำและการบริหาร', 2: 'มิติที่ 2 ประสิทธิภาพการบริหารทรัพยากร', 3: 'มิติที่ 3 ผู้รับบริการและผู้มีส่วนได้ส่วนเสีย', 4: 'มิติที่ 4 บุคลากรพยาบาล', 5: 'มิติที่ 5 กระบวนการและระบบงาน', 6: 'มิติที่ 6 ผลลัพธ์การพยาบาล' };
async function onXlsx(file) {
  if (!file) return;
  loading(true, 'กำลังอ่านไฟล์…');
  try {
    IMPORT = await readXlsx(file);
    const m = IMPORT.meta;
    $('ioKv').innerHTML = [['กลุ่มงาน', IMPORT.groups.length], ['หน่วยงาน', Object.keys(m.wards).length], ['มิติ', Object.keys(m.dims).length], ['ตัวชี้วัด', Object.keys(m.kpis).length], ['ผลงาน (แถว)', IMPORT.results.length]]
      .map(([t, n]) => `<div><b>${n.toLocaleString()}</b><small>${t}</small></div>`).join('');
    $('ioWarn').hidden = !IMPORT.warn.length; $('ioWarn').innerHTML = IMPORT.warn.map(w => '• ' + esc(w)).join('<br>');
    $('ioRes').checked = false; $('ioRes').disabled = !IMPORT.results.length; $('ioPreview').hidden = false;
  } catch (e) { toast('อ่านไฟล์ไม่สำเร็จ: ' + e.message, true); }
  finally { loading(false); $('fileXlsx').value = ''; }
}
async function doImport() {
  if (!IMPORT) return;
  const doMeta = $('ioMeta').checked, doRes = $('ioRes').checked && IMPORT.results.length;
  if (!doMeta && !doRes) return toast('เลือกอย่างน้อย 1 อย่างที่จะนำเข้า', true);
  if (!confirm(`ยืนยันการนำเข้า?${doMeta ? '\n• แทนที่ข้อมูลพื้นฐานทั้งหมด' : ''}${doRes ? `\n• นำเข้าผลงาน ${IMPORT.results.length} แถว` : ''}`)) return;
  loading(true, 'กำลังนำเข้าข้อมูลพื้นฐาน…');
  try {
    if (doMeta) await BE.commit({ meta: Object.assign({}, IMPORT.meta, { _sync: { at: TS, by: USER.email, source: 'web-import' } }) });
    if (doRes) {
      const rs = IMPORT.results;
      for (let i = 0; i < rs.length; i += 500) {
        loading(true, `กำลังนำเข้าผลงาน ${Math.min(i + 500, rs.length)} / ${rs.length}…`);
        const u = {};
        rs.slice(i, i + 500).forEach(r => {
          const rec = { v: r.v, by: r.by, email: USER.email, at: TS }; if (r.n != null) rec.n = r.n; if (r.d != null) rec.d = r.d;
          u[`results/y${r.y}/${r.wid}/${r.mk}/${r.id}`] = rec;
          u[`log/y${r.y}/${BE.newKey('log/y' + r.y)}`] = { ts: TS, action: 'เพิ่ม', by: r.by, email: USER.email, wid: r.wid, ward: IMPORT.meta.wards[r.wid].name, month: K2M[r.mk], kpiId: r.id, kpiName: IMPORT.meta.kpis[r.id].name, v: r.v, ...(r.n != null ? { n: r.n } : {}), ...(r.d != null ? { d: r.d } : {}), old: 'นำเข้าจาก Google Sheet' };
        });
        await BE.commit(u);
      }
    }
    $('ioPreview').hidden = true; IMPORT = null; WEDIT = DEDIT = null;
    toast('✓ นำเข้าข้อมูลเรียบร้อย');
  } catch (e) { toast('นำเข้าไม่สำเร็จ: ' + errMsg(e), true); }
  finally { loading(false); }
}
async function exportAll() {
  loading(true, 'กำลังเตรียมไฟล์…');
  try {
    await loadXLSX();
    const y = $('xYear').value || YEAR;
    const get = p => new Promise(res => { const un = BE.watch(p, v => { setTimeout(() => un && un(), 0); res(v); }, { onError: () => res(null) }); });
    const [res, log] = await Promise.all([y === YEAR ? Promise.resolve(RAW.results) : get('results/y' + y), get('log/y' + y)]);
    const wb = XLSX.utils.book_new(), add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name);
    add('KPI', S.kpis.map(k => ({ KPI_ID: k.id, 'ชื่อตัวชี้วัด': k.name, 'มิติ': k.dim, 'ตัวคูณ': k.multRaw, 'เป้าหมาย': k.target, 'หน่วย': k.unit, 'ชื่อตัวตั้ง': k.num, 'ชื่อตัวหาร': k.den,
      'หน่วยงานที่ใช้ (คั่นด้วย , / เว้นว่าง=ทุกหน่วยงาน)': k.allWards ? '' : k.wards.map(wname).join(','), 'นิยามตัวตั้ง': k.defN, 'นิยามตัวหาร': k.defD, 'หมายเหตุการนับ': k.note })));
    add('Wards', S.wards.map(w => ({ 'กลุ่มงาน': w.group, 'หน่วยงาน': w.name })));
    add('มิติ', Object.keys(S.dims).sort(byNum).map(d => ({ 'มิติ': d, 'ชื่อมิติ': S.dims[d] })));
    const rows = [];
    Object.entries(res || {}).forEach(([wid, bm]) => Object.entries(bm || {}).forEach(([mk, bk]) => Object.entries(bk || {}).forEach(([id, x]) => {
      const k = KPI[id]; rows.push({ 'ปีงบประมาณ': y, 'เดือน': K2M[mk], 'หน่วยงาน': wname(wid), KPI_ID: id, 'ชื่อตัวชี้วัด': k ? k.name : id, 'ตัวตั้ง': x.n ?? '', 'ตัวหาร': x.d ?? '', 'ผลลัพธ์': x.v,
        'ผลการประเมิน': k ? STATUS[statusOf(k, x.v)] : '', 'บันทึกเมื่อ': fmtTs(x.at), 'ผู้บันทึก (ชื่อ-นามสกุล)': x.by, 'อีเมล': x.email });
    })));
    rows.sort((a, b) => a['หน่วยงาน'].localeCompare(b['หน่วยงาน'], 'th') || MONTHS.indexOf(a['เดือน']) - MONTHS.indexOf(b['เดือน']));
    add('ผลงาน', rows);
    add('Log', Object.values(log || {}).sort((a, b) => (a.ts || 0) - (b.ts || 0)).map(l => ({ 'เวลา': fmtTs(l.ts), 'การดำเนินการ': l.action, 'ผู้ดำเนินการ': l.by, 'อีเมล': l.email, 'ปีงบประมาณ': y, 'เดือน': l.month, 'หน่วยงาน': l.ward, KPI_ID: l.kpiId, 'ชื่อตัวชี้วัด': l.kpiName, 'ค่าใหม่': valText(l), 'ค่าเดิม': l.old })));
    XLSX.writeFile(wb, `KPI-กลุ่มการพยาบาล-${y}.xlsx`);
  } catch (e) { toast('ส่งออกไม่สำเร็จ: ' + errMsg(e), true); }
  finally { loading(false); }
}

/* ================= Modals ================= */
function closeModal(id) { $(id).classList.remove('open'); }

/* ================= Auth / boot ================= */
function showGate(msg, denyEmail) {
  loading(false); $('app').hidden = true; $('gate').hidden = false;
  $('gateDeny').hidden = !denyEmail;
  if (denyEmail) $('gateDeny').innerHTML = `บัญชี <b>${esc(denyEmail)}</b> ยังไม่ได้รับสิทธิ์ใช้งานระบบ<br>แจ้งผู้ดูแลระบบให้เพิ่มอีเมลนี้ที่แท็บ ตั้งค่า → ผู้ใช้งาน`;
  $('btnLogin').hidden = !!denyEmail; $('btnGateOut').hidden = !denyEmail;
  if (msg) $('gateMsg').textContent = msg;
}
function stopData() { Object.keys(UNSUB).forEach(k => { UNSUB[k] && UNSUB[k](); UNSUB[k] = null; }); STARTED = false; firstData = { meta: false, results: false }; }
function startApp() {
  $('gate').hidden = true; $('app').hidden = false;
  applyRoleUI();
  if (STARTED) { onData('meta'); return; }
  STARTED = true; loading(true, 'กำลังโหลดข้อมูล…');
  UNSUB.meta = BE.watch('meta', v => { RAW.meta = v; buildMeta(v); onData('meta'); });
  watchYear();
}
async function boot() {
  initCharts();
  bindEvents();
  $('eFirst').value = store.get('kpiFirst'); $('eLast').value = store.get('kpiLast');
  const demo = !(CFG.firebase && CFG.firebase.apiKey);
  try { BE = demo ? makeDemo(demoSeed()) : await makeFirebase(CFG.firebase); }
  catch (e) { loading(false); showGate('เชื่อมต่อ Firebase ไม่สำเร็จ: ' + errMsg(e)); return; }
  if (demo) { $('demoBar').hidden = false; document.body.classList.add('is-demo'); }
  let unProfile = null;
  BE.onAuth(user => {
    unProfile && unProfile(); unProfile = null;
    if (!user) { stopData(); USER = null; showGate(); return; }
    USER = { uid: user.uid, email: String(user.email || '').toLowerCase(), displayName: user.displayName || '' };
    const sup = SUPER.includes(USER.email);
    loading(true, 'กำลังตรวจสอบสิทธิ์…');
    if (BE.demo) { PROFILE = { role: 'admin', name: 'ผู้ดูแล (ตัวอย่าง)' }; ROLE = 'admin'; startApp(); return; }
    unProfile = BE.watch('users/' + ekey(USER.email), p => {
      PROFILE = p; ROLE = sup ? 'admin' : (p && p.role) || '';
      if (!ROLE) { stopData(); showGate('', USER.email); return; }
      startApp();
    }, { onError: e => { stopData(); showGate('ตรวจสอบสิทธิ์ไม่สำเร็จ: ' + errMsg(e)); } });
  });
}

function bindEvents() {
  $('btnLogin').addEventListener('click', async () => { $('btnLoginTxt').textContent = 'กำลังเปิดหน้าต่าง Google…'; try { await BE.signIn(); } catch (e) { toast(errMsg(e), true); } finally { $('btnLoginTxt').textContent = 'เข้าสู่ระบบด้วย Google'; } });
  $('btnGateOut').addEventListener('click', () => BE.signOut());
  $('meBtn').addEventListener('click', e => { e.stopPropagation(); $('meMenu').hidden = !$('meMenu').hidden; });
  document.addEventListener('click', e => { if (!e.target.closest('#me')) $('meMenu').hidden = true; });
  $('btnLogout').addEventListener('click', () => { if (confirmDiscard()) BE.signOut(); });

  $('tabs').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) showView(t.dataset.v); });
  $$('[data-year]').forEach(el => {
    el.addEventListener('focus', () => el._prev = el.value);
    el.addEventListener('change', async () => { if (el.id === 'xYear') return; if (!confirmDiscard()) { el.value = el._prev; return; } $('eList').dataset.built = ''; await setYear(el.value); });
  });
  // dashboard
  ['fMonth', 'fDim'].forEach(id => $(id).addEventListener('change', renderDash));
  $('fSearch').addEventListener('input', renderDash);
  $('gChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; selGroup = b.dataset.g; if (selWard && selGroup && WARD[selWard].group !== selGroup) selWard = ''; renderDash(); });
  $('tiles').addEventListener('click', e => { const t = e.target.closest('.tile'); if (t) selectWard(t.dataset.w, true); });
  $('btnClear').addEventListener('click', () => { selWard = ''; selGroup = ''; store.set('kpiWard', ''); renderDash(); });
  $('sChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; $$('#sChips .chip').forEach(c => c.classList.toggle('on', c === b)); statusFilter = b.dataset.s; renderMatrix(); });
  $('mx').addEventListener('click', e => { const tr = e.target.closest('tr.row'); if (tr) openDetail(KPI[tr.dataset.id], selWard); });
  $('btnWardEntry').addEventListener('click', () => goEntry({ ward: selWard, month: $('fMonth').value }));
  // entry
  $('eList').addEventListener('input', e => { const c = e.target.closest('.kc'); if (!c) return; calcCard(c); updateEntryFoot(); });
  $('eKpi').addEventListener('change', () => { showEntryKpi(); window.scrollTo({ top: $('eList').offsetTop - 90, behavior: 'smooth' }); });
  ['eFirst', 'eLast'].forEach(id => $(id).addEventListener('input', () => $(id).classList.remove('err')));
  ['eGroup', 'eWard', 'eMonth'].forEach(id => {
    $(id).addEventListener('focus', () => $(id)._prev = $(id).value);
    $(id).addEventListener('change', () => {
      if (!confirmDiscard()) { $(id).value = $(id)._prev; return; }
      if (id === 'eGroup') fillEntryWards();
      if (id !== 'eMonth') { $('eKpi').value = ''; fillEntryKpis(); }
      buildEntry(); $(id)._prev = $(id).value;
    });
  });
  $('btnSave').addEventListener('click', saveEntry);
  $('btnReset').addEventListener('click', () => { if (confirm('ยกเลิกค่าที่แก้ไขทั้งหมด กลับเป็นค่าที่บันทึกไว้?')) { eDirty = 0; refreshEntry(); } });
  window.addEventListener('beforeunload', e => { if (eDirty) { e.preventDefault(); e.returnValue = ''; } });
  // log
  ['lWard', 'lMonth', 'lBy'].forEach(id => $(id).addEventListener('change', () => { lShown = 100; renderLog(); }));
  $('lSearch').addEventListener('input', () => { lShown = 100; renderLog(); });
  $('lMode').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; $$('#lMode .chip').forEach(c => c.classList.toggle('on', c === b)); lMode = b.dataset.m; lShown = 100; $('lBy').value = ''; if (lMode === 'hist') watchLog(); renderLog(); });
  $('btnLMore').addEventListener('click', () => { lShown += 100; renderLog(); });
  $('btnLogXlsx').addEventListener('click', () => exportLogXlsx().catch(e => toast(errMsg(e), true)));
  $('lt').addEventListener('change', e => {
    if (e.target.id === 'chkAll') { $$('#lt tbody tr[data-key]').forEach(tr => { if (!tr.querySelector('.chk')) return; e.target.checked ? SEL.add(tr.dataset.key) : SEL.delete(tr.dataset.key); }); renderLog(); return; }
    if (e.target.classList.contains('chk')) { const tr = e.target.closest('tr'); e.target.checked ? SEL.add(tr.dataset.key) : SEL.delete(tr.dataset.key); tr.classList.toggle('sel', e.target.checked); $('selBar').hidden = !SEL.size; $('selTxt').textContent = `เลือก ${SEL.size} รายการ`; }
  });
  $('lt').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const r = findRec(b.closest('tr').dataset.key); if (!r) return;
    if (b.dataset.act === 'edit') goEntry({ ward: r.wid, month: r.month, id: r.id }); else askDelete([recKey(r)]);
  });
  $('btnDelSel').addEventListener('click', () => askDelete([...SEL]));
  $('btnSelClear').addEventListener('click', () => { SEL.clear(); renderLog(); });
  $('btnDelOk').addEventListener('click', doDelete);
  // settings
  $('sTabs').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; $$('#sTabs .chip').forEach(c => c.classList.toggle('on', c === b)); sTab = b.dataset.s; renderSet(); });
  $('wardTbl').addEventListener('input', e => { const tr = e.target.closest('tr[data-i]'); if (!tr) return; const w = WEDIT[+tr.dataset.i]; w[e.target.dataset.f] = e.target.value; });
  $('wardTbl').addEventListener('click', e => { const b = e.target.closest('[data-act="tgl"]'); if (!b) return; const w = WEDIT[+b.closest('tr').dataset.i]; w._del = !w._del; renderWardTbl(); });
  $('btnWardSave').addEventListener('click', saveWards); $('btnWardUndo').addEventListener('click', () => renderWardTbl(true));
  $('btnWardNew').addEventListener('click', openNewWard);
  $('nwCopy').addEventListener('change', nwPrefixHint); $('nwPrefix').addEventListener('input', nwPrefixHint);
  $('btnNwOk').addEventListener('click', addWard);
  $('dimTbl').addEventListener('input', e => { const tr = e.target.closest('tr[data-i]'); if (tr) DEDIT[+tr.dataset.i][e.target.dataset.f] = e.target.value; });
  $('dimTbl').addEventListener('click', e => { const b = e.target.closest('[data-act="tgl"]'); if (!b) return; const d = DEDIT[+b.closest('tr').dataset.i]; if (d._new) DEDIT.splice(DEDIT.indexOf(d), 1); else d._del = !d._del; renderDimTbl(); });
  $('btnDimAdd').addEventListener('click', () => { if (!DEDIT) renderDimTbl(); const mx = Math.max(0, ...DEDIT.map(d => +d.key || 0)); DEDIT.push({ key: String(mx + 1), name: 'มิติที่ ' + (mx + 1), order: mx + 1, _new: true }); renderDimTbl(); });
  $('btnDimSave').addEventListener('click', saveDims); $('btnDimUndo').addEventListener('click', () => renderDimTbl(true));
  ['kWard', 'kDim'].forEach(id => $(id).addEventListener('change', () => { kShown = 100; renderKpiTbl(); }));
  $('kSearch').addEventListener('input', () => { kShown = 100; renderKpiTbl(); });
  $('btnKMore').addEventListener('click', () => { kShown += 100; renderKpiTbl(); });
  $('kpiTbl').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) openKpi(tr.dataset.id); });
  $('btnKpiNew').addEventListener('click', () => openKpi(null));
  $('kmTarget').addEventListener('input', kmTgtPreview);
  $('kmAll').addEventListener('change', () => $('kmWards').style.opacity = $('kmAll').checked ? .4 : 1);
  ['kmWards', 'umWards'].forEach(id => $(id).addEventListener('change', e => { if (e.target.dataset.g != null) e.target.closest('.wgrp').querySelectorAll('.ws input').forEach(c => c.checked = e.target.checked); syncGroupChecks(id); }));
  $('btnKmOk').addEventListener('click', saveKpi); $('btnKmDel').addEventListener('click', deleteKpi);
  $('userTbl').addEventListener('click', e => { const tr = e.target.closest('tr[data-k]'); if (tr) openUser(tr.dataset.k); });
  $('btnUserNew').addEventListener('click', () => openUser(null));
  $('umRole').addEventListener('change', umRoleUI); $('umAll').addEventListener('change', umRoleUI);
  $('btnUmOk').addEventListener('click', saveUser); $('btnUmDel').addEventListener('click', deleteUser);
  $('fileXlsx').addEventListener('change', e => onXlsx(e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => onXlsx(e.dataTransfer.files[0]));
  $('btnIoCancel').addEventListener('click', () => { $('ioPreview').hidden = true; IMPORT = null; });
  $('btnIoGo').addEventListener('click', doImport);
  $('btnExport').addEventListener('click', exportAll);
  // modals
  $$('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
  ['mDetail', 'mDel', 'mWard', 'mKpi', 'mUser'].forEach(id => $(id).addEventListener('click', e => { if (e.target.id === id) closeModal(id); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ['mDel', 'mWard', 'mKpi', 'mUser', 'mDetail'].forEach(closeModal); });
}

/* ================= ข้อมูลตัวอย่าง (โหมดตัวอย่าง) ================= */
function demoSeed() {
  const W = [['อายุรกรรมชาย', 'ผู้ป่วยใน'], ['อายุรกรรมหญิง', 'ผู้ป่วยใน'], ['ศัลยกรรมชาย', 'ผู้ป่วยใน'], ['กุมารเวชกรรม', 'ผู้ป่วยใน'], ['การพยาบาลผู้ป่วยหนัก', 'ผู้ป่วยหนัก'], ['การพยาบาลผู้คลอด', 'ผู้คลอด'], ['การพยาบาลวิสัญญี', 'วิสัญญี']];
  const T = [['1', '1. ร้อยละของตัวชี้วัดวิสัยทัศน์ที่บรรลุเป้าหมาย', 'มากกว่าหรือเท่ากับร้อยละ 80', 'ร้อยละ', 100, 'จำนวนตัวชี้วัดวิสัยทัศน์ที่บรรลุเป้าหมาย', 'จำนวนตัวชี้วัดวิสัยทัศน์ทั้งหมด'],
    ['1', '3. ร้อยละของบุคลากรพยาบาลที่มีผลการประเมินจริยธรรมผ่านเกณฑ์', 'มากกว่าหรือเท่ากับร้อยละ 80', 'ร้อยละ', 100, 'จำนวนบุคลากรที่ผ่านเกณฑ์', 'จำนวนบุคลากรพยาบาลทั้งหมด'],
    ['2', '1. ผลิตภาพของงานการพยาบาลผู้ป่วยใน (Nursing Productivity)', 'ร้อยละ 90 – 110', 'อัตรา', 100, 'ชั่วโมงความต้องการการพยาบาล', 'ชั่วโมงการปฏิบัติการพยาบาล'],
    ['2', '2. จำนวนวันนอนเฉลี่ย', '', 'ค่าเฉลี่ย', null, '', ''],
    ['3', '6. จำนวนข้อร้องเรียนเกี่ยวกับพฤติกรรมบริการ', 'เท่ากับ 0', 'จำนวน', null, 'นับจำนวนข้อร้องเรียน', ''],
    ['4', '3. ร้อยละการโอนย้ายและลาออกของบุคลากรพยาบาล', 'น้อยกว่าหรือเท่ากับร้อยละ 1', 'ร้อยละ', 100, 'จำนวนบุคลากรที่โอนย้ายและลาออก', 'จำนวนบุคลากรพยาบาลทั้งหมด'],
    ['4', '5. ร้อยละของบุคลากรได้รับการอบรมฟื้นฟูทักษะการช่วยฟื้นคืนชีพ', 'ร้อยละ 100', 'ร้อยละ', 100, 'จำนวนบุคลากรที่ได้รับการอบรม', 'จำนวนบุคลากรพยาบาลทั้งหมด'],
    ['5', '2. ร้อยละของการบันทึกทางการพยาบาลตามเกณฑ์มาตรฐาน', 'ร้อยละ 100', 'ร้อยละ', 100, 'จำนวนบันทึกที่ครบถ้วน', 'จำนวนบันทึกที่สุ่มประเมินทั้งหมด'],
    ['6', '9. ร้อยละของการพลัดตกหกล้มมีความรุนแรงระดับ E-I', '', 'ร้อยละ', null, '', ''],
    ['6', '11. อัตราการเกิดแผลกดทับในโรงพยาบาล', '', 'อัตรา', null, '', '']];
  const wards = {}, kpis = {}, dims = {}, results = {}, log = {}, y = 'y' + fyNow();
  W.forEach(([name, group], i) => wards['w' + i] = { name, group, order: i + 1 });
  Object.entries(DEFAULT_DIMS).forEach(([k, n]) => dims['d' + k] = { key: k, name: n, order: +k });
  let ord = 0; W.forEach((_, wi) => T.forEach((t, i) => { const o = { name: t[1], dim: t[0], unit: t[3], order: ++ord, wards: { ['w' + wi]: true } }; if (t[2]) o.target = t[2]; if (t[4]) o.mult = t[4]; if (t[5]) o.num = t[5]; if (t[6]) o.den = t[6]; kpis['DM' + wi + String(i + 1).padStart(2, '0')] = o; }));
  const names = ['สมศรี ใจดี', 'วิภา รักษ์ไทย', 'กนกพร แสงทอง', 'อรุณี บุญมา'], lm = lastMonth(), upto = Math.max(lm.year === fyNow() ? MONTHS.indexOf(lm.month) : 11, 4);
  let seq = 0;
  Object.entries(kpis).forEach(([id, k], ki) => {
    if (ki % 9 === 4) return; const wid = Object.keys(k.wards)[0], tg = parseTarget(k.target);
    for (let m = 0; m <= upto; m++) {
      if (Math.random() < .15) continue;
      const rec = {};
      if (k.den) { const d = 20 + Math.round(Math.random() * 20), p = tg ? (tg.op === '<=' ? .004 : tg.op === 'between' ? 1 : tg.v / 100 * 1.02) : .9; let n = Math.max(0, Math.round(d * p * (.86 + Math.random() * .22))); if (tg && tg.op !== 'between') n = Math.min(n, d); Object.assign(rec, { n, d, v: Math.round(n / d * (k.mult || 1) * 100) / 100 }); }
      else rec.v = k.unit === 'จำนวน' ? (Math.random() < .75 ? 0 : 1 + Math.round(Math.random() * 2)) : k.unit === 'ค่าเฉลี่ย' ? +(4 + Math.random() * 3).toFixed(1) : +(Math.random() * (k.unit === 'ร้อยละ' ? 100 : 5)).toFixed(2);
      const ts = Date.now() - Math.round((12 - m + Math.random()) * 86400000 * 2.5), by = names[(ki + m) % names.length];
      Object.assign(rec, { by, email: 'ward' + wid.slice(1) + '@demo', at: ts });
      ((results[wid] ??= {})[MK[m]] ??= {})[id] = rec;
      log['L' + String(ts).padStart(15, '0') + String(seq++).padStart(5, '0')] = { ts, action: 'เพิ่ม', by, email: rec.email, wid, ward: wards[wid].name, month: MONTHS[m], kpiId: id, kpiName: k.name, n: rec.n, d: rec.d, v: rec.v, old: '' };
    }
  });
  return { meta: { wards, dims, kpis }, results: { [y]: results }, log: { [y]: log }, users: {
    'ward0@demo': { email: 'ward0@demo', name: 'วอร์ดอายุรกรรมชาย', role: 'editor', wards: { w0: true } },
    'head@demo': { email: 'head@demo', name: 'หัวหน้ากลุ่มการพยาบาล', role: 'viewer' } } };
}

boot();
