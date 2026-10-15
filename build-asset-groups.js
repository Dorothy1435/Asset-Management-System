// 자산을 '과제' 기준으로 2026년도 자산 / 김해시 보조금 으로 갈라 asset-groups.json 을 만든다.
//
//   node build-asset-groups.js
//
// 자산 파일(assets.json · assets2025add.json)에는 과제 항목이 없어서, 원본 엑셀에서 과제를 읽어
// 자산번호별로 어느 메뉴에 속하는지만 따로 적어 둔다. 웹페이지가 이 파일을 읽어 메뉴를 가른다.
//
// 분류 기준 (2026. 10. 15. 기준 합의)
//   · 2026년도 자산   : 과제가 '2026 글로컬대학 사업…' 으로 시작
//   · 김해시 보조금   : 과제에 '김해시보조금' 포함
//   · 그 밖      : 2025년도 자산 (기본값이라 파일에 적지 않는다)
//     — EV3 배관 개발(C013)도 2025년도 자산으로 본다.

const fs = require("fs");
const XLSX = require("xlsx");

const GROUP_2026 = "2026자산";
const GROUP_GIMHAE = "김해시보조금";

const norm = (s) => String(s || "").replace(/[\s-]/g, "");
// 원본 엑셀마다 '과제' 열 위치가 달라서 머리글에서 찾는다.
function readTasks(file, sheetNames) {
  const out = new Map();
  if (!fs.existsSync(file)) { console.log(`  (없음) ${file}`); return out; }
  const wb = XLSX.readFile(file);
  for (const sn of (sheetNames || wb.SheetNames)) {
    const ws = wb.Sheets[sn];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    let hr = -1;
    for (let i = 0; i < Math.min(8, rows.length); i++)
      if (rows[i].some((c) => String(c).trim() === "자산관리번호")) { hr = i; break; }
    if (hr < 0) continue;
    const hdr = rows[hr];
    const cNum = hdr.findIndex((h) => String(h).trim() === "자산관리번호");
    const cTask = hdr.findIndex((h) => String(h).trim() === "과제");
    if (cNum < 0 || cTask < 0) continue;
    for (const r of rows.slice(hr + 1)) {
      const n = norm(r[cNum]);
      if (!/^\d{10,}$/.test(n)) continue;
      if (!out.has(n)) out.set(n, String(r[cTask] || "").trim());
    }
  }
  return out;
}

const SOURCES = [
  "글로컬대학사업본부_전체_자산_목록(06.18.기준).xlsx",
  "글로컬대학사업본부_자산_목록(6.30기준_추가).xlsx",
  "글로컬대학사업본부_자산_목록(08.13.기준_추가).xlsx",
  "글로컬대학사업본부_자산_목록(08.25.기준_추가).xlsx",
  "글로컬대학사업본부_자산_목록(09.09.기준_추가).xlsx",
  "글로컬대학사업본부_자산_목록(09.11.기준_추가).xlsx",
  "글로컬대학사업본부_자산_목록(10.01.기준_추가).xlsx",
  "2025년 글로컬대학사업본부 자산 목록_소연.xlsx",
  "2026.03.01.~2026.08.31.글로컬대학사업본부_소연.xlsx",
];

const task = new Map();
console.log("원본에서 과제 읽는 중…");
for (const f of SOURCES) {
  const m = readTasks(f);
  let add = 0;
  for (const [k, v] of m) if (!task.has(k)) { task.set(k, v); add++; }
  if (add) console.log(`  · ${f}: ${add}건`);
}
console.log(`과제 확보 ${task.size}건`);

const groupOfTask = (t) => {
  const s = String(t || "");
  if (/^2026\s*글로컬대학\s*사업/.test(s)) return GROUP_2026;
  if (s.includes("김해시보조금")) return GROUP_GIMHAE;
  return null;                       // 2025년도 자산(기본)
};

// 실제 자산 목록과 맞춰 본다
const aB = JSON.parse(fs.readFileSync("assets.json", "utf8"));
const aA = JSON.parse(fs.readFileSync("assets2025add.json", "utf8"));
const elec = new Set(aB.filter((a) => a.assetGroup === "전자" || String(a.id).startsWith("e")).map((a) => a.id));
const list = [...aB.filter((a) => !elec.has(a.id)), ...aA];

const groups = { [GROUP_2026]: [], [GROUP_GIMHAE]: [] };
const tasks = {};                    // 자산번호 → 과제 (화면에서 보여 주려고 함께 저장)
let noTask = 0, base = 0;
for (const a of list) {
  const n = norm(a.assetNumber);
  const t = task.get(n);
  if (t === undefined) { noTask++; continue; }
  tasks[n] = t;
  const g = groupOfTask(t);
  if (g) groups[g].push(n); else base++;
}
fs.writeFileSync("asset-groups.json", JSON.stringify({ groups, tasks }));

const sum = (nums) => {
  const byNum = new Map(list.map((a) => [norm(a.assetNumber), a]));
  return nums.reduce((s, n) => s + (Number(byNum.get(n)?.acquireCost) || 0), 0);
};
console.log(`\n2025년도 자산 전체 ${list.length}건 기준`);
console.log(`  · 2025년도 자산(기본) ${base}건 · ${sum(list.map((a) => norm(a.assetNumber)).filter((n) => !groups[GROUP_2026].includes(n) && !groups[GROUP_GIMHAE].includes(n))).toLocaleString()}원`);
console.log(`  · ${GROUP_2026} ${groups[GROUP_2026].length}건 · ${sum(groups[GROUP_2026]).toLocaleString()}원`);
console.log(`  · ${GROUP_GIMHAE} ${groups[GROUP_GIMHAE].length}건 · ${sum(groups[GROUP_GIMHAE]).toLocaleString()}원`);
if (noTask) console.log(`  ※ 과제를 찾지 못한 자산 ${noTask}건 → 2025년도 자산으로 둔다`);
console.log(`\nasset-groups.json 저장 (${(fs.statSync("asset-groups.json").size / 1024).toFixed(0)}KB)`);
