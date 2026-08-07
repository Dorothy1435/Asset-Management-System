// 재물조사 목록표(xlsx) → inventory_list.json + survey_targets.json 변환기
//
// 사용법:  node build-survey-list.js "2026년 산학협력단 재물조사 목록표(글로컬대학사업본부).xlsx"
//         (파일명을 생략하면 폴더에서 '재물조사 목록표'가 들어간 xlsx를 자동으로 찾는다)
//
// 왜 전용 스크립트가 필요한가:
//  엑셀이 빈 셀까지 100만 행을 저장해 두어(dimension A1:W1039340) 시트 XML이 압축을 풀면
//  600MB가 넘는다. 일반 엑셀 파서(xlsx 라이브러리)는 통째로 메모리에 올리다 실패한다.
//  그래서 zip을 직접 스트리밍으로 풀면서 행 단위로 읽고, 빈 행이 이어지면 거기서 멈춘다.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const EMPTY_ROW_STOP = 50;   // 빈 행이 이 정도 이어지면 데이터 끝으로 본다
const KEY_HEADER = "자산관리번호"; // 이 값이 있는 행을 머리글로 잡는다

// ===== zip에서 파일 하나를 스트림으로 꺼내기 (외부 프로그램 없이 Node만으로) =====
function findMember(fd, fileSize, memberName) {
  // 1) 끝에서 EOCD(End Of Central Directory) 찾기
  const tailLen = Math.min(fileSize, 65557);
  const tail = Buffer.alloc(tailLen);
  fs.readSync(fd, tail, 0, tailLen, fileSize - tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip 구조를 읽지 못했습니다(EOCD 없음).");
  let cdOffset = tail.readUInt32LE(eocd + 16);
  let cdSize = tail.readUInt32LE(eocd + 12);
  // zip64면 실제 값은 별도 레코드에 있다
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x07064b50) {                 // zip64 EOCD locator
        const z64 = Number(tail.readBigUInt64LE(i + 8));
        const hdr = Buffer.alloc(56);
        fs.readSync(fd, hdr, 0, 56, z64);
        cdSize = Number(hdr.readBigUInt64LE(40));
        cdOffset = Number(hdr.readBigUInt64LE(48));
        break;
      }
    }
  }
  // 2) 중앙 디렉터리에서 원하는 파일 찾기
  const cd = Buffer.alloc(cdSize);
  fs.readSync(fd, cd, 0, cdSize, cdOffset);
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === memberName) return { method, compSize, localOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip 안에 ${memberName} 이(가) 없습니다.`);
}
function memberStream(file, memberName) {
  const fd = fs.openSync(file, "r");
  const size = fs.statSync(file).size;
  const m = findMember(fd, size, memberName);
  // 로컬 헤더를 읽어 실제 데이터 시작 위치 계산
  const lh = Buffer.alloc(30);
  fs.readSync(fd, lh, 0, 30, m.localOffset);
  const dataStart = m.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  fs.closeSync(fd);
  const raw = fs.createReadStream(file, { start: dataStart, end: dataStart + m.compSize - 1 });
  return m.method === 0 ? raw : raw.pipe(zlib.createInflateRaw());
}
function readMemberText(file, memberName) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    memberStream(file, memberName)
      .on("data", (c) => chunks.push(c))
      .on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
      .on("error", reject);
  });
}

// ===== XML 헬퍼 =====
const unescapeXml = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, "&");
const colIndex = (ref) => {   // "AB12" → 27
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
};
// 엑셀 날짜(1900 기준 일련번호) → YYYY-MM-DD
function excelDate(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// 공유 문자열 테이블
async function readSharedStrings(file) {
  let xml;
  try { xml = await readMemberText(file, "xl/sharedStrings.xml"); } catch { return []; }
  const out = [];
  for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || []) {
    // <si> 안의 <t> 조각을 모두 이어붙인다(서식이 섞이면 여러 개로 쪼개짐)
    const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    out.push(parts.map((t) => unescapeXml(t.replace(/<t[^>]*>/, "").replace(/<\/t>$/, ""))).join(""));
  }
  return out;
}

// 날짜 서식이 걸린 스타일 번호 집합 (숫자를 날짜로 되돌리기 위해)
async function readDateStyles(file) {
  let xml;
  try { xml = await readMemberText(file, "xl/styles.xml"); } catch { return new Set(); }
  const dateFmtIds = new Set([14, 15, 16, 17, 22]);   // 내장 날짜 서식
  for (const m of xml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    if (/[ymd]/i.test(m[2]) && !/[hs]/i.test(m[2])) dateFmtIds.add(Number(m[1]));
  }
  const cellXfs = (xml.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [""])[0];
  const styles = new Set();
  let i = 0;
  for (const xf of cellXfs.match(/<xf[^>]*\/?>/g) || []) {
    const id = /numFmtId="(\d+)"/.exec(xf);
    if (id && dateFmtIds.has(Number(id[1]))) styles.add(i);
    i++;
  }
  return styles;
}

// 시트를 스트리밍으로 훑어 '내용이 있는 행'만 뽑는다
function readRows(file, shared, dateStyles) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let buf = "";
    let emptyRun = 0;
    let stopped = false;
    const st = memberStream(file, "xl/worksheets/sheet1.xml");
    const parseRow = (xml) => {
      const cells = [];
      // 셀은 <c .../> (빈 셀) 또는 <c ...>…</c> 두 형태다. 하나의 정규식으로 처리하면
      // 빈 셀 뒤의 </c> 까지 삼켜 값이 엉뚱한 열로 들어가므로, 여는 태그만 찾고 닫는 위치를 직접 잡는다.
      const cellRe = /<c\s+([^>]*?)(\/?)>/g;
      let m;
      while ((m = cellRe.exec(xml))) {
        const attrs = m[1];
        let inner = "";
        if (m[2] !== "/") {
          const close = xml.indexOf("</c>", cellRe.lastIndex);
          inner = close === -1 ? "" : xml.slice(cellRe.lastIndex, close);
          cellRe.lastIndex = close === -1 ? xml.length : close + 4;
        }
        const ref = /r="([A-Z]+\d+)"/.exec(attrs);
        if (!ref) continue;
        const type = (/t="([^"]+)"/.exec(attrs) || [])[1] || "n";
        const style = Number((/s="(\d+)"/.exec(attrs) || [])[1] ?? -1);
        let v = "";
        if (type === "inlineStr") {
          v = (inner.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
            .map((t) => unescapeXml(t.replace(/<t[^>]*>/, "").replace(/<\/t>$/, ""))).join("");
        } else {
          const raw = /<v>([\s\S]*?)<\/v>/.exec(inner);
          if (!raw) continue;
          const text = unescapeXml(raw[1]);
          if (type === "s") v = shared[Number(text)] ?? "";
          else if (type === "n" && dateStyles.has(style) && text !== "" && !isNaN(text)) v = excelDate(Number(text));
          else if (type === "n") v = text === "" ? "" : Number(text);
          else v = text;
        }
        if (v !== "" && v !== null && v !== undefined) cells[colIndex(ref[1])] = v;
      }
      return cells;
    };
    st.on("data", (chunk) => {
      if (stopped) return;
      buf += chunk.toString("utf8");
      let end;
      while ((end = buf.indexOf("</row>")) !== -1) {
        const start = buf.lastIndexOf("<row", end);
        const xml = start === -1 ? "" : buf.slice(start, end);
        buf = buf.slice(end + 6);
        const cells = parseRow(xml);
        const hasData = cells.some((c) => c !== undefined && String(c).trim() !== "");
        if (hasData) { emptyRun = 0; rows.push(cells); }
        else if (rows.length) {
          // 데이터가 시작된 뒤 빈 행이 계속되면 거기서 끝 (100만 행을 다 읽지 않기 위해)
          if (++emptyRun >= EMPTY_ROW_STOP) { stopped = true; st.destroy(); resolve(rows); return; }
        }
      }
      if (buf.length > 4 * 1024 * 1024) buf = buf.slice(-1024); // 안전장치: 비정상적으로 커지면 잘라냄
    });
    st.on("end", () => { if (!stopped) resolve(rows); });
    st.on("close", () => { if (!stopped) resolve(rows); });
    st.on("error", (e) => { if (!stopped) reject(e); });
  });
}

(async () => {
  // 대상 파일 결정
  let file = process.argv[2];
  if (!file) {
    file = fs.readdirSync(".").find((f) => /재물조사 목록표.*\.xlsx$/.test(f) && !f.startsWith("~$") && !/검수표시/.test(f));
    if (!file) { console.error("재물조사 목록표 xlsx 파일을 찾지 못했습니다. 파일명을 인자로 넘겨주세요."); process.exit(1); }
  }
  if (!fs.existsSync(file)) { console.error("파일이 없습니다:", file); process.exit(1); }
  console.log("원본:", path.basename(file), `(${(fs.statSync(file).size / 1048576).toFixed(1)}MB)`);

  const [shared, dateStyles] = await Promise.all([readSharedStrings(file), readDateStyles(file)]);
  const rows = await readRows(file, shared, dateStyles);
  console.log("내용이 있는 행:", rows.length);

  // 머리글 행 찾기 → 그 아래를 데이터로
  const hIdx = rows.findIndex((r) => r.some((c) => String(c).replace(/\s/g, "") === KEY_HEADER));
  if (hIdx === -1) throw new Error(`머리글('${KEY_HEADER}')을 찾지 못했습니다. 목록표 양식이 바뀌었는지 확인해주세요.`);
  // 빈 셀은 배열의 '구멍'이라 map이 건너뛴다 → Array.from으로 구멍을 undefined로 메워서 다룬다.
  const headers = Array.from(rows[hIdx], (c) => String(c ?? "").replace(/\s+/g, " ").trim());
  const numCol = headers.findIndex((h) => h.replace(/\s/g, "") === KEY_HEADER);
  console.log("머리글 행:", hIdx + 1, "| 열:", headers.filter(Boolean).length + "개");

  const data = [];
  for (const r of rows.slice(hIdx + 1)) {
    const num = String(r[numCol] ?? "").trim();
    if (!num) continue;                       // 자산관리번호 없는 행(합계·주석 등) 제외
    const o = {};
    headers.forEach((h, i) => { if (h) o[h] = r[i] === undefined ? "" : r[i]; });
    data.push(o);
  }
  const nums = [...new Set(data.map((r) => String(r[KEY_HEADER] || "").trim()).filter(Boolean))];

  fs.writeFileSync("inventory_list.json", JSON.stringify(data));
  fs.writeFileSync("survey_targets.json", JSON.stringify(nums));
  console.log(`\n✅ inventory_list.json  ${data.length}건 (${(fs.statSync("inventory_list.json").size / 1024).toFixed(0)}KB)`);
  console.log(`✅ survey_targets.json ${nums.length}건 (${(fs.statSync("survey_targets.json").size / 1024).toFixed(0)}KB)`);
})().catch((e) => { console.error("변환 실패:", e.message); process.exit(1); });
