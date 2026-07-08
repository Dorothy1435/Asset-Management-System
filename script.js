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
let selectedIds = new Set(); // 일괄 수정용 선택 자산 id (관리자)
let inspView = "all"; // 선택 회차 검수 필터: "all"(전체) | "uninsp"(미검수) | "done"(검수 완료) — 2025/2024 자산 전용
let inspRound = "1회차"; // 대시보드/필터 기준 검수 회차
const PER_PAGE = 20;

// ===== 메뉴(자산 그룹) / 페이지 라우팅 =====
const GROUP_2024 = "2025년도 자산";   // 메인(현재) 메뉴 — 값은 레거시 이름 그대로 유지
const GROUP_ELEC = "전자";
const GROUP_PAST = "2024자산";        // 2024년도 자산 메뉴 (내부값; 레거시 '2024년도 자산' 문자열과 구분)
const GROUPS = [GROUP_2024, GROUP_PAST, GROUP_ELEC];
// 화면에 보이는 메뉴 이름 (내부값 → 표시 라벨)
const GROUP_LABELS = { [GROUP_2024]: "2025년도 자산", [GROUP_PAST]: "2024년도 자산", [GROUP_ELEC]: "전자" };
const groupLabel = (g) => GROUP_LABELS[g] || g;
// assetGroup 값이 없거나 옛 이름('2024년도 자산')인 기존 자산은 모두 기본(2025) 메뉴로 간주.
// 새 2024 메뉴는 별도 내부값(GROUP_PAST)을 쓰므로 레거시와 섞이지 않는다.
const groupOf = (a) => {
  const g = a.assetGroup;
  if (g === GROUP_PAST) return GROUP_PAST;
  if (!g || g === "2024년도 자산") return GROUP_2024;
  return g;
};
let currentGroup = GROUP_2024;
let currentPageName = "assets"; // "assets" | "board" | "admin"
let currentAdminTab = "review"; // "review" | "hist" | "members"
// 라우트별 자산 그룹 매핑
const ROUTES = { "2025": GROUP_2024, "past": GROUP_PAST, "elec": GROUP_ELEC };
const GROUP_TO_ROUTE = { [GROUP_2024]: "2025", [GROUP_PAST]: "past", [GROUP_ELEC]: "elec" };
// 운영 부서 표준 목록 (폼/필터 공통)
const DEPTS = ["기획사무국", "지역혁신국", "교육혁신국", "산업혁신국", "현장캠퍼스"];

let sortState = { key: null, dir: 1 };
let currentPhotos = [];   // 물품 사진 여러 장 (base64 배열). imageUrl은 첫 장, imageUrls는 전체.
let currentLabelFile = "";
let currentLabelFileName = "";
let currentLabelPreview = "";  // PDF 라벨의 1페이지 미리보기 이미지(base64)
let currentLabelRaw = "";      // 라벨 이미지 원본(고해상도) — QR/OCR 인식 정확도용 (저장 안 함)

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
let inspectPhoto = "";   // 검수 사진(촬영본) — 카메라 검수 시에만 채워짐
let inspectExtraPhotos = []; // 검수 화면에서 이어서 촬영한 '물품 사진'(최대 3장, base64) — 자산 사진에 병합
const INSP_EXTRA_MAX = 3;
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
  return encodeCanvas(canvas, 0.85);
}

// ===== 스냅샷 =====
const SNAP_FIELDS = ["assetName", "assetNumber", "labelSticker", "labelFile", "labelFileName", "labelPreview", "status", "location", "manager", "dept", "model", "spec", "maker", "acquireCost", "note", "imageUrl", "imageUrls", "thumbUrl", "regDate", "assetGroup", "rentDate", "returnDate"];
const DATA_FIELDS = ["assetName", "assetNumber", "labelSticker", "labelFile", "labelFileName", "labelPreview", "status", "location", "manager", "dept", "model", "spec", "maker", "acquireCost", "note", "imageUrl", "imageUrls", "thumbUrl", "assetGroup", "rentDate", "returnDate"];
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
    applyFilter(false); // 데이터 새로고침 시 보던 페이지 유지 (1페이지로 튀지 않게)
  } else {
    updateUI();
  }
}

// ===== 페이지 라우팅 (해시 기반) =====
function parseHash() {
  const h = (location.hash || "").replace(/^#\/?/, "").trim();
  if (h === "board") return { page: "board" };
  if (h === "admin" || h.startsWith("admin/")) {
    const tab = h.split("/")[1] || "review";
    return { page: "admin", tab: ["review", "hist", "members"].includes(tab) ? tab : "review" };
  }
  if (ROUTES[h]) return { page: "assets", group: ROUTES[h] };
  return { page: "assets", group: GROUP_2024 };
}
function applyHashRoute() {
  const r = parseHash();
  // 관리자 아닌데 관리자 페이지로 접근하면 자산 목록으로
  if (r.page === "admin" && authInited && !isAdmin) { navTo("2025"); return; }
  currentPageName = r.page;
  if (r.page === "assets") {
    currentGroup = r.group;
    // 그룹이 바뀌면 검색/필터/페이지 초기화
    const si = document.getElementById("searchInput");
    if (si) si.value = "";
    ["deptFilter", "statusFilter", "minCost", "maxCost", "nameFilter", "locFilter"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
    inspView = "all";
    currentPage = 1;
  }
  showPage(r.page);
  if (authInited) {
    if (r.page === "board") openBoardPage();
    else if (r.page === "admin") openAdminPage(r.tab);
    else rerender();
  }
}
function showPage(page) {
  const assetsEl = document.getElementById("page-assets");
  const boardEl = document.getElementById("page-board");
  const adminEl = document.getElementById("page-admin");
  if (assetsEl) assetsEl.hidden = page !== "assets";
  if (boardEl) boardEl.hidden = page !== "board";
  if (adminEl) adminEl.hidden = page !== "admin";
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
    else if (route === "admin") active = currentPageName === "admin";
    else active = currentPageName === "assets" && GROUP_TO_ROUTE[currentGroup] === route;
    btn.classList.toggle("active", active);
    const cnt = btn.querySelector(".nav-count");
    if (cnt && ROUTES[route]) cnt.textContent = counts[ROUTES[route]].toLocaleString();
  });
}

async function loadData() {
  // 베이스 자산(읽기 전용)은 3개 파일에서 합쳐 읽는다.
  //  · assets.json        : 2025년도 자산(메인)
  //  · assets2025add.json : 2025년도 자산에 추가 병합분(6.30 기준, 중복 자산번호 제외됨)
  //  · assets2024.json    : 2024년도 자산 메뉴 (assetGroup=GROUP_PAST 태깅됨)
  const fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  // 첫 화면을 빨리 띄우려고 '기본(2025)' 데이터만 먼저 로드. 2024 자산(2천여 건)은 뒤에서 이어 로드.
  const baseP = Promise.all([
    fetchJson("assets.json"),
    fetchJson("assets2025add.json"),
  ])
    .then(([main, add2025]) => {
      if (!Array.isArray(main) || !main.length) throw new Error("main empty");
      baseAssets = [...main, ...(Array.isArray(add2025) ? add2025 : [])];
    })
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
  // 2024년도 자산은 백그라운드로 이어 로드 → 기본 화면 표시를 막지 않는다.
  fetchJson("assets2024.json").then((past) => {
    if (Array.isArray(past) && past.length) {
      baseAssets = baseAssets.concat(past);
      buildAssets();
      rerender();
    }
  });
  // 배지·모달용 부가 데이터(내 신청/승인대기/이력/회원)는 백그라운드로 로드 — 목록 표시를 막지 않음
  Promise.all([sbLoadMyRequests(), sbLoadRequests(), sbLoadHistory(), sbLoadMembers()]).then(() => {
    if (currentPageName === "assets") updateUI();
    migrateOverlayMediaOnce(); // 관리자면 기존 base64 이미지를 Storage로 이동(1회)
  });
  // 로그인 사용자(검수 가능자)는 인식 엔진을 유휴 시간에 미리 준비 → 첫 촬영 대기까지 제거
  if (currentUser) {
    const warm = () => warmupNumberOcr();
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 4000 }); else setTimeout(warm, 2500);
  }
}

// 실시간 이벤트로 받은 '바뀐 행'만 메모리 오버레이에 반영한다.
// (예전엔 자산 하나만 바뀌어도 접속자 전원이 오버레이 전체를 다시 내려받아 전송량이 폭증했다.)
function applyOverlayChange(payload) {
  if (!payload) return;
  if (payload.eventType === "DELETE") {
    const id = payload.old && payload.old.id;
    if (id == null) return;
    overlay = overlay.filter((o) => String(o.id) !== String(id));
    return;
  }
  const nu = payload.new;
  if (!nu || nu.id == null) return; // 페이로드에 행 정보가 없으면 무시(다음 재동기화에서 반영)
  const row = { id: nu.id, kind: nu.kind, data: nu.data, updated_at: nu.updated_at };
  const i = overlay.findIndex((o) => String(o.id) === String(row.id));
  if (i >= 0) overlay[i] = row; else overlay.push(row);
}
let _rtInitialSynced = false;
let _realtimeChannel = null;
let _lastFocusRefresh = 0;
// 실시간 구독은 '로그인 사용자'에게만 연다. 익명 방문자가 대량으로 몰려도
// 실시간 동시연결 한도를 소모하지 않는다(익명은 새로고침/포커스 시 최신화).
function sbSubscribe() {
  if (!sb || !currentUser || _realtimeChannel) return;
  _rtInitialSynced = false;
  _realtimeChannel = sb.channel("realtime-all")
    .on("postgres_changes", { event: "*", schema: "public", table: "assets" }, (payload) => {
      applyOverlayChange(payload); buildAssets(); rerender();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, async () => {
      await sbLoadMyRequests(); await sbLoadRequests(); rerender();
      if (currentPageName === "admin" && currentAdminTab === "review") renderReview();
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
    .subscribe((status) => {
      // 최초 구독은 loadData가 이미 오버레이를 받아왔으니 건너뛴다.
      // 이후 재연결(SUBSCRIBED 재발생) 때는 그 사이 놓친 변경을 전체 재동기화로 보정.
      if (status !== "SUBSCRIBED") return;
      if (!_rtInitialSynced) { _rtInitialSynced = true; return; }
      sbLoadOverlay().then(() => { buildAssets(); rerender(); }).catch(() => {});
    });
}
function sbUnsubscribe() {
  if (_realtimeChannel) { try { sb.removeChannel(_realtimeChannel); } catch {} _realtimeChannel = null; _rtInitialSynced = false; }
}
// 실시간을 안 여는 익명 방문자를 위해: 탭이 다시 보이면 최대 60초에 한 번 목록을 최신화.
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !sb || !authInited || _realtimeChannel || currentPageName !== "assets") return;
  const now = Date.now();
  if (now - _lastFocusRefresh < 60000) return;
  _lastFocusRefresh = now;
  sbLoadOverlay().then(() => { buildAssets(); rerender(); }).catch(() => {});
});

