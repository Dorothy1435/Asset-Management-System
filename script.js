// ===== 자산관리 시스템 =====
// 베이스: assets.json (엑셀 원본, 읽기 전용)
// 공유 오버레이: Supabase assets (kind = added | override | deleted) — 관리자만 쓰기
// 요청: Supabase requests (로그인 사용자가 등록 → 관리자 결재) + 본인 신청 내역
// 이력: Supabase history (스냅샷 기반 되돌리기) — 관리자
// 회원: Supabase Auth + profiles(role) — 로그인은 아이디@inje.ac.kr

const SUPABASE_URL = "https://pmjwwvgcmaywbatryibc.supabase.co";
const SUPABASE_KEY = "sb_publishable_dOgVVneeoU9xeZlRWY7zFg_FdRE_PVp";
const DOMAIN = "inje.ac.kr";
// 회원관리(권한 부여/회원 삭제)까지 가능한 '최고관리자' 이메일 목록.
// 여기에 본인 이메일을 넣으면 SQL 없이도 바로 최고관리자가 됩니다. 예: ["admin@inje.ac.kr"]
// (또는 Supabase에서 profiles.role 을 'superadmin' 으로 지정해도 됩니다.)
const SUPER_ADMINS = ["bbui0284@inje.ac.kr"];
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

let baseAssets = [];
let overlay = [];
let requests = [];     // 대기중 요청 (관리자 결재용)
let myRequests = [];   // 내 신청 내역 (로그인 사용자)
let history = [];
let members = [];
let assets = [];
let filtered = [];
let currentPage = 1;
const PER_PAGE = 20;

let sortState = { key: null, dir: 1 };
let currentPhoto = "";
let currentLabelFile = "";
let currentLabelFileName = "";
let currentUser = null;
let myProfile = null;
let isAdmin = false;
let isSuperAdmin = false;
let detailCurrentId = null;
let delReqId = null;
let delReqEditId = null;   // 본인 삭제요청 수정 중인 request id
let editingRequestId = null; // 본인 등록/수정요청 수정 중인 request id
let authMode = "login";
let authInited = false;

// ===== 유틸 =====
const won = (n) => (n ? Number(n).toLocaleString("ko-KR") + "원" : "-");
const val = (v) => (v !== undefined && v !== null && String(v).trim() ? v : "-");

function esc(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtTime(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return iso; }
}
function show(id) { document.getElementById(id).hidden = false; }
function hide(id) { document.getElementById(id).hidden = true; }
const findAsset = (id) => assets.find((x) => String(x.id) === String(id));

// ===== 스냅샷 =====
const SNAP_FIELDS = ["assetName", "assetNumber", "labelSticker", "labelFile", "labelFileName", "status", "location", "manager", "dept", "model", "spec", "maker", "acquireCost", "note", "imageUrl", "regDate"];
const DATA_FIELDS = ["assetName", "assetNumber", "labelSticker", "labelFile", "labelFileName", "status", "location", "manager", "dept", "model", "spec", "maker", "acquireCost", "note", "imageUrl"];
function snapshotOf(a) {
  if (!a) return null;
  const o = {};
  SNAP_FIELDS.forEach((k) => (o[k] = a[k] ?? ""));
  return o;
}
function cleanFields(f) {
  const o = {};
  DATA_FIELDS.forEach((k) => { if (f[k] !== undefined) o[k] = f[k]; });
  return o;
}

// ===== 데이터 로드 =====
async function sbLoadOverlay() {
  if (!sb) return;
  const { data, error } = await sb.from("assets").select("id, kind, data, updated_at");
  if (error) { console.error("오버레이 로드 오류:", error.message); return; }
  overlay = data || [];
}
async function sbLoadRequests() {
  if (!sb || !isAdmin) { requests = []; return; }
  const { data, error } = await sb.from("requests").select("*").eq("status", "pending").order("created_at", { ascending: true });
  if (error) { console.error("요청 로드 오류:", error.message); return; }
  requests = data || [];
}
async function sbLoadMyRequests() {
  if (!sb || !currentUser) { myRequests = []; return; }
  const { data, error } = await sb.from("requests").select("*").eq("user_id", currentUser.id).order("created_at", { ascending: false });
  if (error) { console.error("내 요청 로드 오류:", error.message); return; }
  myRequests = data || [];
}
async function sbLoadHistory() {
  if (!sb || !isAdmin) { history = []; return; }
  const { data, error } = await sb.from("history").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) { console.error("이력 로드 오류:", error.message); return; }
  history = data || [];
}
async function sbLoadMembers() {
  if (!sb || !isAdmin) { members = []; return; }
  const { data, error } = await sb.from("profiles").select("*").order("created_at", { ascending: true });
  if (error) { console.error("회원 로드 오류:", error.message); return; }
  members = data || [];
}

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
function pendingTargetSet() {
  return new Set(requests.filter((r) => r.target_id).map((r) => String(r.target_id)));
}

async function reloadAll() {
  await sbLoadOverlay();
  await sbLoadMyRequests();
  await sbLoadRequests();
  await sbLoadHistory();
  buildAssets();
}
function rerender() {
  initFilters();
  renderStats();
  updateUI();
  applyFilter();
}

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
  await reloadAll();
  rerender();
  sbSubscribe();
  authInited = true;
}

function sbSubscribe() {
  if (!sb) return;
  sb.channel("realtime-all")
    .on("postgres_changes", { event: "*", schema: "public", table: "assets" }, async () => {
      await sbLoadOverlay(); buildAssets(); rerender();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, async () => {
      await sbLoadMyRequests(); await sbLoadRequests(); rerender();
      if (!document.getElementById("reviewOverlay").hidden) renderReview();
      if (!document.getElementById("myReqOverlay").hidden) renderMyRequests();
    })
    .subscribe();
}

// ===== 인증 =====
async function initAuth() {
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  await applySession(data.session);
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") show("pwOverlay");
    await applySession(session);
    if (!authInited) return;
    await reloadAll();
    rerender();
  });
}
async function applySession(session) {
  currentUser = session?.user || null;
  if (currentUser) {
    const { data } = await sb.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
    myProfile = data || null;
    const email = (currentUser.email || "").toLowerCase();
    isSuperAdmin = myProfile?.role === "superadmin" || SUPER_ADMINS.map((e) => e.toLowerCase()).includes(email);
    isAdmin = isSuperAdmin || myProfile?.role === "admin";
  } else {
    myProfile = null;
    isAdmin = false;
    isSuperAdmin = false;
  }
}

function idToEmail(input, forceDomain) {
  let v = (input || "").trim();
  if (forceDomain) v = v.split("@")[0].trim();
  return v.includes("@") ? v : `${v}@${DOMAIN}`;
}


