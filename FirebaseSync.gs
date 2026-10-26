/**
 * FirebaseSync.gs — ซิงก์สองทาง Google Sheet ⇄ Firebase Realtime Database
 * ---------------------------------------------------------------------------
 * ซิงก์แท็บ KPI, Wards, มิติ กับ meta/ ใน Firebase (ผลงานและ Log อยู่ใน Firebase อย่างเดียว)
 *   - แก้ในชีต → Firebase อัปเดตภายใน ~1 นาที
 *   - แก้ในหน้าเว็บ → ชีตอัปเดตภายใน ~1 นาที
 *   - แก้ตัวเดียวกันทั้งสองฝั่งพร้อมกัน → ยึดค่าจากเว็บ (บันทึกไว้ในแท็บ "สถานะซิงก์")
 *   - ลบแถวในชีตจำนวนมากผิดปกติ → ไม่ลบใน Firebase แจ้งเตือนแทน
 *
 * ติดตั้ง (ครั้งเดียว):
 *   1) ใส่ databaseURL ของ Firebase ใน FBS_DB_URL ด้านล่าง
 *   2) เพิ่ม oauthScopes ใน appsscript.json (ดูคู่มือ)
 *   3) เลือกฟังก์ชัน fbsSetup → Run → อนุญาตสิทธิ์
 *   บัญชีที่กด Run ต้องเป็นเจ้าของ/ผู้แก้ไขโปรเจกต์ Firebase (เช่น banmihospital9@gmail.com)
 *
 * ชื่อทั้งหมดขึ้นต้นด้วย fbs / FBS ไม่ชนกับโค้ดอื่นในโปรเจกต์
 */
var FBS_DB_URL = '';   // เช่น 'https://nursing-kpi-default-rtdb.asia-southeast1.firebasedatabase.app'

function fbsSetup() { return FBS.setup(); }               // ติดตั้ง: สร้างแท็บ เมนู และตั้งเวลาซิงก์อัตโนมัติ
function fbsSyncNow() { return FBS.syncNow(); }           // ซิงก์ทันที
function fbsStop() { return FBS.stop(); }                 // หยุดซิงก์อัตโนมัติ
function fbsPullResults() { return FBS.pullResults(); }   // ดึงผลงานจาก Firebase ลงชีต
function fbsTest() { return FBS.test(); }                 // ตรวจการเชื่อมต่อ
function fbsTick() { return FBS.tick(); }                 // (ทริกเกอร์เวลา)
function fbsOnEdit(e) { return FBS.onEdit(e); }           // (ทริกเกอร์แก้ไข)
function fbsOnOpen() { return FBS.onOpen(); }             // (ทริกเกอร์เปิดไฟล์: เมนู)

