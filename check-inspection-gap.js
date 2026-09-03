// 검수표시 엑셀 ↔ 웹페이지 검수 기록 대조기 (읽기만 한다. 아무것도 고치지 않는다)
//
//   $env:ASSET_ID="아이디"; $env:ASSET_PW="비밀번호"
//   node check-inspection-gap.js "…_검수표시_20260903.xlsx"
//
// 계정 없이 돌리면 엑셀 쪽(O 찍힌 행)만 집계한다.
// 나오는 것:
//   ① 시스템에는 검수 기록이 있는데 엑셀에 O 가 없는 행  ← 채워 넣어야 할 것
//   ② 엑셀에는 O 인데 시스템에 검수 기록이 없는 행       ← 방 단위로 찍은 것들(정상)

const fs = require("fs");
const zlib = require("zlib");

const FILE = process.argv[2] || fs.readdirSync(".").find((f) => /검수표시.*\.xlsx$/.test(f) && !f.startsWith("~$"));
const SHEET = "xl/worksheets/sheet1.xml";
const MARK_COL = "T";              // 정상
const NUM_HEADER = "자산관리번호";
const LOC_HEADER = "보관(설치)장소";
const NAME_HEADER = "물품명";
const SB_URL = "https://pmjwwvgcmaywbatryibc.supabase.co";
const SB_KEY = "sb_publishable_dOgVVneeoU9xeZlRWY7zFg_FdRE_PVp";
const ROUNDS_OK = ["목록표", "1회차"];   // 앱과 같은 '목록표 검수 완료' 판정 규칙
const LAST_SCAN_ROW = 1200;

const norm = (s) => String(s || "").replace(/[\s.\-_]/g, "").toUpperCase();

// ===== zip에서 멤버 읽기 (엑셀 라이브러리로는 못 여는 600MB 시트라 직접 스트리밍) =====
function readEntries(file) {
  const fd = fs.openSync(file, "r");
  const size = fs.statSync(file).size;
  const tl = Math.min(size, 65557);
  const tail = Buffer.alloc(tl);
  fs.readSync(fd, tail, 0, tl, size - tl);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("zip 구조를 읽지 못했습니다.");
  let cdOff = tail.readUInt32LE(e + 16), cdSize = tail.readUInt32LE(e + 12);
  if (cdOff === 0xffffffff || cdSize === 0xffffffff) {          // zip64
    for (let i = e - 20; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x07064b50) {
        const z64 = Number(tail.readBigUInt64LE(i + 8));
        const hdr = Buffer.alloc(56);
        fs.readSync(fd, hdr, 0, 56, z64);
        cdSize = Number(hdr.readBigUInt64LE(40));
        cdOff = Number(hdr.readBigUInt64LE(48));
        break;
      }
    }
  }
  const cd = Buffer.alloc(cdSize);
  fs.readSync(fd, cd, 0, cdSize, cdOff);
  const list = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const ent = { method: cd.readUInt16LE(p + 10), compSize: cd.readUInt32LE(p + 20), localOffset: cd.readUInt32LE(p + 42) };
    const nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    ent.name = cd.toString("utf8", p + 46, p + 46 + nl);
    list.push(ent);
    p += 46 + nl + el + cl;
  }
  for (const ent of list) {
    const lh = Buffer.alloc(30);
    fs.readSync(fd, lh, 0, 30, ent.localOffset);
    ent.dataStart = ent.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  }
  fs.closeSync(fd);
  return list;
}
const entryStream = (file, ent) => {
  const raw = fs.createReadStream(file, { start: ent.dataStart, end: ent.dataStart + ent.compSize - 1 });
  return ent.method === 0 ? raw : raw.pipe(zlib.createInflateRaw());
};
const entryText = (file, ent) => new Promise((res, rej) => {
  const c = [];
  entryStream(file, ent).on("data", (x) => c.push(x)).on("end", () => res(Buffer.concat(c).toString("utf8"))).on("error", rej);
});
const unescapeXml = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");

