// 재물조사 목록표 원본 → 웹에서 쓸 '템플릿' xlsx 생성
//
//   node build-survey-template.js
//
// 원본은 엑셀이 빈 셀까지 103만 행을 저장해 둔 탓에 시트 XML이 581MB(파일 63MB)다.
// 브라우저에서 내려받아 가공하는 게 불가능하므로, 데이터가 끝나는 669행 이후의
// '값 없는 빈 행'만 걷어낸 템플릿을 만든다.
//
// 눈에 보이는 것은 하나도 바뀌지 않는다 — 서식(styles), 열 너비(cols), 병합셀(mergeCells),
// 조건부서식, 인쇄 설정, 메모(comments), 공유문자열이 전부 원본 그대로 복사된다.
// 지우는 것은 데이터 아래의 빈 행뿐이라 열었을 때 화면·인쇄 결과가 동일하다.

const fs = require("fs");
const zlib = require("zlib");

const SRC = "2026년 산학협력단 재물조사 목록표(글로컬대학사업본부).xlsx";
const OUT = "survey_template.xlsx";
const SHEET = "xl/worksheets/sheet1.xml";

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf, crc = 0) => { let c = ~crc; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; };

function readEntries(file) {
  const fd = fs.openSync(file, "r");
  const size = fs.statSync(file).size, tl = Math.min(size, 65557);
  const tail = Buffer.alloc(tl); fs.readSync(fd, tail, 0, tl, size - tl);
  let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  const cd = Buffer.alloc(tail.readUInt32LE(e + 12)); fs.readSync(fd, cd, 0, cd.length, tail.readUInt32LE(e + 16));
  const L = []; let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const en = { method: cd.readUInt16LE(p + 10), time: cd.readUInt16LE(p + 12), date: cd.readUInt16LE(p + 14),
      crc: cd.readUInt32LE(p + 16), compSize: cd.readUInt32LE(p + 20), uncompSize: cd.readUInt32LE(p + 24),
      localOffset: cd.readUInt32LE(p + 42) };
    const nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    en.name = cd.toString("utf8", p + 46, p + 46 + nl); L.push(en); p += 46 + nl + el + cl;
  }
  for (const en of L) { const lh = Buffer.alloc(30); fs.readSync(fd, lh, 0, 30, en.localOffset);
    en.dataStart = en.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28); }
  fs.closeSync(fd); return L;
}
const entryStream = (f, e) => { const r = fs.createReadStream(f, { start: e.dataStart, end: e.dataStart + e.compSize - 1 });
  return e.method === 0 ? r : r.pipe(zlib.createInflateRaw()); };
const rawBytes = (f, e) => { const fd = fs.openSync(f, "r"); const b = Buffer.alloc(e.compSize);
  fs.readSync(fd, b, 0, e.compSize, e.dataStart); fs.closeSync(fd); return b; };