// ===== 인증 =====
async function initAuth() {
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  await applySession(data.session);
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") show("pwOverlay");
    await applySession(session);
    // 로그인하면 실시간 구독을 열고, 로그아웃하면 닫아 연결을 반납한다.
    if (currentUser) sbSubscribe(); else sbUnsubscribe();
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
  // 로그인 성공 순간(로그인 창이 떠 있을 때)만 열린 모달을 정리한다.
  // 모바일에서 사진/카메라 선택창을 다녀오면 토큰 갱신 이벤트로 applySession이 다시 불리는데,
  // 그때 검수 창 등 작업 중인 모달이 강제로 닫히지 않도록 로그인 창이 열려있을 때로 한정한다.
  if (currentUser && isApproved) {
    const auth = document.getElementById("authOverlay");
    if (auth && !auth.hidden) ALL_MODALS.forEach(hide);
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
  document.getElementById("authAffil").innerHTML = deptOptionsHtml("");
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

// ===== 내 정보(이름/소속) 수정 =====
function openMyProfile() {
  if (!currentUser) return;
  document.getElementById("mpError").hidden = true;
  document.getElementById("mpInfo").hidden = true;
  document.getElementById("mp-username").value = myProfile?.username || (currentUser.email || "").split("@")[0];
  document.getElementById("mp-name").value = myProfile?.name || "";
  const affil = myProfile?.affiliation || "";
  const sel = document.getElementById("mp-affil");
  sel.innerHTML = deptOptionsHtml(affil);
  sel.value = affil;
  show("myProfileOverlay");
}
async function saveMyProfile() {
  if (!currentUser) return;
  const name = document.getElementById("mp-name").value.trim();
  const affiliation = document.getElementById("mp-affil").value;
  const errEl = document.getElementById("mpError");
  const btn = document.getElementById("mpSaveBtn");
  errEl.hidden = true;
  btn.disabled = true;
  try {
    const { error } = await sb.rpc("update_my_profile", { p_name: name, p_affiliation: affiliation });
    if (error) throw error;
    const { data } = await sb.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
    if (data) myProfile = data;
  } catch (e) {
    console.error(e);
    errEl.textContent = "저장에 실패했습니다. (Storage/함수 설정 SQL 실행 여부 확인) " + (e.message || "");
    errEl.hidden = false; btn.disabled = false; return;
  }
  btn.disabled = false;
  hide("myProfileOverlay");
  updateUI();
  alert("내 정보가 저장되었습니다.");
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
  g("myProfileBtn").hidden = !loggedIn;
  g("userTag").hidden = !loggedIn;
  g("myReqBtn").hidden = !loggedIn || isAdmin;
  g("reviewBtn").hidden = !isAdmin;
  g("histBtn").hidden = !isAdmin;
  g("membersBtn").hidden = !isAdmin; // 가입 승인은 관리자도 가능 (권한변경·삭제는 최고관리자만)
  const navAdmin = g("navAdmin");
  if (navAdmin) navAdmin.hidden = !isAdmin;
  const pendingMembers = members.filter((m) => (m.status || "pending") === "pending").length;
  const setBadge = (id, n) => { const el = g(id); if (el) { el.textContent = n; el.hidden = !n; } };
  setBadge("memberPendingCount", pendingMembers);
  setBadge("adminMemberCount", pendingMembers);      // 관리자 페이지 '회원 관리' 탭 배지
  setBadge("adminReviewCount", requests.length);     // 관리자 페이지 '승인 대기' 탭 배지
  // 관리자 네비 링크 배지 = 승인대기 + 회원승인대기
  setBadge("navAdminCount", (requests.length || 0) + pendingMembers);

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
  const bpb = g("bulkPhotoBtn"); if (bpb) bpb.hidden = !loggedIn; // 검색결과 사진 일괄 적용(로그인 사용자 · 비관리자는 승인 요청)
  const beb = g("bulkEditAllBtn"); if (beb) beb.hidden = !isAdmin; // 검색결과 전체 일괄 수정(관리자)

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
    <div class="stat-card"><div class="num">${total.toLocaleString()}</div><div class="label">${esc(groupLabel(currentGroup))}</div></div>
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
function applyFilter(resetPage = true) {
  const kw = document.getElementById("searchInput").value.trim().toLowerCase();
  const nameKw = (document.getElementById("nameFilter")?.value || "").trim().toLowerCase();
  const locKw = (document.getElementById("locFilter")?.value || "").trim().toLowerCase();
  const dept = document.getElementById("deptFilter").value;
  const status = document.getElementById("statusFilter").value;
  const minCost = Number(document.getElementById("minCost").value) || 0;
  const maxCostRaw = document.getElementById("maxCost").value;
  const maxCost = maxCostRaw === "" ? Infinity : Number(maxCostRaw);
  const inspActive = inspView !== "all" && currentGroup !== GROUP_ELEC;
  filtered = assets.filter((a) => {
    if (groupOf(a) !== currentGroup) return false;
    if (inspActive) {
      const done = inspectedRound(a, inspRound);
      if (inspView === "uninsp" && done) return false;   // 미검수만
      if (inspView === "done" && !done) return false;     // 검수 완료만
    }
    if (dept && a.dept !== dept) return false;
    if (status && a.status !== status) return false;
    // 자산명·위치는 각각 따로 좁힐 수 있다 (둘 다 넣으면 두 조건 모두 만족).
    if (nameKw && !String(a.assetName || "").toLowerCase().includes(nameKw)) return false;
    if (locKw && !String(a.location || "").toLowerCase().includes(locKw)) return false;
    const cost = a.acquireCost || 0;
    if (cost < minCost || cost > maxCost) return false;
    if (!kw) return true;
    const hay = [a.assetName, a.assetNumber, a.labelSticker, a.location, a.manager, a.dept, a.org, a.maker, a.model, a.spec].join(" ").toLowerCase();
    return hay.includes(kw);
  });
  sortFiltered();
  // 검색/필터를 바꿀 때만 1페이지로. 데이터 새로고침(실시간 동기화 등, applyFilter(false))은 보던 페이지 유지.
  // (이벤트 리스너로 호출되면 첫 인자가 Event 객체이므로 !== false 로 판별)
  if (resetPage !== false) currentPage = 1;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;
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
    syncBulkUI();
    return;
  }
  emptyMsg.hidden = true;
  const pending = pendingTargetSet();
  const showInsp = currentGroup !== GROUP_ELEC; // 검수는 2025년도 자산 전용 (전자 제외)
  const tableEl = document.querySelector(".asset-table");
  if (tableEl) { tableEl.classList.toggle("hide-insp", !showInsp); tableEl.classList.toggle("hide-check", !isAdmin); }
  const roundFilter = document.getElementById("inspRoundFilter");
  if (roundFilter) { roundFilter.hidden = !showInsp; roundFilter.value = inspRound; }
  const uninspBtn = document.getElementById("uninspBtn");
  if (uninspBtn) {
    uninspBtn.hidden = !showInsp;
    uninspBtn.textContent = `🔍 미검수`;
    uninspBtn.classList.toggle("active", showInsp && inspView === "uninsp");
  }
  const inspDoneBtn = document.getElementById("inspDoneBtn");
  if (inspDoneBtn) {
    inspDoneBtn.hidden = !showInsp;
    inspDoneBtn.textContent = `✅ 검수 완료`;
    inspDoneBtn.classList.toggle("active", showInsp && inspView === "done");
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
    const thumbSrc = a.thumbUrl || a.imageUrl; // 목록은 가벼운 썸네일 우선(없으면 원본)
    const thumb = thumbSrc ? `<img class="thumb" src="${thumbSrc}" alt="" loading="lazy" decoding="async" />` : "";
    // 모바일 카드에서 빈 값은 숨기기 위한 표식(m-empty). 데스크톱 표에는 영향 없음.
    const labelHtml = labelCell(a);
    const mE = (v) => (!String(v == null ? "" : v).trim() ? " m-empty" : "");
    return `
    <tr>
      <td class="col-check"><input type="checkbox" class="row-check" data-id="${esc(a.id)}" ${selectedIds.has(String(a.id)) ? "checked" : ""} /></td>
      <td class="cell-name" title="${esc(a.assetName)}"><div class="name-wrap">${thumb}<span>${esc(a.assetName)} ${tag}</span></div></td>
      <td class="cell-num" data-label="자산번호">${esc(a.assetNumber)}</td>
      <td data-label="라벨" class="${labelHtml === "-" ? "m-empty" : ""}">${labelHtml}</td>
      <td class="cell-loc${mE(a.location)}" data-label="위치" title="${esc(a.location)}">${esc(val(a.location))}</td>
      <td data-label="사용자" class="${mE(a.manager).trim()}">${esc(val(a.manager))}</td>
      <td data-label="부서" class="${mE(a.dept).trim()}">${esc(val(a.dept))}</td>
      <td data-label="상태">${statusBadge(a.status)}</td>
      <td data-label="등재일">${esc(val(a.regDate))}</td>
      <td class="col-insp cell-insp${li ? "" : " m-empty"}" data-label="검수일">${inspDate}</td>
      <td class="cell-actions">
        <button class="btn-mini btn-view" data-id="${esc(a.id)}">상세</button>
        <button class="btn-mini btn-edit" data-id="${esc(a.id)}">${isAdmin ? "수정" : "수정요청"}</button>
        <button class="btn-mini btn-del" data-id="${esc(a.id)}">${isAdmin ? "삭제" : "삭제요청"}</button>
      </td>
    </tr>`;
  }).join("");
  renderPagination();
  syncBulkUI();
}

// ===== 일괄 수정 (관리자) =====
function syncBulkUI() {
  const bar = document.getElementById("bulkBar");
  if (!bar) return;
  if (!isAdmin) { bar.hidden = true; selectedIds.clear(); return; }
  // 화면에서 지워진(필터에 없는) 선택은 정리
  const validIds = new Set(filtered.map((a) => String(a.id)));
  selectedIds.forEach((id) => { if (!validIds.has(id)) selectedIds.delete(id); });
  document.getElementById("bulkCount").textContent = selectedIds.size;
  bar.hidden = selectedIds.size === 0;
  // 현재 페이지 전체선택 체크 상태
  const start = (currentPage - 1) * PER_PAGE;
  const pageIds = filtered.slice(start, start + PER_PAGE).map((a) => String(a.id));
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const cap = document.getElementById("checkAllPage");
  if (cap) cap.checked = allChecked;
}
function toggleSelect(id, on) {
  id = String(id);
  if (on) selectedIds.add(id); else selectedIds.delete(id);
  syncBulkUI();
}
function toggleSelectPage(on) {
  const start = (currentPage - 1) * PER_PAGE;
  filtered.slice(start, start + PER_PAGE).forEach((a) => { if (on) selectedIds.add(String(a.id)); else selectedIds.delete(String(a.id)); });
  render();
}
// 검색결과(모든 페이지) 전체를 선택해 바로 일괄 수정 — 페이지별로 체크할 필요 없음
function openBulkEditAll() {
  if (!isAdmin) return;
  if (!filtered.length) { alert("먼저 상세 필터·검색으로 자산을 찾은 뒤 사용하세요."); return; }
  selectedIds = new Set(filtered.map((a) => String(a.id)));
  render();
  openBulkEdit();
}
function openBulkEdit() {
  if (!isAdmin || selectedIds.size === 0) return;
  document.getElementById("bulkEditError").hidden = true;
  document.getElementById("bulkProgress").hidden = true;
  document.getElementById("bulkEditTarget").innerHTML = `선택한 <b>${selectedIds.size}개</b> 자산을 한 번에 수정합니다.`;
  const bd = document.getElementById("bulk-dept"); bd.innerHTML = deptOptionsHtml(""); bd.value = "";
  // 초기화: 모든 변경 체크 해제 + 입력 비활성화
  document.querySelectorAll('#bulkEditForm input[data-bulk]').forEach((c) => {
    c.checked = false;
    const input = document.getElementById("bulk-" + c.dataset.bulk);
    if (input) { input.disabled = true; if (input.tagName === "INPUT") input.value = ""; }
  });
  // 자산 사진 추가 섹션 초기화
  bulkEditPhotoData = "";
  document.getElementById("bulk-photo-on").checked = false;
  document.getElementById("bulk-photo-fields").hidden = true;
  document.getElementById("bulk-photo-replace").checked = false;
  document.getElementById("bulk-photo-input").value = "";
  document.getElementById("bulk-photo-preview").innerHTML = "";
  // 검수 처리 섹션 초기화
  document.getElementById("bulk-insp-on").checked = false;
  document.getElementById("bulk-insp-fields").hidden = true;
  const bperiod = document.getElementById("bulk-insp-period");
  bperiod.innerHTML = Array.from({ length: 8 }, (_, i) => `${i + 1}회차`).map((o) => `<option value="${o}">${o}</option>`).join("");
  bperiod.value = inspRound || "1회차";
  document.getElementById("bulk-insp-inspector").value = myProfile?.name || "";
  const baffil = document.getElementById("bulk-insp-affil");
  baffil.innerHTML = deptOptionsHtml(myProfile?.affiliation || "");
  baffil.value = myProfile?.affiliation || "";
  show("bulkEditOverlay");
}
let bulkEditPhotoData = ""; // 일괄 수정에서 추가할 자산 사진(base64)
// 한 자산에 '필드 수정 + 검수 기록'을 한 번의 저장으로 반영(따로 저장하면 서로 덮어써서 유실됨)
async function bulkApplyOne(a, fields, insp) {
  const id = String(a.id);
  const kind = id.startsWith("u") ? "added" : "override";
  const existing = overlay.find((o) => String(o.id) === id && o.kind === kind)?.data || {};
  const data = { ...existing, ...cleanFields(fields) };
  if (insp) {
    const rec = { id: "i" + Date.now() + Math.floor(Math.random() * 1000), periodType: "회차", period: insp.period, inspector: insp.inspector, affiliation: insp.affiliation, photo: "", checkedAt: new Date().toISOString() };
    const cur = Array.isArray(a.inspections) ? a.inspections : [];
    data.inspections = [...cur, rec];
  }
  const { error } = await sb.from("assets").upsert({ id, kind, data, updated_at: new Date().toISOString() });
  if (error) throw error;
  const notes = [];
  if (Object.keys(fields).length) notes.push("일괄 수정");
  if (insp) notes.push(`검수 확인 · ${insp.period} · 확인자: ${insp.inspector}${insp.affiliation ? ` (${insp.affiliation})` : ""}`);
  await logHistory({ asset_id: id, asset_name: a.assetName, action: insp ? "inspect" : "update", before: null, after: null, requester: insp ? (insp.inspector + (insp.affiliation ? ` (${insp.affiliation})` : "")) : "", note: notes.join(" · ") });
}
async function applyBulkEdit() {
  if (!isAdmin) return;
  const fields = {};
  document.querySelectorAll('#bulkEditForm input[data-bulk]:checked').forEach((c) => {
    const key = c.dataset.bulk;
    fields[key] = document.getElementById("bulk-" + key).value.trim();
  });
  const errEl = document.getElementById("bulkEditError");
  errEl.hidden = true;
  // 검수 처리 옵션
  const inspOn = document.getElementById("bulk-insp-on").checked;
  let insp = null;
  if (inspOn) {
    const period = document.getElementById("bulk-insp-period").value.trim();
    const inspector = document.getElementById("bulk-insp-inspector").value.trim();
    const affiliation = document.getElementById("bulk-insp-affil").value.trim();
    if (!inspector) { errEl.textContent = "검수자 이름을 입력해주세요."; errEl.hidden = false; return; }
    insp = { period, inspector, affiliation };
  }
  // 자산 사진 추가 옵션
  const photoOn = document.getElementById("bulk-photo-on").checked;
  const photoReplace = document.getElementById("bulk-photo-replace").checked;
  if (photoOn && !bulkEditPhotoData) { errEl.textContent = "추가할 자산 사진을 선택해주세요."; errEl.hidden = false; return; }
  if (Object.keys(fields).length === 0 && !inspOn && !photoOn) { errEl.textContent = "변경할 항목을 체크하거나 사진/검수 처리를 선택해주세요."; errEl.hidden = false; return; }
  const ids = [...selectedIds];
  const btn = document.getElementById("bulkEditSave");
  const prog = document.getElementById("bulkProgress");
  btn.disabled = true; prog.hidden = false;
  // 사진은 딱 한 번만 업로드해 URL을 모든 자산에 붙인다(용량·속도 절약).
  let photoUrl = "", thumbUrl = "";
  if (photoOn) {
    prog.textContent = "사진 올리는 중…";
    try {
      photoUrl = await uploadMedia(bulkEditPhotoData, "photos");
      try { thumbUrl = await uploadMedia(await resizeDataUrl(bulkEditPhotoData, 240, 0.55), "thumbs"); } catch {}
    } catch (e) { console.warn("사진 업로드 실패 — base64로 진행:", e?.message || e); photoUrl = bulkEditPhotoData; }
  }
  let done = 0, failed = 0;
  for (const id of ids) {
    prog.textContent = `적용 중… ${done + failed + 1}/${ids.length}`;
    try {
      const a = findAsset(id);
      if (!a) { failed++; continue; }
      const perFields = { ...fields };
      if (photoOn) {
        const existing = photosOf(a).filter((u) => u && u !== photoUrl);
        perFields.imageUrls = photoReplace ? [photoUrl] : [photoUrl, ...existing].slice(0, MAX_PHOTOS);
        perFields.imageUrl = photoUrl;
        perFields.thumbUrl = thumbUrl || "";
      }
      if (insp || photoOn) await bulkApplyOne(a, perFields, insp);   // 필드+사진+검수 한 번에
      else await applyUpdate(id, perFields, { note: "일괄 수정" });    // 필드만 (기존 로직)
      done++;
    } catch (e) { console.error("일괄 수정 실패:", id, e); failed++; }
  }
  btn.disabled = false;
  hide("bulkEditOverlay");
  selectedIds.clear();
  await reloadAll(); rerender();
  const extra = [photoOn ? "사진" : "", insp ? "검수" : ""].filter(Boolean).join("·");
  alert(`일괄 처리 완료: ${done}건 적용${failed ? `, ${failed}건 실패` : ""}${extra ? ` (${extra} 포함)` : ""}`);
}
// ===== 검색결과에 사진 1장 일괄 적용 (관리자) =====
let bulkPhotoData = ""; // 선택한 사진(base64)
function openBulkPhoto() {
  if (!requireLogin()) return;
  if (!filtered.length) { alert("먼저 상세 필터·검색으로 자산을 찾은 뒤 사용하세요."); return; }
  bulkPhotoData = "";
  document.getElementById("bulkPhotoError").hidden = true;
  document.getElementById("bulkPhotoProgress").hidden = true;
  document.getElementById("bulkPhotoReplace").checked = false;
  document.getElementById("bulkPhotoInput").value = "";
  document.getElementById("bulkPhotoPreview").innerHTML = "";
  document.getElementById("bulkPhotoApply").disabled = true;
  const verb = isAdmin ? "적용합니다" : "적용을 요청합니다";
  document.getElementById("bulkPhotoTarget").innerHTML = `현재 <b>${filtered.length}개</b>의 검색된 자산에 사진 1장을 ${verb}.`;
  // 비관리자 안내
  const note = document.getElementById("bulkPhotoReqNote");
  if (note) note.hidden = isAdmin;
  show("bulkPhotoOverlay");
}
async function handleBulkPhotoPick(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) { alert("이미지(사진)만 사용할 수 있습니다."); return; }
  try {
    bulkPhotoData = await compressImage(file, 1000, 0.65);
    document.getElementById("bulkPhotoPreview").innerHTML = `<img src="${bulkPhotoData}" alt="선택한 사진" />`;
    updateBulkPhotoApply();
  } catch (e) {
    console.error("사진 처리 오류:", e);
    alert("사진 처리 중 문제가 발생했습니다. 다시 시도해 주세요.");
  }
}
function updateBulkPhotoApply() {
  const btn = document.getElementById("bulkPhotoApply");
  btn.disabled = !bulkPhotoData;
  btn.textContent = isAdmin ? `✅ ${filtered.length}개에 적용` : `✅ ${filtered.length}개에 적용 요청`;
}
async function applyBulkPhoto() {
  if (!requireLogin() || !bulkPhotoData) return;
  const targets = filtered.slice();
  const ids = targets.map((a) => String(a.id));
  if (!ids.length) return;
  const replace = document.getElementById("bulkPhotoReplace").checked;
  const how = replace ? "‘이 사진만’으로 덮어씁니다" : "대표 사진으로 추가합니다";
  const confirmMsg = isAdmin
    ? `검색된 ${ids.length}개 자산에 이 사진을 ${how}.\n계속할까요?`
    : `검색된 ${ids.length}개 자산에 이 사진 적용을 요청합니다. (${how})\n관리자 승인 후 반영됩니다. 계속할까요?`;
  if (!confirm(confirmMsg)) return;
  const errEl = document.getElementById("bulkPhotoError");
  const prog = document.getElementById("bulkPhotoProgress");
  const btn = document.getElementById("bulkPhotoApply");
  errEl.hidden = true;
  btn.disabled = true; prog.hidden = false;
  // 사진은 딱 한 번만 업로드하고, 그 URL을 모든 자산(또는 요청)에 붙인다(용량·속도 절약).
  prog.textContent = "사진 올리는 중…";
  let photoUrl = bulkPhotoData, thumbUrl = "";
  try {
    photoUrl = await uploadMedia(bulkPhotoData, "photos");
    try { thumbUrl = await uploadMedia(await resizeDataUrl(bulkPhotoData, 240, 0.55), "thumbs"); } catch {}
  } catch (e) {
    console.warn("사진 업로드 실패 — base64로 진행:", e?.message || e);
    photoUrl = bulkPhotoData; // 업로드 실패 시 base64로라도 적용
  }
  let done = 0, failed = 0;
  for (const a of targets) {
    const id = String(a.id);
    prog.textContent = `${isAdmin ? "적용" : "요청"} 중… ${done + failed + 1}/${ids.length}`;
    try {
      const existing = photosOf(a).filter((u) => u && u !== photoUrl);
      const merged = replace ? [photoUrl] : [photoUrl, ...existing].slice(0, MAX_PHOTOS);
      const fields = { imageUrls: merged, imageUrl: photoUrl, thumbUrl: thumbUrl || "" };
      if (isAdmin) {
        // 이미 URL이므로 재업로드 없음. 대표사진·썸네일도 함께 지정.
        await applyUpdate(id, fields, { note: "사진 일괄 적용" });
      } else {
        // 비관리자: 자산별 '수정 요청'으로 접수 → 관리자 승인 시 반영
        await submitRequest({
          action: "update", target_id: id,
          payload: { ...fields, assetName: a.assetName, assetNumber: a.assetNumber },
          note: "사진 일괄 적용 요청",
        });
      }
      done++;
    } catch (e) { console.error("사진 일괄 적용 실패:", id, e); failed++; }
  }
  btn.disabled = false;
  hide("bulkPhotoOverlay");
  bulkPhotoData = "";
  await reloadAll(); rerender();
  if (isAdmin) alert(`사진 일괄 적용 완료: ${done}건${failed ? ` · ${failed}건 실패` : ""}`);
  else alert(`사진 일괄 적용 요청 접수: ${done}건${failed ? ` · ${failed}건 실패` : ""}. 관리자 승인 후 반영됩니다.`);
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
    ["메뉴", groupLabel(groupOf(a))],
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
    html += `<div class="insp-empty">아직 검수 기록이 없습니다. 상단 <b>‘📷 검수’</b> 버튼으로 라벨을 촬영하거나, 이 상세 화면의 <b>‘검수’</b> 버튼으로 검수하세요.</div>`;
  } else {
    html += `<table class="insp-table"><thead><tr><th>구분</th><th>검수사진</th><th>검수일시</th><th>확인자</th><th>소속</th>${isAdmin ? "<th></th>" : ""}</tr></thead><tbody>`;
    html += list.slice().reverse().map((ins) => `
      <tr>
        <td><span class="insp-ok">✔</span> ${esc(ins.period || "-")}</td>
        <td>${ins.photo ? `<img src="${ins.photo}" class="insp-thumb" alt="검수 사진" />` : "-"}</td>
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
  currentLabelFile = ""; currentLabelFileName = ""; currentLabelPreview = ""; currentLabelRaw = "";
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
  currentLabelRaw = ""; // 새 파일 선택 시 이전 원본 초기화
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
      currentLabelRaw = e.target.result;  // 원본(고해상도) 보관 → QR/OCR 인식에 사용
      const img = new Image();
      img.onload = () => {
        const MAX = 1280; // 라벨 글자 가독성을 위해 제품 사진보다 크게
        let { width, height } = img;
        if (width > MAX || height > MAX) { const r = Math.min(MAX / width, MAX / height); width = Math.round(width * r); height = Math.round(height * r); }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        currentLabelFile = encodeCanvas(canvas, 0.85);
        currentLabelFileName = file.name.replace(/\.[^.]+$/, "") + (canEncodeWebp() ? ".webp" : ".jpg");
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
// 캔버스를 base64로 인코딩. WebP를 지원하면 WebP로(같은 화질에 ~30% 작음),
// 아니면(구형 사파리 등) JPEG로 폴백한다. → 저장공간·전송량 동시 절감.
let _canWebp;
function canEncodeWebp() {
  if (_canWebp === undefined) {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      _canWebp = c.toDataURL("image/webp").startsWith("data:image/webp");
    } catch { _canWebp = false; }
  }
  return _canWebp;
}
function encodeCanvas(canvas, quality) {
  return canEncodeWebp() ? canvas.toDataURL("image/webp", quality) : canvas.toDataURL("image/jpeg", quality);
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
        resolve(encodeCanvas(canvas, quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
// data:URL(base64) 이미지를 작게 리사이즈한 base64를 반환 (목록용 썸네일 생성).
function resizeDataUrl(dataUrl, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > max || height > max) { const r = Math.min(max / width, max / height); width = Math.round(width * r); height = Math.round(height * r); }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(encodeCanvas(canvas, quality));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
const MAX_PHOTOS = 8; // 자산당 물품 사진 최대 장수 (저장공간 보호)
async function handlePhotoUpload(files) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return;
  if (list.some((f) => !f.type.startsWith("image/"))) {
    showFormError("이미지 파일만 업로드할 수 있습니다.");
  }
  const imgs = list.filter((f) => f.type.startsWith("image/"));
  for (const f of imgs) {
    if (currentPhotos.length >= MAX_PHOTOS) { showFormError(`물품 사진은 최대 ${MAX_PHOTOS}장까지 등록할 수 있습니다.`); break; }
    try {
      const data = await compressImage(f, 800, 0.62); // 저장공간 절약(무료 용량 연장)
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
// 인식률을 높이기 위해 그레이스케일 + 대비 보정 후 캔버스로 변환. rotate(0/90/180/270)로 회전도 지원.
function preprocessOcrImage(dataUrl, max, min, rotate = 0) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.width, img.height);
      // max/min 인자로 해상도 조절(1차 저해상도=빠름, 2차 고해상도=정확).
      const MAX = max || 2400, MIN = (min === undefined ? 1800 : min);
      const s = longest > MAX ? MAX / longest : (MIN && longest < MIN ? MIN / longest : 1);
      const w0 = Math.round(img.width * s), h0 = Math.round(img.height * s);
      const rot = ((rotate % 360) + 360) % 360;
      const swap = rot === 90 || rot === 270;
      const w = swap ? h0 : w0, h = swap ? w0 : h0;   // 90/270도는 가로세로 뒤바뀜
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      // 흑백+대비를 GPU 가속 필터로 처리(픽셀 루프보다 훨씬 빠름). 미지원 브라우저는 수동 처리로 폴백.
      let filtered = false;
      try { ctx.filter = "grayscale(1) contrast(1.35)"; filtered = ctx.filter && ctx.filter !== "none"; } catch {}
      if (rot) { ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(rot * Math.PI / 180); ctx.drawImage(img, -w0 / 2, -h0 / 2, w0, h0); ctx.restore(); }
      else ctx.drawImage(img, 0, 0, w, h);
      if (!filtered) {
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
      }
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
// 캔버스에서 QR 디코드
function _qrFromCanvas(canvas) {
  try {
    const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const r = window.jsQR(d.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
    return r ? r.data : null;
  } catch { return null; }
}
// 캔버스를 흑백 이진화(평균 임계값)해 QR 인식률을 높인다. (그림자·저대비 라벨 대응)
function _binarizeCanvas(canvas) {
  try {
    const ctx = canvas.getContext("2d");
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const p = d.data;
    let sum = 0;
    for (let i = 0; i < p.length; i += 4) { const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] = p[i + 1] = p[i + 2] = g; sum += g; }
    const th = sum / (p.length / 4);
    for (let i = 0; i < p.length; i += 4) { const v = p[i] > th ? 255 : 0; p[i] = p[i + 1] = p[i + 2] = v; }
    ctx.putImageData(d, 0, 0);
  } catch {}
  return canvas;
}
// QR코드를 이미지에서 읽어 문자열 반환 (없으면 null).
// 전체 이미지 + QR이 있을 만한 여러 영역을 배율·이진화까지 바꿔가며 시도해 인식률을 높인다.
async function decodeLabelQR(dataUrl) {
  try { await ensureJsQR(); } catch { return null; }
  if (!window.jsQR) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const crop = (sx, sy, sw, sh, dw) => {
        sw = Math.max(1, Math.round(sw)); sh = Math.max(1, Math.round(sh));
        dw = Math.max(1, Math.round(dw));
        const dh = Math.round(dw * sh / sw);
        const c = document.createElement("canvas"); c.width = dw; c.height = Math.max(1, dh);
        c.getContext("2d").drawImage(img, Math.round(sx), Math.round(sy), sw, sh, 0, 0, dw, dh);
        return c;
      };
      // 시도할 영역: 전체 + 라벨에서 QR이 있을 만한 부분 영역들
      const regions = [
        [0, 0, W, H],                                   // 전체
        [W * 0.45, H * 0.40, W * 0.55, H * 0.60],       // 오른쪽 아래
        [W * 0.45, 0, W * 0.55, H * 0.55],              // 오른쪽 위
        [0, H * 0.45, W * 0.55, H * 0.55],              // 왼쪽 아래
        [W * 0.25, H * 0.25, W * 0.50, H * 0.50],       // 중앙
      ];
      const scales = [2400, 1600];
      for (const [sx, sy, sw, sh] of regions) {
        for (const dw of scales) {
          const canvas = crop(sx, sy, sw, sh, dw);
          let out = _qrFromCanvas(canvas);           // 원본 그대로
          if (!out) out = _qrFromCanvas(_binarizeCanvas(canvas)); // 이진화 후 재시도
          if (out) { resolve(out); return; }
        }
      }
      resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
// QR 문자열에서 채울 수 있는 값(주로 자산코드) 추출
function fillFromQR(qr) {
  if (!qr) return [];
  const filled = [];
  const code = (String(qr).replace(/[\s-]/g, "").match(/\d{16,24}/) || [])[0];
  if (code) {
    const el = document.getElementById("f-assetNumber");
    if (el && !el.value.trim()) { el.value = code; filled.push("자산코드"); }
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
  const src = currentLabelRaw || currentLabelFile;  // 원본(고해상도)이 있으면 그것으로 인식
  let worker = null;
  try {
    // 1) QR코드 먼저 (가장 정확·빠름)
    setOcrStatus("QR코드를 확인하는 중…", "load");
    lastQrText = await decodeLabelQR(src) || "";
    if (lastQrText) filled.push(...fillFromQR(lastQrText));

    // 2) 글자 인식(OCR)으로 나머지 항목 채우기
    await ensureTesseract();
    if (!window.Tesseract) throw new Error("Tesseract 미로드");
    const image = await preprocessOcrImage(src);
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

// ===== 사진촬영 검수 (카메라로만 검수 가능) =====
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
let batchSuppressScan = false; // 여러 장 검수 중에는 단일 검수용 큰 로딩 오버레이를 띄우지 않는다(배치 전용 진행률 사용).
function setScanLoading(msg, show) {
  const el = document.getElementById("scanLoading");
  if (!el) return;
  if (batchSuppressScan) { el.hidden = true; return; } // 배치 진행 중엔 항상 숨김
  if (msg) { const m = document.getElementById("scanLoadingMsg"); if (m) m.textContent = msg; }
  el.hidden = !show;
}
// 두 문자열의 편집 거리(Levenshtein) — 근접 매칭용
function _editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}
// OCR에서 서로 자주 혼동되는 숫자쌍(인쇄 라벨 기준). 정렬한 2글자 키로 저장.
//  3↔8 이 대표적이고, 8을 중심으로 0·5·6·9, 그리고 1↔7 등이 흔하다.
const OCR_CONFUSE_PAIRS = new Set(["38", "08", "58", "68", "89", "06", "56", "17"]);
const isConfusablePair = (a, b) => OCR_CONFUSE_PAIRS.has(a < b ? a + b : b + a);
// 인식 숫자열이 '혼동 가능한 숫자쌍으로만' 어긋나는 실제 자산을 찾는다.
// 예) 3을 8로 오독한 경우처럼, 틀린 자리가 모두 알려진 혼동쌍이고 유일한 후보면 그 자산으로 보정.
function confusableAssetMatch(target, norm, pool) {
  if (target.length < 16 || target.length > 24 || !/^\d+$/.test(target)) return null;
  let best = null, bestMis = Infinity, tie = false;
  for (const a of (pool || assets)) {
    const n = norm(a.assetNumber);
    if (n.length !== target.length || !/^\d+$/.test(n)) continue;
    let mis = 0, ok = true;
    for (let i = 0; i < n.length; i++) {
      if (n[i] === target[i]) continue;
      if (!isConfusablePair(n[i], target[i]) || ++mis > 4) { ok = false; break; }
    }
    if (!ok || mis === 0) continue;
    if (mis < bestMis) { bestMis = mis; best = a; tie = false; }
    else if (mis === bestMis) tie = true;
  }
  // 유일하게 가장 적게 어긋난 후보만 인정 (동점이면 애매하므로 보정하지 않음)
  return best && !tie ? best : null;
}
// 자산번호를 정규화(공백·하이픈 제거)해 비교하며 자산을 찾는다.
// pool: 검색 대상 자산 배열(기본 전체). 일괄 검수의 '위치·자산명 필터'로 좁힌 후보를 넘길 수 있다.
function findAssetByNumber(code, pool) {
  const list = pool || assets;
  const norm = (s) => String(s || "").replace(/[\s-]/g, "");
  const target = norm(code);
  if (!target) return null;
  // 1) 정확 일치
  let hit = list.find((a) => norm(a.assetNumber) === target);
  if (hit) return hit;
  // 2) 부분 포함 (인식 자릿수 오차 대비)
  hit = list.find((a) => { const n = norm(a.assetNumber); return n.length >= 8 && (n.includes(target) || target.includes(n)); });
  if (hit) return hit;
  // 3) 혼동쌍 보정: 3↔8 처럼 OCR이 헷갈리는 숫자로만 어긋난 유일한 자산이면 그것으로 인정.
  hit = confusableAssetMatch(target, norm, list);
  if (hit) return hit;
  // 4) 근접 매칭: 실제 등록된 자산번호 중 편집거리가 최소이면서 '유일하게 가까운' 후보만 채택.
  //    (연속 번호는 1자리 차이라, 애매하면 채택하지 않아 오인식을 막는다.)
  if (target.length >= 16 && target.length <= 24) {
    let best = null, bestD = Infinity, secondD = Infinity;
    for (const a of list) {
      const n = norm(a.assetNumber);
      if (n.length < 16) continue;
      const d = _editDistance(target, n);
      if (d < bestD) { secondD = bestD; bestD = d; best = a; }
      else if (d < secondD) secondD = d;
    }
    // 최소거리 2 이하 & 2등과 2 이상 차이 → 확실한 승자만 인정
    if (best && bestD <= 2 && (secondD - bestD) >= 2) return best;
  }
  return null;
}
// 인식 텍스트에서 자산코드(숫자 20개) 후보들을 뽑는다.
// 자산코드는 대부분 한 줄에 있으므로, 줄 단위로 숫자 덩어리를 만들어
// '구입일·금액' 같은 다른 숫자와 붙지 않게 한다. 20자리를 최우선으로 정렬해 반환.
function extractAssetCodes(text) {
  if (!text) return [];
  const runs = [];
  String(text).split(/[\r\n]+/).forEach((line) => {
    const cleaned = line.replace(/[.\s-]/g, "");           // 한 줄 안의 공백·점·하이픈만 제거
    const m = cleaned.match(/\d{10,}/g);                    // 10자리 이상 숫자 덩어리만 후보
    if (m) runs.push(...m);
  });
  const cand = runs.filter((r) => r.length >= 16 && r.length <= 24);
  // 20자리(정확 길이) 먼저, 그다음 길이가 긴 순
  cand.sort((a, b) => (b.length === 20) - (a.length === 20) || b.length - a.length);
  return [...new Set(cand)];
}
// 2024년도 자산번호(예: G20250019-0001)처럼 '문자+숫자(+하이픈)' 형식 후보를 뽑는다.
function extractAlnumCodes(text) {
  if (!text) return [];
  const runs = [];
  String(text).split(/[\r\n]+/).forEach((line) => {
    const cleaned = line.toUpperCase().replace(/[.\s]/g, ""); // 대문자화, 공백·점만 제거(하이픈 유지)
    const m = cleaned.match(/[A-Z0-9][A-Z0-9-]{5,}/g);        // 6자 이상 영숫자 덩어리
    if (m) runs.push(...m);
  });
  // 문자와 숫자가 모두 있는 것만(순수 숫자는 위 숫자 경로에서 처리)
  return [...new Set(runs)].filter((r) => /[A-Z]/.test(r) && /\d/.test(r));
}
// 2024 메뉴 자산 중에서 코드(문자+숫자)로 자산을 찾는다. 정확→부분포함→근접(유일승자) 순.
function findAsset2024ByCode(code, poolArg) {
  const norm = (s) => String(s || "").toUpperCase().replace(/[\s-]/g, "");
  const target = norm(code);
  if (target.length < 6) return null;
  const pool = (poolArg || assets).filter((a) => groupOf(a) === GROUP_PAST);
  let hit = pool.find((a) => norm(a.assetNumber) === target);
  if (hit) return hit;
  hit = pool.find((a) => { const n = norm(a.assetNumber); return n.length >= 6 && (n.includes(target) || target.includes(n)); });
  if (hit) return hit;
  // 근접 매칭: 편집거리 최소이면서 2등과 2 이상 차이나는 확실한 승자만
  let best = null, bestD = Infinity, secondD = Infinity;
  for (const a of pool) {
    const n = norm(a.assetNumber);
    if (Math.abs(n.length - target.length) > 3) continue;
    const d = _editDistance(target, n);
    if (d < bestD) { secondD = bestD; bestD = d; best = a; }
    else if (d < secondD) secondD = d;
  }
  if (best && bestD <= 2 && (secondD - bestD) >= 2) return best;
  return null;
}
// 단일 자산코드 (라벨 등록 폼 자동채우기용)
function extractAssetCode(text) { return extractAssetCodes(text)[0] || null; }
// 촬영 사진에서 자산코드(20자리)를 인식한다.
// 자산코드 인식용 Tesseract 워커를 '한 번만' 만들어 세션 내내 재사용한다.
// (검수는 자산을 연달아 촬영하므로, 매번 워커를 새로 만들면 WASM·언어 초기화 비용이 반복돼 느리다.)
// 자산코드는 숫자 20자리뿐이라 무거운 한글 모델 없이 영문(eng)+숫자 화이트리스트만 쓴다 → 로드·인식 모두 빠름.
let _numOcrWorkerPromise = null;
let _numOcrProgress = null; // 진행률 콜백(스캔마다 교체)
async function getNumberOcrWorker() {
  await ensureTesseract();
  if (!window.Tesseract || typeof Tesseract.createWorker !== "function") return null;
  if (!_numOcrWorkerPromise) {
    _numOcrWorkerPromise = (async () => {
      const w = await Tesseract.createWorker("eng", 1, {
        // fast 언어모델(약 2MB) — 표준(약 11MB)보다 다운로드·초기화·인식이 모두 빠르다. 숫자 인식엔 충분.
        langPath: "https://tessdata.projectnaptha.com/4.0.0_fast",
        logger: (m) => { if (_numOcrProgress) _numOcrProgress(m); },
      });
      try { await w.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "0123456789" }); } catch {}
      return w;
    })().catch((e) => { _numOcrWorkerPromise = null; throw e; });
  }
  return _numOcrWorkerPromise;
}
// OCR 워커를 미리 초기화(예열)해 둔다. 검수 안내창을 여는 순간 백그라운드로 준비 →
// 사용자가 안내를 읽고 카메라를 조준하는 사이 초기화가 끝나, 첫 촬영 후 대기 시간이 사라진다.
function warmupNumberOcr() { try { getNumberOcrWorker().catch(() => {}); } catch {} }
// QR은 읽지 않고, 라벨에 인쇄된 '자산코드 20자리'를 글자 인식(OCR)으로 읽는다.
// 지금 보고 있는 메뉴에 맞는 인식을 1차부터 사용해 한 번에 끝낸다(빠름+정확).
//  · 2025/전자: 숫자 전용   · 2024: 문자+숫자(G형식)
// 1차에서 못 맞추면(형식 애매 등) 고해상도 넓은 인식으로 한 번만 정밀 재시도.
const OCR_WL_DIGIT = "0123456789";
const OCR_WL_ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-";
async function recognizeAssetNumber(dataUrl, mode, pool, tryRotate = false) {
  const alnumMode = mode === "alnum";
  const candidates = [];
  const addFrom = (text) => { extractAssetCodes(text).forEach((c) => { if (!candidates.includes(c)) candidates.push(c); }); };
  const matched = () => candidates.find((c) => findAssetByNumber(c, pool));
  let alnumHit = null; // 2024 형식(G20250019-0001 등) 매칭 자산
  const tryAlnum = (text) => { if (alnumHit) return; for (const c of extractAlnumCodes(text)) { const a = findAsset2024ByCode(c, pool); if (a) { alnumHit = a; break; } } };
  const done = () => !!matched() || !!alnumHit;
  try {
    setScanLoading("글자를 인식하는 중입니다… 처음 실행은 몇 초 걸릴 수 있어요.", true);
    _numOcrProgress = (m) => { if (m.status === "recognizing text") setScanLoading(`자산 인식 중… ${Math.round((m.progress || 0) * 100)}%`, true); };
    const worker = await getNumberOcrWorker();
    if (worker) {
      // 1차: 메뉴에 맞는 화이트리스트 + 중간 해상도 (한 번에 끝나도록)
      try { await worker.setParameters({ tessedit_char_whitelist: alnumMode ? OCR_WL_ALNUM : OCR_WL_DIGIT }); } catch {}
      const first = await preprocessOcrImage(dataUrl, alnumMode ? 1800 : 1500, 0);
      let { data } = await worker.recognize(first);
      addFrom(data.text); if (alnumMode) tryAlnum(data.text);
      // 1차 실패 시에만 고해상도 + 넓은 인식으로 정밀 재시도 (양쪽 형식 모두)
      if (!done()) {
        setScanLoading("자산을 다시 확인하는 중…", true);
        const high = await preprocessOcrImage(dataUrl, 2400, 1800);
        try { await worker.setParameters({ tessedit_char_whitelist: "" }); } catch {}
        try {
          ({ data } = await worker.recognize(high));
          addFrom(data.text);
          tryAlnum(data.text);
        } finally {
          try { await worker.setParameters({ tessedit_char_whitelist: OCR_WL_DIGIT }); } catch {}
        }
      }
      // 회전 재시도(옵션): 사진이 옆으로/거꾸로 찍힌 경우 → 90·270·180도 돌려가며 재시도
      if (tryRotate && !done()) {
        try { await worker.setParameters({ tessedit_char_whitelist: alnumMode ? OCR_WL_ALNUM : OCR_WL_DIGIT }); } catch {}
        for (const deg of [90, 270, 180]) {
          setScanLoading("사진을 돌려서 다시 확인하는 중…", true);
          const rimg = await preprocessOcrImage(dataUrl, 2000, 1400, deg);
          ({ data } = await worker.recognize(rimg));
          addFrom(data.text); if (alnumMode) tryAlnum(data.text);
          if (done()) break;
        }
      }
    } else {
      const image = await preprocessOcrImage(dataUrl, 2400, 1800);
      let { data } = await Tesseract.recognize(image, "eng");
      addFrom(data.text); tryAlnum(data.text);
      // 회전 재시도(옵션)
      if (tryRotate) for (const deg of [90, 270, 180]) {
        if (done()) break;
        const rimg = await preprocessOcrImage(dataUrl, 2000, 1400, deg);
        ({ data } = await Tesseract.recognize(rimg, "eng"));
        addFrom(data.text); tryAlnum(data.text);
      }
    }
  } catch (e) {
    console.error("자산번호 인식 오류:", e);
  } finally {
    _numOcrProgress = null;
  }
  // 우선순위: 숫자(20자리) 매칭 → 2024 문자형식 매칭 → 표시용 후보
  const hit = matched();
  if (hit) return hit;
  if (alnumHit) return alnumHit.assetNumber; // 정확한 자산번호를 돌려주면 handleScanCapture가 그대로 매칭
  return candidates.find((c) => c.length === 20) || candidates[0] || null;
}
// 사진촬영 검수 버튼 → 촬영 안내 모달 표시
function startScanInspect() {
  if (!requireLogin()) return;
  show("scanGuideOverlay");
  warmupNumberOcr(); // 안내창을 읽는 동안 인식 엔진을 미리 준비 → 첫 촬영 대기 최소화
}
// 안내 모달의 '촬영 시작' → 실제 카메라 실행 (사용자 제스처 내에서 호출해야 카메라가 열림)
function launchScanCamera() {
  hide("scanGuideOverlay");
  warmupNumberOcr(); // (안내창을 건너뛴 경우 대비) 카메라 여는 동안에도 예열
  const input = document.getElementById("scanCameraInput");
  if (input) { input.value = ""; input.click(); }
}
// 카메라로 찍은 사진 처리: 자산번호 인식 → 매칭 자산의 검수 확인 화면 열기
async function handleScanCapture(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) { alert("이미지(사진)만 사용할 수 있습니다."); return; }
  try {
    setScanLoading("사진을 준비하는 중…", true);
    const raw = await fileToDataURL(file);                 // 인식용 원본(고해상도)
    // 지금 메뉴가 2024면 문자+숫자(G형식) 우선 인식, 아니면 숫자(20자리) 우선
    const mode = currentGroup === GROUP_PAST ? "alnum" : "digit";
    const code = await recognizeAssetNumber(raw, mode);    // 인식(%)을 먼저 — 무거운 압축은 매칭 성공 후로 미룬다
    setScanLoading("", false);
    if (!code) {
      alert("사진에서 자산번호를 인식하지 못했습니다.\n\n· 라벨의 ‘자산번호’가 잘리지 않게\n· 크고 반듯하게, 흔들림 없이 밝은 곳에서\n다시 촬영해 주세요.");
      return;
    }
    const a = findAssetByNumber(code);
    if (!a) {
      alert(`인식된 자산번호와 일치하는 자산을 찾지 못했습니다.\n\n인식된 번호: ${code}\n\n등록된 자산이 맞는지 확인 후 다시 시도해 주세요.`);
      return;
    }
    // 매칭 성공 → 이제서야 검수 기록용 사진을 압축하고 검수 확인 화면으로
    const photo = await compressImage(file, 900, 0.6);
    openInspect(a.id, photo);
  } catch (e) {
    console.error("사진촬영 검수 오류:", e);
    setScanLoading("", false);
    alert("사진 처리 중 문제가 발생했습니다. 다시 시도해 주세요.");
  }
}
// ===== 여러 장 한번에 검수 (갤러리에서 라벨 사진 여러 장 업로드 → 각 사진의 자산코드 인식 → 일괄 검수 완료) =====
// 위치·자산명 필터를 넣으면 그 범위로 좁혀 인식·매칭하므로, 한 곳에서 모아 찍은 사진을 한꺼번에 올릴 때 정확도가 높아진다.
let batchItems = [];       // { name, photoData, code, asset, status, overwrite } — status: matched|dup|already|samephoto|nomatch|error
let batchProcessing = false;
let batchFileSigs = new Set(); // 이미 올린 사진(파일) 식별자 — 같은 사진을 다시 고르면 '이미 올린 사진'으로 표시
let batchRunTotal = 0, batchRunDone = 0; // 이번 업로드 진행률(인식 X/Y)
let batchApplyMsg = ""; // 저장 진행 중/완료 안내(‘검수 저장 중… x/y’, ‘완료’)
let batchDone = false;  // 검수 신청/완료가 끝났는지 — 끝나도 창은 열어두고 결과를 보여준다
// 지금 메뉴 + (선택)위치·자산명으로 좁힌 매칭 후보 풀. 필터 결과가 비면 메뉴 전체로 되돌린다.
function buildInspectPool(locStr, nameStr) {
  const g = currentGroup;
  const menu = assets.filter((a) => groupOf(a) === g);
  const loc = String(locStr || "").trim().toLowerCase();
  const nm = String(nameStr || "").trim().toLowerCase();
  let pool = menu;
  if (loc) pool = pool.filter((a) => String(a.location || "").toLowerCase().includes(loc));
  if (nm) pool = pool.filter((a) => String(a.assetName || "").toLowerCase().includes(nm));
  return pool.length ? pool : menu;
}
// 사진 한 장에서 자산을 인식한다. 풀 우선 매칭 → 실패 시 메뉴 전체로 한 번 더 (필터 오타로 놓치지 않게).
async function recognizeAssetInPool(dataUrl, mode, pool, tryRotate = false) {
  const r = await recognizeAssetNumber(dataUrl, mode, pool, tryRotate);
  if (r && typeof r === "object") return { asset: r, code: r.assetNumber || "" };
  const code = typeof r === "string" ? r : null;
  if (!code) return { asset: null, code: null };
  const a = findAssetByNumber(code, pool) || findAsset2024ByCode(code, pool)
        || findAssetByNumber(code) || findAsset2024ByCode(code);
  return { asset: a || null, code };
}
// 인식된 자산의 상태 판정: 이번 업로드 안 중복 / 이미 이번 회차 검수됨 / 새로 검수 준비됨
function classifyBatchItem(item, asset, period) {
  const dupInBatch = batchItems.some((x) => x !== item && x.asset && String(x.asset.id) === String(asset.id));
  if (dupInBatch) return "dup";
  if (inspectedRound(asset, period)) return "already";
  return "matched";
}
function openBatchInspect() {
  if (!requireLogin()) return;
  if (currentGroup === GROUP_ELEC) { alert("여러 장 검수는 2025·2024년도 자산 메뉴에서 사용할 수 있습니다."); return; }
  batchItems = [];
  batchProcessing = false;
  batchSuppressScan = false;
  batchApplyMsg = "";
  batchDone = false;
  batchFileSigs = new Set();
  setScanLoading("", false);
  document.getElementById("batch-location").value = "";
  document.getElementById("batch-name").value = "";
  // 검수 회차: 지금 목록에서 보고 있는 회차를 기본값으로
  const bp = document.getElementById("batch-period");
  bp.innerHTML = Array.from({ length: 8 }, (_, i) => `${i + 1}회차`).map((o) => `<option value="${o}">${o}</option>`).join("");
  bp.value = inspRound || "1회차";
  document.getElementById("batch-inspector").value = myProfile?.name || "";
  const affil = myProfile?.affiliation || "";
  const bAffil = document.getElementById("batch-affil");
  bAffil.innerHTML = deptOptionsHtml(affil);
  bAffil.value = affil;
  document.getElementById("batchInspectTitle").textContent = isAdmin ? "여러 장 검수" : "여러 장 검수 요청";
  const note = document.getElementById("batchInspectNote");
  if (note) note.hidden = isAdmin;
  renderBatchList();
  show("batchInspectOverlay");
}
// 여러 장 업로드 처리: 파일마다 순서대로 인식 → 결과를 즉시 목록에 반영
async function handleBatchFiles(files) {
  const list = Array.from(files || []).filter((f) => f && f.type && f.type.startsWith("image/"));
  if (!list.length) { alert("이미지(사진) 파일을 선택해 주세요."); return; }
  if (batchProcessing) return;
  batchProcessing = true;
  batchSuppressScan = true;
  batchDone = false;      // 새 사진을 추가하면 완료 상태 해제 → 완료 버튼 다시 표시
  batchApplyMsg = "";
  setBatchBusy(true);
  warmupNumberOcr();
  let newDup = 0;
  try {
    const mode = currentGroup === GROUP_PAST ? "alnum" : "digit";
    const pool = buildInspectPool(document.getElementById("batch-location").value, document.getElementById("batch-name").value);
    const period = document.getElementById("batch-period").value;
    batchRunTotal = list.length; batchRunDone = 0;
    for (const file of list) {
      const item = { name: file.name || "사진", file, thumb: "", photoData: "", code: null, asset: null, status: "processing", overwrite: false };
      // 같은 사진(파일)을 또 고른 경우 — 인식 없이 '이미 올린 사진'으로 표시해 헷갈리지 않게 한다.
      const sig = `${file.name || ""}|${file.size || 0}|${file.lastModified || 0}`;
      if (batchFileSigs.has(sig)) {
        item.status = "samephoto";
        batchItems.push(item);
        batchRunDone++;
        renderBatchList();
        continue;
      }
      batchFileSigs.add(sig);
      batchItems.push(item);
      renderBatchList();
      try {
        const raw = await fileToDataURL(file);
        // 목록에서 어떤 사진인지 바로 알아볼 수 있도록 모든 사진에 작은 썸네일을 만든다(실패 사진 확인용).
        try { item.thumb = await resizeDataUrl(raw, 160, 0.5); } catch {}
        renderBatchList();
        const { asset, code } = await recognizeAssetInPool(raw, mode, pool);
        item.code = code || null;
        if (!asset) {
          item.status = "nomatch";
        } else {
          item.asset = asset;
          item.photoData = await compressImage(file, 900, 0.6); // 검수 증빙 사진(압축). 덮어쓰기 대비 미리 준비.
          item.status = classifyBatchItem(item, asset, period);
          if (item.status !== "matched") newDup++;
        }
      } catch (e) {
        console.error("일괄 검수 인식 오류:", e);
        item.status = "error";
      }
      batchRunDone++;
      renderBatchList();
    }
  } catch (e) {
    console.error("일괄 업로드 처리 오류:", e);
  } finally {
    // 무슨 일이 있어도 상태를 풀어 다음 업로드가 막히지 않게 한다.
    batchProcessing = false;
    batchRunTotal = 0;
    batchSuppressScan = false;
    setScanLoading("", false); // 혹시 남아있을 단일 검수 오버레이 정리
    setBatchBusy(false);
    renderBatchList();
  }
  if (newDup) {
    alert(`자산번호가 중복되는 사진이 ${newDup}장 있습니다.\n(같은 번호가 여러 장이거나, 이미 이번 회차에 검수된 자산)\n\n화면 아래 ‘⏭️ 건너뛰고 완료’ 또는 ‘🔁 덮어쓰기 완료’ 버튼으로 처리 방법을 한 번에 선택하세요.`);
  }
}
const BATCH_STATUS = {
  processing: { cls: "b-proc", label: "인식 중…" },
  matched: { cls: "b-ok", label: "검수 준비됨" },
  dup: { cls: "b-dup", label: "번호 중복" },
  already: { cls: "b-dup", label: "이미 검수됨" },
  samephoto: { cls: "b-same", label: "이미 올린 사진" },
  nomatch: { cls: "b-err", label: "인식 실패" },
  error: { cls: "b-err", label: "인식 실패" },
  done: { cls: "b-done", label: "완료" },
  savefail: { cls: "b-err", label: "저장 실패" },
};
// 이 항목이 실제로 검수 처리될지 여부 (준비됨 이거나, 중복/이미검수인데 '덮어쓰기' 선택)
function batchWillApply(it) {
  return !!it.asset && (it.status === "matched" || ((it.status === "dup" || it.status === "already") && it.overwrite));
}
function renderBatchList() {
  const grid = document.getElementById("batchInspectList");
  const summary = document.getElementById("batchInspectSummary");
  if (!grid) return;
  if (!batchItems.length) {
    grid.innerHTML = `<div class="batch-empty">아직 올린 사진이 없습니다. <b>‘사진 선택’</b>을 눌러 라벨 사진을 여러 장 한꺼번에 선택하거나,<br>이 창으로 사진을 <b>끌어다 놓으세요</b>. (PC)</div>`;
  } else {
    grid.innerHTML = batchItems.map((it, i) => {
      const failed = it.status === "nomatch" || it.status === "error";
      const s = BATCH_STATUS[it.status] || BATCH_STATUS.processing;
      const src = it.thumb || it.photoData;
      const thumb = src ? `<img src="${src}" alt="" />` : `<span class="batch-thumb-ph">${it.status === "processing" ? "…" : "🏷️"}</span>`;
      const title = it.asset ? esc(it.asset.assetName) : (it.code ? `인식: ${esc(it.code)}` : "인식되지 않음");
      const sub = it.asset ? esc(it.asset.assetNumber) : esc(it.name);
      // 실패 항목엔 재시도 버튼을 준다. (중복 건너뛰기/덮어쓰기는 하단 완료 버튼으로 한 번에 결정)
      const action = (failed && it.file) ? `<button type="button" class="batch-toggle batch-retry" data-batch-retry="${i}">↻ 재시도</button>` : "";
      const clickable = src ? ' batch-thumb-click" data-batch-preview="' + i + '"' : '"';
      return `<div class="batch-row ${s.cls}" data-idx="${i}"><div class="batch-thumb${clickable}>${thumb}</div><div class="batch-info"><div class="batch-title">${title}</div><div class="batch-sub">${sub}</div></div>${action}<div class="batch-badge">${s.label}</div></div>`;
    }).join("");
  }
  const nomatch = batchItems.filter((it) => it.status === "nomatch" || it.status === "error").length;
  const skip = batchItems.filter((it) => (it.status === "dup" || it.status === "already") && !it.overwrite).length;
  const samePhoto = batchItems.filter((it) => it.status === "samephoto").length;
  const readyN = batchItems.filter(batchWillApply).length;
  // 인식 실패가 있으면 '전체 재시도' / '전체 회전 재시도' 버튼 노출
  const failN = batchItems.filter((it) => (it.status === "nomatch" || it.status === "error") && it.file).length;
  const showRetry = failN > 0 && !batchProcessing;
  const retryAll = document.getElementById("batchRetryAllBtn");
  const retryRot = document.getElementById("batchRetryRotateBtn");
  if (retryAll) { retryAll.hidden = !showRetry; retryAll.textContent = `↻ 전체 재시도 (${failN})`; }
  if (retryRot) { retryRot.hidden = !showRetry; retryRot.textContent = `🔄 전체 회전 재시도 (${failN})`; }
  if (summary) {
    if (batchProcessing && batchRunTotal) {
      summary.innerHTML = `🔎 인식 중… <b class="batch-prog">${Math.min(batchRunDone + 1, batchRunTotal)}/${batchRunTotal}</b>`;
    } else if (batchApplyMsg) {
      summary.innerHTML = batchApplyMsg;
    } else {
      summary.innerHTML = batchItems.length
        ? `총 <b>${batchItems.length}</b>장 · 검수 준비 <b class="b-ok-t">${readyN}</b> · 건너뜀 <b>${skip}</b>${samePhoto ? ` · 이미 올림 <b>${samePhoto}</b>` : ""} · 실패 <b class="b-err-t">${nomatch}</b>`
        : "";
    }
  }
  renderBatchActions();
}
// 하단 고정 완료 버튼: 중복이 있으면 '건너뛰고 완료 / 덮어쓰기 완료' 두 개, 없으면 '검수 완료' 하나.
function renderBatchActions() {
  const wrap = document.getElementById("batchActions");
  if (!wrap) return;
  if (batchDone) { // 신청/완료가 끝난 상태 — 결과만 보여주고 '닫기'로 마무리
    wrap.innerHTML = `<span class="batch-done-msg">🎉 처리가 끝났습니다. 결과를 확인하고 <b>‘닫기’</b>를 누르세요.</span>`;
    return;
  }
  const matchedIds = new Set(), overIds = new Set();
  batchItems.forEach((it) => {
    if (!it.asset) return;
    const id = String(it.asset.id);
    if (it.status === "matched") { matchedIds.add(id); overIds.add(id); }
    else if (it.status === "dup" || it.status === "already") overIds.add(id);
  });
  const skipN = matchedIds.size, overN = overIds.size;
  const verb = isAdmin ? "완료" : "요청";
  const busy = batchProcessing ? "disabled" : "";
  if (!batchItems.length) { wrap.innerHTML = ""; return; }
  if (overN === skipN) {
    wrap.innerHTML = `<button class="btn btn-primary batch-apply-btn" data-batch-apply="skip" ${skipN ? "" : "disabled"} ${busy}>✅ ${skipN}건 검수 ${verb}</button>`;
  } else {
    wrap.innerHTML =
      `<button class="btn btn-secondary batch-apply-btn" data-batch-apply="skip" ${skipN ? "" : "disabled"} ${busy}>⏭️ 건너뛰고 ${skipN}건 ${verb}</button>` +
      `<button class="btn btn-primary batch-apply-btn" data-batch-apply="overwrite" ${overN ? "" : "disabled"} ${busy}>🔁 덮어쓰기 ${overN}건 ${verb}</button>`;
  }
}
function setBatchBusy(busy) {
  const pick = document.getElementById("batchPickBtn");
  const spin = document.getElementById("batchSpinner");
  if (pick) pick.disabled = busy;
  if (spin) spin.hidden = !busy;
}
// 한 항목(사진)을 원본 파일로 인식해 상태를 채운다. (업로드/재시도 공용)
async function recognizeIntoItem(item, mode, pool, period, tryRotate = false) {
  const raw = await fileToDataURL(item.file);
  if (!item.thumb) { try { item.thumb = await resizeDataUrl(raw, 160, 0.5); } catch {} }
  const { asset, code } = await recognizeAssetInPool(raw, mode, pool, tryRotate);
  item.code = code || null;
  if (!asset) { item.status = "nomatch"; return; }
  item.asset = asset;
  item.photoData = await compressImage(item.file, 900, 0.6); // 검수 증빙 사진(압축)
  item.status = classifyBatchItem(item, asset, period);
}
// 현재 위치·자산명·회차 기준 인식 설정
function currentBatchScan() {
  return {
    mode: currentGroup === GROUP_PAST ? "alnum" : "digit",
    pool: buildInspectPool(document.getElementById("batch-location").value, document.getElementById("batch-name").value),
    period: document.getElementById("batch-period").value,
  };
}
// 인식 실패 사진 한 장 다시 인식 (위치·자산명 필터를 고쳤다면 그 값으로 다시 시도)
async function retryBatchItem(index, tryRotate = false) {
  if (batchProcessing) return;
  const it = batchItems[index];
  if (!it || !it.file) return;
  batchProcessing = true; batchSuppressScan = true; batchDone = false; batchApplyMsg = ""; setBatchBusy(true);
  it.status = "processing"; renderBatchList();
  const { mode, pool, period } = currentBatchScan();
  try { await recognizeIntoItem(it, mode, pool, period, tryRotate); }
  catch (e) { console.error("재시도 인식 오류:", e); it.status = "error"; }
  finally { batchProcessing = false; batchSuppressScan = false; setScanLoading("", false); setBatchBusy(false); renderBatchList(); }
  if (it.status === "nomatch" || it.status === "error") {
    alert("이 사진은 여전히 자산번호를 인식하지 못했어요.\n\n· 위치·자산명 칸을 채우면 범위가 좁아져 잘 잡혀요\n· 옆으로 찍혔다면 ‘🔄 회전 재시도’를 눌러 보세요\n· 그래도 안 되면 그 자산은 상세 화면에서 직접 검수하세요.");
  }
}
// 인식 실패한 사진들만 한 번에 모두 다시 인식. tryRotate=true면 90·180·270도 회전까지 시도.
async function retryAllFailed(tryRotate = false) {
  if (batchProcessing) return;
  const fails = batchItems.filter((it) => (it.status === "nomatch" || it.status === "error") && it.file);
  if (!fails.length) return;
  batchProcessing = true; batchSuppressScan = true; batchDone = false; batchApplyMsg = ""; setBatchBusy(true);
  const { mode, pool, period } = currentBatchScan();
  batchRunTotal = fails.length; batchRunDone = 0;
  try {
    for (const it of fails) {
      it.status = "processing"; renderBatchList();
      try { await recognizeIntoItem(it, mode, pool, period, tryRotate); }
      catch (e) { console.error("일괄 재시도 오류:", e); it.status = "error"; }
      batchRunDone++; renderBatchList();
    }
  } finally {
    batchProcessing = false; batchRunTotal = 0; batchSuppressScan = false; setScanLoading("", false); setBatchBusy(false); renderBatchList();
  }
  const still = batchItems.filter((it) => it.status === "nomatch" || it.status === "error").length;
  if (still) alert(`아직 ${still}장은 인식되지 않았어요.\n${tryRotate ? "" : "옆으로 찍힌 사진이면 ‘🔄 전체 회전 재시도’를 눌러 보세요.\n"}위치·자산명 칸을 채우고 다시 시도하거나, 그 자산은 상세 화면에서 직접 검수하세요.`);
}
// 목록의 사진을 크게 확대해 확인 (원본 파일에서 즉석 생성 → 메모리 절약)
async function previewBatchItem(index) {
  const it = batchItems[index];
  if (!it) return;
  try {
    const big = it.file ? await compressImage(it.file, 1400, 0.8) : (it.photoData || it.thumb);
    if (big) openLightbox(big);
  } catch { if (it.thumb || it.photoData) openLightbox(it.thumb || it.photoData); }
}
// 준비된 항목을 일괄 검수 처리. policy: "skip"(중복 건너뛰기) | "overwrite"(중복 덮어쓰기)
// 관리자는 즉시 반영, 일반 사용자는 승인 요청. 버튼 한 번으로 바로 검수 완료된다.
async function applyBatchInspect(policy) {
  if (batchProcessing) return;
  // 전역 버튼(건너뛰기/덮어쓰기)을 누르면 모든 중복 항목의 처리 방식을 한 번에 정한다.
  if (policy === "skip" || policy === "overwrite") {
    const ov = policy === "overwrite";
    batchItems.forEach((it) => { if (it.status === "dup" || it.status === "already") it.overwrite = ov; });
  }
  // 검수 준비됨 + '덮어쓰기' 선택 항목. 같은 자산번호는 한 번만(마지막 사진 우선) 처리.
  const byId = new Map();
  batchItems.filter(batchWillApply).forEach((it) => byId.set(String(it.asset.id), it));
  const targets = [...byId.values()];
  if (!targets.length) { alert("검수할 자산이 없습니다. 먼저 라벨 사진을 올려 인식하세요."); return; }
  const period = document.getElementById("batch-period").value.trim() || "1회차";
  const inspector = document.getElementById("batch-inspector").value.trim();
  const affiliation = document.getElementById("batch-affil").value.trim();
  if (!inspector) {
    alert("검수 확인자 이름을 입력해 주세요. (목록 아래 ‘검수 확인자 이름’ 칸)");
    const el = document.getElementById("batch-inspector"); el.focus(); el.scrollIntoView({ block: "center" });
    return;
  }
  const reqName = affiliation ? `${inspector} (${affiliation})` : inspector;
  batchProcessing = true;
  batchDone = false;
  setBatchBusy(true);
  renderBatchList(); // 완료 버튼 비활성화 + 진행 표시
  const verb = isAdmin ? "검수" : "검수 신청";
  let ok = 0, fail = 0;
  for (const it of targets) {
    batchApplyMsg = `💾 ${verb} 처리 중… <b class="batch-prog">${ok + fail + 1}/${targets.length}</b>`;
    const summary = document.getElementById("batchInspectSummary");
    if (summary) summary.innerHTML = batchApplyMsg;
    try {
      if (isAdmin) {
        await applyInspect(it.asset.id, { periodType: "회차", period, inspector, affiliation, photo: it.photoData, photos: [], label: true });
      } else {
        await submitRequest({
          action: "inspect", target_id: it.asset.id,
          payload: { periodType: "회차", period, inspector, affiliation, photo: it.photoData, photos: [], label: true, assetName: it.asset.assetName, assetNumber: it.asset.assetNumber },
          requester: reqName, note: `${period} 검수 확인 · 여러 장 검수`,
        });
      }
      it.status = "done"; ok++;
    } catch (e) {
      console.error("일괄 검수 처리 오류:", e);
      it.status = "savefail"; fail++;
    }
  }
  batchProcessing = false;
  batchDone = true;
  setBatchBusy(false);
  // 창은 닫지 않는다 — 그 자리에서 결과를 보여준다.
  const doneWord = isAdmin ? "검수 완료" : "검수 신청 완료";
  batchApplyMsg = `✅ <b class="b-ok-t">${ok}건</b> ${doneWord}${fail ? ` · <b class="b-err-t">${fail}건 실패</b>` : ""}${isAdmin ? "" : " · 관리자 승인 후 반영"}`;
  renderBatchList();
  // 뒤 목록/통계는 갱신하되 검수 창은 그대로 열어둔다.
  await reloadAll(); rerender();
}