var FBS = (function () {
  const T = { kpi: 'KPI', wards: 'Wards', dims: 'มิติ', status: 'สถานะซิงก์', base: '_sync_base' };
  const MONTHS = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];
  const DEFAULT_DIMS = { 1: 'มิติที่ 1 การนำและการบริหาร', 2: 'มิติที่ 2 ประสิทธิภาพการบริหารทรัพยากร', 3: 'มิติที่ 3 ผู้รับบริการและผู้มีส่วนได้ส่วนเสีย',
    4: 'มิติที่ 4 บุคลากรพยาบาล', 5: 'มิติที่ 5 กระบวนการและระบบงาน', 6: 'มิติที่ 6 ผลลัพธ์การพยาบาล' };
  const WARD_ID_HEADER = 'ward_id (ระบบใช้ ห้ามแก้)';
  const DELETE_GUARD = { min: 5, ratio: 0.1 };   // ลบจากชีตเกิน 5 รายการ และเกิน 10% → ไม่ลบใน Firebase
  const KPI_FIELDS = ['name', 'dim', 'mult', 'target', 'dir', 'unit', 'num', 'den', 'defN', 'defD', 'note'];

  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const props = () => PropertiesService.getScriptProperties();
  function ss() {
    try { const a = SpreadsheetApp.getActive(); if (a) return a; } catch (e) { }
    const id = props().getProperty('ssId'); if (!id) throw new Error('ไม่พบไฟล์ชีต — รัน fbsSetup จากไฟล์ชีตก่อน');
    return SpreadsheetApp.openById(id);
  }
  const newId = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const okKey = s => !!s && !/[.#$\[\]\/]/.test(s);

  /* ---------------- Firebase REST (สิทธิ์ของบัญชีที่รันสคริปต์ ข้ามกฎความปลอดภัยได้ในฐานะเจ้าของโปรเจกต์) ---------------- */
  function fb(method, path, body) {
    const base = String(FBS_DB_URL || '').replace(/\/+$/, '');
    if (!/^https:\/\/.+/.test(base)) throw new Error('ยังไม่ได้ใส่ FBS_DB_URL ในไฟล์ FirebaseSync.gs');
    const url = base + '/' + path + '.json?access_token=' + encodeURIComponent(ScriptApp.getOAuthToken()) + (method === 'GET' ? '' : '&print=silent');
    const opt = { method: method.toLowerCase(), contentType: 'application/json', muteHttpExceptions: true };
    if (body !== undefined) opt.payload = JSON.stringify(body);
    const res = UrlFetchApp.fetch(url, opt);
    const code = res.getResponseCode(), text = res.getContentText();
    if (code === 401 || code === 403) throw new Error('Firebase ปฏิเสธสิทธิ์ (' + code + ') — ตรวจ oauthScopes ใน appsscript.json และให้บัญชีนี้เป็นสมาชิกโปรเจกต์ Firebase');
    if (code >= 300) throw new Error('Firebase ตอบกลับ ' + code + ': ' + text.slice(0, 200));
    return text ? JSON.parse(text) : null;
  }

  /* ---------------- canonical form (ใช้เทียบว่าข้อมูลเปลี่ยนหรือไม่) ---------------- */
  function stable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  function canonKpi(k, hasCol) {
    if (!k) return null;
    const o = {};
    KPI_FIELDS.forEach(f => {
      if (f !== 'name' && f !== 'dim' && hasCol && !hasCol[f]) return;    // คอลัมน์ที่ชีตไม่มี ไม่นำมาเทียบ
      let v = k[f]; if (v == null || v === '') return;
      if (f === 'mult') { v = Number(v); if (isNaN(v)) return; } else v = norm(v);
      if (v !== '') o[f] = v;
    });
    if (k.allWards) o.allWards = true; else o.wards = Object.keys(k.wards || {}).filter(w => k.wards[w]).sort();
    return stable(o);
  }
  const canonWard = w => w ? stable({ name: norm(w.name), group: norm(w.group) }) : null;
  const canonDim = d => d ? stable({ key: norm(d.key), name: norm(d.name) }) : null;
  function canonAll(m, hasCol) {
    const out = {};
    Object.keys(m.wards || {}).forEach(id => out['w|' + id] = canonWard(m.wards[id]));
    Object.keys(m.dims || {}).forEach(dk => out['d|' + dk] = canonDim(m.dims[dk]));
    Object.keys(m.kpis || {}).forEach(id => out['k|' + id] = canonKpi(m.kpis[id], hasCol));
    return out;
  }
  const hash = s => s == null ? '' : Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8));

  /* ---------------- อ่าน/เขียนชีต ---------------- */
  function colMap(headers, spec) {
    const H = headers.map(norm), map = {};
    Object.keys(spec).forEach(key => {
      const s = spec[key]; let idx = -1;
      for (const n of s.names) { idx = H.indexOf(n); if (idx >= 0) break; }
      if (idx < 0 && !s.exact) for (const n of s.names) { idx = H.findIndex(h => h.indexOf(n) === 0); if (idx >= 0) break; }
      map[key] = idx;
      if (idx < 0 && s.req) throw new Error('แท็บ "' + s.tab + '" ไม่พบคอลัมน์ "' + s.names[0] + '"');
    });
    return map;
  }
  const KPI_SPEC = {
    id: { names: ['KPI_ID', 'รหัสตัวชี้วัด'], req: true, tab: 'KPI' }, name: { names: ['ชื่อตัวชี้วัด', 'ตัวชี้วัด'], req: true, tab: 'KPI' },
    dim: { names: ['มิติ', 'หมวด'], exact: true, req: true, tab: 'KPI' }, mult: { names: ['ตัวคูณ'] }, target: { names: ['เป้าหมาย', 'เกณฑ์'] }, dir: { names: ['ทิศทาง'] },
    unit: { names: ['หน่วย', 'หน่วยนับ'], exact: true }, num: { names: ['ชื่อตัวตั้ง'] }, den: { names: ['ชื่อตัวหาร'] },
    wards: { names: ['หน่วยงานที่ใช้'], req: true, tab: 'KPI' }, defN: { names: ['นิยามตัวตั้ง'] }, defD: { names: ['นิยามตัวหาร'] }, note: { names: ['หมายเหตุ'] }
  };
  function wardsTab() {
    const sh = ss().getSheetByName(T.wards);
    if (!sh) throw new Error('ไม่พบแท็บ "Wards"');
    let head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(norm);
    if (!head.some(h => h.indexOf('ward_id') === 0)) { sh.getRange(1, head.length + 1).setValue(WARD_ID_HEADER); head = head.concat(WARD_ID_HEADER); }
    return { sh, c: colMap(head, { ward: { names: ['หน่วยงาน', 'วอร์ด', 'หอผู้ป่วย'], exact: true, req: true, tab: 'Wards' }, group: { names: ['กลุ่มงาน', 'กลุ่ม'], exact: true, req: true, tab: 'Wards' }, id: { names: ['ward_id'], req: true, tab: 'Wards' } }) };
  }
  function dimsTab(fbDims) {
    let sh = ss().getSheetByName(T.dims);
    if (!sh) {
      sh = ss().insertSheet(T.dims);
      const src = fbDims && Object.keys(fbDims).length ? Object.keys(fbDims).map(k => fbDims[k]).sort((a, b) => (+a.order || 0) - (+b.order || 0)).map(d => [d.key, d.name])
        : Object.keys(DEFAULT_DIMS).map(k => [Number(k), DEFAULT_DIMS[k]]);
      sh.getRange(1, 1, src.length + 1, 2).setValues([['มิติ', 'ชื่อมิติ']].concat(src));
    }
    const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 2)).getValues()[0];
    return { sh, c: colMap(head, { key: { names: ['มิติ', 'รหัสมิติ'], exact: true, req: true, tab: 'มิติ' }, name: { names: ['ชื่อมิติ'], exact: true, req: true, tab: 'มิติ' } }) };
  }
  function kpiTab() {
    const sh = ss().getSheetByName(T.kpi); if (!sh) throw new Error('ไม่พบแท็บ "KPI"');
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    return { sh, c: colMap(head, KPI_SPEC) };
  }
  const body = sh => sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();

  /** อ่านชีตเป็นรูปแบบเดียวกับ meta ใน Firebase */
  function readSheet(F) {
    const warn = [], W = wardsTab(), D = dimsTab(F && F.dims), K = kpiTab();
    const hasCol = {}; KPI_FIELDS.forEach(f => hasCol[f] = K.c[f] >= 0);
    // หน่วยงาน (เติม ward_id ให้แถวใหม่ — ใช้รหัสเดิมจาก Firebase ถ้าชื่อตรงกัน)
    const fbByName = {}; Object.keys((F && F.wards) || {}).forEach(id => fbByName[norm(F.wards[id].name)] = id);
    const wards = {}, wardRow = {}, idWrites = [], seenName = {};
    body(W.sh).forEach((r, i) => {
      const name = norm(r[W.c.ward]); if (!name) return;
      let id = norm(r[W.c.id]);
      if (!id || !okKey(id) || wards[id]) { id = fbByName[name] && !wards[fbByName[name]] ? fbByName[name] : newId(); idWrites.push([i + 2, id]); }
      if (seenName[name]) warn.push('ชื่อหน่วยงานซ้ำในแท็บ Wards: ' + name);
      seenName[name] = 1;
      wards[id] = { name, group: norm(r[W.c.group]) || 'อื่น ๆ', order: i + 1 }; wardRow[id] = i + 2;
    });
    idWrites.forEach(([row, id]) => W.sh.getRange(row, W.c.id + 1).setValue(id));
    // มิติ
    const dims = {}, dimRow = {};
    body(D.sh).forEach((r, i) => { const k = norm(r[D.c.key]).replace(/\.0+$/, ''); if (!k) return; if (!okKey(k)) { warn.push('รหัสมิติไม่ถูกต้อง: ' + k); return; } dims['d' + k] = { key: k, name: norm(r[D.c.name]) || 'มิติที่ ' + k, order: i + 1 }; dimRow['d' + k] = i + 2; });
    // ตัวชี้วัด
    const byName = {}, groups = {};
    Object.keys(wards).forEach(id => { byName[wards[id].name] = id; (groups[wards[id].group] = groups[wards[id].group] || []).push(id); });
    Object.keys((F && F.wards) || {}).forEach(id => { const n = norm(F.wards[id].name); if (!byName[n] && wards[id]) byName[n] = id; });   // ชื่อเดิมก่อนเปลี่ยนชื่อ
    const kpis = {}, kpiRow = {}, unknown = {};
    body(K.sh).forEach((r, i) => {
      const id = norm(r[K.c.id]); if (!id) return;
      if (!okKey(id)) { warn.push('แถว ' + (i + 2) + ': KPI_ID มีอักขระต้องห้าม (. # $ [ ] /) — ข้าม'); return; }
      if (kpis[id]) { warn.push('KPI_ID ซ้ำ: ' + id + ' (ใช้แถวแรก)'); return; }
      const toks = String(r[K.c.wards] || '').split(/[,\/]/).map(norm).filter(Boolean);
      const k = { name: norm(r[K.c.name]), dim: norm(r[K.c.dim]).replace(/\.0+$/, '') || '0', order: i + 1 };
      KPI_FIELDS.slice(2).forEach(f => { if (K.c[f] < 0) return; const v = r[K.c[f]]; if (v !== '' && v != null) k[f] = f === 'mult' ? Number(v) : norm(v); });
      if (k.mult !== undefined && isNaN(k.mult)) { warn.push(id + ': ตัวคูณไม่ใช่ตัวเลข — ข้ามค่า'); delete k.mult; }
      if (!toks.length) k.allWards = true;
      else {
        const set = {}, hit = toks.filter(t => byName[t]);
        if (hit.length) hit.forEach(t => set[byName[t]] = true);
        else toks.forEach(t => { if (groups[t]) groups[t].forEach(w => set[w] = true); });
        const bad = toks.filter(t => !byName[t] && !groups[t]);
        if (bad.length) { unknown[id] = 1; bad.forEach(t => warn.push(id + ': ไม่รู้จักหน่วยงาน "' + t + '" — ยังไม่ส่งตัวชี้วัดนี้ไป Firebase จนกว่าจะแก้ชื่อให้ตรงแท็บ Wards')); }
        k.wards = set;
      }
      kpis[id] = k; kpiRow[id] = i + 2;
    });
    return { meta: { wards, dims, kpis }, rows: { wards: wardRow, dims: dimRow, kpis: kpiRow }, tabs: { W, D, K }, hasCol, warn, unknown };
  }

  /* ---------------- base snapshot (สถานะล่าสุดที่ทั้งสองฝั่งตรงกัน) ---------------- */
  function baseSheet() {
    let sh = ss().getSheetByName(T.base);
    if (!sh) { sh = ss().insertSheet(T.base); sh.getRange(1, 1, 1, 2).setValues([['key', 'hash']]); sh.hideSheet(); }
    return sh;
  }
  function readBase() { const m = {}; body(baseSheet()).forEach(r => { if (r[0]) m[r[0]] = r[1]; }); return m; }
  function writeBase(m) {
    const sh = baseSheet(), rows = Object.keys(m).sort().map(k => [k, m[k]]);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
  }

  /* ---------------- เขียนค่าจาก Firebase ลงชีต ---------------- */
  function wardsText(k, wardsNow) {
    if (k.allWards) return '';
    return Object.keys(k.wards || {}).filter(w => wardsNow[w]).sort((a, b) => (wardsNow[a].order || 0) - (wardsNow[b].order || 0)).map(w => wardsNow[w].name).join(',');
  }
  /** เขียนเฉพาะคอลัมน์ที่ระบบรู้จัก ทีละคอลัมน์ (ไม่แตะคอลัมน์อื่น สูตร หรือ dropdown) */
  function writeTab(sh, cols, rows, updates, appends, deletes) {
    // updates: {rowNumber: {colIdx: value}}  appends: [{colIdx: value}]  deletes: [rowNumber]
    const data = rows;   // body() ของแท็บ (index 0 = แถว 2)
    const touched = {};
    Object.keys(updates).forEach(r => { const i = Number(r) - 2; Object.keys(updates[r]).forEach(c => { data[i][c] = updates[r][c]; touched[c] = 1; }); });
    Object.keys(touched).forEach(c => { if (data.length) sh.getRange(2, Number(c) + 1, data.length, 1).setValues(data.map(r => [r[c]])); });
    if (appends.length) {
      const start = sh.getLastRow() + 1, width = sh.getLastColumn();
      const block = appends.map(a => { const r = new Array(width).fill(''); Object.keys(a).forEach(c => r[c] = a[c]); return r; });
      sh.getRange(start, 1, block.length, width).setValues(block);
    }
    deletes.sort((x, y) => y - x).forEach(r => sh.deleteRow(r));
  }
  function wardsText(k, wardsNow) {
    if (k.allWards) return '';
    return Object.keys(k.wards || {}).filter(w => wardsNow[w]).sort((a, b) => (wardsNow[a].order || 0) - (wardsNow[b].order || 0)).map(w => wardsNow[w].name).join(',');
  }
  function applyToSheet(S, pull, F, renamed) {
    const { W, D, K } = S.tabs, wardsNow = Object.assign({}, S.meta.wards);
    // หน่วยงาน
    let up = {}, add = [], del = [];
    Object.keys(pull.wards).forEach(id => {
      const w = pull.wards[id], row = S.rows.wards[id];
      if (!w) { if (row) del.push(row); delete wardsNow[id]; return; }
      wardsNow[id] = Object.assign({ order: 1e9 }, S.meta.wards[id] || {}, w);
      const v = {}; v[W.c.ward] = w.name; v[W.c.group] = w.group;
      if (row) up[row] = v; else { v[W.c.id] = id; add.push(v); }
    });
    writeTab(W.sh, W.c, body(W.sh), up, add, del);
    // มิติ
    up = {}; add = []; del = [];
    Object.keys(pull.dims).forEach(dk => {
      const d = pull.dims[dk], row = S.rows.dims[dk];
      if (!d) { if (row) del.push(row); return; }
      const v = {}; v[D.c.key] = /^\d+$/.test(d.key) ? Number(d.key) : d.key; v[D.c.name] = d.name;
      if (row) up[row] = v; else add.push(v);
    });
    writeTab(D.sh, D.c, body(D.sh), up, add, del);
    // ตัวชี้วัด (รวมแถวที่อ้างหน่วยงานที่เปลี่ยนชื่อ เพื่อให้ชื่อในคอลัมน์ "หน่วยงานที่ใช้" ตรง)
    Object.keys(S.meta.kpis).forEach(id => {
      if (pull.kpis[id] !== undefined) return;
      const k = S.meta.kpis[id];
      if (!k.allWards && Object.keys(k.wards || {}).some(w => renamed[w])) pull.kpis[id] = (F.kpis && F.kpis[id]) || k;
    });
    up = {}; add = []; del = [];
    Object.keys(pull.kpis).forEach(id => {
      const k = pull.kpis[id], row = S.rows.kpis[id];
      if (!k) { if (row) del.push(row); return; }
      const vals = { id, name: k.name, dim: /^\d+$/.test(k.dim) ? Number(k.dim) : k.dim, wards: wardsText(k, wardsNow) };
      KPI_FIELDS.slice(2).forEach(f => vals[f] = k[f] == null ? '' : k[f]);
      const v = {}; Object.keys(vals).forEach(f => { if (K.c[f] >= 0) v[K.c[f]] = vals[f]; });
      if (row) up[row] = v; else add.push(v);
    });
    writeTab(K.sh, K.c, body(K.sh), up, add, del);
  }

  /* ---------------- ซิงก์ (three-way merge ทีละรายการ) ---------------- */
  function sync(reason) {
    const F = fb('GET', 'meta') || {};
    F.wards = F.wards || {}; F.dims = F.dims || {}; F.kpis = F.kpis || {};
    const S = readSheet(F), B = readBase();
    const cs = canonAll(S.meta, S.hasCol), cf = canonAll(F, S.hasCol);
    const keys = Object.keys(Object.assign({}, cs, cf, B));
    const push = {}, pull = { wards: {}, dims: {}, kpis: {} }, merged = {}, conflicts = [], sheetDeletes = [];
    const obj = (m, k) => { const [t, id] = k.split('|'); return (t === 'w' ? m.wards : t === 'd' ? m.dims : m.kpis)[id]; };
    const fbPath = k => { const [t, id] = k.split('|'); return (t === 'w' ? 'wards/' : t === 'd' ? 'dims/' : 'kpis/') + id; };
    const setPull = (k, v) => { const [t, id] = k.split('|'); pull[t === 'w' ? 'wards' : t === 'd' ? 'dims' : 'kpis'][id] = v || null; };
    keys.forEach(k => {
      const s = hash(cs[k]), f = hash(cf[k]), b = B[k] || '';
      if (s === f) { if (s) merged[k] = s; return; }
      if (k.indexOf('k|') === 0 && S.unknown[k.slice(2)] && f === b) { if (b) merged[k] = b; return; }   // ชื่อหน่วยงานผิด: รอแก้ ไม่ส่ง
      if (s !== b && f === b) {                       // แก้ในชีต
        if (!cs[k]) sheetDeletes.push(k);
        push[k] = obj(S.meta, k) || null; if (s) merged[k] = s;
      } else {                                        // แก้ในเว็บ หรือแก้ทั้งสองฝั่ง (ยึดเว็บ)
        if (s !== b && f !== b) conflicts.push(k);
        setPull(k, obj(F, k)); if (f) merged[k] = f;
      }
    });
    // กันพลาด: ลบจากชีตจำนวนมากผิดปกติ
    const total = Object.keys(cf).length, warn = S.warn.slice();
    if (sheetDeletes.length > DELETE_GUARD.min && sheetDeletes.length > total * DELETE_GUARD.ratio) {
      sheetDeletes.forEach(k => { delete push[k]; merged[k] = hash(cf[k]); });
      warn.unshift('⚠️ ไม่ได้ลบ ' + sheetDeletes.length + ' รายการใน Firebase เพราะจำนวนมากผิดปกติ (แถวถูกลบในชีต) — ถ้าตั้งใจลบ ให้ลบผ่านหน้าเว็บ หรือนำแถวกลับมา');
    }
    // ส่งไป Firebase
    const pushKeys = Object.keys(push);
    if (pushKeys.length) {
      const u = {};
      pushKeys.forEach(k => u[fbPath(k)] = push[k]);
      u._sync = { at: { '.sv': 'timestamp' }, by: Session.getEffectiveUser().getEmail() || 'sheet', source: 'sheet' };
      fb('PATCH', 'meta', u);
    }
    // เขียนลงชีต
    const renamed = {};
    Object.keys(pull.wards).forEach(id => { const a = pull.wards[id], b = S.meta.wards[id]; if (a && b && norm(a.name) !== norm(b.name)) renamed[id] = 1; });
    pushKeys.filter(k => k.indexOf('w|') === 0).forEach(k => { const id = k.slice(2), a = S.meta.wards[id], b = F.wards[id]; if (a && b && norm(a.name) !== norm(b.name)) renamed[id] = 1; });
    const pullCount = Object.keys(pull.wards).length + Object.keys(pull.dims).length + Object.keys(pull.kpis).length;
    if (pullCount || Object.keys(renamed).length) applyToSheet(S, pull, F, renamed);
    Object.keys(merged).forEach(k => { if (!merged[k]) delete merged[k]; });
    writeBase(merged);
    const at = fb('GET', 'meta/_sync/at');
    props().setProperties({ fbAt: String(at || ''), baseOk: '1', lastFull: String(Date.now()) });
    const summary = { reason, pushed: pushKeys.length, pulled: pullCount, conflicts: conflicts.map(k => k.split('|')[1]), warn };
    status(summary);
    return summary;
  }
  function status(s, err) {
    let sh = ss().getSheetByName(T.status);
    if (!sh) { sh = ss().insertSheet(T.status); sh.setColumnWidth(1, 720); }
    const now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm:ss');
    const lines = err ? [['❌ ' + now + ' ซิงก์ไม่สำเร็จ: ' + err]] : [['✅ ' + now + ' ซิงก์สำเร็จ (' + s.reason + ') — ส่งไป Firebase ' + s.pushed + ' รายการ · รับจากเว็บ ' + s.pulled + ' รายการ']];
    if (!err && s.conflicts.length) lines.push(['แก้ทั้งสองฝั่งพร้อมกัน ใช้ค่าจากเว็บ: ' + s.conflicts.slice(0, 30).join(', ')]);
    if (!err) s.warn.slice(0, 40).forEach(w => lines.push([w]));
    sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).clearContent();
    sh.getRange(1, 1, lines.length, 1).setValues(lines);
  }

  /* ---------------- ทริกเกอร์ ---------------- */
  function tick() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return 'busy';
    try {
      const p = props(), dirty = p.getProperty('dirty') === '1';
      const at = String(fb('GET', 'meta/_sync/at') || '');
      const stale = Date.now() - Number(p.getProperty('lastFull') || 0) > 30 * 60 * 1000;   // ตรวจเต็มทุก 30 นาที กันตกหล่น
      if (!dirty && !stale && p.getProperty('baseOk') === '1' && at === (p.getProperty('fbAt') || '')) return 'idle';
      p.setProperty('dirty', '0');
      return sync(dirty ? 'แก้ในชีต' : at !== (p.getProperty('fbAt') || '') ? 'แก้ในเว็บ' : 'ตรวจตามรอบ');
    } catch (e) { props().setProperty('dirty', '1'); try { status(null, e.message); } catch (x) { } return 'error: ' + e.message; }
    finally { lock.releaseLock(); }
  }
  function onEdit(e) {
    const name = e && e.range ? e.range.getSheet().getName() : '';
    if (!name || [T.kpi, T.wards, T.dims].indexOf(name) >= 0) props().setProperty('dirty', '1');
  }
  function onOpen() {
    SpreadsheetApp.getUi().createMenu('🔄 Firebase')
      .addItem('ซิงก์ตอนนี้', 'fbsSyncNow')
      .addItem('ดึงผลงานจาก Firebase ลงชีต', 'fbsPullResults')
      .addSeparator()
      .addItem('ตรวจการเชื่อมต่อ', 'fbsTest')
      .addItem('เปิดซิงก์อัตโนมัติ / ติดตั้งใหม่', 'fbsSetup')
      .addItem('หยุดซิงก์อัตโนมัติ', 'fbsStop')
      .addToUi();
  }
  function stop() {
    ScriptApp.getProjectTriggers().filter(t => ['fbsTick', 'fbsOnEdit', 'fbsOnOpen'].indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
    toast('หยุดซิงก์อัตโนมัติแล้ว');
  }
  function setup() {
    const s = ss(); props().setProperty('ssId', s.getId());
    fb('GET', 'meta/_sync');   // ตรวจสิทธิ์ก่อน
    ScriptApp.getProjectTriggers().filter(t => ['fbsTick', 'fbsOnEdit', 'fbsOnOpen'].indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger('fbsTick').timeBased().everyMinutes(1).create();
    ScriptApp.newTrigger('fbsOnEdit').forSpreadsheet(s).onEdit().create();
    ScriptApp.newTrigger('fbsOnOpen').forSpreadsheet(s).onOpen().create();
    const r = syncNow(true);
    toast('ติดตั้งเรียบร้อย ซิงก์อัตโนมัติทุก 1 นาที — ส่ง ' + r.pushed + ' · รับ ' + r.pulled + ' รายการ');
    try { onOpen(); } catch (e) { }
    return r;
  }
  function syncNow(quiet) {
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try { props().setProperty('dirty', '0'); const r = sync('สั่งซิงก์เอง'); if (!quiet) toast('ซิงก์แล้ว — ส่ง ' + r.pushed + ' · รับ ' + r.pulled + ' รายการ' + (r.warn.length ? ' (มีคำเตือน ดูแท็บสถานะซิงก์)' : '')); return r; }
    catch (e) { status(null, e.message); throw e; }
    finally { lock.releaseLock(); }
  }
  function test() {
    const s = fb('GET', 'meta/_sync'), w = fb('GET', 'meta/wards') || {}, k = fb('GET', 'meta/kpis') || {};
    const msg = 'เชื่อมต่อ Firebase สำเร็จ\nหน่วยงาน ' + Object.keys(w).length + ' · ตัวชี้วัด ' + Object.keys(k).length + '\nแก้ไขล่าสุด: ' + (s && s.at ? Utilities.formatDate(new Date(s.at), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm:ss') + ' (' + (s.source || '-') + ')' : '-');
    try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
    return msg;
  }
  function toast(m) { try { ss().toast(m, 'Firebase', 6); } catch (e) { Logger.log(m); } }

  /** ดึงผลงาน (และ Log) ของปีงบที่เลือกจาก Firebase มาไว้ในแท็บ FB_ผลงาน_ปี (อ่านอย่างเดียว เขียนทับทุกครั้ง) */
  function pullResults() {
    const d = new Date(), fy = String(d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0));
    let year = fy;
    try { const r = SpreadsheetApp.getUi().prompt('ดึงผลงานจาก Firebase', 'ปีงบประมาณ (พ.ศ.)', SpreadsheetApp.getUi().ButtonSet.OK_CANCEL); if (r.getSelectedButton() !== SpreadsheetApp.getUi().Button.OK) return; year = norm(r.getResponseText()) || fy; } catch (e) { }
    if (!/^\d{4}$/.test(year)) throw new Error('ปีงบประมาณไม่ถูกต้อง');
    const meta = fb('GET', 'meta') || {}, res = fb('GET', 'results/y' + year) || {};
    const W = meta.wards || {}, K = meta.kpis || {}, rows = [];
    Object.keys(res).forEach(wid => Object.keys(res[wid] || {}).forEach(mk => Object.keys(res[wid][mk] || {}).forEach(id => {
      const x = res[wid][mk][id], k = K[id] || {};
      rows.push([year, MONTHS[Number(mk.slice(1)) - 1] || mk, (W[wid] || {}).name || wid, (W[wid] || {}).group || '', id, k.name || '', x.n == null ? '' : x.n, x.d == null ? '' : x.d, x.v,
        x.at ? new Date(x.at) : '', x.by || '', x.email || '']);
    })));
    rows.sort((a, b) => String(a[2]).localeCompare(String(b[2])) || MONTHS.indexOf(a[1]) - MONTHS.indexOf(b[1]) || String(a[4]).localeCompare(String(b[4])));
    const name = 'FB_ผลงาน_' + year;
    let sh = ss().getSheetByName(name); if (!sh) sh = ss().insertSheet(name); else sh.clear();
    const head = ['ปีงบประมาณ', 'เดือน', 'หน่วยงาน', 'กลุ่มงาน', 'KPI_ID', 'ชื่อตัวชี้วัด', 'ตัวตั้ง', 'ตัวหาร', 'ผลลัพธ์', 'บันทึกเมื่อ', 'ผู้บันทึก', 'อีเมล'];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#0f8b8d').setFontColor('#ffffff');
    if (rows.length) { sh.getRange(2, 1, rows.length, head.length).setValues(rows); sh.getRange(2, 10, rows.length, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss'); }
    sh.setFrozenRows(1);
    toast('ดึงผลงานปีงบ ' + year + ' แล้ว ' + rows.length + ' แถว → แท็บ ' + name);
    return rows.length;
  }

  return { setup, stop, tick, onEdit, onOpen, syncNow, test, pullResults, _sync: sync, _readSheet: readSheet };
})();
