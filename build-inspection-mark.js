// 재물조사 목록표 원본에 '정상(T열)' O 표시만 찍어 저장한다.
//
//   node build-inspection-mark.js
//
// 원본 xlsx의 서식·머리글·열너비·이미지·메모를 하나도 건드리지 않는다.
// zip 안의 시트 XML만 스트리밍으로 훑으면서, 자산관리번호(B열)가 '검수 완료'인 행의
// T열 빈 셀에만 O 를 넣는다. 나머지 파일들은 압축된 원본 바이트를 그대로 복사한다.
//
// 왜 이렇게 하나: 이 파일은 엑셀이 빈 셀까지 100만 행 저장해 두어 시트 XML이 600MB가 넘는다.
// 일반 엑셀 라이브러리로 열었다 다시 저장하면 서식이 깨지거나 아예 열리지 않는다.
//
// '검수 완료' 판정 = 그 자산에 '목록표' 또는 '1회차' 검수 기록이 있는 경우(앱과 동일한 연동 규칙).

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const SRC = "2026년 산학협력단 재물조사 목록표(글로컬대학사업본부).xlsx";
const OUT = "2026년 산학협력단 재물조사 목록표(글로컬대학사업본부)_검수표시.xlsx";
const SHEET = "xl/worksheets/sheet1.xml";
const MARK_COL = "T";          // 정상
const MARK = "O";
const SB_URL = "https://pmjwwvgcmaywbatryibc.supabase.co";
const SB_KEY = "sb_publishable_dOgVVneeoU9xeZlRWY7zFg_FdRE_PVp";
const ROUNDS_OK = ["목록표", "1회차"];
// 검수 기록은 로그인해야 읽을 수 있다. 계정 정보는 코드에 넣지 않고 실행할 때 환경변수로 준다.
//   Windows PowerShell:  $env:ASSET_ID="아이디"; $env:ASSET_PW="비밀번호"; node build-inspection-mark.js
//   Git Bash:            ASSET_ID=아이디 ASSET_PW=비밀번호 node build-inspection-mark.js
const LOGIN = {
  email: (process.env.ASSET_ID || "").includes("@") ? process.env.ASSET_ID : `${process.env.ASSET_ID || ""}@inje.ac.kr`,
  password: process.env.ASSET_PW || "",
};

const norm = (s) => String(s || "").replace(/[\s.\-_]/g, "").toUpperCase();

// ===== CRC32 =====
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf, crc = 0) {
  let c = ~crc;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// ===== zip 읽기 =====
function readEntries(file) {
  const fd = fs.openSync(file, "r");
  const size = fs.statSync(file).size;
  const tl = Math.min(size, 65557);
  const tail = Buffer.alloc(tl); fs.readSync(fd, tail, 0, tl, size - tl);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("zip 구조를 읽지 못했습니다.");
  const cdOff = tail.readUInt32LE(e + 16), cdSize = tail.readUInt32LE(e + 12);
  const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
  const list = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const ent = {
      method: cd.readUInt16LE(p + 10), time: cd.readUInt16LE(p + 12), date: cd.readUInt16LE(p + 14),
      crc: cd.readUInt32LE(p + 16), compSize: cd.readUInt32LE(p + 20), uncompSize: cd.readUInt32LE(p + 24),
      localOffset: cd.readUInt32LE(p + 42),
    };
    const nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    ent.name = cd.toString("utf8", p + 46, p + 46 + nl);
    list.push(ent);
    p += 46 + nl + el + cl;
  }
  // 로컬 헤더를 읽어 실제 데이터 시작 위치 계산
  for (const ent of list) {
    const lh = Buffer.alloc(30); fs.readSync(fd, lh, 0, 30, ent.localOffset);
    ent.dataStart = ent.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  }
  fs.closeSync(fd);
  return list;
}
function entryStream(file, ent) {
  const raw = fs.createReadStream(file, { start: ent.dataStart, end: ent.dataStart + ent.compSize - 1 });
  return ent.method === 0 ? raw : raw.pipe(zlib.createInflateRaw());
}
function readEntryText(file, ent) {
  return new Promise((res, rej) => {
    const c = []; entryStream(file, ent).on("data", (x) => c.push(x)).on("end", () => res(Buffer.concat(c).toString("utf8"))).on("error", rej);
  });
}

