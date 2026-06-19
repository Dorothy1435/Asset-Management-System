// ===== 자산관리 시스템 =====
// 베이스: assets.json (엑셀 원본, 읽기 전용)
// 사용자 레이어: localStorage (직접 등록 / 수정 / 삭제)

const LS = {
  added: "assetmgr_added", // 사용자가 직접 등록한 자산 [{...}]
  overrides: "assetmgr_overrides", // 베이스 자산 수정 내용 { "<id>": {...} }
  deleted: "assetmgr_deleted", // 삭제된 베이스 자산 id 목록 ["<id>"]
};

let baseAssets = []; // assets.json 원본
let userAdded = []; // localStorage 직접 등록
let overrides = {}; // localStorage 수정
let deleted = []; // localStorage 삭제

let assets = []; // 병합 결과 (화면 데이터)
let filtered = [];
let currentPage = 1;
const PER_PAGE = 20;

let sortState = { key: null, dir: 1 }; // dir: 1 오름, -1 내림

let currentPhoto = ""; // 폼에서 편집 중인 사진(base64)

// ===== 유틸 =====
const won = (n) => (n ? Number(n).toLocaleString("ko-KR") + "원" : "-");
const val = (v) => (v !== undefined && v !== null && String(v).trim() ? v : "-");

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusBadge(status) {
  const s = status || "";
  let cls = "badge-gray";
  if (s.includes("정상") || s.includes("취득") || s.includes("사용")) cls = "badge-normal";
  else if (s.includes("불용") || s.includes("폐기") || s.includes("매각")) cls = "badge-warn";
  return `<span class="badge ${cls}">${val(s)}</span>`;
}

// ===== localStorage =====
function loadUserData() {
  try {
    userAdded = JSON.parse(localStorage.getItem(LS.added) || "[]");
    overrides = JSON.parse(localStorage.getItem(LS.overrides) || "{}");
    deleted = JSON.parse(localStorage.getItem(LS.deleted) || "[]");
  } catch {
    userAdded = []; overrides = {}; deleted = [];
  }
}
function saveAdded() { localStorage.setItem(LS.added, JSON.stringify(userAdded)); }
function saveOverrides() { localStorage.setItem(LS.overrides, JSON.stringify(overrides)); }
function saveDeleted() { localStorage.setItem(LS.deleted, JSON.stringify(deleted)); }

// 베이스 + 사용자 레이어 병합
function buildAssets() {
  const base = baseAssets
    .filter((a) => !deleted.includes(String(a.id)))
    .map((a) => {
      const ov = overrides[String(a.id)];
      return ov ? { ...a, ...ov, _edited: true } : a;
    });
  const added = userAdded.map((a) => ({ ...a, _added: true }));
  assets = [...added, ...base];
}

// ===== 데이터 로드 =====
async function loadData() {
  try {
    const res = await fetch("assets.json");
    baseAssets = await res.json();
  } catch {
    baseAssets = [];
    document.getElementById("assetTbody").innerHTML =
      `<tr><td colspan="9" style="padding:40px;text-align:center;color:#c2410c;">엑셀 데이터를 불러오지 못했습니다.</td></tr>`;
  }
  loadUserData();
  buildAssets();
  filtered = assets;
  initCategoryFilter();
  renderStats();
  render();
}

function refresh() {
  buildAssets();
  initCategoryFilter();
  renderStats();
  applyFilter(); // 현재 검색/필터 유지하며 다시 렌더
}

// ===== 통계 =====
function renderStats() {
  const total = assets.length;
  const totalCost = assets.reduce((s, a) => s + (a.acquireCost || 0), 0);
  const addedCount = userAdded.length;
  const catCount = new Set(assets.map((a) => a.category).filter(Boolean)).size;

  document.getElementById("stats").innerHTML = `
    <div class="stat-card"><div class="num">${total.toLocaleString()}</div><div class="label">전체 자산</div></div>
    <div class="stat-card"><div class="num">${(totalCost / 100000000).toFixed(1)}억</div><div class="label">총 취득금액</div></div>
    <div class="stat-card"><div class="num">${catCount}</div><div class="label">자산 분류</div></div>
    <div class="stat-card"><div class="num">${addedCount}</div><div class="label">직접 등록</div></div>
  `;
}

