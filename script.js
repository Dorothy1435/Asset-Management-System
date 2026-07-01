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
let inspFilter = false; // 선택 회차 미검수만 보기 (2025년도 자산 전용)
let inspRound = "1회차"; // 대시보드/필터 기준 검수 회차
const PER_PAGE = 20;

// ===== 메뉴(자산 그룹) / 페이지 라우팅 =====
const GROUP_2024 = "2025년도 자산";
const GROUP_ELEC = "전자";
const GROUPS = [GROUP_2024, GROUP_ELEC];
// assetGroup 값이 없거나 옛 이름('2024년도 자산')인 기존 자산은 모두 기본 자산 메뉴로 간주
const groupOf = (a) => {
  const g = a.assetGroup;
  if (!g || g === "2024년도 자산") return GROUP_2024;
  return g;
};
let currentGroup = GROUP_2024;
let currentPageName = "assets"; // "assets" | "board"
// 라우트별 자산 그룹 매핑 (옛 해시 '2024'도 호환)
const ROUTES = { "2025": GROUP_2024, "2024": GROUP_2024, "elec": GROUP_ELEC };
const GROUP_TO_ROUTE = { [GROUP_2024]: "2025", [GROUP_ELEC]: "elec" };
// 운영 부서 표준 목록 (폼/필터 공통)
const DEPTS = ["기획사무국", "지역혁신국", "교육혁신국", "산업혁신국", "현장캠퍼스"];

let sortState = { key: null, dir: 1 };
let currentPhotos = [];   // 물품 사진 여러 장 (base64 배열). imageUrl은 첫 장, imageUrls는 전체.
let currentLabelFile = "";
let currentLabelFileName = "";
let currentLabelPreview = "";  // PDF 라벨의 1페이지 미리보기 이미지(base64)

// ===== 무거운 라이브러리는 필요할 때만 로드 (첫 화면 속도 개선) =====
const _scriptCache = {};
function loadScript(url) {
  if (_scriptCache[url]) return _scriptCache[url];
  _scriptCache[url] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url; s.async = true;
    s.onload = resolve;
    s.onerror = () => { delete _scriptCache[url]; reject(new Error("스크립트 로드 실패: " + url)); };
    document.head.appendChild(s);
  });
  return _scriptCache[url];
}
async function ensureXlsx() {
  if (!window.XLSX) await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
}
async function ensurePdfjs() {
  if (!window.pdfjsLib) {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
    if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
}
async function ensureTesseract() {
  if (!window.Tesseract) await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js");
}
async function ensureJsQR() {
  if (!window.jsQR) await loadScript("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js");
}
let currentUser = null;
let myProfile = null;
let isAdmin = false;
let isSuperAdmin = false;
let isApproved = false;
let detailCurrentId = null;
let inspectTargetId = null;
let posts = [];          // 게시판 글
let postComments = [];   // 현재 보고 있는 글의 댓글
let currentPostId = null;
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
function fmtDate(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  } catch { return iso; }
}
// 가장 최근 검수 기록 (없으면 null)
function lastInspection(a) {
  const l = Array.isArray(a.inspections) ? a.inspections : [];
  return l.length ? l[l.length - 1] : null;
}
// 특정 회차 검수 여부
function inspectedRound(a, round) {
  const l = Array.isArray(a.inspections) ? a.inspections : [];
  return l.some((ins) => ins.period === round);
}
function show(id) { document.getElementById(id).hidden = false; }
function hide(id) { document.getElementById(id).hidden = true; }
const findAsset = (id) => assets.find((x) => String(x.id) === String(id));
const isImageData = (f) => /^data:image\//i.test(f || "");
// 목록 '라벨' 칸: 무거운 미리보기 이미지를 목록에서 바로 불러오면 느려지므로,
// 가벼운 '라벨' 버튼만 보여주고 클릭할 때 이미지를 확대로 불러온다.
function labelCell(a) {
  if (!a.labelFile) return "-";
  const viewable = isImageData(a.labelFile) || a.labelPreview;
  if (viewable) return `<button class="btn-mini btn-label-view" data-id="${esc(a.id)}" title="클릭하면 라벨 보기">🏷 라벨</button>`;
  return `<button class="btn-mini btn-label" data-id="${esc(a.id)}" title="${esc(a.labelFileName || "라벨 파일")}">⬇ 라벨</button>`;
}
// PDF 데이터 URL의 1페이지를 캔버스에 렌더링해 JPEG 미리보기(base64)로 반환
async function renderPdfFirstPage(dataUrl) {
  await ensurePdfjs();
  if (!window.pdfjsLib) throw new Error("PDF 라이브러리 미로드");
  const base64 = (dataUrl.split(",")[1]) || "";
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  // cMap(한글 등 CJK)·표준폰트 데이터를 지정해야 글자가 렌더링됨 (없으면 글자가 통째로 안 보임)
  const pdf = await window.pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/",
  }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const MAX = 1280;
  const scale = Math.min(MAX / base.width, MAX / base.height, 2);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.85);
}

// ===== 스냅샷 =====
const SNAP_FIELDS = ["assetName", "assetNumber", "labelSticker", "labelFile", "labelFileName", "labelPreview", "status", "location", "manager", "dept", "model", "spec", "maker", "acquireCost", "note", "imageUrl", "imageUrls", "regDate", "assetGroup", "rentDate", "returnDate"];
const DATA_FIELDS = ["assetName", "assetNumber", "labelSticker", "labelFile", "labelFileName", "labelPreview", "status", "location", "manager", "dept", "model", "spec", "maker", "acquireCost", "note", "imageUrl", "imageUrls", "assetGroup", "rentDate", "returnDate"];
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
  // 쿼리를 동시에 실행 (순차 실행보다 훨씬 빠름). 회원 목록은 가입 승인 배지용으로 관리자만 로드.
  await Promise.all([sbLoadOverlay(), sbLoadMyRequests(), sbLoadRequests(), sbLoadHistory(), sbLoadMembers()]);
  buildAssets();
}
function rerender() {
  renderNav();
  if (currentPageName === "assets") {
    initFilters();
    renderStats();
    updateUI();
    applyFilter();
  } else {
    updateUI();
  }
}

