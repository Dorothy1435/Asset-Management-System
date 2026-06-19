// ===== 자산관리 시스템 =====
// 베이스: assets.json (엑셀 원본, 읽기 전용 파일)
// 공유 오버레이: Supabase assets 테이블 (등록/수정/삭제 결과, 승인된 것만)
//   kind = 'added'(직접등록) | 'override'(엑셀자산 수정) | 'deleted'(엑셀자산 삭제)
// 변경 요청: Supabase requests 테이블 (일반 사용자가 요청 → 관리자 승인 시 오버레이에 반영)
// 관리자: Supabase Auth 로그인 (로그인해야 승인/직접반영 가능)

const SUPABASE_URL = "https://pmjwwvgcmaywbatryibc.supabase.co";
const SUPABASE_KEY = "sb_publishable_dOgVVneeoU9xeZlRWY7zFg_FdRE_PVp";
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

let baseAssets = []; // assets.json 원본
let overlay = []; // Supabase assets 테이블 rows [{id, kind, data}]
let requests = []; // Supabase requests 테이블 (pending)
let assets = []; // 병합 결과 (화면 데이터)
let filtered = [];
let currentPage = 1;
const PER_PAGE = 20;

let sortState = { key: null, dir: 1 };
let currentPhoto = "";
let isAdmin = false;
let adminEmail = "";
let detailCurrentId = null;

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

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function show(id) { document.getElementById(id).hidden = false; }
function hide(id) { document.getElementById(id).hidden = true; }

const findAsset = (id) => assets.find((x) => String(x.id) === String(id));

// ===== Supabase: 데이터 로드 =====
async function sbLoadOverlay() {
  if (!sb) return;
  const { data, error } = await sb.from("assets").select("id, kind, data, updated_at");
  if (error) { console.error("오버레이 로드 오류:", error.message); return; }
  overlay = data || [];
}