(async () => {
  const entries = readEntries(SRC);
  const sheetEnt = entries.find((e) => e.name === SHEET);

  // ---- 시트에서 '값 있는 마지막 행'까지만 남기고 나머지 빈 행은 버린다 ----
  // 값이 있는 마지막 행이 어디인지 미리 알 수 없으므로, 앞부분(KEEP_SCAN 행까지)은 일단 모아 두고
  // 그 뒤는 곧바로 버린다. 다 읽은 뒤 '값 있는 마지막 행'까지만 남기고 잘라낸다.
  // (6·7행처럼 표 중간의 빈 행은 서식이라 반드시 남겨야 해서 '첫 빈 행에서 중단'하면 안 된다)
  const KEEP_SCAN = 5000;
  const head = [];              // <sheetData> 앞부분
  const rows = [];              // { rn, buf }
  let tailPart = Buffer.alloc(0);
  let pending = Buffer.alloc(0), dropped = 0, seenFirstRow = false;
  await new Promise((res, rej) => {
    const st = entryStream(SRC, sheetEnt);
    st.on("error", rej);
    st.on("data", (c) => {
      pending = Buffer.concat([pending, c]);
      let i;
      while ((i = pending.indexOf("</row>")) !== -1) {
        const end = i + 6, s = pending.lastIndexOf("<row", i);
        if (s === -1) { pending = pending.slice(end); continue; }
        if (s > 0) { if (!seenFirstRow) head.push(pending.slice(0, s)); }
        seenFirstRow = true;
        const rowBuf = pending.slice(s, end);
        pending = pending.slice(end);
        const rn = Number((/<row r="(\d+)"/.exec(rowBuf.slice(0, 40).toString("utf8")) || [])[1] || 0);
        if (rn && rn <= KEEP_SCAN) rows.push({ rn, buf: rowBuf, hasValue: rowBuf.includes("<v>") || rowBuf.includes("<is>") });
        else dropped++;
      }
      if (pending.length > 4 * 1024 * 1024) pending = pending.slice(-8192);
    });
    st.on("end", () => { tailPart = pending; res(); });   // </sheetData> 이후(병합셀·인쇄설정 등)
  });
  let lastKept = 0;
  for (const r of rows) if (r.hasValue) lastKept = r.rn;
  const keep = rows.filter((r) => r.rn <= lastKept);
  dropped += rows.length - keep.length;
  const tailIdx = tailPart.indexOf("</sheetData>");
  if (tailIdx === -1) throw new Error("</sheetData> 를 찾지 못했습니다.");
  const newSheet = Buffer.concat([...head, ...keep.map((r) => r.buf), tailPart.slice(tailIdx)]);
  console.log(`시트: 값 있는 마지막 행 ${lastKept} · 빈 행 ${dropped.toLocaleString()}개 제거`);
  console.log(`시트 크기: 581MB → ${(newSheet.length / 1024).toFixed(0)}KB`);
  if (!newSheet.includes("</worksheet>")) throw new Error("시트 XML이 온전하지 않습니다.");
  for (const tag of ["<mergeCells", "<conditionalFormatting", "<pageMargins", "<legacyDrawing", "<cols"]) {
    if (!newSheet.includes(tag) && sheetEnt.uncompSize > 0) console.log(`  (참고: 원본에 ${tag} 없음 또는 유지 확인 필요)`);
  }

  // ---- zip 다시 쓰기 (시트만 교체, 나머지는 압축된 원본 바이트 그대로) ----
  const deflated = zlib.deflateRawSync(newSheet, { level: 9 });
  const fdOut = fs.openSync(OUT, "w");
  let offset = 0; const central = [];
  const w = (b) => { fs.writeSync(fdOut, b); offset += b.length; };
  for (const ent of entries) {
    const isSheet = ent.name === SHEET;
    const nameBuf = Buffer.from(ent.name, "utf8");
    const meta = isSheet
      ? { method: 8, crc: crc32(newSheet), compSize: deflated.length, uncompSize: newSheet.length }
      : { method: ent.method, crc: ent.crc, compSize: ent.compSize, uncompSize: ent.uncompSize };
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(meta.method, 8); lh.writeUInt16LE(ent.time, 10); lh.writeUInt16LE(ent.date, 12);
    lh.writeUInt32LE(meta.crc, 14); lh.writeUInt32LE(meta.compSize, 18); lh.writeUInt32LE(meta.uncompSize, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const localOffset = offset;
    w(lh); w(nameBuf);
    w(isSheet ? deflated : rawBytes(SRC, ent));
    central.push({ ...meta, name: nameBuf, time: ent.time, date: ent.date, localOffset });
  }
  const cdStart = offset;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(c.method, 10); h.writeUInt16LE(c.time, 12); h.writeUInt16LE(c.date, 14);
    h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.compSize, 20); h.writeUInt32LE(c.uncompSize, 24);
    h.writeUInt16LE(c.name.length, 28); h.writeUInt32LE(c.localOffset, 42);
    w(h); w(c.name);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12); eocd.writeUInt32LE(cdStart, 16);
  w(eocd);
  fs.closeSync(fdOut);
  console.log(`✅ ${OUT}  (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB)`);
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