// ===== 페이지 라우팅 (해시 기반) =====
function parseHash() {
  const h = (location.hash || "").replace(/^#\/?/, "").trim();
  if (h === "board") return { page: "board" };
  if (ROUTES[h]) return { page: "assets", group: ROUTES[h] };
  return { page: "assets", group: GROUP_2024 };
}
function applyHashRoute() {
  const r = parseHash();
  currentPageName = r.page;
  if (r.page === "assets") {
    currentGroup = r.group;
    // 그룹이 바뀌면 검색/필터/페이지 초기화
    const si = document.getElementById("searchInput");
    if (si) si.value = "";
    ["deptFilter", "statusFilter", "minCost", "maxCost"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
    inspFilter = false;
    currentPage = 1;
  }
  showPage(r.page);
  if (authInited) {
    if (r.page === "board") openBoardPage();
    else rerender();
  }
}
function showPage(page) {
  const assetsEl = document.getElementById("page-assets");
  const boardEl = document.getElementById("page-board");
  if (assetsEl) assetsEl.hidden = page !== "assets";
  if (boardEl) boardEl.hidden = page !== "board";
  // 자산 페이지에서만 의미있는 버튼 노출 제어
  const addBtn = document.getElementById("addBtn");
  if (addBtn) addBtn.style.display = page === "assets" ? "" : "none";
  window.scrollTo({ top: 0 });
}
function navTo(route) { location.hash = "#/" + route; }
function renderNav() {
  const counts = {};
  GROUPS.forEach((g) => (counts[g] = 0));
  assets.forEach((a) => { const g = groupOf(a); if (counts[g] !== undefined) counts[g]++; });
  document.querySelectorAll(".main-nav .nav-link").forEach((btn) => {
    const route = btn.dataset.route;
    let active = false;
    if (route === "board") active = currentPageName === "board";
    else active = currentPageName === "assets" && GROUP_TO_ROUTE[currentGroup] === route;
    btn.classList.toggle("active", active);
    const cnt = btn.querySelector(".nav-count");
    if (cnt && ROUTES[route]) cnt.textContent = counts[ROUTES[route]].toLocaleString();
  });
}

async function loadData() {
  // assets.json 다운로드와 로그인 세션 확인을 동시에 진행 (서로 독립적)
  const baseP = fetch("assets.json")
    .then((r) => r.json())
    .then((d) => { baseAssets = d; })
    .catch(() => {
      baseAssets = [];
      document.getElementById("assetTbody").innerHTML =
        `<tr><td colspan="10" style="padding:40px;text-align:center;color:#c2410c;">엑셀 데이터를 불러오지 못했습니다.</td></tr>`;
    });
  await initAuth();
  await baseP;
  await sbLoadOverlay();  // 목록 표시에 꼭 필요한 최소 데이터만 먼저
  buildAssets();
  authInited = true;
  applyHashRoute();      // 목록을 최대한 빨리 렌더
  sbSubscribe();
  window.addEventListener("hashchange", applyHashRoute);
  // 배지·모달용 부가 데이터(내 신청/승인대기/이력/회원)는 백그라운드로 로드 — 목록 표시를 막지 않음
  Promise.all([sbLoadMyRequests(), sbLoadRequests(), sbLoadHistory(), sbLoadMembers()]).then(() => {
    if (currentPageName === "assets") updateUI();
    migrateOverlayMediaOnce(); // 관리자면 기존 base64 이미지를 Storage로 이동(1회)
  });
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
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, async () => {
      if (currentPageName === "board") { await sbLoadPosts(); renderBoard(); }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, async () => {
      if (!document.getElementById("postViewOverlay").hidden && currentPostId) {
        await sbLoadComments(currentPostId);
        const p = posts.find((x) => String(x.id) === String(currentPostId));
        if (p) renderPostView(p);
      }
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
    migrateOverlayMediaOnce();
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
  // 관리자는 항상 승인, 일반 회원은 profiles.status === 'approved' 여야 이용 가능
  isApproved = isAdmin || myProfile?.status === "approved";
  // 로그인 전에는 시작 화면 / 승인 전에는 대기 화면 / 승인 후에는 자산관리 시스템
  document.body.classList.toggle("authed", !!currentUser && isApproved);
  document.body.classList.toggle("pending-approval", !!currentUser && !isApproved);
  if (currentUser && isApproved) ALL_MODALS.forEach(hide); // 로그인 성공 시 열려있던 로그인 모달 등 닫기
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
  resetConsent();
  applyAuthMode();
  show("authOverlay");
}
// 회원가입 동의 체크박스 초기화/동기화
function resetConsent() {
  ["agreeAll", "agreePrivacy", "agreePledge"].forEach((id) => { const el = document.getElementById(id); if (el) el.checked = false; });
}
function consentAllChecked() {
  return document.querySelectorAll("#consentBox .agree-item:checked").length === document.querySelectorAll("#consentBox .agree-item").length;
}
function syncConsentAll() {
  document.getElementById("agreeAll").checked = consentAllChecked();
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
      if (!consentAllChecked()) { errEl.textContent = "회원가입을 위해 필수 동의 항목에 모두 체크해주세요."; errEl.hidden = false; btn.disabled = false; return; }
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
        alert("가입 신청이 접수되었습니다.\n관리자 승인 후 이용하실 수 있습니다.");
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
  g("membersBtn").hidden = !isAdmin; // 가입 승인은 관리자도 가능 (권한변경·삭제는 최고관리자만)
  const mpc = g("memberPendingCount");
  const pendingMembers = members.filter((m) => (m.status || "pending") === "pending").length;
  mpc.textContent = pendingMembers;
  mpc.hidden = pendingMembers === 0;

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
  const inGroup = assets.filter((a) => groupOf(a) === currentGroup);
  const total = inGroup.length;
  const totalCost = inGroup.reduce((s, a) => s + (a.acquireCost || 0), 0);
  const inUse = inGroup.filter((a) => a.status === "사용중" || a.status === "대여중").length;
  const labelCount = inGroup.filter((a) => a.labelFile).length;
  const showInsp = currentGroup !== GROUP_ELEC; // 검수율은 2025년도 자산 전용
  const inspectedCnt = showInsp ? inGroup.filter((a) => inspectedRound(a, inspRound)).length : 0;
  const inspRate = total ? Math.round((inspectedCnt / total) * 100) : 0;
  const roundSel = `<select id="inspRoundSel" class="stat-sel">${Array.from({ length: 8 }, (_, i) => `${i + 1}회차`).map((r) => `<option value="${r}"${r === inspRound ? " selected" : ""}>${r}</option>`).join("")}</select>`;
  const inspCard = showInsp
    ? `<div class="stat-card stat-insp"><div class="num">${inspectedCnt.toLocaleString()}/${total.toLocaleString()} <span class="rate">(${inspRate}%)</span></div><div class="label">${roundSel} 검수 완료</div></div>`
    : "";
  document.getElementById("stats").innerHTML = `
    <div class="stat-card"><div class="num">${total.toLocaleString()}</div><div class="label">${esc(currentGroup)}</div></div>
    <div class="stat-card"><div class="num">${(totalCost / 100000000).toFixed(1)}억</div><div class="label">총 취득금액</div></div>
    <div class="stat-card"><div class="num">${labelCount}</div><div class="label">라벨 파일</div></div>
    <div class="stat-card"><div class="num">${inUse}</div><div class="label">사용/대여 중</div></div>
    ${inspCard}`;
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
  const inGroup = assets.filter((a) => groupOf(a) === currentGroup);
  // 부서 필터: 표준 5개 부서를 먼저 노출하고, 데이터에 있는 기타 값도 함께 제공
  const deptVals = inGroup.map((a) => a.dept).filter(Boolean);
  fillSelect("deptFilter", [...DEPTS, ...deptVals], "전체");
  fillSelect("statusFilter", inGroup.map((a) => a.status), "전체");
}
function applyFilter() {
  const kw = document.getElementById("searchInput").value.trim().toLowerCase();
  const dept = document.getElementById("deptFilter").value;
  const status = document.getElementById("statusFilter").value;
  const minCost = Number(document.getElementById("minCost").value) || 0;
  const maxCostRaw = document.getElementById("maxCost").value;
  const maxCost = maxCostRaw === "" ? Infinity : Number(maxCostRaw);
  const inspActive = inspFilter && currentGroup !== GROUP_ELEC;
  filtered = assets.filter((a) => {
    if (groupOf(a) !== currentGroup) return false;
    if (inspActive && inspectedRound(a, inspRound)) return false;
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
  const showInsp = currentGroup !== GROUP_ELEC; // 검수는 2025년도 자산 전용 (전자 제외)
  const tableEl = document.querySelector(".asset-table");
  if (tableEl) tableEl.classList.toggle("hide-insp", !showInsp);
  const uninspBtn = document.getElementById("uninspBtn");
  if (uninspBtn) {
    uninspBtn.hidden = !showInsp;
    uninspBtn.textContent = `🔍 ${inspRound} 미검수`;
    uninspBtn.classList.toggle("active", showInsp && inspFilter);
  }
  const start = (currentPage - 1) * PER_PAGE;
  const pageItems = filtered.slice(start, start + PER_PAGE);
  tbody.innerHTML = pageItems.map((a) => {
    let tag = "";
    if (a._added) tag = `<span class="tag tag-added">직접</span>`;
    const li = showInsp ? lastInspection(a) : null;
    if (li) tag += ` <span class="tag tag-inspected">검수 ${esc(li.period || "완료")}</span>`;
    if (pending.has(String(a.id))) tag += ` <span class="tag tag-pending">요청중</span>`;
    const inspDate = li ? fmtDate(li.checkedAt) : "—";
    const thumb = a.imageUrl ? `<img class="thumb" src="${a.imageUrl}" alt="" loading="lazy" />` : "";
    return `
    <tr>
      <td class="cell-name" title="${esc(a.assetName)}"><div class="name-wrap">${thumb}<span>${esc(a.assetName)} ${tag}</span></div></td>
      <td class="cell-num">${esc(a.assetNumber)}</td>
      <td>${labelCell(a)}</td>
      <td class="cell-loc" title="${esc(a.location)}">${esc(val(a.location))}</td>
      <td>${esc(val(a.manager))}</td>
      <td>${esc(val(a.dept))}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${esc(val(a.regDate))}</td>
      <td class="col-insp cell-insp">${inspDate}</td>
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
// 상세 화면에서 사용자(이름)를 바로 등록/수정한다.
function renderUserEditor(a) {
  if (!currentUser) return "";
  const btnLabel = isAdmin ? "저장" : "등록 요청";
  return `<div class="user-editor">
    <h3 class="insp-title">사용자 등록</h3>
    <div class="user-editor-row">
      <input type="text" id="detailUserInput" value="${esc(a.manager || "")}" placeholder="사용자 이름" autocomplete="off" />
      <button class="btn btn-primary" id="detailUserSaveBtn">${btnLabel}</button>
    </div>
    ${isAdmin ? "" : `<p class="insp-note">사용자 등록은 관리자 승인 후 반영됩니다.</p>`}
  </div>`;
}
async function saveDetailUser(id) {
  const a = findAsset(id);
  if (!a) return;
  if (!requireLogin()) return;
  const input = document.getElementById("detailUserInput");
  const value = input ? input.value.trim() : "";
  const btn = document.getElementById("detailUserSaveBtn");
  if (btn) btn.disabled = true;
  try {
    if (isAdmin) {
      await applyUpdate(id, { manager: value });
      await reloadAll(); rerender();
      openDetail(id);
    } else {
      await submitRequest({
        action: "update", target_id: id,
        payload: { manager: value, assetName: a.assetName, assetNumber: a.assetNumber },
        requester: myProfile?.name || "", note: "사용자 등록/변경",
      });
      hide("detailOverlay");
      alert("사용자 등록 요청이 접수되었습니다. 관리자 승인 후 반영됩니다.");
    }
  } catch (e) {
    console.error(e);
    if (btn) btn.disabled = false;
    alert("저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
  }
}
function openDetail(id) {
  const a = findAsset(id);
  if (!a) return;
  detailCurrentId = id;
  const pics = photosOf(a);
  const photo = pics.length
    ? `<div class="detail-photos">${pics.map((src, i) => `<div class="detail-photo"><img src="${src}" alt="물품 사진 ${i + 1}" /></div>`).join("")}</div>`
    : `<div class="detail-photo no-photo">등록된 사진 없음</div>`;
  const labelImgSrc = isImageData(a.labelFile) ? a.labelFile : (a.labelPreview || "");
  const labelPhoto = labelImgSrc
    ? `<div class="detail-photo detail-label-photo"><span class="detail-photo-cap">라벨 사진${isImageData(a.labelFile) ? "" : " (PDF 1페이지)"}</span><img src="${labelImgSrc}" alt="라벨 사진" /></div>`
    : "";
  const isElec = groupOf(a) === GROUP_ELEC;
  const rows = [
    ["메뉴", groupOf(a)],
    ["자산명", a.assetName], ["자산번호", a.assetNumber], ["라벨스티커", a.labelSticker],
    ["라벨 파일", a.labelFile ? (a.labelFileName || "첨부됨") : ""],
    ["모델명", a.model], ["규격", a.spec], ["제작회사", a.maker],
    ["단가", a.unitPrice ? won(a.unitPrice) : ""], ["수량", a.qty],
    ["취득금액", a.acquireCost ? won(a.acquireCost) : ""], ["취득일자", a.acquireDate],
    ["보관 위치", a.location], ["관리 기관", a.org], ["운영 부서", a.dept],
    ["사용자", a.manager],
  ];
  if (isElec) rows.push(["대여 일시", a.rentDate], ["반납 일시", a.returnDate]);
  rows.push(["등재일", a.regDate], ["상태", a.status], ["비고", a.note]);
  document.getElementById("detailTitle").textContent = a.assetName || "자산 상세 정보";
  document.getElementById("detailBody").innerHTML = photo + labelPhoto +
    `<dl class="detail-grid">` + rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(val(v))}</dd>`).join("") + `</dl>` +
    renderUserEditor(a) +
    renderInspectionLog(a);
  document.getElementById("detailDownloadBtn").hidden = !a.imageUrl;
  document.getElementById("detailLabelBtn").hidden = !a.labelFile;
  document.getElementById("detailLabelDelBtn").hidden = !(isAdmin && a.labelFile);
  document.getElementById("detailInspectBtn").textContent = isAdmin ? "검수 확인" : "검수 요청";
  document.getElementById("detailEditBtn").textContent = isAdmin ? "수정" : "수정 요청";
  document.getElementById("detailDeleteBtn").textContent = isAdmin ? "삭제" : "삭제 요청";
  show("detailOverlay");
}
// 검수 기록(로그) 렌더
function renderInspectionLog(a) {
  const list = Array.isArray(a.inspections) ? a.inspections : [];
  let html = `<div class="insp-section"><h3 class="insp-title">검수 기록 <span class="insp-count">${list.length}</span></h3>`;
  if (list.length === 0) {
    html += `<div class="insp-empty">아직 검수 기록이 없습니다. ‘검수’ 버튼으로 회차별 검수를 확인하세요.</div>`;
  } else {
    html += `<table class="insp-table"><thead><tr><th>구분</th><th>검수일시</th><th>확인자</th><th>소속</th>${isAdmin ? "<th></th>" : ""}</tr></thead><tbody>`;
    html += list.slice().reverse().map((ins) => `
      <tr>
        <td><span class="insp-ok">✔</span> ${esc(ins.period || "-")}</td>
        <td>${fmtTime(ins.checkedAt)}</td>
        <td>${esc(ins.inspector || "-")}</td>
        <td>${esc(ins.affiliation || "-")}</td>
        ${isAdmin ? `<td><button class="btn-mini btn-del" data-delinsp="${esc(ins.id)}">삭제</button></td>` : ""}
      </tr>`).join("");
    html += `</tbody></table>`;
  }
  return html + `</div>`;
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

// 라벨 파일 삭제 (관리자) — 자산의 labelFile/labelFileName 을 비움
async function deleteLabelFile(id) {
  if (!isAdmin) return;
  const a = findAsset(id != null ? id : detailCurrentId);
  if (!a || !a.labelFile) return;
  if (!confirm(`이 라벨 파일을 삭제하시겠습니까?\n\n${a.assetName}`)) return;
  try {
    await applyUpdate(a.id, { labelFile: "", labelFileName: "", labelPreview: "" }, { note: "라벨 파일 삭제" });
  } catch (e) { console.error(e); alert("라벨 삭제에 실패했습니다."); return; }
  await reloadAll(); rerender(); openDetail(a.id);
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
  currentPhotos = [];
  currentLabelFile = ""; currentLabelFileName = ""; currentLabelPreview = "";
  updateOcrBtn();
  document.querySelectorAll(".request-only").forEach((el) => (el.style.display = isAdmin ? "none" : ""));

  if (id) {
    const a = findAsset(id);
    if (!a) return;
    document.getElementById("formTitle").textContent = isAdmin ? "자산 수정" : "자산 수정 요청";
    document.getElementById("formSaveBtn").textContent = isAdmin ? "저장" : "수정 요청";
    fillForm(a);
    document.getElementById("f-id").value = a.id;
    currentPhotos = photosOf(a);
    currentLabelFile = a.labelFile || ""; currentLabelFileName = a.labelFileName || ""; currentLabelPreview = a.labelPreview || "";
  } else {
    document.getElementById("formTitle").textContent = isAdmin ? "자산 등록" : "자산 등록 요청";
    document.getElementById("formSaveBtn").textContent = isAdmin ? "등록" : "등록 요청";
    document.getElementById("f-id").value = "";
    document.getElementById("f-assetGroup").value = currentGroup;
    setDeptSelect("");
  }
  updateFormForGroup();
  renderPhotoPreview();
  renderLabelFileInfo();
  show("formOverlay");
}
function fillForm(a) {
  const set = (k, v) => (document.getElementById("f-" + k).value = v ?? "");
  set("assetName", a.assetName); set("assetNumber", a.assetNumber); set("labelSticker", a.labelSticker);
  document.getElementById("f-status").value = a.status || "취득";
  set("location", a.location); set("manager", a.manager);
  setDeptSelect(a.dept);
  set("model", a.model); set("spec", a.spec); set("maker", a.maker);
  set("acquireCost", a.acquireCost || ""); set("note", a.note);
  set("rentDate", a.rentDate); set("returnDate", a.returnDate);
  document.getElementById("f-assetGroup").value = groupOf(a);
}

// 선택한 메뉴(구분)에 따라 폼 UI를 전환한다.
const STATUS_OPTS_DEFAULT = ["취득", "사용중", "보관중", "불용", "폐기"];
const STATUS_OPTS_ELEC = ["사용중", "보관중"];
function updateFormForGroup() {
  const isElec = document.getElementById("f-assetGroup").value === GROUP_ELEC;
  // 상태 옵션 (전자는 사용중/보관중만)
  const sel = document.getElementById("f-status");
  const prev = sel.value;
  const opts = isElec ? STATUS_OPTS_ELEC : STATUS_OPTS_DEFAULT;
  sel.innerHTML = opts.map((s) => `<option value="${s}">${s}</option>`).join("");
  sel.value = opts.includes(prev) ? prev : opts[isElec ? 1 : 0]; // 전자 신규 기본값: 보관중
  // 대여/반납 일시 행
  document.getElementById("row-rentDate").hidden = !isElec;
  document.getElementById("row-returnDate").hidden = !isElec;
  // 전자는 필수(*) 표시 제거
  document.querySelectorAll("#assetForm .req").forEach((el) => (el.style.display = isElec ? "none" : ""));
}
// 부서 select 옵션 HTML (표준 5개 + 기존 값 보존)
function deptOptionsHtml(value) {
  const list = [...DEPTS];
  if (value && !list.includes(value)) list.push(value);
  return `<option value="">(선택 안 함)</option>` + list.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");
}
function setDeptSelect(value) {
  const sel = document.getElementById("f-dept");
  sel.innerHTML = deptOptionsHtml(value);
  sel.value = value || "";
}
// 자산의 사진들을 배열로 반환 (신형 imageUrls 우선, 없으면 구형 imageUrl 1장)
function photosOf(a) {
  if (Array.isArray(a.imageUrls) && a.imageUrls.length) return a.imageUrls.filter(Boolean);
  return a.imageUrl ? [a.imageUrl] : [];
}
function renderPhotoPreview() {
  const box = document.getElementById("photoPreview");
  const removeBtn = document.getElementById("removePhotoBtn");
  if (currentPhotos.length) {
    box.innerHTML = currentPhotos.map((src, i) =>
      `<div class="photo-thumb"><img src="${src}" alt="미리보기 ${i + 1}" /><button type="button" class="photo-thumb-del" data-photo-idx="${i}" title="이 사진 제거">✕</button></div>`
    ).join("");
    removeBtn.hidden = false;
  } else {
    box.innerHTML = `<span class="photo-placeholder">사진 없음</span>`;
    removeBtn.hidden = true;
  }
}
function renderLabelFileInfo() {
  const box = document.getElementById("labelFileInfo");
  const removeBtn = document.getElementById("removeLabelFileBtn");
  if (currentLabelFile) {
    const preview = currentLabelPreview ? `<img src="${currentLabelPreview}" alt="라벨 미리보기" class="label-preview-img" /><div class="label-preview-cap">PDF 1페이지 미리보기</div>` : "";
    box.innerHTML = preview + `<a href="${currentLabelFile}" download="${esc(currentLabelFileName || "라벨파일")}" class="label-file-link">📎 ${esc(currentLabelFileName || "라벨 파일")} (다운로드)</a>`;
    removeBtn.hidden = false;
  } else {
    box.innerHTML = `<span class="photo-placeholder">파일 없음</span>`;
    removeBtn.hidden = true;
  }
  updateOcrBtn();
}
// 라벨이 이미지일 때만 OCR 자동채우기 버튼 노출
function updateOcrBtn() {
  const btn = document.getElementById("ocrBtn");
  if (!btn) return;
  btn.hidden = !isImageData(currentLabelFile);
  if (btn.hidden) {
    const st = document.getElementById("ocrStatus"); if (st) st.hidden = true;
    const rb = document.getElementById("ocrResultBtn"); if (rb) rb.hidden = true;
  }
}
function handleLabelFileUpload(file) {
  if (!file) return;
  const MAX_BYTES = 10 * 1024 * 1024; // 원본 10MB까지 허용(이미지는 자동 압축됨)
  if (file.size > MAX_BYTES) {
    showFormError("라벨 파일은 10MB 이하만 업로드할 수 있습니다.");
    document.getElementById("f-labelFile").value = "";
    return;
  }
  if (file.type.startsWith("image/")) {
    // 라벨 이미지는 제품 사진처럼 압축 저장 (base64 용량 초과로 업로드 실패하는 문제 방지)
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1280; // 라벨 글자 가독성을 위해 제품 사진보다 크게
        let { width, height } = img;
        if (width > MAX || height > MAX) { const r = Math.min(MAX / width, MAX / height); width = Math.round(width * r); height = Math.round(height * r); }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        currentLabelFile = canvas.toDataURL("image/jpeg", 0.85);
        currentLabelFileName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
        currentLabelPreview = "";  // 이미지 라벨은 labelFile 자체가 미리보기
        renderLabelFileInfo();
      };
      img.onerror = () => showFormError("이미지를 읽을 수 없습니다. 다른 파일로 시도해주세요.");
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    // PDF 등 이미지가 아닌 파일은 압축이 안 되므로 용량 제한
    const MAX_RAW = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_RAW) {
      showFormError("PDF 등 이미지가 아닌 라벨 파일은 5MB 이하만 가능합니다. (사진으로 올리면 더 큰 파일도 자동 압축됩니다.)");
      document.getElementById("f-labelFile").value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      currentLabelFile = e.target.result;       // data URL (base64) — 원본(다운로드용)
      currentLabelFileName = file.name;
      currentLabelPreview = "";
      renderLabelFileInfo();
      // PDF면 1페이지를 이미지로 렌더링해 미리보기 생성 (실패해도 원본은 저장/다운로드 가능)
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        try {
          currentLabelPreview = await renderPdfFirstPage(currentLabelFile);
          renderLabelFileInfo();
        } catch (err) {
          console.error("PDF 미리보기 생성 실패:", err);
        }
      }
    };
    reader.readAsDataURL(file);
  }
}
// 이미지 1장을 압축해 base64로 변환 (Promise)
function compressImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > max || height > max) { const r = Math.min(max / width, max / height); width = Math.round(width * r); height = Math.round(height * r); }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function handlePhotoUpload(files) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return;
  if (list.some((f) => !f.type.startsWith("image/"))) {
    showFormError("이미지 파일만 업로드할 수 있습니다.");
  }
  const imgs = list.filter((f) => f.type.startsWith("image/"));
  for (const f of imgs) {
    try {
      const data = await compressImage(f, 800, 0.7);
      currentPhotos.push(data);
      renderPhotoPreview();
    } catch { /* 한 장 실패해도 나머지는 계속 */ }
  }
  document.getElementById("f-image").value = "";
}
function showFormError(msg) {
  const el = document.getElementById("formError");
  el.textContent = msg; el.hidden = false;
}

// ===== 라벨 사진 OCR 자동 채우기 (Tesseract.js, 한글+영문) =====
// 인제대 산학협력단 자산 라벨은 항상 같은 표 양식이라, '항목명'의 위치를 찾아
// 그 다음 항목명 직전까지를 값으로 잘라낸다. (2단 표: 비치호실|재원, 구입일|금액 대응)
// field 가 없는 항목(부서명·재원·구입일)은 값 경계를 잡아주는 '구분자' 역할만 한다.
const OCR_FIELDS = [
  { key: "부서명" },
  { key: "품명", field: "assetName" },
  { key: "규격", field: "spec" },
  { key: "모델명", field: "model" },
  { key: "비치호실", field: "location" },
  { key: "재원" },
  { key: "구입일" },
  { key: "금액", field: "acquireCost", numeric: true },
  { key: "자산코드", field: "assetNumber", compact: true },
  { key: "비고", field: "note" },
];
const OCR_FIELD_NAMES = { assetName: "품명", spec: "규격", model: "모델명", location: "위치", assetNumber: "자산코드", acquireCost: "금액", maker: "제작회사", note: "비고" };
function setOcrStatus(msg, kind) {
  const st = document.getElementById("ocrStatus");
  if (!st) return;
  st.hidden = false;
  st.textContent = msg;
  st.className = "ocr-status" + (kind ? " ocr-" + kind : "");
}
// 인식률을 높이기 위해 그레이스케일 + 대비 보정 후 캔버스로 변환
function preprocessOcrImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.width, img.height);
      const s = longest > 2200 ? 2200 / longest : (longest < 1400 ? 1400 / longest : 1);
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const d = ctx.getImageData(0, 0, w, h);
        const p = d.data;
        for (let i = 0; i < p.length; i += 4) {
          let g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
          g = (g - 128) * 1.35 + 128;            // 대비 강화
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          p[i] = p[i + 1] = p[i + 2] = g;
        }
        ctx.putImageData(d, 0, 0);
      } catch { /* 전처리 실패해도 원본 캔버스로 진행 */ }
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
// QR코드를 이미지에서 읽어 문자열 반환 (없으면 null)
async function decodeLabelQR(dataUrl) {
  try { await ensureJsQR(); } catch { return null; }
  if (!window.jsQR) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // 해상도가 너무 낮으면 QR이 안 읽히므로 최소 1600px는 유지
      const longest = Math.max(img.width, img.height);
      const s = longest > 2600 ? 2600 / longest : (longest < 1600 ? 1600 / longest : 1);
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
      let out = null;
      try { const d = ctx.getImageData(0, 0, w, h); const r = window.jsQR(d.data, w, h, { inversionAttempts: "attemptBoth" }); out = r ? r.data : null; } catch {}
      resolve(out);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
// QR 문자열에서 채울 수 있는 값(주로 자산코드) 추출
function fillFromQR(qr) {
  if (!qr) return [];
  const filled = [];
  const code = (String(qr).match(/\d{16,24}/) || [])[0];
  if (code) {
    const el = document.getElementById("f-assetNumber");
    if (el) { el.value = code; filled.push("자산코드"); }
  }
  return filled;
}
let lastOcrText = "";   // 마지막 인식 원문 (진단용 '결과 보기')
let lastQrText = "";
async function runLabelOcr() {
  if (!isImageData(currentLabelFile)) { setOcrStatus("라벨을 이미지(사진)로 올려야 자동 인식할 수 있습니다.", "err"); return; }
  const btn = document.getElementById("ocrBtn");
  btn.disabled = true;
  const filled = [];
  lastOcrText = ""; lastQrText = "";
  let worker = null;
  try {
    // 1) QR코드 먼저 (가장 정확·빠름)
    setOcrStatus("QR코드를 확인하는 중…", "load");
    lastQrText = await decodeLabelQR(currentLabelFile) || "";
    if (lastQrText) filled.push(...fillFromQR(lastQrText));

    // 2) 글자 인식(OCR)으로 나머지 항목 채우기
    await ensureTesseract();
    if (!window.Tesseract) throw new Error("Tesseract 미로드");
    const image = await preprocessOcrImage(currentLabelFile);
    setOcrStatus("라벨 글자를 인식하는 중입니다… 처음 실행은 데이터를 내려받아 30초~1분 걸릴 수 있어요.", "load");
    const logger = (m) => { if (m.status === "recognizing text") setOcrStatus(`라벨 인식 중… ${Math.round((m.progress || 0) * 100)}%`, "load"); };
    if (typeof Tesseract.createWorker === "function") {
      worker = await Tesseract.createWorker("kor+eng", 1, { logger });
      try { await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" }); } catch {}
      const { data } = await worker.recognize(image);
      lastOcrText = data.text || "";
    } else {
      const { data } = await Tesseract.recognize(image, "kor+eng", { logger });
      lastOcrText = data.text || "";
    }
    fillFromOcr(lastOcrText).forEach((f) => { if (!filled.includes(f)) filled.push(f); });
  } catch (e) {
    console.error("자동 인식 오류:", e);
  } finally {
    if (worker) { try { await worker.terminate(); } catch {} }
    btn.disabled = false;
  }
  // 결과 표시 (+ 무엇이 읽혔는지 확인 버튼)
  document.getElementById("ocrResultBtn").hidden = !(lastOcrText || lastQrText);
  if (filled.length) setOcrStatus(`✔ 자동 인식: ${[...new Set(filled)].join(", ")} 채움. 값을 확인·수정하세요.`, "ok");
  else setOcrStatus("자동 인식이 잘 안 됐어요. ‘인식 결과 보기’로 무엇이 읽혔는지 확인해 주세요. (라벨이 크고 반듯하게 나오게 촬영)", "err");
}
// 인식 원문 보기 (진단/확인용)
function showOcrResult() {
  const parts = [];
  if (lastQrText) parts.push("[QR코드 내용]\n" + lastQrText);
  parts.push("[글자 인식(OCR) 결과]\n" + (lastOcrText || "(인식된 글자 없음)"));
  alert(parts.join("\n\n──────────\n\n"));
}
// 인식 텍스트에서 각 '항목명' 위치를 찾아, 다음 항목명 직전까지를 값으로 채운다.
function fillFromOcr(text) {
  const t = (text || "").replace(/\r/g, "");
  // 각 항목명의 첫 등장 위치 (항목명 글자 사이 공백 허용: 부 서 명 → 부\s*서\s*명)
  const marks = [];
  OCR_FIELDS.forEach((f) => {
    const re = new RegExp(f.key.split("").join("\\s*"));
    const m = re.exec(t);
    if (m) marks.push({ f, start: m.index, end: m.index + m[0].length });
  });
  marks.sort((a, b) => a.start - b.start);
  const filled = [];
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    if (!cur.f.field) continue; // 구분자 전용 항목
    const next = marks[i + 1];
    let v = t.slice(cur.end, next ? next.start : t.length);
    v = v.replace(/^[\s:·\-|]+/, "").replace(/\s+/g, " ").trim();
    if (cur.f.numeric) v = v.replace(/[^0-9]/g, "");
    else if (cur.f.compact) v = v.replace(/\s+/g, "");
    if (!v) continue;
    const el = document.getElementById("f-" + cur.f.field);
    if (!el) continue;
    el.value = v;
    filled.push(OCR_FIELD_NAMES[cur.f.field] || cur.f.field);
  }
  return filled;
}

async function saveForm() {
  const id = document.getElementById("f-id").value;
  const get = (k) => document.getElementById("f-" + k).value.trim();
  const assetName = get("assetName"), assetNumber = get("assetNumber"), location = get("location"), manager = get("manager");
  const group = document.getElementById("f-assetGroup").value || GROUP_2024;
  const isElec = group === GROUP_ELEC;
  // 전자 메뉴는 필수 입력 조건 없음 (등록/수정/삭제 자유)
  if (!isElec && (!assetName || !assetNumber || !location)) {
    showFormError("필수 항목을 입력해주세요. (자산명, 자산번호, 위치)");
    return;
  }
  // 자산번호 중복 (값이 있을 때만, 편집중인 자산/요청 제외)
  if (assetNumber && !editingRequestId) {
    const dup = assets.find((a) => a.assetNumber === assetNumber && String(a.id) !== String(id));
    if (dup) { showFormError("이미 등록된 자산번호입니다."); return; }
  }

  const fields = {
    assetName, assetNumber, location, manager,
    labelSticker: get("labelSticker"), labelFile: currentLabelFile || "", labelFileName: currentLabelFile ? currentLabelFileName : "", labelPreview: currentLabelFile ? (currentLabelPreview || "") : "",
    status: get("status") || (isElec ? "보관중" : "취득"), dept: get("dept"),
    model: get("model"), spec: get("spec"), maker: get("maker"),
    acquireCost: Number(get("acquireCost")) || 0, note: get("note"), imageUrl: currentPhotos[0] || "", imageUrls: currentPhotos.slice(),
    assetGroup: group, rentDate: get("rentDate"), returnDate: get("returnDate"),
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
    const detail = e?.message ? ` (${e.message})` : "";
    showFormError("저장에 실패했습니다. 라벨/사진 파일이 너무 크면 실패할 수 있습니다." + detail);
    saveBtn.disabled = false;
    return;
  }
  saveBtn.disabled = false;
  hide("formOverlay");
  const wasReqEdit = !!editingRequestId;
  editingRequestId = null;
  const keepPage = currentPage; // 수정 후에도 보고 있던 페이지 유지 (1페이지로 튀지 않도록)
  await reloadAll();
  rerender();
  // 기존 자산을 수정한 경우, rerender가 초기화한 페이지를 원래대로 되돌린다.
  if (id && currentPageName === "assets") {
    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    currentPage = Math.min(keepPage, totalPages);
    render();
  }
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

// ===== 검수 확인 =====
function openInspect(id) {
  if (!requireLogin()) return;
  const a = findAsset(id);
  if (!a) return;
  inspectTargetId = id;
  document.getElementById("inspectError").hidden = true;
  fillInspPeriod();
  document.getElementById("insp-inspector").value = myProfile?.name || "";
  const affil = myProfile?.affiliation || "";
  const affilSel = document.getElementById("insp-affil");
  affilSel.innerHTML = deptOptionsHtml(affil);
  affilSel.value = affil;
  document.getElementById("insp-checked").checked = true;
  document.getElementById("inspectTarget").innerHTML = `<b>${esc(a.assetName)}</b> (${esc(a.assetNumber)})`;
  document.getElementById("inspectTitle").textContent = isAdmin ? "검수 확인" : "검수 요청";
  document.getElementById("inspectSubmit").textContent = isAdmin ? "검수 확인" : "검수 요청";
  document.getElementById("inspectNote").hidden = isAdmin;
  show("inspectOverlay");
}
// 검수 회차 드롭다운을 채운다. (1~8회차)
function fillInspPeriod() {
  const sel = document.getElementById("insp-period");
  const opts = Array.from({ length: 8 }, (_, i) => `${i + 1}회차`);
  sel.innerHTML = opts.map((o) => `<option value="${o}">${o}</option>`).join("");
}
async function submitInspect() {
  const periodType = "회차";
  const period = document.getElementById("insp-period").value.trim();
  const inspector = document.getElementById("insp-inspector").value.trim();
  const affiliation = document.getElementById("insp-affil").value.trim();
  const checked = document.getElementById("insp-checked").checked;
  const errEl = document.getElementById("inspectError");
  errEl.hidden = true;
  if (!checked) { errEl.textContent = "‘검수 완료를 확인합니다’에 체크해주세요."; errEl.hidden = false; return; }
  if (!period) { errEl.textContent = "검수 회차를 선택해주세요."; errEl.hidden = false; return; }
  if (!inspector) { errEl.textContent = "검수 확인자 이름을 입력해주세요."; errEl.hidden = false; return; }
  const a = findAsset(inspectTargetId);
  if (!a) { hide("inspectOverlay"); return; }
  const reqName = affiliation ? `${inspector} (${affiliation})` : inspector;
  const btn = document.getElementById("inspectSubmit");
  btn.disabled = true;
  try {
    if (isAdmin) {
      await applyInspect(inspectTargetId, { periodType, period, inspector, affiliation });
    } else {
      await submitRequest({
        action: "inspect", target_id: inspectTargetId,
        payload: { periodType, period, inspector, affiliation, assetName: a.assetName, assetNumber: a.assetNumber },
        requester: reqName, note: `${period} 검수 확인`,
      });
    }
  } catch (e) {
    console.error(e); btn.disabled = false;
    errEl.textContent = "처리에 실패했습니다. 잠시 후 다시 시도해주세요."; errEl.hidden = false; return;
  }
  btn.disabled = false;
  hide("inspectOverlay");
  await reloadAll(); rerender();
  if (isAdmin) { openDetail(inspectTargetId); }
  else { hide("detailOverlay"); alert("검수 요청이 접수되었습니다. 관리자 승인 후 기록에 반영됩니다."); }
}
// 검수 목록을 오버레이에 저장(기존 데이터 보존)
async function writeInspections(id, list) {
  const isAdded = String(id).startsWith("u");
  const kind = isAdded ? "added" : "override";
  const existing = overlay.find((o) => String(o.id) === String(id) && o.kind === kind)?.data || {};
  const { error } = await sb.from("assets").upsert({ id: String(id), kind, data: { ...existing, inspections: list }, updated_at: new Date().toISOString() });
  if (error) throw error;
}
async function applyInspect(id, { periodType, period, inspector, affiliation }, meta = {}) {
  const current = findAsset(id);
  if (!current) throw new Error("자산 없음");
  const insp = { id: "i" + Date.now() + Math.floor(Math.random() * 1000), periodType: periodType || "", period: period || "", inspector: inspector || "", affiliation: affiliation || "", checkedAt: new Date().toISOString() };
  const list = Array.isArray(current.inspections) ? [...current.inspections, insp] : [insp];
  await writeInspections(id, list);
  const who = inspector + (affiliation ? ` (${affiliation})` : "");
  await logHistory({ asset_id: id, asset_name: current.assetName, action: "inspect", before: null, after: null, requester: meta.requester || who, note: `검수 확인 · ${period} · 확인자: ${who}` });
}
async function removeInspection(assetId, inspId) {
  const current = findAsset(assetId);
  if (!current) return;
  if (!confirm("이 검수 기록을 삭제하시겠습니까?")) return;
  const target = (current.inspections || []).find((x) => String(x.id) === String(inspId));
  const list = (current.inspections || []).filter((x) => String(x.id) !== String(inspId));
  try {
    await writeInspections(assetId, list);
    await logHistory({ asset_id: assetId, asset_name: current.assetName, action: "inspect", before: null, after: null, note: `검수 기록 삭제 · ${target ? (target.period || "") + " · " + (target.inspector || "") : ""}` });
  } catch (e) { console.error(e); alert("삭제에 실패했습니다."); return; }
  await reloadAll(); rerender(); openDetail(assetId);
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
// ===== 이미지 저장소(Storage) : base64를 파일로 올리고 URL만 DB에 저장 (속도 개선) =====
const MEDIA_BUCKET = "asset-media";
// data:URL(base64)이면 Storage에 업로드하고 공개 URL 반환. 이미 URL이거나 비어있으면 그대로.
async function uploadMedia(dataUrl, folder) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return dataUrl || "";
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) return dataUrl;
  const mime = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.includes("pdf") ? "pdf" : (mime.split("/")[1] || "jpg").split("+")[0];
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, new Blob([bytes], { type: mime }), { contentType: mime, upsert: false });
  if (error) throw error;
  return sb.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}
// 자산 필드의 이미지들을 모두 Storage URL로 치환. 업로드 실패 시 원본(base64) 유지.
async function withUploadedMedia(fields) {
  try {
    const out = { ...fields };
    if (out.imageUrl) out.imageUrl = await uploadMedia(out.imageUrl, "photos");
    if (Array.isArray(out.imageUrls)) out.imageUrls = await Promise.all(out.imageUrls.map((u) => uploadMedia(u, "photos")));
    if (out.labelFile) out.labelFile = await uploadMedia(out.labelFile, "labels");
    if (out.labelPreview) out.labelPreview = await uploadMedia(out.labelPreview, "labels");
    if (Array.isArray(out.imageUrls) && out.imageUrls.length) out.imageUrl = out.imageUrls[0];
    return out;
  } catch (e) {
    console.warn("이미지 업로드 실패 — base64로 저장합니다. (Storage 설정 SQL 실행 여부 확인):", e?.message || e);
    return fields;
  }
}
// 기존 base64 오버레이를 Storage로 한 번 옮긴다(관리자·세션당 1회). 실패해도 조용히 넘어감.
let _mediaMigrated = false;
function hasInlineMedia(d) {
  if (!d) return false;
  const is64 = (v) => typeof v === "string" && v.startsWith("data:");
  return is64(d.imageUrl) || is64(d.labelFile) || is64(d.labelPreview) || (Array.isArray(d.imageUrls) && d.imageUrls.some(is64));
}
async function migrateOverlayMediaOnce() {
  if (_mediaMigrated || !isAdmin || !sb) return;
  _mediaMigrated = true;
  const heavy = overlay.filter((o) => hasInlineMedia(o.data));
  if (!heavy.length) return;
  console.log(`[속도개선] base64 이미지 ${heavy.length}건을 Storage로 이동합니다…`);
  let ok = 0;
  for (const o of heavy) {
    try {
      const migrated = await withUploadedMedia(o.data);
      if (hasInlineMedia(migrated)) continue; // 업로드 실패(변화 없음)면 건너뜀
      const { error } = await sb.from("assets").update({ data: migrated, updated_at: new Date().toISOString() }).eq("id", o.id);
      if (error) throw error;
      ok++;
    } catch (e) { console.warn("이동 실패:", o.id, e?.message || e); }
  }
  if (ok) { await sbLoadOverlay(); buildAssets(); rerender(); console.log(`[속도개선] ${ok}건 이동 완료.`); }
  else _mediaMigrated = false; // 하나도 못 옮겼으면(설정 전) 다음 기회에 재시도
}

async function applyCreate(fields, meta = {}) {
  fields = await withUploadedMedia(fields);
  const id = "u" + Date.now() + Math.floor(Math.random() * 1000);
  const data = { ...cleanFields(fields), regDate: todayStr() };
  const { error } = await sb.from("assets").upsert({ id, kind: "added", data, updated_at: new Date().toISOString() });
  if (error) throw error;
  await logHistory({ asset_id: id, asset_name: data.assetName, action: "create", before: null, after: snapshotOf(data), requester: meta.requester, note: meta.note });
}
async function applyUpdate(id, fields, meta = {}) {
  fields = await withUploadedMedia(fields);
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
  if (!isSuperAdmin) { alert("원상복구(되돌리기)는 최고관리자만 할 수 있습니다."); return; }
  const h = history.find((x) => String(x.id) === String(histId));
  if (!h) return;
  if (h.action === "inspect") { alert("검수 기록은 되돌리기 대상이 아닙니다. 검수 기록 삭제는 상세 화면에서 가능합니다."); return; }
  if (!confirm(`이 변경을 취소하고 '이전 상태'로 되돌리시겠습니까?\n\n대상: ${h.asset_name || h.asset_id}`)) return;
  const beforeNow = snapshotOf(findAsset(h.asset_id));
  try {
    await applyState(h.asset_id, h.before_snap);
    await logHistory({ asset_id: h.asset_id, asset_name: h.asset_name, action: "revert", before: beforeNow, after: h.before_snap, note: "이전 상태로 되돌림" });
  } catch (e) { console.error(e); alert("되돌리기에 실패했습니다."); return; }
  await reloadAll(); rerender(); renderHistory();
}
async function deleteHistory(histId) {
  if (!isSuperAdmin) { alert("기록 삭제는 최고관리자만 할 수 있습니다."); return; }
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
    currentPhotos = photosOf(r.payload || {});
    updateOcrBtn();
    currentLabelFile = (r.payload && r.payload.labelFile) || "";
    currentLabelPreview = (r.payload && r.payload.labelPreview) || "";
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
  const actionLabel = { create: "등록 요청", update: "수정 요청", delete: "삭제 요청", inspect: "검수 요청" };
  const actionCls = { create: "req-create", update: "req-update", delete: "req-delete", inspect: "req-inspect" };
  body.innerHTML = myRequests.map((r) => {
    const p = r.payload || {};
    const decided = r.status !== "pending";
    const meta = [
      `신청: ${fmtTime(r.created_at)}`,
      decided && r.decided_at && `처리: ${fmtTime(r.decided_at)}`,
      r.note && `사유: ${esc(r.note)}`,
    ].filter(Boolean).join(" · ");
    const actions = !decided
      ? `${r.action !== "inspect" ? `<button class="btn btn-secondary btn-sm" data-editreq="${r.id}">수정</button>` : ""}
         <button class="btn btn-danger btn-sm" data-cancelreq="${r.id}">취소</button>`
      : `<button class="btn btn-danger btn-sm" data-delreq="${r.id}">삭제</button>`;
    const extra = r.action === "inspect" && p.period ? ` · 검수: ${esc(p.period)}` : (p.location ? ` · 위치: ${esc(p.location)}` : "");
    return `
      <div class="req-card">
        <div class="req-top">
          <span class="req-badge ${actionCls[r.action]}">${actionLabel[r.action]}</span>
          ${reqStatusBadge(r.status)}
          <span class="req-meta">${meta}</span>
        </div>
        <div class="req-summary"><b>${esc(p.assetName || "")}</b>${p.assetNumber ? ` (${esc(p.assetNumber)})` : ""}${extra}</div>
        ${actions ? `<div class="req-actions">${actions}</div>` : ""}
      </div>`;
  }).join("");
}

// ===== 승인 대기 (관리자) =====
function openReview() { renderReview(); show("reviewOverlay"); }
function renderReview() {
  const body = document.getElementById("reviewBody");
  if (requests.length === 0) { body.innerHTML = `<div class="empty-msg">대기 중인 요청이 없습니다.</div>`; return; }
  const actionLabel = { create: "등록 요청", update: "수정 요청", delete: "삭제 요청", inspect: "검수 요청" };
  const actionCls = { create: "req-create", update: "req-update", delete: "req-delete", inspect: "req-inspect" };
  body.innerHTML = requests.map((r) => {
    const p = r.payload || {};
    let summary;
    if (r.action === "inspect") summary = `<b>${esc(p.assetName || "")}</b> (${esc(p.assetNumber || "")}) · 검수 회차: <b>${esc(p.period || "-")}</b> · 확인자: ${esc(p.inspector || "-")}${p.affiliation ? ` (${esc(p.affiliation)})` : ""}`;
    else summary = r.action === "delete"
      ? `<b>${esc(p.assetName || "")}</b> (${esc(p.assetNumber || "")})`
      : `<div class="req-fields">
            <span><b>${esc(p.assetName || "")}</b></span>
            <span>자산번호: ${esc(p.assetNumber || "-")}</span>
            <span>위치: ${esc(p.location || "-")}</span>
            <span>사용자: ${esc(p.manager || "-")}</span>
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
    else if (r.action === "inspect") await applyInspect(r.target_id, r.payload, meta);
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
const HIST_LABELS = { assetName: "자산명", assetNumber: "자산번호", labelSticker: "라벨스티커", labelFile: "라벨 파일", status: "상태", location: "위치", manager: "사용자", dept: "부서", model: "모델", spec: "규격", maker: "제작사", acquireCost: "취득금액", note: "비고", imageUrl: "사진" };
function histSummary(h) {
  if (h.action === "inspect") return `🔍 ${esc(h.note || "검수 확인")}`;
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
  const actLabel = { create: "등록", update: "수정", delete: "삭제", revert: "되돌림", inspect: "검수" };
  const actCls = { create: "req-create", update: "req-update", delete: "req-delete", revert: "req-revert", inspect: "req-inspect" };
  body.innerHTML =
    (isSuperAdmin ? "" : `<div class="notice" style="margin-bottom:14px;">원상복구(되돌리기)와 기록 삭제는 <b>최고관리자</b>만 할 수 있습니다. 일반 관리자는 이력 조회만 가능합니다.</div>`) +
    rows.map((h) => {
    const meta = [h.approved_by && `결재자: ${esc(h.approved_by)}`, h.requester && `신청자: ${esc(h.requester)}`, h.note && esc(h.note)].filter(Boolean).join(" · ");
    const canRevert = h.action !== "inspect" && isSuperAdmin;
    const actions = isSuperAdmin
      ? `${canRevert ? `<button class="btn btn-secondary btn-sm" data-revert="${h.id}">이전 상태로 되돌리기</button>` : ""}
         <button class="btn btn-danger btn-sm" data-delhist="${h.id}">기록 삭제</button>`
      : "";
    return `
      <div class="req-card">
        <div class="req-top">
          <span class="req-badge ${actCls[h.action] || "badge-gray"}">${actLabel[h.action] || h.action}</span>
          <span class="req-meta">${fmtTime(h.created_at)} · <b>${esc(h.asset_name || h.asset_id)}</b></span>
        </div>
        <div class="req-summary">${histSummary(h)}</div>
        ${meta ? `<div class="req-meta" style="margin-bottom:8px;">${meta}</div>` : ""}
        ${actions ? `<div class="req-actions">${actions}</div>` : ""}
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
function memberStatusBadge(status) {
  const s = status || "pending";
  if (s === "approved") return `<span class="badge badge-normal">승인됨</span>`;
  if (s === "rejected") return `<span class="badge badge-warn">거절됨</span>`;
  return `<span class="badge badge-gray">승인대기</span>`;
}
function renderMembers() {
  const body = document.getElementById("membersBody");
  if (members.length === 0) { body.innerHTML = `<div class="empty-msg">회원이 없습니다.</div>`; return; }
  const myId = currentUser?.id;
  // 승인 대기 회원을 맨 위로 정렬
  const sorted = members.slice().sort((a, b) => {
    const pa = (a.status || "pending") === "pending" ? 0 : 1;
    const pb = (b.status || "pending") === "pending" ? 0 : 1;
    return pa - pb;
  });
  const pendingN = members.filter((m) => (m.status || "pending") === "pending").length;
  body.innerHTML = `
    ${pendingN ? `<div class="notice" style="margin-bottom:14px;">승인 대기 중인 가입 신청이 <b>${pendingN}건</b> 있습니다. ‘승인’을 눌러 이용을 허가하세요.</div>` : ""}
    <table class="member-table">
      <thead><tr><th>이름</th><th>소속</th><th>아이디</th><th>이메일</th><th>상태</th><th>권한</th><th>가입일</th><th>관리</th></tr></thead>
      <tbody>
        ${sorted.map((m) => {
          const isSelf = String(m.id) === String(myId);
          const isSuper = m.role === "superadmin";
          const status = m.status || "pending";
          // 가입 승인/거절 (관리자 가능)
          let approveBtns = "";
          if (!isSelf && !isSuper) {
            if (status !== "approved") approveBtns += `<button class="btn-mini btn-view" data-setstatus="approved" data-id="${esc(m.id)}">승인</button> `;
            if (status === "pending") approveBtns += `<button class="btn-mini btn-del" data-setstatus="rejected" data-id="${esc(m.id)}">거절</button> `;
            if (status === "approved") approveBtns += `<button class="btn-mini btn-edit" data-setstatus="pending" data-id="${esc(m.id)}">승인취소</button> `;
          }
          // 권한 변경/삭제 (최고관리자만)
          let superBtns = "";
          if (!isSelf && !isSuper && isSuperAdmin) {
            const toggle = m.role === "admin"
              ? `<button class="btn-mini btn-edit" data-role="user" data-id="${esc(m.id)}">사용자로</button>`
              : `<button class="btn-mini btn-view" data-role="admin" data-id="${esc(m.id)}">관리자로</button>`;
            superBtns = `${toggle} <button class="btn-mini btn-del" data-delmember="${esc(m.id)}">삭제</button>`;
          }
          let actions;
          if (isSelf) actions = `<span class="member-self">본인</span>`;
          else if (isSuper) actions = `<span class="member-self">최고관리자</span>`;
          else actions = approveBtns + superBtns;
          return `
          <tr>
            <td>${esc(m.name || "-")}</td>
            <td>${esc(m.affiliation || "-")}</td>
            <td>${esc(m.username || "-")}</td>
            <td class="cell-num">${esc(m.email || "-")}</td>
            <td>${memberStatusBadge(status)}</td>
            <td>${roleBadge(m.role)}</td>
            <td>${fmtTime(m.created_at)}</td>
            <td class="cell-actions">${actions}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <p class="member-count">총 ${members.length}명 · 가입 승인은 관리자가, 권한 변경·삭제는 최고관리자가 할 수 있습니다.</p>`;
}
async function setMemberStatus(id, status) {
  const m = members.find((x) => String(x.id) === String(id));
  if (!m) return;
  const label = { approved: "승인", rejected: "거절", pending: "승인취소" }[status] || status;
  if (!confirm(`${m.name || m.username || m.email} 님을 ${label}하시겠습니까?`)) return;
  try {
    const { error } = await sb.from("profiles").update({ status }).eq("id", id);
    if (error) throw error;
  } catch (e) { console.error(e); alert("처리에 실패했습니다."); return; }
  await sbLoadMembers();
  renderMembers();
  updateUI();
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

// ===== 건의 게시판 =====
async function sbLoadPosts() {
  if (!sb) { posts = []; return; }
  const { data, error } = await sb.from("posts").select("*").order("created_at", { ascending: false });
  if (error) { console.error("게시글 로드 오류:", error.message); posts = []; return; }
  posts = data || [];
}
async function sbLoadComments(postId) {
  if (!sb) { postComments = []; return; }
  const { data, error } = await sb.from("comments").select("*").eq("post_id", postId).order("created_at", { ascending: true });
  if (error) { console.error("댓글 로드 오류:", error.message); postComments = []; return; }
  postComments = data || [];
}
async function openBoardPage() {
  renderNav();
  updateUI();
  const body = document.getElementById("boardBody");
  if (body && posts.length === 0) body.innerHTML = `<div class="empty-msg">불러오는 중...</div>`;
  await sbLoadPosts();
  renderBoard();
}
function renderBoard() {
  const body = document.getElementById("boardBody");
  if (posts.length === 0) { body.innerHTML = `<div class="empty-msg">아직 게시글이 없습니다. 첫 글을 남겨보세요.</div>`; return; }
  const notices = posts.filter((p) => p.type === "notice");
  const suggestions = posts.filter((p) => p.type !== "notice");
  const card = (p) => {
    const isNotice = p.type === "notice";
    return `
      <div class="post-card ${isNotice ? "post-notice" : ""}" data-post="${esc(p.id)}">
        <div class="post-row">
          <span class="post-badge ${isNotice ? "badge-notice" : "badge-suggest"}">${isNotice ? "공지" : "건의"}</span>
          <span class="post-title">${esc(p.title || "(제목 없음)")}</span>
          <span class="post-cmt">💬</span>
        </div>
        <div class="post-meta">${esc(p.author_name || "-")}${p.author_affiliation ? " · " + esc(p.author_affiliation) : ""} · ${fmtTime(p.created_at)}</div>
      </div>`;
  };
  body.innerHTML = [...notices, ...suggestions].map(card).join("");
}
async function openPostView(id) {
  const p = posts.find((x) => String(x.id) === String(id));
  if (!p) return;
  currentPostId = id;
  await sbLoadComments(id);
  renderPostView(p);
  document.getElementById("commentInput").value = "";
  document.getElementById("commentError").hidden = true;
  document.getElementById("commentName").value = myProfile?.name || "";
  document.getElementById("commentAffil").value = myProfile?.affiliation || "";
  document.getElementById("commentWrite").style.display = currentUser ? "" : "none";
  document.getElementById("commentLoginNote").hidden = !!currentUser;
  show("postViewOverlay");
}
function renderPostView(p) {
  const isNotice = p.type === "notice";
  document.getElementById("postViewTitle").textContent = isNotice ? "공지사항" : "건의사항";
  document.getElementById("postDeleteBtn").hidden = !isAdmin;
  const head = `
    <div class="post-view-head">
      <span class="post-badge ${isNotice ? "badge-notice" : "badge-suggest"}">${isNotice ? "공지" : "건의"}</span>
      <h3 class="post-view-h">${esc(p.title || "(제목 없음)")}</h3>
      <div class="post-meta">${esc(p.author_name || "-")}${p.author_affiliation ? " · " + esc(p.author_affiliation) : ""} · ${fmtTime(p.created_at)}</div>
    </div>
    <div class="post-content">${esc(p.content || "").replace(/\n/g, "<br>")}</div>`;
  const comments = postComments.map((c) => `
    <div class="comment ${c.is_admin_reply ? "comment-admin" : ""}">
      <div class="comment-meta">
        <b>${esc(c.author_name || "익명")}</b>${c.author_affiliation ? ` <span class="comment-affil">(${esc(c.author_affiliation)})</span>` : ""}
        ${c.is_admin_reply ? `<span class="comment-tag">관리자</span>` : ""}
        <span class="comment-time">${fmtTime(c.created_at)}</span>
        ${isAdmin ? `<button class="btn-mini btn-del" data-delcomment="${esc(c.id)}">삭제</button>` : ""}
      </div>
      <div class="comment-body">${esc(c.content || "").replace(/\n/g, "<br>")}</div>
    </div>`).join("");
  document.getElementById("postViewBody").innerHTML = head +
    `<div class="comment-section"><h4 class="comment-h">댓글 <span class="insp-count">${postComments.length}</span></h4>` +
    (postComments.length ? comments : `<div class="insp-empty">아직 댓글이 없습니다.</div>`) + `</div>`;
}
function openPostForm() {
  if (!requireLogin()) return;
  document.getElementById("postFormError").hidden = true;
  document.getElementById("pf-title").value = "";
  document.getElementById("pf-content").value = "";
  document.getElementById("pf-name").value = myProfile?.name || "";
  document.getElementById("pf-affil").value = myProfile?.affiliation || "";
  document.getElementById("pf-type").value = "suggestion";
  document.getElementById("pf-type-row").style.display = isSuperAdmin ? "" : "none"; // 공지사항은 최고관리자만
  show("postFormOverlay");
}
async function submitPost() {
  if (!requireLogin()) return;
  const type = isSuperAdmin ? document.getElementById("pf-type").value : "suggestion";
  const title = document.getElementById("pf-title").value.trim();
  const content = document.getElementById("pf-content").value.trim();
  const name = document.getElementById("pf-name").value.trim();
  const affiliation = document.getElementById("pf-affil").value.trim();
  const errEl = document.getElementById("postFormError");
  errEl.hidden = true;
  if (!name) { errEl.textContent = "이름을 입력해주세요."; errEl.hidden = false; return; }
  if (!affiliation) { errEl.textContent = "소속을 입력해주세요."; errEl.hidden = false; return; }
  if (!title) { errEl.textContent = "제목을 입력해주세요."; errEl.hidden = false; return; }
  if (!content) { errEl.textContent = "내용을 입력해주세요."; errEl.hidden = false; return; }
  const btn = document.getElementById("postFormSubmit");
  btn.disabled = true;
  try {
    const { error } = await sb.from("posts").insert({ type, title, content, author_name: name, author_affiliation: affiliation, user_id: currentUser.id });
    if (error) throw error;
  } catch (e) { console.error(e); errEl.textContent = "등록 실패: " + (e.message || ""); errEl.hidden = false; btn.disabled = false; return; }
  btn.disabled = false;
  hide("postFormOverlay");
  await sbLoadPosts(); renderBoard();
}
async function submitComment() {
  if (!requireLogin()) return;
  const name = document.getElementById("commentName").value.trim();
  const affiliation = document.getElementById("commentAffil").value.trim();
  const content = document.getElementById("commentInput").value.trim();
  const errEl = document.getElementById("commentError");
  errEl.hidden = true;
  if (!name) { errEl.textContent = "이름을 입력해주세요."; errEl.hidden = false; return; }
  if (!content) { errEl.textContent = "댓글 내용을 입력해주세요."; errEl.hidden = false; return; }
  const btn = document.getElementById("commentSubmit");
  btn.disabled = true;
  try {
    const { error } = await sb.from("comments").insert({ post_id: currentPostId, content, author_name: name, author_affiliation: affiliation, user_id: currentUser.id, is_admin_reply: isAdmin });
    if (error) throw error;
  } catch (e) { console.error(e); errEl.textContent = "댓글 등록 실패: " + (e.message || ""); errEl.hidden = false; btn.disabled = false; return; }
  btn.disabled = false;
  document.getElementById("commentInput").value = "";
  await sbLoadComments(currentPostId);
  renderPostView(posts.find((x) => String(x.id) === String(currentPostId)));
}
async function deleteComment(cid) {
  if (!isAdmin) return;
  if (!confirm("이 댓글을 삭제하시겠습니까?")) return;
  try { const { error } = await sb.from("comments").delete().eq("id", cid); if (error) throw error; }
  catch (e) { console.error(e); alert("댓글 삭제에 실패했습니다."); return; }
  await sbLoadComments(currentPostId);
  renderPostView(posts.find((x) => String(x.id) === String(currentPostId)));
}
async function deletePost(id) {
  if (!isAdmin) return;
  const pid = id || currentPostId;
  if (!confirm("이 게시글을 삭제하시겠습니까?\n\n(달린 댓글도 함께 삭제됩니다.)")) return;
  try { const { error } = await sb.from("posts").delete().eq("id", pid); if (error) throw error; }
  catch (e) { console.error(e); alert("게시글 삭제에 실패했습니다."); return; }
  hide("postViewOverlay");
  await sbLoadPosts(); renderBoard();
}

// ===== 엑셀 내보내기 =====
async function exportExcel() {
  if (filtered.length === 0) { alert("내보낼 자산이 없습니다."); return; }
  try { await ensureXlsx(); } catch { alert("엑셀 모듈을 불러오지 못했습니다. 인터넷 연결을 확인해주세요."); return; }
  const rows = filtered.map((a) => ({
    "메뉴": groupOf(a),
    "자산명": a.assetName || "", "자산번호": a.assetNumber || "", "라벨스티커": a.labelSticker || "", "라벨파일": a.labelFile ? (a.labelFileName || "있음") : "",
    "모델명": a.model || "", "규격": a.spec || "", "제작회사": a.maker || "",
    "단가": a.unitPrice || 0, "수량": a.qty || 0, "취득금액": a.acquireCost || 0, "취득일자": a.acquireDate || "",
    "보관 위치": a.location || "", "관리 기관": a.org || "", "운영 부서": a.dept || "",
    "사용자": a.manager || "", "대여일시": a.rentDate || "", "반납일시": a.returnDate || "",
    "등재일": a.regDate || "", "상태": a.status || "", "비고": a.note || "",
    "구분": a._added ? "직접등록" : a._edited ? "수정됨" : "엑셀원본",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "자산목록");
  XLSX.writeFile(wb, `${currentGroup}_자산목록_${todayStr()}.xlsx`);
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
document.getElementById("uninspBtn").addEventListener("click", () => { inspFilter = !inspFilter; applyFilter(); });
document.getElementById("stats").addEventListener("change", (e) => {
  if (e.target && e.target.id === "inspRoundSel") { inspRound = e.target.value; renderStats(); applyFilter(); }
});
document.getElementById("addBtn").addEventListener("click", () => openForm(null));

document.getElementById("assetTbody").addEventListener("click", (e) => {
  const thumb = e.target.closest("img.thumb");
  if (thumb) { openLightbox(thumb.src); return; }
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains("btn-label-view")) { const a = findAsset(id); if (a) openLightbox(isImageData(a.labelFile) ? a.labelFile : a.labelPreview); }
  else if (btn.classList.contains("btn-label")) downloadLabelFile(id);
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
document.getElementById("detailLabelDelBtn").addEventListener("click", () => deleteLabelFile(detailCurrentId));
document.getElementById("detailInspectBtn").addEventListener("click", () => openInspect(detailCurrentId));
document.getElementById("detailBody").addEventListener("click", (e) => {
  const img = e.target.closest(".detail-photo img");
  if (img) { openLightbox(img.src); return; }
  const saveUser = e.target.closest("#detailUserSaveBtn");
  if (saveUser) { saveDetailUser(detailCurrentId); return; }
  const delInsp = e.target.closest("button[data-delinsp]");
  if (delInsp) removeInspection(detailCurrentId, delInsp.dataset.delinsp);
});
document.getElementById("inspectSubmit").addEventListener("click", submitInspect);
document.getElementById("inspectForm").addEventListener("submit", (e) => { e.preventDefault(); submitInspect(); });
document.getElementById("lightbox").addEventListener("click", closeLightbox);

document.getElementById("f-image").addEventListener("change", (e) => handlePhotoUpload(e.target.files));
document.getElementById("removePhotoBtn").addEventListener("click", () => { currentPhotos = []; document.getElementById("f-image").value = ""; renderPhotoPreview(); });
document.getElementById("photoPreview").addEventListener("click", (e) => {
  const del = e.target.closest("button[data-photo-idx]");
  if (del) { currentPhotos.splice(Number(del.dataset.photoIdx), 1); renderPhotoPreview(); return; }
  const img = e.target.closest("img");
  if (img) openLightbox(img.src);
});
document.getElementById("f-labelFile").addEventListener("change", (e) => handleLabelFileUpload(e.target.files[0]));
document.getElementById("removeLabelFileBtn").addEventListener("click", () => { currentLabelFile = ""; currentLabelFileName = ""; currentLabelPreview = ""; document.getElementById("f-labelFile").value = ""; renderLabelFileInfo(); updateOcrBtn(); });
document.getElementById("ocrBtn").addEventListener("click", runLabelOcr);
document.getElementById("ocrResultBtn").addEventListener("click", showOcrResult);
document.getElementById("f-assetGroup").addEventListener("change", updateFormForGroup);
document.getElementById("formSaveBtn").addEventListener("click", saveForm);
document.getElementById("assetForm").addEventListener("submit", (e) => { e.preventDefault(); saveForm(); });

document.getElementById("delReqSubmit").addEventListener("click", submitDeleteRequest);
document.getElementById("delReqForm").addEventListener("submit", (e) => { e.preventDefault(); submitDeleteRequest(); });

// 시작 화면 (로그인 전)
document.getElementById("landingLoginBtn").addEventListener("click", () => openAuth("login"));
document.getElementById("landingSignupBtn").addEventListener("click", () => openAuth("signup"));

// 가입 승인 대기 화면
document.getElementById("pendingRefreshBtn").addEventListener("click", () => location.reload());
document.getElementById("pendingLogoutBtn").addEventListener("click", logout);

// 회원가입 동의 체크박스
const CONSENT_TEXT = {
  privacy: "[개인정보 수집·이용 동의]\n\n1. 수집 항목: 아이디(이메일), 이름, 소속, 비밀번호\n2. 수집 목적: 자산관리 시스템 회원 식별 및 서비스 제공, 등록·검수 이력 관리\n3. 보유 기간: 회원 탈퇴 또는 소속 만료 시까지\n4. 동의를 거부할 수 있으나, 거부 시 회원가입 및 서비스 이용이 제한됩니다.",
  pledge: "[자산관리 성실 서약]\n\n1. 본인은 등록·수정·검수하는 자산 정보를 사실에 근거하여 정확하게 입력합니다.\n2. 담당 자산을 성실히 관리하고, 이동·불용·분실 발생 시 지체 없이 반영합니다.\n3. 시스템 계정과 권한을 타인에게 양도하지 않으며 보안을 준수합니다.",
};
document.getElementById("agreeAll").addEventListener("change", (e) => {
  document.querySelectorAll("#consentBox .agree-item").forEach((c) => (c.checked = e.target.checked));
});
document.querySelectorAll("#consentBox .agree-item").forEach((c) => c.addEventListener("change", syncConsentAll));
document.getElementById("consentBox").addEventListener("click", (e) => {
  const link = e.target.closest(".consent-link");
  if (link) { e.preventDefault(); alert(CONSENT_TEXT[link.dataset.consent] || ""); }
});

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
  const statusBtn = e.target.closest("button[data-setstatus]");
  const roleBtn = e.target.closest("button[data-role]");
  const delBtn = e.target.closest("button[data-delmember]");
  if (statusBtn) setMemberStatus(statusBtn.dataset.id, statusBtn.dataset.setstatus);
  else if (roleBtn) setMemberRole(roleBtn.dataset.id, roleBtn.dataset.role);
  else if (delBtn) deleteMember(delBtn.dataset.delmember);
});

// 건의 게시판
document.getElementById("boardBtn").addEventListener("click", () => navTo("board"));
document.querySelectorAll(".main-nav .nav-link").forEach((btn) => btn.addEventListener("click", () => navTo(btn.dataset.route)));
document.getElementById("boardWriteBtn").addEventListener("click", openPostForm);
document.getElementById("boardBackBtn").addEventListener("click", () => navTo("2025"));
document.getElementById("boardBody").addEventListener("click", (e) => {
  const card = e.target.closest("[data-post]");
  if (card) openPostView(card.dataset.post);
});
document.getElementById("postFormSubmit").addEventListener("click", submitPost);
document.getElementById("postForm").addEventListener("submit", (e) => { e.preventDefault(); submitPost(); });
document.getElementById("commentSubmit").addEventListener("click", submitComment);
document.getElementById("postDeleteBtn").addEventListener("click", () => deletePost(currentPostId));
document.getElementById("postViewBackBtn").addEventListener("click", () => hide("postViewOverlay"));
document.getElementById("postFormCancelBtn").addEventListener("click", () => hide("postFormOverlay"));
document.getElementById("postViewBody").addEventListener("click", (e) => {
  const del = e.target.closest("button[data-delcomment]");
  if (del) deleteComment(del.dataset.delcomment);
});

// 모달 닫기
const ALL_MODALS = ["detailOverlay", "formOverlay", "delReqOverlay", "authOverlay", "myReqOverlay", "reviewOverlay", "histOverlay", "membersOverlay", "inspectOverlay", "postFormOverlay", "postViewOverlay"];
document.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => ALL_MODALS.forEach(hide)));
document.querySelectorAll(".modal-overlay").forEach((ov) => ov.addEventListener("click", (e) => { if (e.target === ov) ov.hidden = true; }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeLightbox(); ALL_MODALS.forEach(hide); } });

// 시작
loadData();