async function sbLoadRequests() {
  if (!sb) return;
  const { data, error } = await sb
    .from("requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) { console.error("요청 로드 오류:", error.message); return; }
  requests = data || [];
}

// 베이스 + 오버레이 병합
function buildAssets() {
  const addedRows = overlay.filter((o) => o.kind === "added");
  const overrideMap = {};
  overlay.filter((o) => o.kind === "override").forEach((o) => (overrideMap[String(o.id)] = o.data));
  const deletedSet = new Set(overlay.filter((o) => o.kind === "deleted").map((o) => String(o.id)));

  const base = baseAssets
    .filter((a) => !deletedSet.has(String(a.id)))
    .map((a) => {
      const ov = overrideMap[String(a.id)];
      return ov ? { ...a, ...ov, _edited: true } : a;
    });
  const added = addedRows.map((o) => ({ ...o.data, id: o.id, _added: true }));
  assets = [...added, ...base];
}

// 대기중인 요청 대상 id 집합 (목록에 "요청중" 표시용)
function pendingTargetSet() {
  return new Set(requests.filter((r) => r.target_id).map((r) => String(r.target_id)));
}

// ===== 초기 로드 =====
async function loadData() {
  try {
    const res = await fetch("assets.json");
    baseAssets = await res.json();
  } catch {
    baseAssets = [];
    document.getElementById("assetTbody").innerHTML =
      `<tr><td colspan="9" style="padding:40px;text-align:center;color:#c2410c;">엑셀 데이터를 불러오지 못했습니다.</td></tr>`;
  }
  await initAuth();
  await sbLoadOverlay();
  await sbLoadRequests();
  buildAssets();
  filtered = assets;
  initFilters();
  renderStats();
  updateAdminUI();
  render();
  sbSubscribe();
}

function refresh() {
  buildAssets();
  initFilters();
  renderStats();
  updateAdminUI();
  applyFilter();
}

// 실시간 동기화
function sbSubscribe() {
  if (!sb) return;
  sb.channel("realtime-all")
    .on("postgres_changes", { event: "*", schema: "public", table: "assets" }, async () => {
      await sbLoadOverlay();
      refresh();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, async () => {
      await sbLoadRequests();
      refresh();
      if (!document.getElementById("reviewOverlay").hidden) renderReview();
    })
    .subscribe();
}

// ===== 인증 =====
async function initAuth() {
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  setAdmin(data.session);
  sb.auth.onAuthStateChange((_event, session) => {
    setAdmin(session);
    refresh();
  });
}

function setAdmin(session) {
  isAdmin = !!session;
  adminEmail = session?.user?.email || "";
}

async function login() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.hidden = true;
  const btn = document.getElementById("loginSubmit");
  btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if (error) {
    errEl.textContent = "로그인 실패: 이메일 또는 비밀번호를 확인하세요.";
    errEl.hidden = false;
    return;
  }
  hide("loginOverlay");
  await sbLoadRequests();
  refresh();
}

async function logout() {
  await sb.auth.signOut();
  refresh();
}

// 관리자 여부에 따라 UI 갱신
function updateAdminUI() {
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const adminTag = document.getElementById("adminTag");
  const reviewBtn = document.getElementById("reviewBtn");
  const notice = document.getElementById("userNotice");
  const addBtn = document.getElementById("addBtn");

  if (isAdmin) {
    loginBtn.hidden = true;
    logoutBtn.hidden = false;
    adminTag.hidden = false;
    adminTag.textContent = `관리자: ${adminEmail}`;
    reviewBtn.hidden = false;
    document.getElementById("pendingCount").textContent = requests.length;
    notice.hidden = true;
    addBtn.textContent = "+ 자산 등록";
  } else {
    loginBtn.hidden = false;
    logoutBtn.hidden = true;
    adminTag.hidden = true;
    reviewBtn.hidden = true;
    notice.hidden = false;
    addBtn.textContent = "+ 자산 등록 요청";
  }
}

// ===== 통계 =====
function renderStats() {
  const total = assets.length;
  const totalCost = assets.reduce((s, a) => s + (a.acquireCost || 0), 0);
  const addedCount = overlay.filter((o) => o.kind === "added").length;
  const catCount = new Set(assets.map((a) => a.category).filter(Boolean)).size;

  document.getElementById("stats").innerHTML = `
    <div class="stat-card"><div class="num">${total.toLocaleString()}</div><div class="label">전체 자산</div></div>
    <div class="stat-card"><div class="num">${(totalCost / 100000000).toFixed(1)}억</div><div class="label">총 취득금액</div></div>
    <div class="stat-card"><div class="num">${catCount}</div><div class="label">자산 분류</div></div>
    <div class="stat-card"><div class="num">${addedCount}</div><div class="label">직접 등록</div></div>
  `;
}

// ===== 필터 =====
function fillSelect(id, values, allLabel) {
  const sel = document.getElementById(id);
  const prev = sel.value;
  const opts = [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "ko"));
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    opts.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if (opts.includes(prev)) sel.value = prev;
}

function initFilters() {
  fillSelect("categoryFilter", assets.map((a) => a.category), "전체 분류");
  fillSelect("deptFilter", assets.map((a) => a.dept), "전체");
  fillSelect("statusFilter", assets.map((a) => a.status), "전체");
}

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
    const cmp = bothNum ? na - nb : String(va).localeCompare(String(vb), "ko");
    return cmp * dir;
  });
}