(async () => {
  if (!fs.existsSync(SRC)) throw new Error("원본을 찾을 수 없습니다: " + SRC);
  const entries = readEntries(SRC);
  const sheetEnt = entries.find((e) => e.name === SHEET);
  if (!sheetEnt) throw new Error("시트를 찾을 수 없습니다: " + SHEET);

  // ---- 1) 검수 완료 자산번호 집합 만들기 (웹페이지 DB) ----
  if (!process.env.ASSET_ID || !process.env.ASSET_PW)
    throw new Error("계정 정보가 없습니다.\n  ASSET_ID=아이디 ASSET_PW=비밀번호 node build-inspection-mark.js");
  const lr = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify(LOGIN) });
  const auth = await lr.json();
  if (!lr.ok) throw new Error("로그인 실패: " + JSON.stringify(auth).slice(0, 200));
  const H = { apikey: SB_KEY, Authorization: "Bearer " + auth.access_token };
  const overlay = [];
  for (let from = 0; ; ) {
    const r = await fetch(`${SB_URL}/rest/v1/assets?select=id,kind,data`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error("자산 조회 실패");
    if (!j.length) break;
    overlay.push(...j); from += j.length;
    if (j.length < 1000) break;
  }
  const inspectedIds = new Set();
  for (const row of overlay) {
    if (row.kind === "deleted") continue;
    const l = (row.data && row.data.inspections) || [];
    if (l.some((i) => i && ROUNDS_OK.includes(i.period))) inspectedIds.add(String(row.id));
  }
  // 자산번호 → id
  const numToId = new Map();
  for (const f of ["assets.json", "assets2025add.json", "assets2024.json"])
    for (const a of JSON.parse(fs.readFileSync(f, "utf8"))) {
      const n = norm(a.assetNumber);
      if (n && !numToId.has(n)) numToId.set(n, String(a.id));
    }
  const isDone = (assetNo) => { const id = numToId.get(norm(assetNo)); return !!id && inspectedIds.has(id); };
  console.log(`검수 기록 보유 자산 ${inspectedIds.size}건 확인`);

  // ---- 2) 공유 문자열 (B열 자산번호를 읽기 위해) ----
  const ssEnt = entries.find((e) => e.name === "xl/sharedStrings.xml");
  const shared = [];
  if (ssEnt) {
    const xml = await readEntryText(SRC, ssEnt);
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || [])
      shared.push((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
        .map((t) => t.replace(/<t[^>]*>/, "").replace(/<\/t>$/, "")).join(""));
  }
  const cellText = (xml, col, rn) => {
    const m = new RegExp(`<c r="${col}${rn}"([^>]*)>([\\s\\S]*?)</c>`).exec(xml);
    if (!m) return "";
    const v = /<v>([\s\S]*?)<\/v>/.exec(m[2]);
    if (!v) return "";
    return / t="s"/.test(m[1]) ? (shared[Number(v[1])] ?? "") : v[1];
  };

  // ---- 3) 시트 XML을 스트리밍하며 T열에 O 찍기 ----
  const tmp = path.join(require("os").tmpdir(), "sheet1-marked-" + process.pid + ".deflate");
  const deflate = zlib.createDeflateRaw({ level: 6 });
  const tmpOut = fs.createWriteStream(tmp);
  let crc = 0, rawSize = 0, backpressure = false;
  deflate.setMaxListeners(0);
  deflate.pipe(tmpOut);
  // 압축이 밀리면(false) 원본 읽기를 잠시 멈춰 메모리가 부풀지 않게 한다.
  const write = (buf) => { crc = crc32(buf, crc); rawSize += buf.length; if (!deflate.write(buf)) backpressure = true; };

  let marked = 0, dataRows = 0, notFound = [];
  const LAST_SCAN_ROW = 1200;          // 데이터는 9행부터 700행 안쪽. 넉넉히 잡고 이후는 원본 그대로 통과.
  let pending = Buffer.alloc(0), passthrough = false;

  const processRow = (buf) => {
    const s = buf.toString("utf8");
    const rn = Number((/<row r="(\d+)"/.exec(s) || [])[1] || 0);
    if (!rn || rn > LAST_SCAN_ROW) return buf;
    const assetNo = cellText(s, "B", rn);
    if (!assetNo || !/^[0-9A-Za-z]/.test(assetNo)) return buf;   // 머리글·빈 행
    dataRows++;
    if (!numToId.has(norm(assetNo))) notFound.push(assetNo);
    if (!isDone(assetNo)) return buf;
    const ref = `${MARK_COL}${rn}`;
    let out;
    if (new RegExp(`<c r="${ref}"[^>]*/>`).test(s)) {
      // 빈 셀 → 서식(s=..)은 유지하고 값만 넣는다
      out = s.replace(new RegExp(`<c r="${ref}"([^>]*?)\\s*/>`), `<c r="${ref}"$1 t="inlineStr"><is><t>${MARK}</t></is></c>`);
    } else if (new RegExp(`<c r="${ref}"[^>]*>`).test(s)) {
      // 값이 이미 있는 셀 → 통째로 교체(서식 유지)
      out = s.replace(new RegExp(`<c r="${ref}"([^>]*)>[\\s\\S]*?</c>`), (mm, attrs) =>
        `<c r="${ref}"${attrs.replace(/\s*t="[^"]*"/, "")} t="inlineStr"><is><t>${MARK}</t></is></c>`);
    } else {
      // 셀 자체가 없으면 U열 앞(없으면 행 끝)에 새로 만든다
      const cell = `<c r="${ref}" t="inlineStr"><is><t>${MARK}</t></is></c>`;
      out = new RegExp(`<c r="U${rn}"`).test(s)
        ? s.replace(new RegExp(`<c r="U${rn}"`), cell + `<c r="U${rn}"`)
        : s.replace("</row>", cell + "</row>");
    }
    if (out !== s) marked++;
    return Buffer.from(out, "utf8");
  };

  await new Promise((resolve, reject) => {
    const st = entryStream(SRC, sheetEnt);
    st.on("error", reject);
    deflate.on("error", reject);
    deflate.on("drain", () => { backpressure = false; st.resume(); });
    st.on("data", (chunk) => {
      if (passthrough) { write(chunk); if (backpressure) st.pause(); return; }
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let i;
      while ((i = pending.indexOf("</row>")) !== -1) {
        const end = i + 6;
        const start = pending.lastIndexOf("<row", i);
        if (start === -1) { write(pending.slice(0, end)); pending = pending.slice(end); continue; }
        if (start > 0) write(pending.slice(0, start));
        write(processRow(pending.slice(start, end)));
        pending = pending.slice(end);
        // 데이터 구간을 지나면 나머지는 손대지 않고 그대로 흘려보낸다(속도)
        const rn = Number((/<row r="(\d+)"/.exec(pending.slice(0, 40).toString("utf8")) || [])[1] || 0);
        if (rn > LAST_SCAN_ROW) { write(pending); pending = Buffer.alloc(0); passthrough = true; break; }
      }
      if (!passthrough && pending.length > 8 * 1024 * 1024) { write(pending); pending = Buffer.alloc(0); }
      if (backpressure) st.pause();
    });
    st.on("end", () => {
      if (pending.length) { write(pending); pending = Buffer.alloc(0); }
      deflate.end();
      resolve();
    });
  });
  await new Promise((r) => tmpOut.on("close", r));

  const compSize = fs.statSync(tmp).size;
  console.log(`데이터 행 ${dataRows}건 · O 표시 ${marked}건`);
  if (notFound.length) console.log(`⚠️ 시스템에 없는 자산번호 ${notFound.length}건 (표시 안 함): ${notFound.slice(0, 3).join(", ")}${notFound.length > 3 ? " …" : ""}`);

  // ---- 4) zip 다시 쓰기: 시트만 새 데이터, 나머지는 압축된 원본 바이트 그대로 ----
  const fdIn = fs.openSync(SRC, "r");
  const fdOut = fs.openSync(OUT, "w");
  let offset = 0;
  const central = [];
  const writeOut = (buf) => { fs.writeSync(fdOut, buf); offset += buf.length; };

  for (const ent of entries) {
    const isSheet = ent.name === SHEET;
    const nameBuf = Buffer.from(ent.name, "utf8");
    const meta = isSheet
      ? { method: 8, crc, compSize, uncompSize: rawSize }
      : { method: ent.method, crc: ent.crc, compSize: ent.compSize, uncompSize: ent.uncompSize };
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(meta.method, 8); lh.writeUInt16LE(ent.time, 10); lh.writeUInt16LE(ent.date, 12);
    lh.writeUInt32LE(meta.crc, 14); lh.writeUInt32LE(meta.compSize, 18); lh.writeUInt32LE(meta.uncompSize, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const localOffset = offset;
    writeOut(lh); writeOut(nameBuf);
    // 데이터 본문 복사
    const srcFd = isSheet ? fs.openSync(tmp, "r") : fdIn;
    const srcStart = isSheet ? 0 : ent.dataStart;
    const buf = Buffer.alloc(1 << 20);
    let left = meta.compSize, pos = srcStart;
    while (left > 0) {
      const n = fs.readSync(srcFd, buf, 0, Math.min(buf.length, left), pos);
      if (n <= 0) break;
      writeOut(buf.slice(0, n)); pos += n; left -= n;
    }
    if (isSheet) fs.closeSync(srcFd);
    central.push({ ...meta, name: nameBuf, time: ent.time, date: ent.date, localOffset });
  }
  const cdStart = offset;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(c.method, 10); h.writeUInt16LE(c.time, 12); h.writeUInt16LE(c.date, 14);
    h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.compSize, 20); h.writeUInt32LE(c.uncompSize, 24);
    h.writeUInt16LE(c.name.length, 28);
    h.writeUInt32LE(c.localOffset, 42);   // 각 항목의 로컬 헤더 위치 (여기를 0으로 두면 파일이 통째로 깨진다)
    writeOut(h); writeOut(c.name);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12); eocd.writeUInt32LE(cdStart, 16);
  writeOut(eocd);
  fs.closeSync(fdIn); fs.closeSync(fdOut); fs.unlinkSync(tmp);

  console.log(`✅ ${OUT}  (${(fs.statSync(OUT).size / 1048576).toFixed(1)}MB)`);
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