// 인식 텍스트에서 '자산번호(20자리)'와 '취득금액(천단위 숫자)'만 채운다.
// (품명·비치호실 등 한글 항목은 OCR 정확도 한계로 자동입력하지 않음 — 직접 입력)
function fillFromOcr(text) {
  const t = (text || "").replace(/\r/g, "");
  const filled = [];
  const setIfEmpty = (field, value, label) => {
    const el = document.getElementById("f-" + field);
    if (!el || el.value.trim() || !value) return;   // 이미 값이 있으면(QR/사용자 입력) 덮어쓰지 않음
    el.value = value;
    filled.push(label || field);
  };
  // 자산번호: 20자리 자산코드 (구입일·금액 등 다른 숫자와 섞이지 않게 줄 단위로 추출)
  const code = extractAssetCode(t);
  if (code) setIfEmpty("assetNumber", code, "자산번호");
  // 취득금액: 천단위 구분 숫자 중 가장 큰 값
  const money = (t.match(/\d{1,3}(?:[.,]\s?\d{3})+/g) || []).map((x) => Number(x.replace(/[^0-9]/g, ""))).filter((n) => n >= 1000 && n < 100000000);
  if (money.length) setIfEmpty("acquireCost", String(Math.max(...money)), "취득금액");
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
// 검수 확인 화면 열기. photo(촬영 사진)가 있으면 검수 기록에 첨부한다.
// 카메라 검수(handleScanCapture)에서는 사진과 함께, 상세 화면에서는 사진 없이 호출된다.
function openInspect(id, photo) {
  if (!requireLogin()) return;
  const a = findAsset(id);
  if (!a) return;
  inspectTargetId = id;
  inspectPhoto = photo || "";
  inspectExtraPhotos = [];
  renderInspExtra();
  document.getElementById("inspectError").hidden = true;
  fillInspPeriod();
  document.getElementById("insp-inspector").value = myProfile?.name || "";
  const affil = myProfile?.affiliation || "";
  const affilSel = document.getElementById("insp-affil");
  affilSel.innerHTML = deptOptionsHtml(affil);
  affilSel.value = affil;
  document.getElementById("insp-checked").checked = true;
  document.getElementById("inspectTarget").innerHTML = `<b>${esc(a.assetName)}</b> (${esc(a.assetNumber)})`;
  // 촬영된 검수 사진 미리보기 (사진 검수일 때만 표시)
  const photoRow = document.getElementById("insp-photo-row");
  const photoPrev = document.getElementById("inspPhotoPreview");
  if (photoRow && photoPrev) {
    if (inspectPhoto) {
      photoPrev.innerHTML = `<img src="${inspectPhoto}" alt="검수 사진" />`;
      photoRow.hidden = false;
    } else {
      photoPrev.innerHTML = "";
      photoRow.hidden = true;
    }
  }
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
// 검수 화면에서 이어 찍은 '물품 사진' 미리보기/버튼 상태 갱신
function renderInspExtra() {
  const grid = document.getElementById("inspExtraPreview");
  const btn = document.getElementById("inspExtraBtn");
  const hint = document.getElementById("inspExtraHint");
  if (!grid || !btn) return;
  grid.innerHTML = inspectExtraPhotos.map((src, i) =>
    `<div class="insp-extra-thumb"><img src="${src}" alt="물품 사진 ${i + 1}" /><button type="button" class="insp-extra-del" data-insp-extra="${i}" title="이 사진 제거">✕</button></div>`
  ).join("");
  const full = inspectExtraPhotos.length >= INSP_EXTRA_MAX;
  btn.hidden = full;
  btn.textContent = inspectExtraPhotos.length ? `📷 물품 사진 더 찍기 (${inspectExtraPhotos.length}/${INSP_EXTRA_MAX})` : "📷 물품 사진 촬영";
  if (hint) hint.textContent = full
    ? `물품 사진 ${INSP_EXTRA_MAX}장을 모두 찍었어요. ‘검수 확인’을 누르면 함께 저장됩니다.`
    : "검수한 자산의 실물 사진을 최대 3장까지 이어서 찍을 수 있어요. 원하는 만큼만 찍고 ‘검수 확인’을 누르면 함께 저장됩니다.";
}
// 물품 사진 1장 촬영 처리 (최대 3장)
async function handleInspExtraCapture(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) { alert("이미지(사진)만 사용할 수 있습니다."); return; }
  if (inspectExtraPhotos.length >= INSP_EXTRA_MAX) return;
  try {
    const data = await compressImage(file, 800, 0.62); // 저장공간 절약(무료 용량 연장)
    inspectExtraPhotos.push(data);
    renderInspExtra();
  } catch (e) {
    console.error("물품 사진 처리 오류:", e);
    alert("사진 처리 중 문제가 발생했습니다. 다시 시도해 주세요.");
  }
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
  const photo = inspectPhoto;
  const photos = inspectExtraPhotos.slice(); // 이어 찍은 물품 사진(최대 3장)
  const reqName = affiliation ? `${inspector} (${affiliation})` : inspector;
  const btn = document.getElementById("inspectSubmit");
  const origLabel = btn.textContent;
  btn.disabled = true;
  if (photos.length) btn.textContent = "사진 저장 중…";
  try {
    if (isAdmin) {
      await applyInspect(inspectTargetId, { periodType, period, inspector, affiliation, photo, photos });
    } else {
      await submitRequest({
        action: "inspect", target_id: inspectTargetId,
        payload: { periodType, period, inspector, affiliation, photo, photos, assetName: a.assetName, assetNumber: a.assetNumber },
        requester: reqName, note: `${period} 검수 확인${photos.length ? ` · 물품사진 ${photos.length}장` : ""}`,
      });
    }
  } catch (e) {
    console.error(e); btn.disabled = false; btn.textContent = origLabel;
    errEl.textContent = "처리에 실패했습니다. 잠시 후 다시 시도해주세요."; errEl.hidden = false; return;
  }
  btn.disabled = false; btn.textContent = origLabel;
  hide("inspectOverlay");
  inspectPhoto = "";
  inspectExtraPhotos = [];
  await reloadAll(); rerender();
  const photoMsg = photos.length ? `물품 사진 ${photos.length}장이 자산에 추가되었습니다. ` : "";
  if (isAdmin) { openDetail(inspectTargetId); alert(`검수가 완료되었습니다. ${photoMsg}${photo ? "검수 사진이 기록에 추가되었습니다." : ""}`.trim()); }
  else { hide("detailOverlay"); alert(`검수 승인 신청이 접수되었습니다. 관리자 승인 후 ${photos.length ? "물품 사진과 함께 " : ""}${photo ? "검수 사진과 함께 " : ""}기록에 반영됩니다.`); }
}
// 검수 목록(+선택적으로 병합된 물품 사진)을 오버레이에 저장(기존 데이터 보존)
// photoFields: { imageUrl, imageUrls } 가 있으면 자산 사진도 함께 갱신한다.
async function writeInspections(id, list, photoFields) {
  const isAdded = String(id).startsWith("u");
  const kind = isAdded ? "added" : "override";
  const existing = overlay.find((o) => String(o.id) === String(id) && o.kind === kind)?.data || {};
  const data = { ...existing, inspections: list, ...(photoFields || {}) };
  const { error } = await sb.from("assets").upsert({ id: String(id), kind, data, updated_at: new Date().toISOString() });
  if (error) throw error;
}
async function applyInspect(id, { periodType, period, inspector, affiliation, photo, photos, label }, meta = {}) {
  const current = findAsset(id);
  if (!current) throw new Error("자산 없음");
  // 검수 사진은 Storage에 올리고 DB에는 URL만 저장한다.
  // (base64로 DB에 넣으면 모든 접속자가 목록 로드마다 통째로 내려받아 전송량이 폭증한다.)
  let photoStored = photo || "";
  if (photoStored && photoStored.startsWith("data:")) {
    try { photoStored = await uploadMedia(photoStored, "inspections"); }
    catch (e) { console.warn("검수 사진 업로드 실패 — base64로 저장합니다:", e?.message || e); }
  }
  const insp = { id: "i" + Date.now() + Math.floor(Math.random() * 1000), periodType: periodType || "", period: period || "", inspector: inspector || "", affiliation: affiliation || "", photo: photoStored || "", checkedAt: new Date().toISOString() };
  const list = Array.isArray(current.inspections) ? [...current.inspections, insp] : [insp];
  let mediaFields = {};
  // 이어 찍은 물품 사진(최대 3장)이 있으면 기존 자산 사진 뒤에 병합해 함께 저장
  const extra = Array.isArray(photos) ? photos.filter(Boolean) : [];
  if (extra.length) mediaFields.imageUrls = [...photosOf(current), ...extra];
  // 검수한 라벨 사진을 자산의 '라벨 파일'로도 저장.
  // label === true 이면 '검수 사진을 라벨로도 사용'(요청 payload에 사진을 중복 저장하지 않기 위함).
  const labelImg = label === true ? (photoStored || photo) : label;
  if (labelImg) {
    const sameAsPhoto = (label === true) || (labelImg === photo);
    mediaFields.labelFile = (sameAsPhoto && photoStored && !photoStored.startsWith("data:")) ? photoStored : labelImg;
    // 미리보기는 base64 원본에서 생성(Storage URL로 만들면 캔버스가 오염돼 실패할 수 있음)
    const previewSrc = label === true ? photo : labelImg;
    try { mediaFields.labelPreview = (previewSrc && previewSrc.startsWith("data:")) ? await resizeDataUrl(previewSrc, 640, 0.6) : ""; }
    catch { mediaFields.labelPreview = ""; }
    mediaFields.labelFileName = `${(current.assetName || "asset")}_라벨.jpg`;
  }
  // withUploadedMedia: base64는 Storage 업로드 후 URL로, 이미 URL이면 그대로 둔다.
  let photoFields = Object.keys(mediaFields).length ? await withUploadedMedia(mediaFields) : null;
  await writeInspections(id, list, photoFields);
  const who = inspector + (affiliation ? ` (${affiliation})` : "");
  const photoNote = extra.length ? ` · 물품사진 ${extra.length}장 추가` : "";
  const labelNote = label ? " · 라벨 저장" : "";
  await logHistory({ asset_id: id, asset_name: current.assetName, action: "inspect", before: null, after: null, requester: meta.requester || who, note: `검수 확인 · ${period} · 확인자: ${who}${photoNote}${labelNote}` });
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
    // 목록용 썸네일: 대표(첫) 사진이 '새 이미지(base64)'면 작은 썸네일을 만들어 따로 저장.
    // 목록에서 원본 대신 이 썸네일을 불러오므로 전송량이 크게 준다.
    const firstPhoto = out.imageUrl || (Array.isArray(out.imageUrls) && out.imageUrls[0]) || "";
    if (typeof firstPhoto === "string" && firstPhoto.startsWith("data:")) {
      try { out.thumbUrl = await uploadMedia(await resizeDataUrl(firstPhoto, 240, 0.55), "thumbs"); }
      catch (e) { /* 썸네일 실패 시 목록은 원본으로 대체 */ }
    } else if (("imageUrl" in out || "imageUrls" in out) && !firstPhoto) {
      out.thumbUrl = ""; // 사진을 모두 지운 경우 썸네일도 제거
    }
    if (out.imageUrl) out.imageUrl = await uploadMedia(out.imageUrl, "photos");
    if (Array.isArray(out.imageUrls)) out.imageUrls = await Promise.all(out.imageUrls.map((u) => uploadMedia(u, "photos")));
    if (out.labelFile) out.labelFile = await uploadMedia(out.labelFile, "labels");
    if (out.labelPreview) out.labelPreview = await uploadMedia(out.labelPreview, "labels");
    if (Array.isArray(out.imageUrls) && out.imageUrls.length) out.imageUrl = out.imageUrls[0];
    // 검수 기록 안의 base64 사진도 Storage로 (있을 때만)
    if (Array.isArray(out.inspections)) {
      out.inspections = await Promise.all(out.inspections.map(async (ins) =>
        (ins && typeof ins.photo === "string" && ins.photo.startsWith("data:"))
          ? { ...ins, photo: await uploadMedia(ins.photo, "inspections") } : ins));
    }
    _storageIssueNotified = false; // 정상 업로드되면 경고 상태 해제(다음 장애 시 다시 알림)
    return out;
  } catch (e) {
    console.warn("이미지 업로드 실패 — 임시로 사진을 보존합니다:", e?.message || e);
    notifyStorageIssue(e); // 저장공간 가득참 등 → 관리자에게 명확히 안내(조용히 넘어가지 않음)
    return fields;
  }
}
// 저장소 업로드 실패(용량 초과 등) 시 1회 안내. 사진은 임시 보존되지만 조치가 필요함을 알린다.
let _storageIssueNotified = false;
function notifyStorageIssue(err) {
  if (_storageIssueNotified) return;
  _storageIssueNotified = true;
  const msg = String(err?.message || "").toLowerCase();
  const full = msg.includes("exceed") || msg.includes("quota") || msg.includes("limit") || msg.includes("payload") || msg.includes("413");
  setTimeout(() => {
    alert(
      (full
        ? "⚠️ 사진 저장 공간이 가득 찼을 수 있습니다.\n\n"
        : "⚠️ 사진을 클라우드 저장소에 올리지 못했습니다.\n\n") +
      "방금 사진은 임시로 보존되었지만, 저장소 상태를 확인해 주세요.\n" +
      "· Supabase 대시보드 → Settings → Usage 에서 Storage 사용량 확인\n" +
      "· 용량이 가득 찼다면 요금제 업그레이드(무제한 종량제)가 필요합니다."
    );
  }, 200);
}
// 기존 base64 오버레이를 Storage로 한 번 옮긴다(관리자·세션당 1회). 실패해도 조용히 넘어감.
let _mediaMigrated = false;
function hasInlineMedia(d) {
  if (!d) return false;
  const is64 = (v) => typeof v === "string" && v.startsWith("data:");
  return is64(d.imageUrl) || is64(d.labelFile) || is64(d.labelPreview)
    || (Array.isArray(d.imageUrls) && d.imageUrls.some(is64))
    || (Array.isArray(d.inspections) && d.inspections.some((ins) => ins && is64(ins.photo)));
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
    currentLabelRaw = "";
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

// ===== 관리자 페이지 (승인 대기 · 결재 내역 · 회원 관리) =====
// 관리자 페이지를 열고 데이터를 최신화한 뒤 선택 탭을 렌더링한다.
async function openAdminPage(tab) {
  if (!isAdmin) { navTo("2025"); return; }
  currentAdminTab = ["review", "hist", "members"].includes(tab) ? tab : "review";
  renderNav();
  setAdminTab(currentAdminTab);        // 먼저 화면 틀을 보여주고
  // 최신 데이터 로드 후 다시 렌더 (탭 전환도 빠르게 보이도록)
  await Promise.all([sbLoadRequests(), sbLoadHistory(), sbLoadMembers()]);
  updateUI();
  setAdminTab(currentAdminTab);
}
// 탭 전환: 활성 표시 + 패널 노출 + 해당 목록 렌더
function setAdminTab(tab) {
  currentAdminTab = tab;
  document.querySelectorAll(".admin-tab").forEach((b) => b.classList.toggle("active", b.dataset.atab === tab));
  ["review", "hist", "members"].forEach((t) => { const el = document.getElementById("admin-" + t); if (el) el.hidden = t !== tab; });
  if (tab === "review") renderReview();
  else if (tab === "hist") renderHistory();
  else if (tab === "members") renderMembers();
}
function renderReview() {
  const body = document.getElementById("adminReviewBody");
  if (!body) return;
  if (requests.length === 0) { selectedReqIds.clear(); body.innerHTML = `<div class="empty-msg">대기 중인 요청이 없습니다.</div>`; return; }
  // 유효한 선택만 유지
  const validIds = new Set(requests.map((r) => String(r.id)));
  selectedReqIds.forEach((id) => { if (!validIds.has(id)) selectedReqIds.delete(id); });
  const actionLabel = { create: "등록 요청", update: "수정 요청", delete: "삭제 요청", inspect: "검수 요청" };
  const actionCls = { create: "req-create", update: "req-update", delete: "req-delete", inspect: "req-inspect" };
  const allChecked = requests.length > 0 && requests.every((r) => selectedReqIds.has(String(r.id)));
  const selCount = selectedReqIds.size;
  const bar = `
    <div class="req-bulkbar">
      <label class="req-selall"><input type="checkbox" id="reqSelectAll" ${allChecked ? "checked" : ""} /> 전체 선택 <span class="req-total">(${requests.length}건)</span></label>
      <span class="req-selcount">${selCount ? `${selCount}건 선택됨` : ""}</span>
      <span class="form-info req-prog" id="reqBulkProgress" hidden></span>
      <span class="req-bulk-actions">
        <button class="btn btn-primary btn-sm" id="reqBulkApprove" ${selCount ? "" : "disabled"}>✅ 선택 결재</button>
        <button class="btn btn-danger btn-sm" id="reqBulkReject" ${selCount ? "" : "disabled"}>✖ 선택 반려</button>
      </span>
    </div>`;
  body.innerHTML = bar + requests.map((r) => {
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
      <div class="req-card${selectedReqIds.has(String(r.id)) ? " req-checked" : ""}">
        <div class="req-top">
          <label class="req-check"><input type="checkbox" data-reqcheck="${r.id}" ${selectedReqIds.has(String(r.id)) ? "checked" : ""} /></label>
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
// 요청 1건 승인 처리(적용 + 상태 갱신)만 수행 — 목록 새로고침은 호출부에서.
async function approveRequestCore(r) {
  const meta = { requester: r.requester, note: r.note };
  if (r.action === "create") await applyCreate(r.payload, meta);
  else if (r.action === "update") await applyUpdate(r.target_id, r.payload, meta);
  else if (r.action === "delete") await applyDelete(r.target_id, meta);
  else if (r.action === "inspect") await applyInspect(r.target_id, r.payload, meta);
  const { error } = await sb.from("requests").update({ status: "approved", decided_at: new Date().toISOString() }).eq("id", r.id);
  if (error) throw error;
}
async function approveRequest(reqId) {
  const r = requests.find((x) => String(x.id) === String(reqId));
  if (!r) return;
  try { await approveRequestCore(r); }
  catch (e) { console.error(e); alert("승인 처리에 실패했습니다."); return; }
  await reloadAll(); rerender(); renderReview();
}
async function rejectRequest(reqId) {
  try {
    const { error } = await sb.from("requests").update({ status: "rejected", decided_at: new Date().toISOString() }).eq("id", reqId);
    if (error) throw error;
  } catch (e) { console.error(e); alert("반려 처리에 실패했습니다."); return; }
  await reloadAll(); rerender(); renderReview();
}
// ===== 일괄 결재/반려 (관리자) =====
let selectedReqIds = new Set();
let reqBulkBusy = false;
function setReqProgress(msg) { const el = document.getElementById("reqBulkProgress"); if (el) { el.textContent = msg || ""; el.hidden = !msg; } }
async function bulkApproveSelected() {
  if (reqBulkBusy) return;
  const ids = [...selectedReqIds].filter((id) => requests.some((r) => String(r.id) === String(id)));
  if (!ids.length) { alert("결재할 요청을 먼저 선택하세요."); return; }
  if (!confirm(`선택한 ${ids.length}건을 모두 결재(승인)합니다.\n계속할까요?`)) return;
  reqBulkBusy = true;
  let ok = 0, fail = 0;
  for (const id of ids) {
    setReqProgress(`결재 중… ${ok + fail + 1}/${ids.length}`);
    const r = requests.find((x) => String(x.id) === String(id));
    if (!r) { continue; }
    try { await approveRequestCore(r); ok++; }
    catch (e) { console.error("일괄 결재 실패:", id, e); fail++; }
  }
  selectedReqIds.clear();
  setReqProgress("");
  reqBulkBusy = false;
  await reloadAll(); rerender(); renderReview();
  alert(`일괄 결재 완료: ${ok}건${fail ? ` · ${fail}건 실패` : ""}`);
}
async function bulkRejectSelected() {
  if (reqBulkBusy) return;
  const ids = [...selectedReqIds].filter((id) => requests.some((r) => String(r.id) === String(id)));
  if (!ids.length) { alert("반려할 요청을 먼저 선택하세요."); return; }
  if (!confirm(`선택한 ${ids.length}건을 모두 반려합니다.\n계속할까요?`)) return;
  reqBulkBusy = true;
  let ok = 0, fail = 0;
  for (const id of ids) {
    setReqProgress(`반려 중… ${ok + fail + 1}/${ids.length}`);
    try { const { error } = await sb.from("requests").update({ status: "rejected", decided_at: new Date().toISOString() }).eq("id", id); if (error) throw error; ok++; }
    catch (e) { console.error("일괄 반려 실패:", id, e); fail++; }
  }
  selectedReqIds.clear();
  setReqProgress("");
  reqBulkBusy = false;
  await reloadAll(); rerender(); renderReview();
  alert(`일괄 반려 완료: ${ok}건${fail ? ` · ${fail}건 실패` : ""}`);
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
  return changes.length ? changes.join(" · ") : "변경 없음";
}
const stripTags = (s) => String(s == null ? "" : s).replace(/<[^>]+>/g, "");
// 결재/변경 이력 — 한 줄씩 간결한 목록으로 표시
function renderHistory() {
  const body = document.getElementById("adminHistBody");
  if (!body) return;
  const searchEl = document.getElementById("adminHistSearch");
  const kw = (searchEl ? searchEl.value : "").trim().toLowerCase();
  let rows = history;
  if (kw) rows = rows.filter((h) => `${h.asset_name} ${h.asset_id}`.toLowerCase().includes(kw));
  if (rows.length === 0) { body.innerHTML = `<div class="empty-msg">기록이 없습니다.</div>`; return; }
  const actLabel = { create: "등록", update: "수정", delete: "삭제", revert: "되돌림", inspect: "검수" };
  const actCls = { create: "req-create", update: "req-update", delete: "req-delete", revert: "req-revert", inspect: "req-inspect" };
  const notice = isSuperAdmin ? "" : `<div class="notice" style="margin-bottom:12px;">되돌리기·기록 삭제는 <b>최고관리자</b>만 할 수 있습니다.</div>`;
  body.innerHTML = notice + `<div class="hist-list">` + rows.map((h) => {
    const summary = histSummary(h);
    const who = [h.approved_by && `결재 ${esc(h.approved_by)}`, h.requester && `신청 ${esc(h.requester)}`].filter(Boolean).join(" · ");
    const canRevert = h.action !== "inspect" && isSuperAdmin;
    const actions = isSuperAdmin
      ? `<span class="hist-actions">${canRevert ? `<button class="btn-mini btn-edit" data-revert="${h.id}">되돌리기</button>` : ""}<button class="btn-mini btn-del" data-delhist="${h.id}">삭제</button></span>`
      : "";
    const tip = stripTags(`${h.asset_name || h.asset_id} · ${summary}${who ? " · " + who : ""}`);
    return `
      <div class="hist-row" title="${esc(tip)}">
        <span class="hist-time">${fmtTime(h.created_at)}</span>
        <span class="req-badge ${actCls[h.action] || "badge-gray"}">${actLabel[h.action] || h.action}</span>
        <span class="hist-asset">${esc(h.asset_name || h.asset_id)}</span>
        <span class="hist-sum">${summary}</span>
        ${who ? `<span class="hist-who">${who}</span>` : ""}
        ${actions}
      </div>`;
  }).join("") + `</div>`;
}

// ===== 회원 관리 (관리자) =====
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
  const body = document.getElementById("adminMembersBody");
  if (!body) return;
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
    "메뉴": groupLabel(groupOf(a)),
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
  XLSX.writeFile(wb, `${groupLabel(currentGroup)}_자산목록_${todayStr()}.xlsx`);
}

// ===== 이벤트 =====
document.getElementById("searchInput").addEventListener("input", applyFilter);
document.getElementById("clearBtn").addEventListener("click", () => { document.getElementById("searchInput").value = ""; applyFilter(); });
document.getElementById("advToggle").addEventListener("click", () => { const p = document.getElementById("advPanel"); p.hidden = !p.hidden; });
["deptFilter", "statusFilter"].forEach((id) => document.getElementById(id).addEventListener("change", applyFilter));
["minCost", "maxCost", "nameFilter", "locFilter"].forEach((id) => document.getElementById(id).addEventListener("input", applyFilter));
document.getElementById("advReset").addEventListener("click", () => {
  ["deptFilter", "statusFilter", "minCost", "maxCost", "nameFilter", "locFilter"].forEach((id) => (document.getElementById(id).value = ""));
  applyFilter();
});
document.querySelectorAll(".asset-table th.sortable").forEach((th) => th.addEventListener("click", () => setSort(th.dataset.key)));
document.getElementById("exportBtn").addEventListener("click", exportExcel);
document.getElementById("uninspBtn").addEventListener("click", () => { inspView = inspView === "uninsp" ? "all" : "uninsp"; applyFilter(); });
document.getElementById("inspDoneBtn").addEventListener("click", () => { inspView = inspView === "done" ? "all" : "done"; applyFilter(); });
document.getElementById("inspRoundFilter").addEventListener("change", (e) => { inspRound = e.target.value; renderStats(); applyFilter(); });
document.getElementById("stats").addEventListener("change", (e) => {
  if (e.target && e.target.id === "inspRoundSel") { inspRound = e.target.value; renderStats(); applyFilter(); }
});
document.getElementById("addBtn").addEventListener("click", () => openForm(null));

document.getElementById("assetTbody").addEventListener("change", (e) => {
  const chk = e.target.closest("input.row-check");
  if (chk) toggleSelect(chk.dataset.id, chk.checked);
});
document.getElementById("checkAllPage").addEventListener("change", (e) => toggleSelectPage(e.target.checked));
document.getElementById("bulkClear").addEventListener("click", () => { selectedIds.clear(); render(); });
document.getElementById("bulkSelectAll").addEventListener("click", () => { filtered.forEach((a) => selectedIds.add(String(a.id))); render(); });
document.getElementById("bulkEditBtn").addEventListener("click", openBulkEdit);
document.getElementById("bulkEditSave").addEventListener("click", applyBulkEdit);
document.getElementById("bulkEditForm").addEventListener("change", (e) => {
  if (e.target.id === "bulk-insp-on") {
    const box = document.getElementById("bulk-insp-fields");
    box.hidden = !e.target.checked;
    if (e.target.checked) document.getElementById("bulk-insp-inspector").focus();
    return;
  }
  if (e.target.id === "bulk-photo-on") {
    document.getElementById("bulk-photo-fields").hidden = !e.target.checked;
    return;
  }
  const c = e.target.closest("input[data-bulk]");
  if (!c) return;
  const input = document.getElementById("bulk-" + c.dataset.bulk);
  if (input) { input.disabled = !c.checked; if (c.checked) input.focus(); }
});
document.getElementById("bulk-photo-pick").addEventListener("click", () => { const i = document.getElementById("bulk-photo-input"); i.value = ""; i.click(); });
document.getElementById("bulk-photo-input").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) { alert("이미지(사진)만 사용할 수 있습니다."); return; }
  try {
    bulkEditPhotoData = await compressImage(file, 1000, 0.65);
    document.getElementById("bulk-photo-preview").innerHTML = `<img src="${bulkEditPhotoData}" alt="선택한 사진" />`;
  } catch (err) { console.error("사진 처리 오류:", err); alert("사진 처리 중 문제가 발생했습니다."); }
});
// 검색결과에 사진 일괄 적용
document.getElementById("bulkEditAllBtn").addEventListener("click", openBulkEditAll);
document.getElementById("bulkPhotoBtn").addEventListener("click", openBulkPhoto);
document.getElementById("bulkPhotoPickBtn").addEventListener("click", () => { const i = document.getElementById("bulkPhotoInput"); i.value = ""; i.click(); });
document.getElementById("bulkPhotoInput").addEventListener("change", (e) => handleBulkPhotoPick(e.target.files && e.target.files[0]));
document.getElementById("bulkPhotoApply").addEventListener("click", applyBulkPhoto);

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
  const thumb = e.target.closest(".insp-thumb");
  if (thumb) { openLightbox(thumb.src); return; }
  const img = e.target.closest(".detail-photo img");
  if (img) { openLightbox(img.src); return; }
  const saveUser = e.target.closest("#detailUserSaveBtn");
  if (saveUser) { saveDetailUser(detailCurrentId); return; }
  const delInsp = e.target.closest("button[data-delinsp]");
  if (delInsp) removeInspection(detailCurrentId, delInsp.dataset.delinsp);
});
document.getElementById("inspectSubmit").addEventListener("click", submitInspect);
document.getElementById("inspectForm").addEventListener("submit", (e) => { e.preventDefault(); submitInspect(); });
document.getElementById("scanInspectBtn").addEventListener("click", startScanInspect);
document.getElementById("scanGuideStart").addEventListener("click", launchScanCamera);
document.getElementById("scanGuideCancel").addEventListener("click", () => hide("scanGuideOverlay"));
document.getElementById("scanGuideOverlay").addEventListener("click", (e) => { if (e.target.id === "scanGuideOverlay") hide("scanGuideOverlay"); });
document.getElementById("scanCameraInput").addEventListener("change", (e) => { handleScanCapture(e.target.files && e.target.files[0]); });
// 여러 장 한번에 검수
document.getElementById("batchInspectBtn").addEventListener("click", openBatchInspect);
document.getElementById("batchPickBtn").addEventListener("click", () => {
  const input = document.getElementById("batchInspectInput");
  if (input) { input.value = ""; input.click(); }
});
document.getElementById("batchInspectInput").addEventListener("change", (e) => { handleBatchFiles(e.target.files); });
document.getElementById("batchRetryAllBtn").addEventListener("click", () => retryAllFailed(false));
document.getElementById("batchRetryRotateBtn").addEventListener("click", () => retryAllFailed(true));
document.getElementById("batchActions").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-batch-apply]");
  if (b) applyBatchInspect(b.dataset.batchApply);
});
document.getElementById("batchInspectList").addEventListener("click", (e) => {
  const retry = e.target.closest("button[data-batch-retry]");
  if (retry) { retryBatchItem(Number(retry.dataset.batchRetry)); return; }
  const prev = e.target.closest("[data-batch-preview]");
  if (prev) { previewBatchItem(Number(prev.dataset.batchPreview)); return; }
});
// 창에 사진을 끌어다 놓으면(드래그&드롭) 한 번에 추가 (PC에서 여러 장 골라 끌어오기 편함)
(function () {
  const modal = document.querySelector("#batchInspectOverlay .modal");
  if (!modal) return;
  ["dragenter", "dragover"].forEach((ev) => modal.addEventListener(ev, (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy"; modal.classList.add("batch-drag");
  }));
  ["dragleave", "dragend"].forEach((ev) => modal.addEventListener(ev, (e) => { if (e.target === modal) modal.classList.remove("batch-drag"); }));
  modal.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    e.preventDefault(); modal.classList.remove("batch-drag");
    handleBatchFiles(files);
  });
})();
// 검수 화면: 물품 사진 이어 찍기(최대 3장)
document.getElementById("inspExtraBtn").addEventListener("click", () => {
  const input = document.getElementById("inspExtraInput");
  if (input) { input.value = ""; input.click(); }
});
document.getElementById("inspExtraInput").addEventListener("change", (e) => { handleInspExtraCapture(e.target.files && e.target.files[0]); });
document.getElementById("inspExtraPreview").addEventListener("click", (e) => {
  const del = e.target.closest("button[data-insp-extra]");
  if (del) { inspectExtraPhotos.splice(Number(del.dataset.inspExtra), 1); renderInspExtra(); }
});
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
document.getElementById("removeLabelFileBtn").addEventListener("click", () => { currentLabelFile = ""; currentLabelFileName = ""; currentLabelPreview = ""; currentLabelRaw = ""; document.getElementById("f-labelFile").value = ""; renderLabelFileInfo(); updateOcrBtn(); });
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
document.getElementById("myProfileBtn").addEventListener("click", openMyProfile);
document.getElementById("mpSaveBtn").addEventListener("click", saveMyProfile);
document.getElementById("myProfileForm").addEventListener("submit", (e) => { e.preventDefault(); saveMyProfile(); });
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