function openAuth(mode) {
  authMode = mode;
  document.getElementById("authError").hidden = true;
  document.getElementById("authInfo").hidden = true;
  document.getElementById("authId").value = "";
  document.getElementById("authPw").value = "";
  document.getElementById("authName").value = "";
  document.getElementById("authAffil").value = "";
  applyAuthMode();
  show("authOverlay");
}
function applyAuthMode() {
  const isSignup = authMode === "signup";
  document.getElementById("authTitle").textContent = isSignup ? "회원가입" : "로그인";
  document.getElementById("authSubmit").textContent = isSignup ? "가입하기" : "로그인";
  document.getElementById("authSwitch").textContent = isSignup ? "← 로그인으로" : "회원가입으로 →";
  document.getElementById("forgotBtn").style.display = isSignup ? "none" : "";
  document.getElementById("authPw").setAttribute("autocomplete", isSignup ? "new-password" : "current-password");
  document.querySelectorAll(".signup-only").forEach((el) => (el.style.display = isSignup ? "" : "none"));
}

async function authSubmit() {
  const idVal = document.getElementById("authId").value.trim();
  const pw = document.getElementById("authPw").value;
  const errEl = document.getElementById("authError");
  const infoEl = document.getElementById("authInfo");
  errEl.hidden = true; infoEl.hidden = true;
  if (!idVal || !pw) { errEl.textContent = "아이디와 비밀번호를 입력하세요."; errEl.hidden = false; return; }

  const btn = document.getElementById("authSubmit");
  btn.disabled = true;
  try {
    if (authMode === "signup") {
      const email = idToEmail(idVal, true);
      const name = document.getElementById("authName").value.trim();
      const affiliation = document.getElementById("authAffil").value.trim();
      const username = email.split("@")[0];
      const { data, error } = await sb.auth.signUp({
        email, password: pw,
        options: { data: { name, affiliation, username } },
      });
      if (error) { errEl.textContent = "가입 실패: " + error.message; errEl.hidden = false; return; }
      if (data.session) {
        hide("authOverlay");
        alert("가입이 완료되었습니다. 환영합니다!");
      } else {
        // 자동 승인(이메일 인증 OFF)이면 세션이 바로 생기지만,
        // 혹시 세션이 없으면 곧바로 로그인 시도
        const { error: e2 } = await sb.auth.signInWithPassword({ email, password: pw });
        if (e2) {
          infoEl.textContent = "가입은 되었습니다. 로그인 화면에서 로그인해 주세요.";
          infoEl.hidden = false;
        } else {
          hide("authOverlay");
          alert("가입이 완료되었습니다. 환영합니다!");
        }
      }
    } else {
      const email = idToEmail(idVal, false);
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) { errEl.textContent = "로그인 실패: 아이디 또는 비밀번호를 확인하세요."; errEl.hidden = false; return; }
      hide("authOverlay");
    }
  } finally {
    btn.disabled = false;
  }
}

async function logout() {
  await sb.auth.signOut();
}

async function forgotPassword() {
  const idVal = document.getElementById("authId").value.trim();
  const errEl = document.getElementById("authError");
  const infoEl = document.getElementById("authInfo");
  errEl.hidden = true; infoEl.hidden = true;
  if (!idVal) { errEl.textContent = "아이디를 먼저 입력하세요."; errEl.hidden = false; return; }
  const email = idToEmail(idVal, false);
  await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  infoEl.textContent = "등록된 계정이면 재설정 메일이 발송됩니다. 메일함을 확인해주세요.";
  infoEl.hidden = false;
}

async function updatePassword() {
  const pw = document.getElementById("newPassword").value;
  const errEl = document.getElementById("pwError");
  errEl.hidden = true;
  if (pw.length < 6) { errEl.textContent = "비밀번호는 6자 이상이어야 합니다."; errEl.hidden = false; return; }
  const btn = document.getElementById("pwSubmit");
  btn.disabled = true;
  const { error } = await sb.auth.updateUser({ password: pw });
  btn.disabled = false;
  if (error) { errEl.textContent = "변경 실패: " + error.message; errEl.hidden = false; return; }
  hide("pwOverlay");
  alert("비밀번호가 변경되었습니다.");
}

function requireLogin() {
  if (currentUser) return true;
  alert("요청하려면 로그인이 필요합니다.");
  openAuth("login");
  return false;
}

// ===== 알림 (본인 요청 결재/반려) =====
function notifSeenKey() { return currentUser ? "notif_seen_" + currentUser.id : ""; }
function unseenCount() {
  if (!currentUser) return 0;
  const seen = localStorage.getItem(notifSeenKey()) || "";
  return myRequests.filter((r) => r.status !== "pending" && r.decided_at && r.decided_at > seen).length;
}
function markNotifSeen() {
  if (currentUser) localStorage.setItem(notifSeenKey(), new Date().toISOString());
}

// ===== UI 상태 =====
function updateUI() {
  const g = (id) => document.getElementById(id);
  const loggedIn = !!currentUser;
  g("loginBtn").hidden = loggedIn;
  g("signupBtn").hidden = loggedIn;
  g("logoutBtn").hidden = !loggedIn;
  g("userTag").hidden = !loggedIn;
  g("myReqBtn").hidden = !loggedIn || isAdmin;
  g("reviewBtn").hidden = !isAdmin;
  g("histBtn").hidden = !isAdmin;
  g("membersBtn").hidden = !isSuperAdmin;

  if (loggedIn) {
    const uname = myProfile?.name || myProfile?.username || (currentUser.email || "").split("@")[0];
    g("userTag").textContent = isAdmin ? `관리자: ${uname}` : `${uname} 님`;
  }
  g("pendingCount").textContent = requests.length;

  const n = unseenCount();
  const badge = g("myReqCount");
  badge.textContent = n;
  badge.hidden = n === 0;

  g("addBtn").textContent = isAdmin ? "+ 자산 등록" : "+ 자산 등록 요청";

  const notice = g("userNotice");
  if (isAdmin) notice.hidden = true;
  else if (loggedIn) { notice.hidden = false; notice.innerHTML = "등록·수정·삭제는 <b>요청</b>으로 접수되며, 관리자 승인 후 반영됩니다. '내 신청'에서 처리 결과를 확인하세요."; }
  else { notice.hidden = false; notice.innerHTML = "자산 조회는 누구나 가능합니다. 등록·수정·삭제를 <b>요청</b>하려면 로그인하세요."; }
}

// ===== 통계 =====
function renderStats() {
  const total = assets.length;
  const totalCost = assets.reduce((s, a) => s + (a.acquireCost || 0), 0);
  const addedCount = overlay.filter((o) => o.kind === "added").length;
  const labelCount = assets.filter((a) => a.labelFile).length;
  document.getElementById("stats").innerHTML = `
    <div class="stat-card"><div class="num">${total.toLocaleString()}</div><div class="label">전체 자산</div></div>
    <div class="stat-card"><div class="num">${(totalCost / 100000000).toFixed(1)}억</div><div class="label">총 취득금액</div></div>
    <div class="stat-card"><div class="num">${labelCount}</div><div class="label">라벨 파일</div></div>
    <div class="stat-card"><div class="num">${addedCount}</div><div class="label">직접 등록</div></div>`;
}