// ===== 필터 드롭다운 채우기 =====
function fillSelect(id, values, allLabel) {
  const sel = document.getElementById(id);
  const prev = sel.value;
  const opts = [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "ko"));
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    opts.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if (opts.includes(prev)) sel.value = prev;
}

function initCategoryFilter() {
  fillSelect("categoryFilter", assets.map((a) => a.category), "전체 분류");
  fillSelect("deptFilter", assets.map((a) => a.dept), "전체");
  fillSelect("statusFilter", assets.map((a) => a.status), "전체");
}

// ===== 검색/필터 =====
function applyFilter() {
  const kw = document.getElementById("searchInput").value.trim().toLowerCase();
  const cat = document.getElementById("categoryFilter").value;
  const dept = document.getElementById("deptFilter").value;
  const status = document.getElementById("statusFilter").value;
  const minCost = Number(document.getElementById("minCost").value) || 0;
  const maxCostRaw = document.getElementById("maxCost").value;
  const maxCost = maxCostRaw === "" ? Infinity : Number(maxCostRaw);

  filtered = assets.filter((a) => {
    if (cat && a.category !== cat) return false;
    if (dept && a.dept !== dept) return false;
    if (status && a.status !== status) return false;
    const cost = a.acquireCost || 0;
    if (cost < minCost || cost > maxCost) return false;
    if (!kw) return true;
    const hay = [
      a.assetName, a.assetNumber, a.location, a.manager,
      a.dept, a.org, a.maker, a.model, a.spec, a.category,
    ].join(" ").toLowerCase();
    return hay.includes(kw);
  });

  sortFiltered();
  currentPage = 1;
  render();
}

// ===== 정렬 =====
function sortFiltered() {
  const { key, dir } = sortState;
  if (!key) return;
  filtered.sort((a, b) => {
    let va = a[key] ?? "";
    let vb = b[key] ?? "";
    const na = parseFloat(va), nb = parseFloat(vb);
    const bothNum = va !== "" && vb !== "" && !isNaN(na) && !isNaN(nb) &&
      String(va).trim() === String(na) && String(vb).trim() === String(nb);
    let cmp;
    if (bothNum) cmp = na - nb;
    else cmp = String(va).localeCompare(String(vb), "ko");
    return cmp * dir;
  });
}

function setSort(key) {
  if (sortState.key === key) sortState.dir *= -1;
  else sortState = { key, dir: 1 };
  // 헤더 화살표 갱신
  document.querySelectorAll(".asset-table th.sortable").forEach((th) => {
    const arrow = th.querySelector(".sort-arrow");
    if (th.dataset.key === key) {
      arrow.textContent = sortState.dir === 1 ? "▲" : "▼";
      th.classList.add("sorted");
    } else {
      arrow.textContent = "";
      th.classList.remove("sorted");
    }
  });
  applyFilter();
}

// ===== 렌더링 =====
function render() {
  const tbody = document.getElementById("assetTbody");
  const emptyMsg = document.getElementById("emptyMsg");
  document.getElementById("resultCount").textContent = `총 ${filtered.length.toLocaleString()}건`;

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
    .map((a) => {
      let tag = "";
      if (a._added) tag = `<span class="tag tag-added">직접</span>`;
      else if (a._edited) tag = `<span class="tag tag-edited">수정</span>`;
      return `
    <tr>
      <td class="cell-name" title="${esc(a.assetName)}">${esc(a.assetName)} ${tag}</td>
      <td class="cell-num">${esc(a.assetNumber)}</td>
      <td>${esc(val(a.category))}</td>
      <td class="cell-loc" title="${esc(a.location)}">${esc(val(a.location))}</td>
      <td>${esc(val(a.manager))}</td>
      <td>${esc(val(a.dept))}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${esc(val(a.regDate))}</td>
      <td class="cell-actions">
        <button class="btn-mini btn-view" data-id="${esc(a.id)}">상세</button>
        <button class="btn-mini btn-edit" data-id="${esc(a.id)}">수정</button>
        <button class="btn-mini btn-del" data-id="${esc(a.id)}">삭제</button>
      </td>
    </tr>`;
    })
    .join("");

  renderPagination();
}