// 관리자 페이지 — 헤더 버튼/탭은 해당 탭으로 이동(해시 라우팅)
document.getElementById("reviewBtn").addEventListener("click", () => navTo("admin/review"));
document.getElementById("histBtn").addEventListener("click", () => navTo("admin/hist"));
document.getElementById("membersBtn").addEventListener("click", () => navTo("admin/members"));
document.getElementById("adminBackBtn").addEventListener("click", () => navTo("2025"));
document.querySelectorAll(".admin-tab").forEach((b) => b.addEventListener("click", () => navTo("admin/" + b.dataset.atab)));

// 승인 대기 목록
document.getElementById("adminReviewBody").addEventListener("click", (e) => {
  const ap = e.target.closest("button[data-approve]");
  const rj = e.target.closest("button[data-reject]");
  if (ap) { approveRequest(ap.dataset.approve); return; }
  if (rj) { rejectRequest(rj.dataset.reject); return; }
  if (e.target.closest("#reqBulkApprove")) { bulkApproveSelected(); return; }
  if (e.target.closest("#reqBulkReject")) { bulkRejectSelected(); return; }
});
document.getElementById("adminReviewBody").addEventListener("change", (e) => {
  const chk = e.target.closest("input[data-reqcheck]");
  if (chk) {
    const id = String(chk.dataset.reqcheck);
    if (chk.checked) selectedReqIds.add(id); else selectedReqIds.delete(id);
    renderReview();
    return;
  }
  if (e.target.id === "reqSelectAll") {
    if (e.target.checked) requests.forEach((r) => selectedReqIds.add(String(r.id)));
    else selectedReqIds.clear();
    renderReview();
  }
});
// 결재/변경 이력
document.getElementById("adminHistSearch").addEventListener("input", renderHistory);
document.getElementById("adminHistBody").addEventListener("click", (e) => {
  const rv = e.target.closest("button[data-revert]");
  const dl = e.target.closest("button[data-delhist]");
  if (rv) revertHistory(rv.dataset.revert);
  else if (dl) deleteHistory(dl.dataset.delhist);
});
// 회원 관리
document.getElementById("adminMembersBody").addEventListener("click", (e) => {
  const statusBtn = e.target.closest("button[data-setstatus]");
  const roleBtn = e.target.closest("button[data-role]");
  const delBtn = e.target.closest("button[data-delmember]");
  if (statusBtn) setMemberStatus(statusBtn.dataset.id, statusBtn.dataset.setstatus);
  else if (roleBtn) setMemberRole(roleBtn.dataset.id, roleBtn.dataset.role);
  else if (delBtn) deleteMember(delBtn.dataset.delmember);
});