// ===== 필터 =====
function fillSelect(id, values, allLabel) {
  const sel = document.getElementById(id);
  const prev = sel.value;
  const opts = [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "ko"));
  sel.innerHTML = `<option value="">${allLabel}</option>` + opts.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if (opts.includes(prev)) sel.value = prev;
}
function initFilters() {
  fillSelect("deptFilter", assets.map((a) => a.dept), "전체");
  fillSelect("statusFilter", assets.map((a) => a.status), "전체");
}
function applyFilter() {
  const kw = document.getElementById("searchInput").value.trim().toLowerCase();
  const dept = document.getElementById("deptFilter").value;
  const status = document.getElementById("statusFilter").value;
  const minCost = Number(document.getElementById("minCost").value) || 0;
  const maxCostRaw = document.getElementById("maxCost").value;
  const maxCost = maxCostRaw === "" ? Infinity : Number(maxCostRaw);
  filtered = assets.filter((a) => {
    if (dept && a.dept !== dept) return false;
    if (status && a.status !== status) return false;
    const cost = a.acquireCost || 0;
    if (cost < minCost || cost > maxCost) return false;
    if (!kw) return true;
    const hay = [a.assetName, a.assetNumber, a.labelSticker, a.location, a.manager, a.dept, a.org, a.maker, a.model, a.spec].join(" ").toLowerCase();
    return hay.includes(kw);
  });
  sortFiltered();
  currentPage = 1;
  render();
}
function sortFiltered() {
  const { key, dir } = sortState;
  if (!key) return;
  filtered.sort((a, b) => {
    let va = a[key] ?? "", vb = b[key] ?? "";
    const na = parseFloat(va), nb = parseFloat(vb);
    const bothNum = va !== "" && vb !== "" && !isNaN(na) && !isNaN(nb) && String(va).trim() === String(na) && String(vb).trim() === String(nb);
    const cmp = bothNum ? na - nb : String(va).localeCompare(String(vb), "ko");
    return cmp * dir;
  });
}
function setSort(key) {
  if (sortState.key === key) sortState.dir *= -1;
  else sortState = { key, dir: 1 };
  document.querySelectorAll(".asset-table th.sortable").forEach((th) => {
    const arrow = th.querySelector(".sort-arrow");
    if (th.dataset.key === key) { arrow.textContent = sortState.dir === 1 ? "▲" : "▼"; th.classList.add("sorted"); }
    else { arrow.textContent = ""; th.classList.remove("sorted"); }
  });
  applyFilter();
}

