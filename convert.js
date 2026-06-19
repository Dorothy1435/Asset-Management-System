const XLSX = require('xlsx');

// 엑셀 시리얼 날짜 -> YYYY-MM-DD
function excelDate(serial) {
  if (!serial || isNaN(serial)) return '';
  const d = XLSX.SSF.parse_date_code(serial);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
}

const wb = XLSX.readFile('글로컬대학사업본부_전체_자산_목록(06.18.기준).xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// 컬럼 인덱스 매핑
const COL = {
  assetNumber: 1,   // 자산관리번호
  regDate: 2,       // 자산등재일
  category: 3,      // 자산구분
  assetName: 4,     // 물품명
  classify: 6,      // 물품분류
  model: 7,         // 모델명
  spec: 8,          // 규격
  maker: 10,        // 제작회사
  unitPrice: 13,    // 단가
  qty: 14,          // 수량
  acquireCost: 17,  // 취득금액
  acquireDate: 18,  // 취득일자
  dept: 24,         // 운영부서
  org: 25,          // 관리기관
  manager: 27,      // 운영책임자
  storage: 50,      // 보관(설치)장소
  building: 52,     // 건물명
  room: 57,         // 호실명
  note: 59,         // 비고
  status: 60,       // 자산상태
};

const data = rows.slice(1)
  .filter((r) => r[COL.assetNumber]) // 자산번호 없는 행 제거
  .map((r, i) => {
    const loc = [r[COL.storage], r[COL.building], r[COL.room]]
      .filter((v) => v && String(v).trim())
      .join(' / ');
    return {
      id: i + 1,
      assetNumber: String(r[COL.assetNumber] || '').trim(),
      assetName: String(r[COL.assetName] || '').trim(),
      category: String(r[COL.category] || '').trim(),
      classify: String(r[COL.classify] || '').trim(),
      model: String(r[COL.model] || '').trim(),
      spec: String(r[COL.spec] || '').trim(),
      maker: String(r[COL.maker] || '').trim(),
      unitPrice: Number(r[COL.unitPrice]) || 0,
      qty: Number(r[COL.qty]) || 0,
      acquireCost: Number(r[COL.acquireCost]) || 0,
      acquireDate: excelDate(r[COL.acquireDate]),
      regDate: excelDate(r[COL.regDate]),
      dept: String(r[COL.dept] || '').trim(),
      org: String(r[COL.org] || '').trim(),
      manager: String(r[COL.manager] || '').trim(),
      location: loc,
      note: String(r[COL.note] || '').trim(),
      status: String(r[COL.status] || '').trim() || '정상',
    };
  });

const fs = require('fs');
fs.writeFileSync('assets.json', JSON.stringify(data));
console.log('변환 완료:', data.length, '건');
console.log('예시:', JSON.stringify(data[0], null, 2));