function renderPagination() {
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const nav = document.getElementById("pagination");
  if (totalPages <= 1) { nav.innerHTML = ""; return; }

  let html = `<button data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>‹</button>`;
  const range = [1];
  for (let p = currentPage - 2; p <= currentPage + 2; p++) if (p > 1 && p < totalPages) range.push(p);
  if (totalPages > 1) range.push(totalPages);
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

// ===== 조회 헬퍼 =====
const findAsset = (id) => assets.find((x) => String(x.id) === String(id));

// ===== 상세 모달 =====
let detailCurrentId = null;

function openDetail(id) {
  const a = findAsset(id);
  if (!a) return;
  detailCurrentId = id;

  const photo = a.imageUrl
    ? `<div class="detail-photo"><img src="${a.imageUrl}" alt="물품 사진" /></div>`
    : `<div class="detail-photo no-photo">등록된 사진 없음</div>`;

  const rows = [
    ["자산명", a.assetName],
    ["자산번호", a.assetNumber],
    ["자산구분", a.category],
    ["모델명", a.model],
    ["규격", a.spec],
    ["제작회사", a.maker],
    ["단가", a.unitPrice ? won(a.unitPrice) : ""],
    ["수량", a.qty],
    ["취득금액", a.acquireCost ? won(a.acquireCost) : ""],
    ["취득일자", a.acquireDate],
    ["보관 위치", a.location],
    ["관리 기관", a.org],
    ["운영 부서", a.dept],
    ["담당자", a.manager],
    ["등재일", a.regDate],
    ["상태", a.status],
    ["비고", a.note],
  ];

  document.getElementById("detailTitle").textContent = a.assetName || "자산 상세 정보";
  document.getElementById("detailBody").innerHTML =
    photo +
    `<dl class="detail-grid">` +
    rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(val(v))}</dd>`).join("") +
    `</dl>`;
  show("detailOverlay");
}

// ===== 등록/수정 폼 =====
function openForm(id) {
  const form = document.getElementById("assetForm");
  form.reset();
  document.getElementById("formError").hidden = true;
  currentPhoto = "";

  if (id) {
    // 수정 모드
    const a = findAsset(id);
    if (!a) return;
    document.getElementById("formTitle").textContent = "자산 수정";
    document.getElementById("formSaveBtn").textContent = "저장";
    document.getElementById("f-id").value = a.id;
    document.getElementById("f-assetName").value = a.assetName || "";
    document.getElementById("f-assetNumber").value = a.assetNumber || "";
    document.getElementById("f-category").value = a.category || "";
    document.getElementById("f-status").value = a.status || "취득";
    document.getElementById("f-location").value = a.location || "";
    document.getElementById("f-manager").value = a.manager || "";
    document.getElementById("f-dept").value = a.dept || "";
    document.getElementById("f-model").value = a.model || "";
    document.getElementById("f-spec").value = a.spec || "";
    document.getElementById("f-maker").value = a.maker || "";
    document.getElementById("f-acquireCost").value = a.acquireCost || "";
    document.getElementById("f-note").value = a.note || "";
    currentPhoto = a.imageUrl || "";
  } else {
    // 등록 모드
    document.getElementById("formTitle").textContent = "자산 등록";
    document.getElementById("formSaveBtn").textContent = "등록";
    document.getElementById("f-id").value = "";
  }

  renderPhotoPreview();
  show("formOverlay");
}

function renderPhotoPreview() {
  const box = document.getElementById("photoPreview");
  const removeBtn = document.getElementById("removePhotoBtn");
  if (currentPhoto) {
    box.innerHTML = `<img src="${currentPhoto}" alt="미리보기" />`;
    removeBtn.hidden = false;
  } else {
    box.innerHTML = `<span class="photo-placeholder">사진 없음</span>`;
    removeBtn.hidden = true;
  }
}

// 사진 업로드 → 이미지 검증 → 리사이즈 → base64
function handlePhotoUpload(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showFormError("이미지 파일만 업로드할 수 있습니다.");
    document.getElementById("f-image").value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const r = Math.min(MAX / width, MAX / height);
        width = Math.round(width * r);
        height = Math.round(height * r);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      currentPhoto = canvas.toDataURL("image/jpeg", 0.7);
      renderPhotoPreview();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function showFormError(msg) {
  const el = document.getElementById("formError");
  el.textContent = msg;
  el.hidden = false;
}

// 저장 (등록 또는 수정)
function saveForm() {
  const id = document.getElementById("f-id").value;
  const get = (k) => document.getElementById("f-" + k).value.trim();

  const assetName = get("assetName");
  const assetNumber = get("assetNumber");
  const location = get("location");
  const manager = get("manager");

  // 필수값 검증
  if (!assetName || !assetNumber || !location || !manager) {
    showFormError("필수 항목을 입력해주세요. (자산명, 자산번호, 위치, 담당자)");
    return;
  }

  // 자산번호 중복 검사 (자기 자신 제외)
  const dup = assets.find(
    (a) => a.assetNumber === assetNumber && String(a.id) !== String(id)
  );
  if (dup) {
    showFormError("이미 등록된 자산번호입니다.");
    return;
  }

  const fields = {
    assetName, assetNumber, location, manager,
    category: get("category"),
    status: get("status") || "취득",
    dept: get("dept"),
    model: get("model"),
    spec: get("spec"),
    maker: get("maker"),
    acquireCost: Number(get("acquireCost")) || 0,
    note: get("note"),
    imageUrl: currentPhoto || "",
  };

  try {
    if (!id) {
      // 신규 등록
      const newAsset = {
        id: "u" + Date.now() + Math.floor(Math.random() * 1000),
        ...fields,
        regDate: todayStr(),
      };
      userAdded.unshift(newAsset);
      saveAdded();
    } else if (String(id).startsWith("u")) {
      // 직접 등록 자산 수정
      const idx = userAdded.findIndex((a) => String(a.id) === String(id));
      if (idx >= 0) userAdded[idx] = { ...userAdded[idx], ...fields };
      saveAdded();
    } else {
      // 베이스(엑셀) 자산 수정 → override 저장
      overrides[String(id)] = { ...(overrides[String(id)] || {}), ...fields };
      saveOverrides();
    }
  } catch (e) {
    showFormError("저장 용량이 초과되었습니다. 사진 크기를 줄여주세요.");
    return;
  }

  hide("formOverlay");
  refresh();
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ===== 삭제 =====
function deleteAsset(id) {
  const a = findAsset(id);
  if (!a) return;
  if (!confirm(`정말 이 자산을 삭제하시겠습니까?\n\n${a.assetName}`)) return;

  if (String(id).startsWith("u")) {
    userAdded = userAdded.filter((x) => String(x.id) !== String(id));
    saveAdded();
  } else {
    if (!deleted.includes(String(id))) deleted.push(String(id));
    delete overrides[String(id)];
    saveDeleted();
    saveOverrides();
  }
  hide("detailOverlay");
  refresh();
}

// ===== 엑셀 내보내기 =====
function exportExcel() {
  if (filtered.length === 0) {
    alert("내보낼 자산이 없습니다.");
    return;
  }
  const rows = filtered.map((a) => ({
    "자산명": a.assetName || "",
    "자산번호": a.assetNumber || "",
    "자산구분": a.category || "",
    "모델명": a.model || "",
    "규격": a.spec || "",
    "제작회사": a.maker || "",
    "단가": a.unitPrice || 0,
    "수량": a.qty || 0,
    "취득금액": a.acquireCost || 0,
    "취득일자": a.acquireDate || "",
    "보관 위치": a.location || "",
    "관리 기관": a.org || "",
    "운영 부서": a.dept || "",
    "담당자": a.manager || "",
    "등재일": a.regDate || "",
    "상태": a.status || "",
    "비고": a.note || "",
    "구분": a._added ? "직접등록" : a._edited ? "수정됨" : "엑셀원본",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "자산목록");
  XLSX.writeFile(wb, `자산목록_${todayStr()}.xlsx`);
}

// ===== 모달 표시 헬퍼 =====
function show(id) { document.getElementById(id).hidden = false; }
function hide(id) { document.getElementById(id).hidden = true; }

// ===== 이벤트 바인딩 =====
document.getElementById("searchInput").addEventListener("input", applyFilter);
document.getElementById("categoryFilter").addEventListener("change", applyFilter);
document.getElementById("clearBtn").addEventListener("click", () => {
  document.getElementById("searchInput").value = "";
  applyFilter();
});

// 상세 필터
document.getElementById("advToggle").addEventListener("click", () => {
  const p = document.getElementById("advPanel");
  p.hidden = !p.hidden;
});
["deptFilter", "statusFilter"].forEach((id) =>
  document.getElementById(id).addEventListener("change", applyFilter)
);
["minCost", "maxCost"].forEach((id) =>
  document.getElementById(id).addEventListener("input", applyFilter)
);
document.getElementById("advReset").addEventListener("click", () => {
  ["deptFilter", "statusFilter", "minCost", "maxCost", "categoryFilter"].forEach(
    (id) => (document.getElementById(id).value = "")
  );
  applyFilter();
});

// 정렬 (헤더 클릭)
document.querySelectorAll(".asset-table th.sortable").forEach((th) =>
  th.addEventListener("click", () => setSort(th.dataset.key))
);

// 엑셀 내보내기
document.getElementById("exportBtn").addEventListener("click", exportExcel);

// 등록 버튼
document.getElementById("addBtn").addEventListener("click", () => openForm(null));

// 테이블 행 버튼 (이벤트 위임)
document.getElementById("assetTbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains("btn-view")) openDetail(id);
  else if (btn.classList.contains("btn-edit")) openForm(id);
  else if (btn.classList.contains("btn-del")) deleteAsset(id);
});

// 페이지네이션
document.getElementById("pagination").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-page]");
  if (!btn || btn.disabled) return;
  currentPage = Number(btn.dataset.page);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// 상세 모달 버튼
document.getElementById("detailEditBtn").addEventListener("click", () => {
  hide("detailOverlay");
  openForm(detailCurrentId);
});
document.getElementById("detailDeleteBtn").addEventListener("click", () => deleteAsset(detailCurrentId));

// 폼 모달
document.getElementById("f-image").addEventListener("change", (e) => handlePhotoUpload(e.target.files[0]));
document.getElementById("removePhotoBtn").addEventListener("click", () => {
  currentPhoto = "";
  document.getElementById("f-image").value = "";
  renderPhotoPreview();
});
document.getElementById("formSaveBtn").addEventListener("click", saveForm);
document.getElementById("assetForm").addEventListener("submit", (e) => {
  e.preventDefault();
  saveForm();
});

// 모달 닫기 (data-close 버튼, 오버레이 클릭, ESC)
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => {
    hide("detailOverlay");
    hide("formOverlay");
  });
});
document.querySelectorAll(".modal-overlay").forEach((ov) => {
  ov.addEventListener("click", (e) => {
    if (e.target === ov) ov.hidden = true;
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hide("detailOverlay");
    hide("formOverlay");
  }
});

// 시작
loadData();