function setSort(key) {
  if (sortState.key === key) sortState.dir *= -1;
  else sortState = { key, dir: 1 };
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

  const pending = pendingTargetSet();
  const start = (currentPage - 1) * PER_PAGE;
  const pageItems = filtered.slice(start, start + PER_PAGE);

  tbody.innerHTML = pageItems
    .map((a) => {
      let tag = "";
      if (a._added) tag = `<span class="tag tag-added">직접</span>`;
      else if (a._edited) tag = `<span class="tag tag-edited">수정</span>`;
      if (pending.has(String(a.id))) tag += ` <span class="tag tag-pending">요청중</span>`;
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
        <button class="btn-mini btn-edit" data-id="${esc(a.id)}">${isAdmin ? "수정" : "수정요청"}</button>
        <button class="btn-mini btn-del" data-id="${esc(a.id)}">${isAdmin ? "삭제" : "삭제요청"}</button>
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

// ===== 상세 모달 =====
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
  document.getElementById("detailEditBtn").textContent = isAdmin ? "수정" : "수정 요청";
  document.getElementById("detailDeleteBtn").textContent = isAdmin ? "삭제" : "삭제 요청";
  show("detailOverlay");
}

// ===== 등록/수정 폼 =====
function openForm(id) {
  const form = document.getElementById("assetForm");
  form.reset();
  document.getElementById("formError").hidden = true;
  currentPhoto = "";

  // 요청 정보 입력란은 비관리자에게만 표시
  document.querySelectorAll(".request-only").forEach((el) => (el.style.display = isAdmin ? "none" : ""));

  if (id) {
    const a = findAsset(id);
    if (!a) return;
    document.getElementById("formTitle").textContent = isAdmin ? "자산 수정" : "자산 수정 요청";
    document.getElementById("formSaveBtn").textContent = isAdmin ? "저장" : "수정 요청";
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
    document.getElementById("formTitle").textContent = isAdmin ? "자산 등록" : "자산 등록 요청";
    document.getElementById("formSaveBtn").textContent = isAdmin ? "등록" : "등록 요청";
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

// 폼 저장: 관리자=즉시 반영, 일반=요청 등록
async function saveForm() {
  const id = document.getElementById("f-id").value;
  const get = (k) => document.getElementById("f-" + k).value.trim();

  const assetName = get("assetName");
  const assetNumber = get("assetNumber");
  const location = get("location");
  const manager = get("manager");

  if (!assetName || !assetNumber || !location || !manager) {
    showFormError("필수 항목을 입력해주세요. (자산명, 자산번호, 위치, 담당자)");
    return;
  }

  // 자산번호 중복 검사 (자기 자신 제외)
  const dup = assets.find((a) => a.assetNumber === assetNumber && String(a.id) !== String(id));
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

  const saveBtn = document.getElementById("formSaveBtn");
  saveBtn.disabled = true;
  try {
    if (isAdmin) {
      // 즉시 반영
      if (!id) await applyCreate(fields);
      else await applyUpdate(id, fields);
    } else {
      // 요청 등록
      await submitRequest({
        action: id ? "update" : "create",
        target_id: id || null,
        payload: id ? { ...fields, id } : fields,
        requester: get("requester"),
        note: get("reqnote"),
      });
    }
  } catch (e) {
    console.error(e);
    showFormError("저장에 실패했습니다. 네트워크 연결을 확인하고 다시 시도해주세요.");
    saveBtn.disabled = false;
    return;
  }
  saveBtn.disabled = false;
  hide("formOverlay");

  if (isAdmin) { await sbLoadOverlay(); }
  else { await sbLoadRequests(); alert("요청이 접수되었습니다. 관리자 승인 후 반영됩니다."); }
  refresh();
}

// ===== 삭제 =====
async function handleDelete(id) {
  const a = findAsset(id);
  if (!a) return;

  if (isAdmin) {
    if (!confirm(`정말 이 자산을 삭제하시겠습니까?\n\n${a.assetName}`)) return;
    try {
      await applyDelete(id);
    } catch (e) {
      console.error(e);
      alert("삭제에 실패했습니다. 네트워크 연결을 확인해주세요.");
      return;
    }
    hide("detailOverlay");
    await sbLoadOverlay();
    refresh();
  } else {
    if (!confirm(`이 자산의 삭제를 요청하시겠습니까?\n\n${a.assetName}\n\n관리자 승인 후 삭제됩니다.`)) return;
    const requester = prompt("요청자 이름(선택):", "") ?? "";
    try {
      await submitRequest({
        action: "delete",
        target_id: id,
        payload: { assetName: a.assetName, assetNumber: a.assetNumber },
        requester,
        note: "",
      });
    } catch (e) {
      console.error(e);
      alert("요청 전송에 실패했습니다. 네트워크 연결을 확인해주세요.");
      return;
    }
    hide("detailOverlay");
    await sbLoadRequests();
    alert("삭제 요청이 접수되었습니다. 관리자 승인 후 반영됩니다.");
    refresh();
  }
}

// ===== 오버레이 직접 반영 (관리자) =====
async function applyCreate(fields) {
  const id = "u" + Date.now() + Math.floor(Math.random() * 1000);
  const data = { ...fields, regDate: todayStr() };
  const { error } = await sb.from("assets").upsert({ id, kind: "added", data, updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function applyUpdate(id, fields) {
  if (String(id).startsWith("u")) {
    const existing = overlay.find((o) => String(o.id) === String(id))?.data || {};
    const data = { ...existing, ...fields };
    const { error } = await sb.from("assets").upsert({ id, kind: "added", data, updated_at: new Date().toISOString() });
    if (error) throw error;
  } else {
    const existing = overlay.find((o) => String(o.id) === String(id) && o.kind === "override")?.data || {};
    const data = { ...existing, ...fields };
    const { error } = await sb.from("assets").upsert({ id: String(id), kind: "override", data, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
}

async function applyDelete(id) {
  if (String(id).startsWith("u")) {
    const { error } = await sb.from("assets").delete().eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("assets").upsert({ id: String(id), kind: "deleted", data: {}, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
}

// ===== 변경 요청 (일반 사용자) =====
async function submitRequest(req) {
  if (!sb) throw new Error("Supabase 미연결");
  const { error } = await sb.from("requests").insert({
    action: req.action,
    target_id: req.target_id,
    payload: req.payload,
    requester: req.requester || "",
    note: req.note || "",
    status: "pending",
  });
  if (error) throw error;
}

// ===== 승인 패널 (관리자) =====
function openReview() {
  renderReview();
  show("reviewOverlay");
}

function renderReview() {
  const body = document.getElementById("reviewBody");
  if (requests.length === 0) {
    body.innerHTML = `<div class="empty-msg">대기 중인 요청이 없습니다.</div>`;
    return;
  }
  const actionLabel = { create: "등록 요청", update: "수정 요청", delete: "삭제 요청" };
  const actionCls = { create: "req-create", update: "req-update", delete: "req-delete" };

  body.innerHTML = requests
    .map((r) => {
      const p = r.payload || {};
      let summary = "";
      if (r.action === "delete") {
        summary = `<b>${esc(p.assetName || "")}</b> (${esc(p.assetNumber || "")})`;
      } else {
        summary = `
          <div class="req-fields">
            <span><b>${esc(p.assetName || "")}</b></span>
            <span>자산번호: ${esc(p.assetNumber || "-")}</span>
            <span>위치: ${esc(p.location || "-")}</span>
            <span>담당자: ${esc(p.manager || "-")}</span>
            <span>상태: ${esc(p.status || "-")}</span>
            ${p.dept ? `<span>부서: ${esc(p.dept)}</span>` : ""}
          </div>`;
      }
      const meta = [r.requester && `요청자: ${esc(r.requester)}`, r.note && `사유: ${esc(r.note)}`]
        .filter(Boolean).join(" · ");
      return `
      <div class="req-card">
        <div class="req-top">
          <span class="req-badge ${actionCls[r.action]}">${actionLabel[r.action]}</span>
          ${meta ? `<span class="req-meta">${meta}</span>` : ""}
        </div>
        <div class="req-summary">${summary}</div>
        <div class="req-actions">
          <button class="btn btn-primary btn-sm" data-approve="${r.id}">승인</button>
          <button class="btn btn-danger btn-sm" data-reject="${r.id}">반려</button>
        </div>
      </div>`;
    })
    .join("");
}

async function approveRequest(reqId) {
  const r = requests.find((x) => String(x.id) === String(reqId));
  if (!r) return;
  try {
    if (r.action === "create") await applyCreate(r.payload);
    else if (r.action === "update") await applyUpdate(r.target_id, r.payload);
    else if (r.action === "delete") await applyDelete(r.target_id);
    const { error } = await sb.from("requests").update({ status: "approved" }).eq("id", reqId);
    if (error) throw error;
  } catch (e) {
    console.error(e);
    alert("승인 처리에 실패했습니다.");
    return;
  }
  await sbLoadOverlay();
  await sbLoadRequests();
  refresh();
  renderReview();
}

async function rejectRequest(reqId) {
  try {
    const { error } = await sb.from("requests").update({ status: "rejected" }).eq("id", reqId);
    if (error) throw error;
  } catch (e) {
    console.error(e);
    alert("반려 처리에 실패했습니다.");
    return;
  }
  await sbLoadRequests();
  refresh();
  renderReview();
}

// ===== 엑셀 내보내기 =====
function exportExcel() {
  if (filtered.length === 0) { alert("내보낼 자산이 없습니다."); return; }
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

// ===== 이벤트 바인딩 =====
document.getElementById("searchInput").addEventListener("input", applyFilter);
document.getElementById("categoryFilter").addEventListener("change", applyFilter);
document.getElementById("clearBtn").addEventListener("click", () => {
  document.getElementById("searchInput").value = "";
  applyFilter();
});

document.getElementById("advToggle").addEventListener("click", () => {
  const p = document.getElementById("advPanel");
  p.hidden = !p.hidden;
});
["deptFilter", "statusFilter"].forEach((id) =>
  document.getElementById(id).addEventListener("change", applyFilter));
["minCost", "maxCost"].forEach((id) =>
  document.getElementById(id).addEventListener("input", applyFilter));
document.getElementById("advReset").addEventListener("click", () => {
  ["deptFilter", "statusFilter", "minCost", "maxCost", "categoryFilter"].forEach(
    (id) => (document.getElementById(id).value = ""));
  applyFilter();
});

document.querySelectorAll(".asset-table th.sortable").forEach((th) =>
  th.addEventListener("click", () => setSort(th.dataset.key)));

document.getElementById("exportBtn").addEventListener("click", exportExcel);
document.getElementById("addBtn").addEventListener("click", () => openForm(null));

// 테이블 행 버튼
document.getElementById("assetTbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains("btn-view")) openDetail(id);
  else if (btn.classList.contains("btn-edit")) openForm(id);
  else if (btn.classList.contains("btn-del")) handleDelete(id);
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
document.getElementById("detailDeleteBtn").addEventListener("click", () => handleDelete(detailCurrentId));

// 폼
document.getElementById("f-image").addEventListener("change", (e) => handlePhotoUpload(e.target.files[0]));
document.getElementById("removePhotoBtn").addEventListener("click", () => {
  currentPhoto = "";
  document.getElementById("f-image").value = "";
  renderPhotoPreview();
});
document.getElementById("formSaveBtn").addEventListener("click", saveForm);
document.getElementById("assetForm").addEventListener("submit", (e) => { e.preventDefault(); saveForm(); });

// 로그인
document.getElementById("loginBtn").addEventListener("click", () => {
  document.getElementById("loginError").hidden = true;
  show("loginOverlay");
});
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("loginSubmit").addEventListener("click", login);
document.getElementById("loginForm").addEventListener("submit", (e) => { e.preventDefault(); login(); });

// 승인 패널
document.getElementById("reviewBtn").addEventListener("click", openReview);
document.getElementById("reviewBody").addEventListener("click", (e) => {
  const ap = e.target.closest("button[data-approve]");
  const rj = e.target.closest("button[data-reject]");
  if (ap) approveRequest(ap.dataset.approve);
  else if (rj) rejectRequest(rj.dataset.reject);
});

// 모달 닫기
document.querySelectorAll("[data-close]").forEach((btn) =>
  btn.addEventListener("click", () => {
    ["detailOverlay", "formOverlay", "loginOverlay", "reviewOverlay"].forEach(hide);
  }));
document.querySelectorAll(".modal-overlay").forEach((ov) =>
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.hidden = true; }));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") ["detailOverlay", "formOverlay", "loginOverlay", "reviewOverlay"].forEach(hide);
});

// 시작
loadData();