// ===== 시트를 행 단위로 읽어 {행번호, 자산번호, 물품명, 장소, 정상} 만 뽑는다 =====
async function readSheetRows(file) {
  const entries = readEntries(file);
  const sheetEnt = entries.find((e) => e.name === SHEET);
  if (!sheetEnt) throw new Error("시트를 찾지 못했습니다: " + SHEET);
  const ssEnt = entries.find((e) => e.name === "xl/sharedStrings.xml");
  const shared = [];
  if (ssEnt) {
    const xml = await entryText(file, ssEnt);
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || [])
      shared.push((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
        .map((t) => unescapeXml(t.replace(/<t[^>]*>/, "").replace(/<\/t>$/, ""))).join(""));
  }
  const cellsOf = (s) => {
    const out = {};
    const re = /<c\s+([^>]*?)(\/?)>/g;
    let m;
    while ((m = re.exec(s))) {
      const attrs = m[1];
      let inner = "";
      if (m[2] !== "/") {
        const close = s.indexOf("</c>", re.lastIndex);
        inner = close === -1 ? "" : s.slice(re.lastIndex, close);
        re.lastIndex = close === -1 ? s.length : close + 4;
      }
      const ref = /r="([A-Z]+)(\d+)"/.exec(attrs);
      if (!ref) continue;
      const t = (/t="([^"]+)"/.exec(attrs) || [])[1] || "n";
      let v = "";
      if (t === "inlineStr") {
        v = (inner.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
          .map((x) => unescapeXml(x.replace(/<t[^>]*>/, "").replace(/<\/t>$/, ""))).join("");
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (!raw) continue;
        v = t === "s" ? (shared[Number(raw[1])] ?? "") : unescapeXml(raw[1]);
      }
      if (String(v).trim()) out[ref[1]] = String(v).trim();
    }
    return out;
  };

  return new Promise((resolve, reject) => {
    const st = entryStream(file, sheetEnt);
    const rows = [];
    let pending = Buffer.alloc(0), done = false;
    let cols = null;   // {num, loc, name}
    st.on("error", reject);
    st.on("data", (chunk) => {
      if (done) return;
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let i;
      while ((i = pending.indexOf("</row>")) !== -1) {
        const start = pending.lastIndexOf("<row", i);
        const s = start === -1 ? "" : pending.slice(start, i + 6).toString("utf8");
        pending = pending.slice(i + 6);
        const rn = Number((/<row r="(\d+)"/.exec(s) || [])[1] || 0);
        if (!rn) continue;
        if (rn > LAST_SCAN_ROW) { done = true; st.destroy(); resolve({ rows, cols }); return; }
        const c = cellsOf(s);
        if (!cols) {   // 머리글 행 찾기
          const find = (h) => Object.keys(c).find((k) => c[k].replace(/\s/g, "") === h);
          const num = find(NUM_HEADER);
          if (num) cols = { num, loc: find(LOC_HEADER), name: find(NAME_HEADER), headerRow: rn };
          continue;
        }
        const num = c[cols.num];
        if (!num || !/^[0-9A-Za-z]/.test(num)) continue;
        rows.push({ row: rn, num, name: c[cols.name] || "", loc: c[cols.loc] || "", mark: c[MARK_COL] || "" });
      }
      if (pending.length > 8 * 1024 * 1024) pending = pending.slice(-1024);
    });
    st.on("end", () => resolve({ rows, cols }));
    st.on("close", () => { if (!done) resolve({ rows, cols }); });
  });
}

// ===== 웹페이지에서 검수 기록 가져오기 (로그인 필요) =====
async function loadInspected() {
  const id = process.env.ASSET_ID || "", pw = process.env.ASSET_PW || "";
  if (!id || !pw) return null;
  const login = { email: id.includes("@") ? id : `${id}@inje.ac.kr`, password: pw };
  const lr = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify(login) });
  const auth = await lr.json();
  if (!lr.ok) throw new Error("로그인 실패: " + JSON.stringify(auth).slice(0, 200));
  const H = { apikey: SB_KEY, Authorization: "Bearer " + auth.access_token };
  const overlay = [];
  for (let from = 0; ; ) {
    const r = await fetch(`${SB_URL}/rest/v1/assets?select=id,kind,data`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error("자산 조회 실패: " + JSON.stringify(j).slice(0, 200));
    if (!j.length) break;
    overlay.push(...j);
    from += j.length;
    if (j.length < 1000) break;
  }
  // id → 검수 기록(목록표/1회차만)
  const byId = new Map();
  for (const row of overlay) {
    if (row.kind === "deleted") continue;
    const list = ((row.data && row.data.inspections) || []).filter((i) => i && ROUNDS_OK.includes(i.period));
    if (list.length) byId.set(String(row.id), list);
  }
  // 자산번호 → id (베이스 3파일)
  const numToId = new Map();
  for (const f of ["assets.json", "assets2025add.json", "assets2024.json"])
    for (const a of JSON.parse(fs.readFileSync(f, "utf8"))) {
      const n = norm(a.assetNumber);
      if (n && !numToId.has(n)) numToId.set(n, String(a.id));
    }
  // 앱에서 직접 등록한 자산(kind=added)도 자산번호로 찾을 수 있게 넣는다
  for (const row of overlay)
    if (row.kind === "added" && row.data && row.data.assetNumber) {
      const n = norm(row.data.assetNumber);
      if (n && !numToId.has(n)) numToId.set(n, String(row.id));
    }
  return { byId, numToId };
}