// ===== 목록 렌더 =====
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
  tbody.innerHTML = pageItems.map((a) => {
    let tag = "";
    if (a._added) tag = `<span class="tag tag-added">직접</span>`;
    else if (a._edited) tag = `<span class="tag tag-edited">수정</span>`;
    if (pending.has(String(a.id))) tag += ` <span class="tag tag-pending">요청중</span>`;
    const thumb = a.imageUrl ? `<img class="thumb" src="${a.imageUrl}" alt="" loading="lazy" />` : "";
    return `
    <tr>
      <td class="cell-name" title="${esc(a.assetName)}"><div class="name-wrap">${thumb}<span>${esc(a.assetName)} ${tag}</span></div></td>
      <td class="cell-num">${esc(a.assetNumber)}</td>
      <td>${a.labelFile ? `<button class="btn-mini btn-label" data-id="${esc(a.id)}" title="${esc(a.labelFileName || "라벨 파일")}">⬇ 라벨</button>` : "-"}</td>
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
  }).join("");
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
  [...new Set(range)].sort((a, b) => a - b).forEach((p, i, arr) => {
    if (i > 0 && p - arr[i - 1] > 1) html += `<span style="padding:0 4px;color:#9ca3af;">…</span>`;
    html += `<button data-page="${p}" class="${p === currentPage ? "active" : ""}">${p}</button>`;
  });
  html += `<button data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>›</button>`;
  nav.innerHTML = html;
}

// ===== 상세 =====
function openDetail(id) {
  const a = findAsset(id);
  if (!a) return;
  detailCurrentId = id;
  const photo = a.imageUrl
    ? `<div class="detail-photo"><img src="${a.imageUrl}" alt="물품 사진" /></div>`
    : `<div class="detail-photo no-photo">등록된 사진 없음</div>`;
  const rows = [
    ["자산명", a.assetName], ["자산번호", a.assetNumber], ["라벨스티커", a.labelSticker],
    ["라벨 파일", a.labelFile ? (a.labelFileName || "첨부됨") : ""],
    ["모델명", a.model], ["규격", a.spec], ["제작회사", a.maker],
    ["단가", a.unitPrice ? won(a.unitPrice) : ""], ["수량", a.qty],
    ["취득금액", a.acquireCost ? won(a.acquireCost) : ""], ["취득일자", a.acquireDate],
    ["보관 위치", a.location], ["관리 기관", a.org], ["운영 부서", a.dept],
    ["담당자", a.manager], ["등재일", a.regDate], ["상태", a.status], ["비고", a.note],
  ];
  document.getElementById("detailTitle").textContent = a.assetName || "자산 상세 정보";
  document.getElementById("detailBody").innerHTML = photo +
    `<dl class="detail-grid">` + rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(val(v))}</dd>`).join("") + `</dl>`;
  document.getElementById("detailDownloadBtn").hidden = !a.imageUrl;
  document.getElementById("detailLabelBtn").hidden = !a.labelFile;
  document.getElementById("detailEditBtn").textContent = isAdmin ? "수정" : "수정 요청";
  document.getElementById("detailDeleteBtn").textContent = isAdmin ? "삭제" : "삭제 요청";
  show("detailOverlay");
}
function downloadPhoto() {
  const a = findAsset(detailCurrentId);
  if (!a || !a.imageUrl) return;
  const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const link = document.createElement("a");
  link.href = a.imageUrl;
  link.download = `${safe(a.assetName) || "asset"}_${safe(a.assetNumber)}.jpg`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
function downloadLabelFile(id) {
  const a = findAsset(id != null ? id : detailCurrentId);
  if (!a || !a.labelFile) return;
  const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  let name = a.labelFileName || `${safe(a.assetName) || "asset"}_라벨`;
  if (!/\.[a-z0-9]+$/i.test(name)) {
    const m = /^data:([^;]+)/.exec(a.labelFile);
    const ext = m && m[1] === "application/pdf" ? ".pdf" : m && m[1].startsWith("image/") ? "." + m[1].split("/")[1] : "";
    name += ext;
  }
  const link = document.createElement("a");
  link.href = a.labelFile;
  link.download = safe(name);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// ===== 사진 확대 (라이트박스) =====
function openLightbox(src) {
  if (!src) return;
  document.getElementById("lightboxImg").src = src;
  show("lightbox");
}
function closeLightbox() {
  hide("lightbox");
  document.getElementById("lightboxImg").src = "";
}

// ===== 등록/수정 폼 =====
function openForm(id) {
  if (!requireLogin()) return;
  editingRequestId = null;
  const form = document.getElementById("assetForm");
  form.reset();
  document.getElementById("formError").hidden = true;
  currentPhoto = "";
  currentLabelFile = ""; currentLabelFileName = "";
  document.querySelectorAll(".request-only").forEach((el) => (el.style.display = isAdmin ? "none" : ""));

  if (id) {
    const a = findAsset(id);
    if (!a) return;
    document.getElementById("formTitle").textContent = isAdmin ? "자산 수정" : "자산 수정 요청";
    document.getElementById("formSaveBtn").textContent = isAdmin ? "저장" : "수정 요청";
    fillForm(a);
    document.getElementById("f-id").value = a.id;
    currentPhoto = a.imageUrl || "";
    currentLabelFile = a.labelFile || ""; currentLabelFileName = a.labelFileName || "";
  } else {
    document.getElementById("formTitle").textContent = isAdmin ? "자산 등록" : "자산 등록 요청";
    document.getElementById("formSaveBtn").textContent = isAdmin ? "등록" : "등록 요청";
    document.getElementById("f-id").value = "";
  }
  renderPhotoPreview();
  renderLabelFileInfo();
  show("formOverlay");
}
function fillForm(a) {
  const set = (k, v) => (document.getElementById("f-" + k).value = v ?? "");
  set("assetName", a.assetName); set("assetNumber", a.assetNumber); set("labelSticker", a.labelSticker);
  document.getElementById("f-status").value = a.status || "취득";
  set("location", a.location); set("manager", a.manager); set("dept", a.dept);
  set("model", a.model); set("spec", a.spec); set("maker", a.maker);
  set("acquireCost", a.acquireCost || ""); set("note", a.note);
}
function renderPhotoPreview() {
  const box = document.getElementById("photoPreview");
  const removeBtn = document.getElementById("removePhotoBtn");
  if (currentPhoto) { box.innerHTML = `<img src="${currentPhoto}" alt="미리보기" />`; removeBtn.hidden = false; }
  else { box.innerHTML = `<span class="photo-placeholder">사진 없음</span>`; removeBtn.hidden = true; }
}
function renderLabelFileInfo() {
  const box = document.getElementById("labelFileInfo");
  const removeBtn = document.getElementById("removeLabelFileBtn");
  if (currentLabelFile) {
    box.innerHTML = `<a href="${currentLabelFile}" download="${esc(currentLabelFileName || "라벨파일")}" class="label-file-link">📎 ${esc(currentLabelFileName || "라벨 파일")} (다운로드)</a>`;
    removeBtn.hidden = false;
  } else {
    box.innerHTML = `<span class="photo-placeholder">파일 없음</span>`;
    removeBtn.hidden = true;
  }
}
function handleLabelFileUpload(file) {
  if (!file) return;
  const MAX_BYTES = 3 * 1024 * 1024; // 3MB
  if (file.size > MAX_BYTES) {
    showFormError("라벨 파일은 3MB 이하만 업로드할 수 있습니다.");
    document.getElementById("f-labelFile").value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    currentLabelFile = e.target.result;       // data URL (base64)
    currentLabelFileName = file.name;
    renderLabelFileInfo();
  };
  reader.readAsDataURL(file);
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
      if (width > MAX || height > MAX) { const r = Math.min(MAX / width, MAX / height); width = Math.round(width * r); height = Math.round(height * r); }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
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
  el.textContent = msg; el.hidden = false;
}

async function saveForm() {
  const id = document.getElementById("f-id").value;
  const get = (k) => document.getElementById("f-" + k).value.trim();
  const assetName = get("assetName"), assetNumber = get("assetNumber"), location = get("location"), manager = get("manager");
  if (!assetName || !assetNumber || !location || !manager) {
    showFormError("필수 항목을 입력해주세요. (자산명, 자산번호, 위치, 담당자)");
    return;
  }
  // 자산번호 중복 (편집중인 자산/요청 제외)
  const dup = assets.find((a) => a.assetNumber === assetNumber && String(a.id) !== String(id));
  if (dup && !editingRequestId) { showFormError("이미 등록된 자산번호입니다."); return; }

  const fields = {
    assetName, assetNumber, location, manager,
    labelSticker: get("labelSticker"), labelFile: currentLabelFile || "", labelFileName: currentLabelFile ? currentLabelFileName : "",
    status: get("status") || "취득", dept: get("dept"),
    model: get("model"), spec: get("spec"), maker: get("maker"),
    acquireCost: Number(get("acquireCost")) || 0, note: get("note"), imageUrl: currentPhoto || "",
  };

  const saveBtn = document.getElementById("formSaveBtn");
  saveBtn.disabled = true;
  try {
    if (editingRequestId) {
      // 본인 대기중 요청 수정
      await updateMyRequest(editingRequestId, { payload: fields, requester: get("requester"), note: get("reqnote") });
    } else if (isAdmin) {
      if (!id) await applyCreate(fields);
      else await applyUpdate(id, fields);
    } else {
      await submitRequest({ action: id ? "update" : "create", target_id: id || null, payload: fields, requester: get("requester"), note: get("reqnote") });
    }
  } catch (e) {
    console.error(e);
    showFormError("저장에 실패했습니다. 네트워크 연결을 확인하고 다시 시도해주세요.");
    saveBtn.disabled = false;
    return;
  }
  saveBtn.disabled = false;
  hide("formOverlay");
  const wasReqEdit = !!editingRequestId;
  editingRequestId = null;
  await reloadAll();
  rerender();
  if (wasReqEdit) { renderMyRequests(); }
  else if (!isAdmin) alert("요청이 접수되었습니다. 관리자 승인 후 반영됩니다.");
}

// ===== 삭제 =====
async function handleDelete(id) {
  if (!requireLogin()) return;
  const a = findAsset(id);
  if (!a) return;
  if (isAdmin) {
    if (!confirm(`정말 이 자산을 삭제하시겠습니까?\n\n${a.assetName}`)) return;
    try { await applyDelete(id); }
    catch (e) { console.error(e); alert("삭제에 실패했습니다."); return; }
    hide("detailOverlay");
    await reloadAll(); rerender();
  } else {
    delReqId = id;
    delReqEditId = null;
    document.getElementById("dr-requester").value = "";
    document.getElementById("dr-note").value = "";
    document.getElementById("delReqTarget").innerHTML =
      `<b>${esc(a.assetName)}</b> (${esc(a.assetNumber)})<br><span class="del-note">관리자 승인 후 삭제됩니다.</span>`;
    show("delReqOverlay");
  }
}
async function submitDeleteRequest() {
  const btn = document.getElementById("delReqSubmit");
  const requester = document.getElementById("dr-requester").value.trim();
  const note = document.getElementById("dr-note").value.trim();
  btn.disabled = true;
  try {
    if (delReqEditId) {
      await updateMyRequest(delReqEditId, { requester, note });
    } else {
      const a = findAsset(delReqId);
      if (!a) { hide("delReqOverlay"); btn.disabled = false; return; }
      await submitRequest({ action: "delete", target_id: delReqId, payload: { assetName: a.assetName, assetNumber: a.assetNumber }, requester, note });
    }
  } catch (e) {
    console.error(e); btn.disabled = false;
    alert("요청 전송에 실패했습니다."); return;
  }
  btn.disabled = false;
  hide("delReqOverlay");
  hide("detailOverlay");
  const wasEdit = !!delReqEditId;
  delReqEditId = null;
  await reloadAll(); rerender();
  if (wasEdit) renderMyRequests();
  else alert("삭제 요청이 접수되었습니다. 관리자 승인 후 반영됩니다.");
}

// ===== 이력 =====
async function logHistory(entry) {
  if (!sb) return;
  try {
    await sb.from("history").insert({
      asset_id: String(entry.asset_id), asset_name: entry.asset_name || "", action: entry.action,
      before_snap: entry.before || null, after_snap: entry.after || null,
      requester: entry.requester || "", note: entry.note || "", approved_by: (myProfile?.username || currentUser?.email || ""),
    });
  } catch (e) { console.error("이력 기록 실패:", e); }
}
async function applyCreate(fields, meta = {}) {
  const id = "u" + Date.now() + Math.floor(Math.random() * 1000);
  const data = { ...cleanFields(fields), regDate: todayStr() };
  const { error } = await sb.from("assets").upsert({ id, kind: "added", data, updated_at: new Date().toISOString() });
  if (error) throw error;
  await logHistory({ asset_id: id, asset_name: data.assetName, action: "create", before: null, after: snapshotOf(data), requester: meta.requester, note: meta.note });
}
async function applyUpdate(id, fields, meta = {}) {
  const current = findAsset(id);
  const before = snapshotOf(current);
  const clean = cleanFields(fields);
  if (String(id).startsWith("u")) {
    const existing = overlay.find((o) => String(o.id) === String(id))?.data || {};
    const { error } = await sb.from("assets").upsert({ id, kind: "added", data: { ...existing, ...clean }, updated_at: new Date().toISOString() });
    if (error) throw error;
  } else {
    const existing = overlay.find((o) => String(o.id) === String(id) && o.kind === "override")?.data || {};
    const { error } = await sb.from("assets").upsert({ id: String(id), kind: "override", data: { ...existing, ...clean }, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
  await logHistory({ asset_id: id, asset_name: (current && current.assetName) || clean.assetName, action: "update", before, after: snapshotOf({ ...current, ...clean }), requester: meta.requester, note: meta.note });
}
async function applyDelete(id, meta = {}) {
  const current = findAsset(id);
  const before = snapshotOf(current);
  if (String(id).startsWith("u")) {
    const { error } = await sb.from("assets").delete().eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("assets").upsert({ id: String(id), kind: "deleted", data: {}, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
  await logHistory({ asset_id: id, asset_name: current && current.assetName, action: "delete", before, after: null, requester: meta.requester, note: meta.note });
}
async function applyState(assetId, snap) {
  const isAdded = String(assetId).startsWith("u");
  if (snap === null || snap === undefined) {
    if (isAdded) { const { error } = await sb.from("assets").delete().eq("id", assetId); if (error) throw error; }
    else { const { error } = await sb.from("assets").upsert({ id: String(assetId), kind: "deleted", data: {}, updated_at: new Date().toISOString() }); if (error) throw error; }
  } else {
    const { error } = await sb.from("assets").upsert({ id: String(assetId), kind: isAdded ? "added" : "override", data: cleanFields(snap), updated_at: new Date().toISOString() });
    if (error) throw error;
  }
}
async function revertHistory(histId) {
  const h = history.find((x) => String(x.id) === String(histId));
  if (!h) return;
  if (!confirm(`이 변경을 취소하고 '이전 상태'로 되돌리시겠습니까?\n\n대상: ${h.asset_name || h.asset_id}`)) return;
  const beforeNow = snapshotOf(findAsset(h.asset_id));
  try {
    await applyState(h.asset_id, h.before_snap);
    await logHistory({ asset_id: h.asset_id, asset_name: h.asset_name, action: "revert", before: beforeNow, after: h.before_snap, note: "이전 상태로 되돌림" });
  } catch (e) { console.error(e); alert("되돌리기에 실패했습니다."); return; }
  await reloadAll(); rerender(); renderHistory();
}
async function deleteHistory(histId) {
  if (!confirm("이 기록을 삭제하시겠습니까?\n\n(기록만 지워지며 현재 자산 상태는 바뀌지 않습니다. 삭제 후 이 시점으로 되돌릴 수 없습니다.)")) return;
  try { const { error } = await sb.from("history").delete().eq("id", histId); if (error) throw error; }
  catch (e) { console.error(e); alert("기록 삭제에 실패했습니다."); return; }
  await sbLoadHistory(); renderHistory();
}

// ===== 요청 (사용자) =====
async function submitRequest(req) {
  if (!sb || !currentUser) throw new Error("로그인 필요");
  const { error } = await sb.from("requests").insert({
    action: req.action, target_id: req.target_id, payload: req.payload,
    requester: req.requester || (myProfile?.name || myProfile?.username || ""), note: req.note || "",
    status: "pending", user_id: currentUser.id,
  });
  if (error) throw error;
}
async function updateMyRequest(reqId, patch) {
  const { error } = await sb.from("requests").update(patch).eq("id", reqId);
  if (error) throw error;
}
async function cancelMyRequest(reqId) {
  if (!confirm("이 신청을 취소하시겠습니까?")) return;
  try { const { error } = await sb.from("requests").delete().eq("id", reqId); if (error) throw error; }
  catch (e) { console.error(e); alert("취소에 실패했습니다."); return; }
  await reloadAll(); rerender(); renderMyRequests();
}
async function deleteMyRequest(reqId) {
  if (!confirm("이 신청 내역을 삭제하시겠습니까?")) return;
  try { const { error } = await sb.from("requests").delete().eq("id", reqId); if (error) throw error; }
  catch (e) { console.error(e); alert("삭제에 실패했습니다."); return; }
  await sbLoadMyRequests(); rerender(); renderMyRequests();
}
// 본인 대기중 요청 수정 열기
function editMyRequest(reqId) {
  const r = myRequests.find((x) => String(x.id) === String(reqId));
  if (!r || r.status !== "pending") return;
  if (r.action === "delete") {
    delReqEditId = r.id; delReqId = r.target_id;
    document.getElementById("dr-requester").value = r.requester || "";
    document.getElementById("dr-note").value = r.note || "";
    const p = r.payload || {};
    document.getElementById("delReqTarget").innerHTML = `<b>${esc(p.assetName || "")}</b> (${esc(p.assetNumber || "")})<br><span class="del-note">삭제 요청 내용을 수정합니다.</span>`;
    hide("myReqOverlay");
    show("delReqOverlay");
  } else {
    editingRequestId = r.id;
    const form = document.getElementById("assetForm");
    form.reset();
    document.getElementById("formError").hidden = true;
    currentPhoto = (r.payload && r.payload.imageUrl) || "";
    currentLabelFile = (r.payload && r.payload.labelFile) || "";
    currentLabelFileName = (r.payload && r.payload.labelFileName) || "";
    document.querySelectorAll(".request-only").forEach((el) => (el.style.display = ""));
    document.getElementById("formTitle").textContent = r.action === "create" ? "등록 요청 수정" : "수정 요청 수정";
    document.getElementById("formSaveBtn").textContent = "요청 수정";
    fillForm(r.payload || {});
    document.getElementById("f-id").value = r.target_id || "";
    document.getElementById("f-requester").value = r.requester || "";
    document.getElementById("f-reqnote").value = r.note || "";
    renderPhotoPreview();
    renderLabelFileInfo();
    hide("myReqOverlay");
    show("formOverlay");
  }
}

// ===== 내 신청 내역 패널 =====
function reqStatusBadge(s) {
  if (s === "approved") return `<span class="badge badge-normal">승인됨</span>`;
  if (s === "rejected") return `<span class="badge badge-warn">반려됨</span>`;
  return `<span class="badge badge-gray">대기중</span>`;
}
function openMyRequests() {
  renderMyRequests();
  markNotifSeen();
  updateUI();
  show("myReqOverlay");
}
function renderMyRequests() {
  const body = document.getElementById("myReqBody");
  if (myRequests.length === 0) { body.innerHTML = `<div class="empty-msg">신청 내역이 없습니다.</div>`; return; }
  const actionLabel = { create: "등록 요청", update: "수정 요청", delete: "삭제 요청" };
  const actionCls = { create: "req-create", update: "req-update", delete: "req-delete" };
  body.innerHTML = myRequests.map((r) => {
    const p = r.payload || {};
    const decided = r.status !== "pending";
    const meta = [
      `신청: ${fmtTime(r.created_at)}`,
      decided && r.decided_at && `처리: ${fmtTime(r.decided_at)}`,
      r.note && `사유: ${esc(r.note)}`,
    ].filter(Boolean).join(" · ");
    const actions = !decided
      ? `<button class="btn btn-secondary btn-sm" data-editreq="${r.id}">수정</button>
         <button class="btn btn-danger btn-sm" data-cancelreq="${r.id}">취소</button>`
      : `<button class="btn btn-danger btn-sm" data-delreq="${r.id}">삭제</button>`;
    return `
      <div class="req-card">
        <div class="req-top">
          <span class="req-badge ${actionCls[r.action]}">${actionLabel[r.action]}</span>
          ${reqStatusBadge(r.status)}
          <span class="req-meta">${meta}</span>
        </div>
        <div class="req-summary"><b>${esc(p.assetName || "")}</b>${p.assetNumber ? ` (${esc(p.assetNumber)})` : ""}${p.location ? ` · 위치: ${esc(p.location)}` : ""}</div>
        ${actions ? `<div class="req-actions">${actions}</div>` : ""}
      </div>`;
  }).join("");
}

// ===== 승인 대기 (관리자) =====
function openReview() { renderReview(); show("reviewOverlay"); }
function renderReview() {
  const body = document.getElementById("reviewBody");
  if (requests.length === 0) { body.innerHTML = `<div class="empty-msg">대기 중인 요청이 없습니다.</div>`; return; }
  const actionLabel = { create: "등록 요청", update: "수정 요청", delete: "삭제 요청" };
  const actionCls = { create: "req-create", update: "req-update", delete: "req-delete" };
  body.innerHTML = requests.map((r) => {
    const p = r.payload || {};
    let summary = r.action === "delete"
      ? `<b>${esc(p.assetName || "")}</b> (${esc(p.assetNumber || "")})`
      : `<div class="req-fields">
            <span><b>${esc(p.assetName || "")}</b></span>
            <span>자산번호: ${esc(p.assetNumber || "-")}</span>
            <span>위치: ${esc(p.location || "-")}</span>
            <span>담당자: ${esc(p.manager || "-")}</span>
            <span>상태: ${esc(p.status || "-")}</span>
            ${p.dept ? `<span>부서: ${esc(p.dept)}</span>` : ""}
         </div>`;
    const meta = [`요청일시: ${fmtTime(r.created_at)}`, r.requester && `신청자: ${esc(r.requester)}`, r.note && `사유: ${esc(r.note)}`].filter(Boolean).join(" · ");
    return `
      <div class="req-card">
        <div class="req-top">
          <span class="req-badge ${actionCls[r.action]}">${actionLabel[r.action]}</span>
          ${meta ? `<span class="req-meta">${meta}</span>` : ""}
        </div>
        <div class="req-summary">${summary}</div>
        <div class="req-actions">
          <button class="btn btn-primary btn-sm" data-approve="${r.id}">결재</button>
          <button class="btn btn-danger btn-sm" data-reject="${r.id}">반려</button>
        </div>
      </div>`;
  }).join("");
}
async function approveRequest(reqId) {
  const r = requests.find((x) => String(x.id) === String(reqId));
  if (!r) return;
  const meta = { requester: r.requester, note: r.note };
  try {
    if (r.action === "create") await applyCreate(r.payload, meta);
    else if (r.action === "update") await applyUpdate(r.target_id, r.payload, meta);
    else if (r.action === "delete") await applyDelete(r.target_id, meta);
    const { error } = await sb.from("requests").update({ status: "approved", decided_at: new Date().toISOString() }).eq("id", reqId);
    if (error) throw error;
  } catch (e) { console.error(e); alert("승인 처리에 실패했습니다."); return; }
  await reloadAll(); rerender(); renderReview();
}
async function rejectRequest(reqId) {
  try {
    const { error } = await sb.from("requests").update({ status: "rejected", decided_at: new Date().toISOString() }).eq("id", reqId);
    if (error) throw error;
  } catch (e) { console.error(e); alert("반려 처리에 실패했습니다."); return; }
  await reloadAll(); rerender(); renderReview();
}

// ===== 결재/변경 이력 (관리자) =====
function shortVal(v) { v = v === "" || v === null || v === undefined ? "(없음)" : String(v); return v.length > 28 ? v.slice(0, 28) + "…" : v; }
const HIST_LABELS = { assetName: "자산명", assetNumber: "자산번호", labelSticker: "라벨스티커", labelFile: "라벨 파일", status: "상태", location: "위치", manager: "담당자", dept: "부서", model: "모델", spec: "규격", maker: "제작사", acquireCost: "취득금액", note: "비고", imageUrl: "사진" };
function histSummary(h) {
  if (h.action === "delete") return `자산이 <b>삭제</b>되었습니다.`;
  const b = h.before_snap, a = h.after_snap;
  if (h.action === "create") return `신규 <b>등록</b>: ${esc((a && a.assetName) || "")}`;
  if (!a) return `삭제 처리`;
  if (!b) return esc(a.assetName || "");
  const changes = [];
  Object.keys(HIST_LABELS).forEach((k) => {
    const bv = b[k] ?? "", av = a[k] ?? "";
    if (String(bv) !== String(av)) changes.push((k === "imageUrl" || k === "labelFile") ? `${HIST_LABELS[k]} 변경` : `${HIST_LABELS[k]}: ${esc(shortVal(bv))} → ${esc(shortVal(av))}`);
  });
  return changes.length ? changes.join("<br>") : "변경 없음";
}
async function openHistory() {
  await sbLoadHistory();
  document.getElementById("histSearch").value = "";
  renderHistory();
  show("histOverlay");
}
function renderHistory() {
  const body = document.getElementById("histBody");
  const kw = document.getElementById("histSearch").value.trim().toLowerCase();
  let rows = history;
  if (kw) rows = rows.filter((h) => `${h.asset_name} ${h.asset_id}`.toLowerCase().includes(kw));
  if (rows.length === 0) { body.innerHTML = `<div class="empty-msg">기록이 없습니다.</div>`; return; }
  const actLabel = { create: "등록", update: "수정", delete: "삭제", revert: "되돌림" };
  const actCls = { create: "req-create", update: "req-update", delete: "req-delete", revert: "req-revert" };
  body.innerHTML = rows.map((h) => {
    const meta = [h.approved_by && `결재자: ${esc(h.approved_by)}`, h.requester && `신청자: ${esc(h.requester)}`, h.note && esc(h.note)].filter(Boolean).join(" · ");
    return `
      <div class="req-card">
        <div class="req-top">
          <span class="req-badge ${actCls[h.action] || "badge-gray"}">${actLabel[h.action] || h.action}</span>
          <span class="req-meta">${fmtTime(h.created_at)} · <b>${esc(h.asset_name || h.asset_id)}</b></span>
        </div>
        <div class="req-summary">${histSummary(h)}</div>
        ${meta ? `<div class="req-meta" style="margin-bottom:8px;">${meta}</div>` : ""}
        <div class="req-actions">
          <button class="btn btn-secondary btn-sm" data-revert="${h.id}">이전 상태로 되돌리기</button>
          <button class="btn btn-danger btn-sm" data-delhist="${h.id}">기록 삭제</button>
        </div>
      </div>`;
  }).join("");
}

// ===== 회원 관리 (관리자) =====
async function openMembers() {
  await sbLoadMembers();
  renderMembers();
  show("membersOverlay");
}
function roleBadge(role) {
  if (role === "superadmin") return `<span class="badge badge-normal">최고관리자</span>`;
  if (role === "admin") return `<span class="badge badge-normal">관리자</span>`;
  return `<span class="badge badge-gray">사용자</span>`;
}
function renderMembers() {
  const body = document.getElementById("membersBody");
  if (members.length === 0) { body.innerHTML = `<div class="empty-msg">회원이 없습니다.</div>`; return; }
  const myId = currentUser?.id;
  body.innerHTML = `
    <table class="member-table">
      <thead><tr><th>이름</th><th>소속</th><th>아이디</th><th>이메일</th><th>권한</th><th>가입일</th><th>관리</th></tr></thead>
      <tbody>
        ${members.map((m) => {
          const isSelf = String(m.id) === String(myId);
          const isSuper = m.role === "superadmin";
          let actions;
          if (isSelf) actions = `<span class="member-self">본인</span>`;
          else if (isSuper) actions = `<span class="member-self">최고관리자</span>`;
          else {
            const toggle = m.role === "admin"
              ? `<button class="btn-mini btn-edit" data-role="user" data-id="${esc(m.id)}">사용자로 변경</button>`
              : `<button class="btn-mini btn-view" data-role="admin" data-id="${esc(m.id)}">관리자로 지정</button>`;
            actions = `${toggle} <button class="btn-mini btn-del" data-delmember="${esc(m.id)}">삭제</button>`;
          }
          return `
          <tr>
            <td>${esc(m.name || "-")}</td>
            <td>${esc(m.affiliation || "-")}</td>
            <td>${esc(m.username || "-")}</td>
            <td class="cell-num">${esc(m.email || "-")}</td>
            <td>${roleBadge(m.role)}</td>
            <td>${fmtTime(m.created_at)}</td>
            <td class="cell-actions">${actions}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <p class="member-count">총 ${members.length}명 · 관리자로 지정된 회원은 회원관리를 제외한 모든 관리 기능을 사용할 수 있습니다.</p>`;
}
async function setMemberRole(id, role) {
  const m = members.find((x) => String(x.id) === String(id));
  if (!m) return;
  const label = role === "admin" ? "관리자로 지정" : "사용자로 변경";
  if (!confirm(`${m.username || m.email} 님을 ${label}하시겠습니까?`)) return;
  try {
    const { error } = await sb.from("profiles").update({ role }).eq("id", id);
    if (error) throw error;
  } catch (e) { console.error(e); alert("권한 변경에 실패했습니다."); return; }
  await sbLoadMembers();
  renderMembers();
}
async function deleteMember(id) {
  const m = members.find((x) => String(x.id) === String(id));
  if (!m) return;
  if (!confirm(`${m.username || m.email} 님을 삭제하시겠습니까?\n\n해당 회원의 권한과 프로필이 제거됩니다.`)) return;
  try {
    const { error } = await sb.from("profiles").delete().eq("id", id);
    if (error) throw error;
  } catch (e) { console.error(e); alert("회원 삭제에 실패했습니다."); return; }
  await sbLoadMembers();
  renderMembers();
}

// ===== 엑셀 내보내기 =====
function exportExcel() {
  if (filtered.length === 0) { alert("내보낼 자산이 없습니다."); return; }
  const rows = filtered.map((a) => ({
    "자산명": a.assetName || "", "자산번호": a.assetNumber || "", "라벨스티커": a.labelSticker || "", "라벨파일": a.labelFile ? (a.labelFileName || "있음") : "",
    "모델명": a.model || "", "규격": a.spec || "", "제작회사": a.maker || "",
    "단가": a.unitPrice || 0, "수량": a.qty || 0, "취득금액": a.acquireCost || 0, "취득일자": a.acquireDate || "",
    "보관 위치": a.location || "", "관리 기관": a.org || "", "운영 부서": a.dept || "",
    "담당자": a.manager || "", "등재일": a.regDate || "", "상태": a.status || "", "비고": a.note || "",
    "구분": a._added ? "직접등록" : a._edited ? "수정됨" : "엑셀원본",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "자산목록");
  XLSX.writeFile(wb, `자산목록_${todayStr()}.xlsx`);
}

// ===== 이벤트 =====
document.getElementById("searchInput").addEventListener("input", applyFilter);
document.getElementById("clearBtn").addEventListener("click", () => { document.getElementById("searchInput").value = ""; applyFilter(); });
document.getElementById("advToggle").addEventListener("click", () => { const p = document.getElementById("advPanel"); p.hidden = !p.hidden; });
["deptFilter", "statusFilter"].forEach((id) => document.getElementById(id).addEventListener("change", applyFilter));
["minCost", "maxCost"].forEach((id) => document.getElementById(id).addEventListener("input", applyFilter));
document.getElementById("advReset").addEventListener("click", () => {
  ["deptFilter", "statusFilter", "minCost", "maxCost"].forEach((id) => (document.getElementById(id).value = ""));
  applyFilter();
});
document.querySelectorAll(".asset-table th.sortable").forEach((th) => th.addEventListener("click", () => setSort(th.dataset.key)));
document.getElementById("exportBtn").addEventListener("click", exportExcel);
document.getElementById("addBtn").addEventListener("click", () => openForm(null));

document.getElementById("assetTbody").addEventListener("click", (e) => {
  const thumb = e.target.closest("img.thumb");
  if (thumb) { openLightbox(thumb.src); return; }
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains("btn-label")) downloadLabelFile(id);
  else if (btn.classList.contains("btn-view")) openDetail(id);
  else if (btn.classList.contains("btn-edit")) openForm(id);
  else if (btn.classList.contains("btn-del")) handleDelete(id);
});
document.getElementById("pagination").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-page]");
  if (!btn || btn.disabled) return;
  currentPage = Number(btn.dataset.page);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.getElementById("detailEditBtn").addEventListener("click", () => { hide("detailOverlay"); openForm(detailCurrentId); });
document.getElementById("detailDeleteBtn").addEventListener("click", () => handleDelete(detailCurrentId));
document.getElementById("detailDownloadBtn").addEventListener("click", downloadPhoto);
document.getElementById("detailLabelBtn").addEventListener("click", () => downloadLabelFile(detailCurrentId));
document.getElementById("detailBody").addEventListener("click", (e) => {
  const img = e.target.closest(".detail-photo img");
  if (img) openLightbox(img.src);
});
document.getElementById("lightbox").addEventListener("click", closeLightbox);

document.getElementById("f-image").addEventListener("change", (e) => handlePhotoUpload(e.target.files[0]));
document.getElementById("removePhotoBtn").addEventListener("click", () => { currentPhoto = ""; document.getElementById("f-image").value = ""; renderPhotoPreview(); });
document.getElementById("f-labelFile").addEventListener("change", (e) => handleLabelFileUpload(e.target.files[0]));
document.getElementById("removeLabelFileBtn").addEventListener("click", () => { currentLabelFile = ""; currentLabelFileName = ""; document.getElementById("f-labelFile").value = ""; renderLabelFileInfo(); });
document.getElementById("formSaveBtn").addEventListener("click", saveForm);
document.getElementById("assetForm").addEventListener("submit", (e) => { e.preventDefault(); saveForm(); });

document.getElementById("delReqSubmit").addEventListener("click", submitDeleteRequest);
document.getElementById("delReqForm").addEventListener("submit", (e) => { e.preventDefault(); submitDeleteRequest(); });

// 인증
document.getElementById("loginBtn").addEventListener("click", () => openAuth("login"));
document.getElementById("signupBtn").addEventListener("click", () => openAuth("signup"));
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("authSubmit").addEventListener("click", authSubmit);
document.getElementById("authForm").addEventListener("submit", (e) => { e.preventDefault(); authSubmit(); });
document.getElementById("authSwitch").addEventListener("click", () => { authMode = authMode === "login" ? "signup" : "login"; document.getElementById("authError").hidden = true; document.getElementById("authInfo").hidden = true; applyAuthMode(); });
document.getElementById("forgotBtn").addEventListener("click", forgotPassword);
document.getElementById("pwSubmit").addEventListener("click", updatePassword);
document.getElementById("pwForm").addEventListener("submit", (e) => { e.preventDefault(); updatePassword(); });

// 내 신청
document.getElementById("myReqBtn").addEventListener("click", openMyRequests);
document.getElementById("myReqBody").addEventListener("click", (e) => {
  const ed = e.target.closest("button[data-editreq]");
  const cancel = e.target.closest("button[data-cancelreq]");
  const del = e.target.closest("button[data-delreq]");
  if (ed) editMyRequest(ed.dataset.editreq);
  else if (cancel) cancelMyRequest(cancel.dataset.cancelreq);
  else if (del) deleteMyRequest(del.dataset.delreq);
});

// 승인 대기
document.getElementById("reviewBtn").addEventListener("click", openReview);
document.getElementById("reviewBody").addEventListener("click", (e) => {
  const ap = e.target.closest("button[data-approve]");
  const rj = e.target.closest("button[data-reject]");
  if (ap) approveRequest(ap.dataset.approve);
  else if (rj) rejectRequest(rj.dataset.reject);
});

// 이력
document.getElementById("histBtn").addEventListener("click", openHistory);
document.getElementById("histSearch").addEventListener("input", renderHistory);
document.getElementById("histBody").addEventListener("click", (e) => {
  const rv = e.target.closest("button[data-revert]");
  const dl = e.target.closest("button[data-delhist]");
  if (rv) revertHistory(rv.dataset.revert);
  else if (dl) deleteHistory(dl.dataset.delhist);
});

// 회원 관리
document.getElementById("membersBtn").addEventListener("click", openMembers);
document.getElementById("membersBody").addEventListener("click", (e) => {
  const roleBtn = e.target.closest("button[data-role]");
  const delBtn = e.target.closest("button[data-delmember]");
  if (roleBtn) setMemberRole(roleBtn.dataset.id, roleBtn.dataset.role);
  else if (delBtn) deleteMember(delBtn.dataset.delmember);
});

// 모달 닫기
const ALL_MODALS = ["detailOverlay", "formOverlay", "delReqOverlay", "authOverlay", "myReqOverlay", "reviewOverlay", "histOverlay", "membersOverlay"];
document.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => ALL_MODALS.forEach(hide)));
document.querySelectorAll(".modal-overlay").forEach((ov) => ov.addEventListener("click", (e) => { if (e.target === ov) ov.hidden = true; }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeLightbox(); ALL_MODALS.forEach(hide); } });

// 시작
loadData();
