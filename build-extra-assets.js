// 추가 자산 데이터 변환 스크립트
//  1) "2024년도 자산.xls"           → assets2024.json   (assetGroup = "2024자산")
//  2) "..._자산_목록(6.30기준_추가).xlsx" → assets2025add.json (2025 메뉴, assets.json과 자산번호 중복 제외)
// 실행: node build-extra-assets.js
const XLSX = require('xlsx');
const fs = require('fs');

const GROUP_PAST = '2024자산'; // script.js의 GROUP_PAST와 동일해야 함

// 엑셀 시리얼 날짜 -> YYYY-MM-DD
function excelDate(serial) {
  if (serial === '' || serial === null || serial === undefined) return '';
  if (typeof serial === 'string') {
    const s = serial.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);        // 이미 ISO
    if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; // 20241219
    const n = Number(s);
    if (!isNaN(n) && n > 0) return excelDate(n);
    return '';
  }
  if (isNaN(serial)) return '';
  const d = XLSX.SSF.parse_date_code(serial);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
}
const str = (v) => String(v === undefined || v === null ? '' : v).trim();

// ===== 1) 2024년도 자산.xls =====
function build2024() {
  const wb = XLSX.readFile('2024년도 자산.xls');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  // 컬럼: 0구분 1자산코드 2장소코드 3비치장소 4품목코드 5품목명 6규격명 7단위 8수량 9단가
  //       10최초취득부서 11관리부서 12최초취득일자 13시리얼 14재원구분 15구입처 16취득일자 17용도 18비고 19비목
  const out = rows.slice(1)
    .filter((r) => str(r[1]))
    .map((r, i) => {
      const qty = Number(r[8]) || 0;
      const unit = Number(r[9]) || 0;
      const loc = [str(r[3]), str(r[2])].filter(Boolean).join(' / ');
      return {
        id: 2000001 + i,
        assetGroup: GROUP_PAST,
        assetNumber: str(r[1]),
        assetName: str(r[5]),
        category: str(r[0]),
        classify: str(r[0]),
        model: str(r[5]),
        spec: str(r[6]),
        maker: str(r[15]),
        unitPrice: unit,
        qty: qty,
        acquireCost: unit * (qty || 1),
        acquireDate: excelDate(r[16]) || excelDate(r[12]),
        regDate: excelDate(r[12]) || excelDate(r[16]),
        dept: '',
        org: str(r[11]),
        manager: '',
        location: loc,
        note: str(r[18]),
        status: '취득',
      };
    });
  fs.writeFileSync('assets2024.json', JSON.stringify(out));
  console.log('assets2024.json:', out.length, '건 / 예시:', JSON.stringify(out[0]));
  return out;
}

// ===== 2) 6.30기준_추가.xlsx (2025 메뉴에 병합) =====
function build2025add() {
  // 기존 2025 자산번호 집합 (중복 제외 기준)
  const base = JSON.parse(fs.readFileSync('assets.json', 'utf8'));
  const norm = (s) => String(s || '').replace(/[\s-]/g, '');
  const existing = new Set(base.map((a) => norm(a.assetNumber)));

  const wb = XLSX.readFile('글로컬대학사업본부_자산_목록(6.30기준_추가).xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  // 헤더 2줄(0,1), 데이터는 2행부터. 컬럼(1행 기준):
  //  1자산관리번호 2자산등재일 3자산구분 4물품명 6물품분류 10모델명 11규격 13제작회사
  //  16단가 17수량 20취득금액 21취득일자 27운영부서 28관리기관 30운영책임자
  //  53보관설치장소 55건물명 60호실명 63자산상태 70비고
  const seen = new Set();
  let skipped = 0, dupInFile = 0, id = 3000001;
  const out = [];
  rows.slice(2).forEach((r) => {
    const num = str(r[1]);
    if (!num) return;
    const key = norm(num);
    if (existing.has(key)) { skipped++; return; }   // 기존 2025와 중복 → 제외
    if (seen.has(key)) { dupInFile++; return; }      // 파일 내 중복 → 1건만
    seen.add(key);
    const bldRoom = [str(r[55]), str(r[60])].filter(Boolean).join(' / ');
    const loc = bldRoom || str(r[53]);
    out.push({
      id: id++,
      assetNumber: num,
      assetName: str(r[4]),
      category: str(r[3]),
      classify: str(r[6]),
      model: str(r[10]),
      spec: str(r[11]),
      maker: str(r[13]),
      unitPrice: Number(r[16]) || 0,
      qty: Number(r[17]) || 0,
      acquireCost: Number(r[20]) || 0,
      acquireDate: excelDate(r[21]),
      regDate: excelDate(r[2]),
      dept: str(r[27]),
      org: str(r[28]),
      manager: str(r[30]),
      location: loc,
      note: str(r[70]) || str(r[62]),
      status: str(r[63]) || '취득',
    });
  });
  fs.writeFileSync('assets2025add.json', JSON.stringify(out));
  console.log(`assets2025add.json: ${out.length}건 추가 / 기존중복 ${skipped} · 파일내중복 ${dupInFile}`);
  if (out[0]) console.log('예시:', JSON.stringify(out[0]));
  return out;
}

build2024();
build2025add();
console.log('완료.');
