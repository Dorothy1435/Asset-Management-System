// ===== 자산관리 시스템 =====

let allAssets = [];
let filtered = [];
let currentPage = 1;
const PER_PAGE = 20;

// 금액 포맷
const won = (n) => (n ? Number(n).toLocaleString("ko-KR") + "원" : "-");
// 빈 값 처리
const val = (v) => (v && String(v).trim() ? v : "-");

// 상태 -> 배지 클래스
function statusBadge(status) {
  const s = status || "";
  let cls = "badge-gray";
  if (s.includes("정상") || s.includes("취득") || s.includes("사용")) cls = "badge-normal";
  else if (s.includes("불용") || s.includes("폐기") || s.includes("매각")) cls = "badge-warn";
  return `<span class="badge ${cls}">${val(s)}</span>`;
}

// HTML 이스케이프
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ===== 데이터 로드 =====
async function loadData() {
  try {
    const res = await fetch("assets.json");
    allAssets = await res.json();
    filtered = allAssets;
    initCategoryFilter();
    renderStats();
    render();
  } catch (e) {
    document.getElementById("assetTbody").innerHTML =
      `<tr><td colspan="9" style="padding:40px;text-align:center;color:#c2410c;">데이터를 불러오지 못했습니다.</td></tr>`;
  }
}

// ===== 통계 =====
function renderStats() {
  const total = allAssets.length;
  const totalCost = allAssets.reduce((s, a) => s + (a.acquireCost || 0), 0);
  const deptCount = new Set(allAssets.map((a) => a.dept).filter(Boolean)).size;
  const catCount = new Set(allAssets.map((a) => a.category).filter(Boolean)).size;

  document.getElementById("stats").innerHTML = `
    <div class="stat-card"><div class="num">${total.toLocaleString()}</div><div class="label">전체 자산</div></div>
    <div class="stat-card"><div class="num">${(totalCost / 100000000).toFixed(1)}억</div><div class="label">총 취득금액</div></div>
    <div class="stat-card"><div class="num">${catCount}</div><div class="label">자산 분류</div></div>
    <div class="stat-card"><div class="num">${deptCount}</div><div class="label">관리 기관</div></div>
  `;
}

// ===== 분류 필터 옵션 =====
function initCategoryFilter() {
  const cats = [...new Set(allAssets.map((a) => a.category).filter(Boolean))].sort();
  const sel = document.getElementById("categoryFilter");
  cats.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
}

// ===== 검색/필터 =====
function applyFilter() {
  const kw = document.getElementById("searchInput").value.trim().toLowerCase();
  const cat = document.getElementById("categoryFilter").value;

  filtered = allAssets.filter((a) => {
    if (cat && a.category !== cat) return false;
    if (!kw) return true;
    const hay = [
      a.assetName, a.assetNumber, a.location, a.manager,
      a.dept, a.org, a.maker, a.model, a.spec, a.category,
    ].join(" ").toLowerCase();
    return hay.includes(kw);
  });

  currentPage = 1;
  render();
}

// ===== 렌더링 =====
function render() {
  const tbody = document.getElementById("assetTbody");
  const emptyMsg = document.getElementById("emptyMsg");
  const resultCount = document.getElementById("resultCount");

  resultCount.textContent = `총 ${filtered.length.toLocaleString()}건`;

  if (filtered.length === 0) {
    tbody.innerHTML = "";
    emptyMsg.hidden = false;
    document.getElementById("pagination").innerHTML = "";
    return;
  }
  emptyMsg.hidden = true;

  const start = (currentPage - 1) * PER_PAGE;
  const pageItems = filtered.slice(start, start + PER_PAGE);

  tbody.innerHTML = pageItems
    .map(
      (a) => `
    <tr>
      <td class="cell-name" title="${esc(a.assetName)}">${esc(a.assetName)}</td>
      <td class="cell-num">${esc(a.assetNumber)}</td>
      <td>${esc(val(a.category))}</td>
      <td class="cell-loc" title="${esc(a.location)}">${esc(val(a.location))}</td>
      <td>${esc(val(a.manager))}</td>
      <td>${esc(val(a.dept))}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${esc(val(a.regDate))}</td>
      <td><button class="btn-detail" data-id="${a.id}">상세</button></td>
    </tr>`
    )
    .join("");

  renderPagination();
}

// ===== 페이지네이션 =====
function renderPagination() {
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const nav = document.getElementById("pagination");
  if (totalPages <= 1) {
    nav.innerHTML = "";
    return;
  }

  let html = `<button data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>‹</button>`;

  const range = [];
  const push = (p) => range.push(p);
  push(1);
  for (let p = currentPage - 2; p <= currentPage + 2; p++) {
    if (p > 1 && p < totalPages) push(p);
  }
  if (totalPages > 1) push(totalPages);
  const uniq = [...new Set(range)].sort((a, b) => a - b);

  let prev = 0;
  uniq.forEach((p) => {
    if (p - prev > 1) html += `<span style="padding:0 4px;color:#9ca3af;">…</span>`;
    html += `<button data-page="${p}" class="${p === currentPage ? "active" : ""}">${p}</button>`;
    prev = p;
  });

  html += `<button data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>›</button>`;
  nav.innerHTML = html;
}

// ===== 상세 모달 =====
function openDetail(id) {
  const a = allAssets.find((x) => x.id === Number(id));
  if (!a) return;

  const rows = [
    ["자산명", a.assetName],
    ["자산번호", a.assetNumber],
    ["자산구분", a.category],
    ["물품분류", a.classify],
    ["모델명", a.model],
    ["규격", a.spec],
    ["제작회사", a.maker],
    ["단가", won(a.unitPrice)],
    ["수량", a.qty],
    ["취득금액", won(a.acquireCost)],
    ["취득일자", a.acquireDate],
    ["보관 위치", a.location],
    ["관리 기관", a.org],
    ["운영 부서", a.dept],
    ["담당자", a.manager],
    ["등재일", a.regDate],
    ["상태", a.status],
    ["비고", a.note],
  ];

  document.getElementById("modalTitle").textContent = a.assetName || "자산 상세 정보";
  document.getElementById("modalBody").innerHTML =
    `<dl class="detail-grid">` +
    rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(val(v))}</dd>`).join("") +
    `</dl>`;
  document.getElementById("modalOverlay").hidden = false;
}

function closeModal() {
  document.getElementById("modalOverlay").hidden = true;
}

// ===== 이벤트 바인딩 =====
document.getElementById("searchInput").addEventListener("input", applyFilter);
document.getElementById("categoryFilter").addEventListener("change", applyFilter);
document.getElementById("clearBtn").addEventListener("click", () => {
  document.getElementById("searchInput").value = "";
  applyFilter();
});

document.getElementById("assetTbody").addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-detail");
  if (btn) openDetail(btn.dataset.id);
});

document.getElementById("pagination").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-page]");
  if (!btn || btn.disabled) return;
  currentPage = Number(btn.dataset.page);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.getElementById("modalClose").addEventListener("click", closeModal);
document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
document.getElementById("modalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "modalOverlay") closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// 시작
loadData();