(async () => {
  if (!FILE || !fs.existsSync(FILE)) throw new Error("검수표시 엑셀을 찾지 못했습니다. 파일명을 인자로 넘겨주세요.");
  console.log("엑셀:", FILE, `(${(fs.statSync(FILE).size / 1048576).toFixed(1)}MB)`);
  const { rows, cols } = await readSheetRows(FILE);
  if (!cols) throw new Error(`머리글('${NUM_HEADER}')을 찾지 못했습니다.`);
  const marked = rows.filter((r) => r.mark);
  const blank = rows.filter((r) => !r.mark);
  console.log(`데이터 ${rows.length}행 · O 표시 ${marked.length}행 · 빈칸 ${blank.length}행 (머리글 ${cols.headerRow}행, 장소 열 ${cols.loc})`);
  const tally = (list) => {
    const m = {};
    list.forEach((r) => (m[r.loc || "(빈칸)"] = (m[r.loc || "(빈칸)"] || 0) + 1));
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  console.log("\n[엑셀 빈칸] 장소별");
  tally(blank).forEach(([k, v]) => console.log(`   ${String(v).padStart(4)}  ${k}`));

  const db = await loadInspected();
  if (!db) {
    console.log("\n계정 정보가 없어 시스템 대조는 못 했습니다.");
    console.log('  $env:ASSET_ID="아이디"; $env:ASSET_PW="비밀번호"; node check-inspection-gap.js "' + FILE + '"');
    return;
  }
  const inspOf = (num) => { const id = db.numToId.get(norm(num)); return id ? db.byId.get(id) : undefined; };

  const missing = [];   // ① 시스템 검수 O, 엑셀 빈칸
  const extra = [];     // ② 엑셀 O, 시스템 기록 없음
  const unknown = [];   // 시스템에 아예 없는 자산번호
  for (const r of rows) {
    const id = db.numToId.get(norm(r.num));
    if (!id) { unknown.push(r); continue; }
    const insp = db.byId.get(id);
    if (insp && !r.mark) missing.push({ ...r, insp });
    if (!insp && r.mark) extra.push(r);
  }
  console.log(`\n① 시스템 검수됨 · 엑셀 O 없음 : ${missing.length}건`);
  missing.slice(0, 60).forEach((r) => {
    const last = r.insp[r.insp.length - 1] || {};
    const who = [last.inspector, last.affiliation && `(${last.affiliation})`].filter(Boolean).join(" ");
    console.log(`   ${r.row}행  ${r.num}  ${r.name}  [${r.loc}]`);
    console.log(`        ← ${last.period || ""} · ${(last.checkedAt || "").slice(0, 10)} · ${who}`);
  });
  if (missing.length > 60) console.log(`   … 외 ${missing.length - 60}건`);
  const byLoc = {};
  missing.forEach((r) => (byLoc[r.loc || "(빈칸)"] = (byLoc[r.loc || "(빈칸)"] || 0) + 1));
  if (missing.length) { console.log("   장소별:"); Object.entries(byLoc).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`     ${String(v).padStart(4)}  ${k}`)); }

  console.log(`\n② 엑셀 O · 시스템 검수 기록 없음 : ${extra.length}건 (방 단위로 찍은 것이면 정상)`);
  const byLoc2 = {};
  extra.forEach((r) => (byLoc2[r.loc || "(빈칸)"] = (byLoc2[r.loc || "(빈칸)"] || 0) + 1));
  Object.entries(byLoc2).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${String(v).padStart(4)}  ${k}`));

  if (unknown.length) console.log(`\n⚠️ 시스템에 없는 자산번호 ${unknown.length}건 (대조 제외): ${unknown.slice(0, 5).map((r) => r.num).join(", ")}${unknown.length > 5 ? " …" : ""}`);
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