// 건의 게시판
document.getElementById("homeTitle").addEventListener("click", () => navTo("2025")); // 제목 클릭 → 메인
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
const ALL_MODALS = ["detailOverlay", "formOverlay", "delReqOverlay", "authOverlay", "myProfileOverlay", "bulkEditOverlay", "bulkPhotoOverlay", "myReqOverlay", "inspectOverlay", "batchInspectOverlay", "postFormOverlay", "postViewOverlay", "scanGuideOverlay"];
document.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => { inspectPhoto = ""; ALL_MODALS.forEach(hide); }));
// 배경(어두운 부분) 클릭 시 닫기 — 단, 여러 장 검수 창은 실수로 닫히면 인식한 사진이 날아가므로 제외(‘닫기’ 버튼으로만)
document.querySelectorAll(".modal-overlay").forEach((ov) => ov.addEventListener("click", (e) => { if (e.target === ov && ov.id !== "batchInspectOverlay") ov.hidden = true; }));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeLightbox();
  const batch = document.getElementById("batchInspectOverlay");
  const keepBatch = batch && !batch.hidden; // 여러 장 검수 창은 Esc로 닫지 않는다(‘닫기’ 버튼 사용)
  ALL_MODALS.forEach((id) => { if (id === "batchInspectOverlay" && keepBatch) return; hide(id); });
});

// 시작
loadData();
