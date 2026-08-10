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
// 로그인 유지: 세션을 localStorage에 저장하고 토큰을 자동 갱신(기본값이지만 명시).
// (storageKey는 기본값 유지 — 바꾸면 기존 로그인 세션을 못 찾아 한 번 로그아웃되므로 건드리지 않음)
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage },
}) : null;
const REMEMBER_ID_KEY = "assetmgr.rememberId"; // '아이디 저장' 체크 시 보관하는 로그인 아이디

// ===== 토스트 알림 (기존 alert 대체) =====
// alert()은 흐름을 끊고 투박해서, 화면 위에 잠깐 떴다 사라지는 부드러운 알림으로 바꾼다.
// window.alert를 오버라이드하므로 기존 alert(...) 호출 83곳이 코드 수정 없이 전부 토스트가 된다.
// (확인/취소가 필요한 confirm()은 값을 돌려줘야 하므로 그대로 둔다.)
function toast(msg, kind) {
  try {
    const text = String(msg == null ? "" : msg);
    if (!kind) {
      if (/(실패|오류|불가|없습니다|없어요|못\s|못했|않았|않습니다|할 수 없|잘못|확인하세요|주세요)/.test(text)) kind = "error";
      else if (/(완료|접수|되었|저장|등록되|반영|환영|성공|승인)/.test(text)) kind = "success";
      else kind = "info";
    }
    const icons = { success: "✅", error: "⚠️", warn: "⚠️", info: "ℹ️" };
    let c = document.getElementById("toastWrap");
    if (!c) { c = document.createElement("div"); c.id = "toastWrap"; c.className = "toast-wrap"; (document.body || document.documentElement).appendChild(c); }
    const el = document.createElement("div");
    el.className = "toast toast-" + kind;
    const ic = document.createElement("span"); ic.className = "toast-ic"; ic.textContent = icons[kind] || "ℹ️";
    const m = document.createElement("span"); m.className = "toast-msg"; m.textContent = text; // textContent = XSS 안전, \n은 CSS pre-line로 표시
    const x = document.createElement("button"); x.className = "toast-x"; x.setAttribute("aria-label", "닫기"); x.textContent = "✕";
    el.append(ic, m, x);
    c.appendChild(el);
    while (c.children.length > 4) c.removeChild(c.firstChild); // 오래된 것 정리
    requestAnimationFrame(() => el.classList.add("show"));
    const dur = Math.min(9000, Math.max(kind === "error" ? 5200 : 3200, text.length * 90));
    let timer = setTimeout(close, dur);
    function close() { clearTimeout(timer); el.classList.remove("show"); el.classList.add("hide"); setTimeout(() => el.remove(), 280); }
    el.addEventListener("click", close);
  } catch { try { window.__nativeAlert && window.__nativeAlert(String(msg)); } catch {} }
}

// ===== 인앱 브라우저(카카오톡·인스타 등) 감지 안내 =====
// 인앱 브라우저는 파일 업로드(사진 저장)가 막히거나 불안정하다. 감지되면 상단 배너로
// 기본 브라우저(Chrome/Safari)로 열도록 유도한다.
function checkInAppBrowser() {
  try {
    const ua = navigator.userAgent || "";
    const kakao = /KAKAOTALK/i.test(ua);
    const inApp = kakao || /Instagram|FBAN|FBAV|FB_IAB|Line\/|NAVER|DaumApps|everytimeApp|; wv\)/i.test(ua);
    if (!inApp) return;
    const bar = document.createElement("div");
    bar.className = "inapp-warn";
    bar.innerHTML =
      '<span>⚠️ 지금 <b>' + (kakao ? "카카오톡" : "인앱") + ' 브라우저</b>예요. 여기선 <b>사진 업로드가 안 됩니다</b>.<br>' +
      '오른쪽 아래/위 <b>메뉴(⋮)</b> → <b>“다른 브라우저로 열기”</b>(Chrome/Safari)로 열어 주세요.</span>' +
      (kakao ? '<button type="button" id="inappOpenBtn" class="btn btn-primary btn-sm">브라우저로 열기</button>' : '') +
      '<button type="button" id="inappCloseBtn" class="inapp-x" aria-label="닫기">✕</button>';
    document.body.insertBefore(bar, document.body.firstChild);
    const cb = document.getElementById("inappCloseBtn");
    if (cb) cb.addEventListener("click", () => bar.remove());
    const ob = document.getElementById("inappOpenBtn");
    if (ob) ob.addEventListener("click", () => { try { location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(location.href); } catch {} });
  } catch {}
}
checkInAppBrowser();

// ===== 앱 설치(홈 화면에 추가) 안내 =====
let _deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); _deferredInstallPrompt = e; updateInstallButton(); });
window.addEventListener("appinstalled", () => { _deferredInstallPrompt = null; updateInstallButton(); });
function isStandaloneApp() {
  try { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; } catch { return false; }
}
function updateInstallButton() {
  const btn = document.getElementById("installAppBtn");
  if (!btn) return;
  // 이미 '앱으로 설치'되어 standalone으로 실행 중이면 숨김. 설치 개념 없는 데스크톱도 숨김(모바일만 노출).
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  btn.hidden = isStandaloneApp() || !isMobile;
}
function openInstallGuide() {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  const body = document.getElementById("installGuideBody");
  if (body) body.innerHTML = ios
    ? `<p class="form-info">아이폰(사파리)에서 앱처럼 쓰려면:</p>
       <ol class="install-steps">
         <li>이 페이지를 <b>사파리</b>로 여세요. (카카오톡·인스타 안이면 먼저 '다른 브라우저로 열기')</li>
         <li>하단 <b>공유 버튼 ⬆️</b> 을 누르세요.</li>
         <li><b>'홈 화면에 추가'</b> → <b>추가</b>.</li>
         <li>홈에 생긴 <b>자산관리 아이콘</b>으로 실행하면 앱처럼 열려요.</li>
       </ol>`
    : `<p class="form-info">안드로이드(크롬)에서 앱처럼 쓰려면:</p>
       <ol class="install-steps">
         <li>이 페이지를 <b>크롬</b>으로 여세요. (카카오톡 안이면 먼저 '다른 브라우저로 열기')</li>
         <li>우측 상단 <b>⋮ 메뉴</b> 를 누르세요.</li>
         <li><b>'홈 화면에 추가'</b> 또는 <b>'앱 설치'</b> 를 누르세요.</li>
         <li>홈에 생긴 <b>자산관리 아이콘</b>으로 실행하면 앱처럼 열려요.</li>
       </ol>`;
  show("installGuideOverlay");
}
document.getElementById("installAppBtn").addEventListener("click", async () => {
  if (_deferredInstallPrompt) {                 // 안드로이드 등: 원탭 설치 프롬프트
    try { _deferredInstallPrompt.prompt(); await _deferredInstallPrompt.userChoice; } catch {}
    _deferredInstallPrompt = null; updateInstallButton();
  } else {                                        // 아이폰 등: 수동 설치 안내 팝업
    openInstallGuide();
  }
});
updateInstallButton();
window.__nativeAlert = window.alert.bind(window);
window.alert = (m) => toast(m);

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
// 관리자 페이지 탭 목록 — 한 곳에서만 관리한다.
// (여기 빠뜨리면 탭을 눌러도 '승인 대기'로 튕겨나간다. 실제로 저장공간 탭이 그랬다.)
const ADMIN_TABS = ["review", "hist", "members", "access", "storage"];
let currentAdminTab = "review";
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
  // 로컬 번들 우선(첫 인식 다운로드 지연·CDN 장애 제거). 실패 시에만 CDN 폴백.
  if (window.Tesseract) return;
  try { await loadScript("/vendor/tesseract/tesseract.min.js"); } catch {}
  if (!window.Tesseract) await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
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
// 시:분만 (검수일 셀에서 날짜 옆에 덧붙임). 초는 title 툴팁으로 제공.
function fmtHM(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return ""; }
}
function fmtSec(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${fmtDate(iso)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
// 가장 최근 검수 기록 (없으면 null) — 배열 순서가 아니라 checkedAt 이 가장 늦은 것.
function lastInspection(a) {
  const l = Array.isArray(a.inspections) ? a.inspections : [];
  if (!l.length) return null;
  let best = null, bestT = -Infinity;
  for (const ins of l) {
    if (!ins) continue;
    const t = ins.checkedAt ? Date.parse(ins.checkedAt) : NaN;
    const v = isNaN(t) ? -1 : t;   // 시각 없는 옛 기록은 가장 뒤로
    if (v >= bestT) { bestT = v; best = ins; }
  }
  return best || l[l.length - 1];
}
// 가장 최근 검수 시각(ms). 미검수면 0 — 정렬에서 맨 뒤로 보내기 위함.
function latestInspectedAt(a) {
  const li = lastInspection(a);
  const t = li && li.checkedAt ? Date.parse(li.checkedAt) : NaN;
  return isNaN(t) ? 0 : t;
}
// 특정 회차 검수 여부
// ※ '목록표'는 1회차와 연동한다 — 목록표 자산이 1회차에 이미 검수됐다면 목록표도 검수된 것으로 본다.
//   (같은 물건을 두 번 찾아다니지 않도록. 반대 방향은 연동하지 않는다: 목록표만 한 건 1회차로 안 잡힘)
function inspectedRound(a, round) {
  const l = Array.isArray(a.inspections) ? a.inspections : [];
  if (round === SURVEY_ROUND) {
    return l.some((ins) => ins.period === SURVEY_ROUND) ||
      (isSurveyTarget(a) && l.some((ins) => ins.period === SURVEY_LINKED_ROUND));
  }
  return l.some((ins) => ins.period === round);
}
// 해당 구분의 검수 기록(가장 최근). 목록표는 기록이 없으면 연동된 1회차 기록을 쓴다.
function inspectionFor(a, round) {
  const l = Array.isArray(a.inspections) ? a.inspections : [];
  const pick = (p) => l.filter((i) => i && i.period === p).slice(-1)[0] || null;
  if (round === SURVEY_ROUND) return pick(SURVEY_ROUND) || (isSurveyTarget(a) ? pick(SURVEY_LINKED_ROUND) : null);
  return pick(round);
}
function show(id) { document.getElementById(id).hidden = false; }
function hide(id) { document.getElementById(id).hidden = true; }
// 일괄 작업 묶음 식별자 (요청/기록을 한 작업으로 묶어 한 번에 승인·거절·되돌리기)
function newBatchId() { return "bt" + Date.now() + Math.floor(Math.random() * 1000); }
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
  // kind='config'(양식 파일 포인터 등)는 자산이 아니므로 목록 로드에서 제외 → 모두의 로딩을 가볍게 유지
  const { data, error } = await sb.from("assets").select("id, kind, data, updated_at").neq("kind", "config");
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
// ===== 접속 로그 (최고관리자 전용 조회) =====
let accessLogs = [];
async function sbLoadAccessLogs() {
  if (!sb || !isSuperAdmin) { accessLogs = []; return; }
  const { data, error } = await sb.from("access_logs").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) { console.error("접속 로그 로드 오류:", error.message); return; }
  accessLogs = data || [];
}
// 접속 기록: '로그인 유지' 특성상 매번 로그인하지 않으므로, 사용자·기기별 하루 1회만 남긴다(새로고침 스팸 방지).
async function recordAccessLog() {
  try {
    if (!sb || !currentUser) return;
    const key = "assetmgr.access." + currentUser.id;
    const today = fmtDate(new Date().toISOString());
    if (localStorage.getItem(key) === today) return; // 오늘 이미 기록됨
    localStorage.setItem(key, today);
    const meta = currentUser.user_metadata || {};
    await sb.from("access_logs").insert({
      user_id: currentUser.id,
      email: currentUser.email || "",
      name: (myProfile && myProfile.name) || meta.name || "",
      affiliation: (myProfile && myProfile.affiliation) || meta.affiliation || "",
      event: "login",
    });
  } catch (e) { /* 접속 로그 실패는 본 기능에 영향 없도록 조용히 무시 */ }
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
    normalizeRound();   // 메뉴가 바뀌어 '목록표'를 못 쓰게 되면 회차로 되돌린 뒤 그린다
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
    return { page: "admin", tab: ADMIN_TABS.includes(tab) ? tab : "review" };
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
  //  · assets2025add.json : 2025년도 자산에 추가 병합분(6.30 기준, 중복 자산코드 제외됨)
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
  // 재물조사 목록표 대상(15KB)도 백그라운드로 — 다 받으면 '📋 목록표 미검수' 버튼이 나타난다.
  loadSurveyTargets().then(() => { if (currentPageName === "assets") syncInspButtons(); });
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
  // 접속 기록(하루 1회) — 승인된 사용자만. 실패해도 무시(fire-and-forget).
  if (currentUser && isApproved) recordAccessLog();
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
  document.getElementById("authPw").value = "";
  document.getElementById("authName").value = "";
  document.getElementById("authAffil").innerHTML = deptSignupOptionsHtml();
  document.getElementById("authAffil").value = "";
  const affilCustom = document.getElementById("authAffilCustom");
  if (affilCustom) { affilCustom.value = ""; affilCustom.hidden = true; }
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
  document.querySelectorAll(".login-only").forEach((el) => (el.style.display = isSignup ? "none" : ""));
  // 로그인 모드에서는 '아이디 저장'된 아이디를 미리 채우고 체크박스도 반영(회원가입은 비움).
  const savedId = localStorage.getItem(REMEMBER_ID_KEY) || "";
  const idEl = document.getElementById("authId");
  if (idEl) idEl.value = isSignup ? "" : savedId;
  const rememberEl = document.getElementById("rememberId");
  if (rememberEl) rememberEl.checked = !isSignup && !!savedId;
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
      const name = document.getElementById("authName").value.trim();
      const affilSel = document.getElementById("authAffil").value;
      const affiliation = affilSel === "__custom__"
        ? document.getElementById("authAffilCustom").value.trim()
        : affilSel.trim();
      // 이름·소속(부서)은 필수
      if (!name) { errEl.textContent = "이름을 입력해주세요."; errEl.hidden = false; btn.disabled = false; return; }
      if (!affiliation) { errEl.textContent = "소속(부서)를 선택하거나 직접 입력해주세요."; errEl.hidden = false; btn.disabled = false; return; }
      const email = idToEmail(idVal, true);
      const username = email.split("@")[0];
      // 아이디 형식 검사(웹메일 아이디 부분)
      if (!/^[a-zA-Z0-9._%+-]+$/.test(username)) {
        errEl.textContent = "아이디는 영문·숫자로 입력하세요. (예: hong123 → hong123@inje.ac.kr)"; errEl.hidden = false; return;
      }
      const dupMsg = "이미 등록된 아이디입니다. 로그인하거나 ‘비밀번호를 잊으셨나요?’를 이용하세요.";
      const { data, error } = await sb.auth.signUp({
        email, password: pw,
        options: { data: { name, affiliation, username } },
      });
      if (error) {
        const m = (error.message || "").toLowerCase();
        // 이미 가입된 이메일(이메일 확인 OFF일 때 여기로 옴)
        errEl.textContent = (m.includes("already") || m.includes("registered") || m.includes("exist")) ? dupMsg : ("가입 실패: " + error.message);
        errEl.hidden = false; return;
      }
      // 이메일 확인 ON이면 이미 존재하는 계정은 열거 방지를 위해 identities가 빈 배열로 온다 → 중복으로 처리
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        errEl.textContent = dupMsg; errEl.hidden = false; return;
      }
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
      // '아이디 저장' 체크 시 아이디 보관, 해제 시 삭제
      const rememberEl = document.getElementById("rememberId");
      if (rememberEl && rememberEl.checked) localStorage.setItem(REMEMBER_ID_KEY, idVal);
      else localStorage.removeItem(REMEMBER_ID_KEY);
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
  setMyProfileTab("info");
  show("myProfileOverlay");
}

// ===== 내 정보 > 내 이력 =====
// '내가 처리하거나 신청한' 기록만 모아 보여준다. history 는 로그인 사용자면 읽을 수 있고,
// 관리자가 아니면 평소 불러오지 않으므로 이 탭을 열 때 한 번 가져온다.
let myHistCache = null;
function setMyProfileTab(tab) {
  document.querySelectorAll(".mp-tabs .admin-tab").forEach((b) => b.classList.toggle("active", b.dataset.mptab === tab));
  document.getElementById("myProfileForm").hidden = tab !== "info";
  document.getElementById("mp-log").hidden = tab !== "log";
  document.getElementById("mpSaveBtn").hidden = tab !== "info";   // 이력 탭에서는 '저장' 숨김
  if (tab === "log") renderMyHistory();
}
// 이 기록이 '나'와 관련된 것인지 — 결재자(approved_by)나 신청자(requester)가 나인 경우
function isMyRecord(h) {
  const me = [myProfile?.username, myProfile?.name, currentUser?.email, (currentUser?.email || "").split("@")[0]]
    .filter(Boolean).map((s) => String(s).toLowerCase());
  if (!me.length) return false;
  const hay = `${h.approved_by || ""} ${h.requester || ""}`.toLowerCase();
  return me.some((m) => hay.includes(m));
}
async function renderMyHistory() {
  const body = document.getElementById("myHistBody");
  if (!body) return;
  if (!currentUser) { body.innerHTML = `<div class="empty-msg">로그인이 필요합니다.</div>`; return; }
  if (myHistCache === null) {
    body.innerHTML = `<div class="empty-msg">불러오는 중…</div>`;
    try {
      const { data, error } = await sb.from("history").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      myHistCache = (data || []).filter(isMyRecord);
    } catch (e) {
      console.error(e);
      body.innerHTML = `<div class="empty-msg">이력을 불러오지 못했습니다.</div>`;
      myHistCache = null; return;
    }
  }
  if (!myHistCache.length) {
    body.innerHTML = `<div class="empty-msg"><div class="empty-ic">🧾</div><div class="empty-title">아직 기록이 없습니다</div>
      <div class="empty-sub">자산을 등록·수정·검수하면 여기에 쌓입니다.</div></div>`;
    return;
  }
  const actLabel = { create: "등록", update: "수정", delete: "삭제", revert: "되돌림", inspect: "검수" };
  const actCls = { create: "req-create", update: "req-update", delete: "req-delete", revert: "req-revert", inspect: "req-inspect" };
  body.innerHTML = `<div class="hist-list">` + myHistCache.map((h) => `
      <div class="hist-row hist-openable" data-hist-asset="${esc(h.asset_id)}" title="${esc(stripTags(`${h.asset_name || h.asset_id} · ${histSummary(h)}`))} — 눌러서 물품 상세 보기">
        <span class="hist-time">${fmtTime(h.created_at)}</span>
        <span class="req-badge ${actCls[h.action] || "badge-gray"}">${actLabel[h.action] || h.action}</span>
        <span class="hist-asset">${esc(h.asset_name || h.asset_id)}</span>
        <span class="hist-sum">${histSummary(h)}</span>
      </div>`).join("") + `</div>`;
}
// 이력 기록에서 물품 상세로 이동 (결재 내역 / 내 이력 공통)
function openAssetFromRecord(assetId) {
  if (!findAsset(assetId)) {
    toast(baseAssets.length ? "삭제되었거나 찾을 수 없는 자산입니다." : "자산을 아직 불러오는 중입니다. 잠시 후 다시 눌러주세요.", "warn");
    return;
  }
  hide("myProfileOverlay");
  openDetail(assetId);
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
  const expInsp = g("exportInspBtn"); // 재물조사 결과 내보내기 = 관리자 전용(업로드 목록표 기준, 메뉴 무관)
  if (expInsp) expInsp.hidden = !isAdmin;
  const accessTab = document.querySelector('.admin-tab[data-atab="access"]');
  if (accessTab) accessTab.hidden = !isSuperAdmin; // 접속 로그 탭은 최고관리자만
  const navAdmin = g("navAdmin");
  if (navAdmin) navAdmin.hidden = !isAdmin;
  const pendingMembers = members.filter((m) => (m.status || "pending") === "pending").length;
  // 관리자 승격 요청(grant_admin)은 자산 결재가 아니라 회원 관리에서 처리 → 배지 계산을 분리한다.
  const assetReqN = requests.filter((r) => r.action !== "grant_admin").length;
  const grantReqN = isSuperAdmin ? requests.filter((r) => r.action === "grant_admin").length : 0;
  const memberBadge = pendingMembers + grantReqN;    // 최고관리자는 승격 요청도 회원 관리에서 확인
  const setBadge = (id, n) => { const el = g(id); if (el) { el.textContent = n; el.hidden = !n; } };
  setBadge("memberPendingCount", memberBadge);
  setBadge("adminMemberCount", memberBadge);         // 관리자 페이지 '회원 관리' 탭 배지
  setBadge("adminReviewCount", assetReqN);           // 관리자 페이지 '승인 대기' 탭 배지
  // 관리자 네비 링크 배지 = 자산 결재 + 회원 승인 + (최고관리자) 승격 요청
  setBadge("navAdminCount", assetReqN + memberBadge);

  if (loggedIn) {
    const uname = myProfile?.name || myProfile?.username || (currentUser.email || "").split("@")[0];
    g("userTag").textContent = isAdmin ? `관리자: ${uname}` : `${uname} 님`;
  }
  g("pendingCount").textContent = assetReqN;

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
  // 목록표 모드에서는 모든 수치를 목록표 661건 기준으로 낸다(회차 검수와 섞이지 않게).
  const inGroup = inspScope();
  const total = inGroup.length;
  const totalCost = inGroup.reduce((s, a) => s + (a.acquireCost || 0), 0);
  const inUse = inGroup.filter((a) => a.status === "사용중" || a.status === "대여중").length;
  const labelCount = inGroup.filter((a) => a.labelFile).length;
  const showInsp = currentGroup !== GROUP_ELEC; // 검수율은 2025/2024년도 자산 전용
  const inspectedCnt = showInsp ? inGroup.filter((a) => inspectedRound(a, inspRound)).length : 0;
  const inspRate = total ? Math.round((inspectedCnt / total) * 100) : 0;
  const remaining = Math.max(0, total - inspectedCnt);
  const roundSel = `<select id="inspRoundSel" class="stat-sel">${roundOptions(inspRound)}</select>`;
  // 검수 진행 대시보드: 진행률 바 + 미검수 바로가기(재물조사 진척을 한눈에)
  const inspCard = showInsp
    ? `<div class="stat-card stat-insp">
         <div class="num">${inspectedCnt.toLocaleString()}/${total.toLocaleString()} <span class="rate">(${inspRate}%)</span></div>
         <div class="insp-bar" title="${inspRate}% 검수 완료"><div class="insp-bar-fill" style="width:${inspRate}%"></div></div>
         <div class="label">${roundSel} 검수 진행${remaining ? ` · <button type="button" class="insp-jump" data-insp-jump="uninsp">미검수 ${remaining.toLocaleString()}건 →</button>` : ` · <span class="insp-done-all">✅ 전체 완료</span>`} · <button type="button" class="insp-detail-btn" data-insp-detail>📊 자세히</button></div>
       </div>`
    : "";
  document.getElementById("stats").innerHTML = `
    <div class="stat-card${surveyMode() ? " stat-survey" : ""}"><div class="num">${total.toLocaleString()}</div><div class="label">${surveyMode() ? "📋 재물조사 목록표" : esc(groupLabel(currentGroup))}</div></div>
    <div class="stat-card"><div class="num">${(totalCost / 100000000).toFixed(1)}억</div><div class="label">총 취득금액</div></div>
    <div class="stat-card"><div class="num">${labelCount}</div><div class="label">라벨 파일</div></div>
    <div class="stat-card"><div class="num">${inUse}</div><div class="label">사용/대여 중</div></div>
    ${inspCard}`;
}
// 부서·위치별 검수 진척 상세(모달) — 평소엔 숨기고 '자세히'로만 연다. 어디가 덜 됐는지 한눈에.
function openInspProgressDetail() {
  const g = currentGroup;
  const list = inspScope();   // 목록표 모드면 목록표 661건만
  const round = inspRound;
  const agg = (keyFn) => {
    const m = new Map();
    for (const a of list) {
      const k = (String(keyFn(a) || "").trim()) || "(미지정)";
      const o = m.get(k) || { total: 0, done: 0 };
      o.total++; if (inspectedRound(a, round)) o.done++;
      m.set(k, o);
    }
    return [...m.entries()].map(([k, v]) => ({ k, done: v.done, total: v.total, rate: v.total ? Math.round(v.done / v.total * 100) : 0 }))
      .sort((a, b) => a.rate - b.rate || b.total - a.total); // 진척 낮은 순(남은 것 먼저)
  };
  // 장소 줄을 누르면 그 장소의 미검수만 걸러 보여준다 → 한 곳씩 찾아가 몰아서 끝내기 좋다.
  const rowsHtml = (arr, kind) => arr.map((x) => `
    <div class="ipd-row${kind === "loc" ? " ipd-clickable" : ""}"${kind === "loc" ? ` data-ipd-loc="${esc(x.k)}" title="${esc(x.k)}&#10;— 눌러서 이 장소의 미검수만 보기"` : ` title="${esc(x.k)}"`}>
      <div class="ipd-name">${esc(x.k)}</div>
      <div class="ipd-bar"><div class="ipd-bar-fill" style="width:${x.rate}%"></div></div>
      <div class="ipd-num">${x.done}/${x.total} <b>${x.rate}%</b></div>
    </div>`).join("");
  const byDept = agg((a) => a.dept);
  const byLoc = agg((a) => a.location);
  const empty = '<div class="empty-msg">데이터 없음</div>';
  const locBlock = `<h3 class="ipd-h">📍 위치별 <span class="ipd-h-sub">— 줄을 누르면 그 장소의 미검수만 보입니다</span></h3>${byLoc.length ? rowsHtml(byLoc, "loc") : empty}`;
  const deptBlock = `<h3 class="ipd-h">🏢 부서별</h3>${byDept.length ? rowsHtml(byDept, "dept") : empty}`;
  document.getElementById("inspDetailTitle").textContent = surveyMode()
    ? `📋 재물조사 목록표 ${list.length.toLocaleString()}건 · 검수 진척`
    : `${groupLabel(g)} · ${round} 검수 진척`;
  document.getElementById("inspDetailBody").innerHTML =
    `<p class="ipd-hint">진척이 낮은 순(아직 남은 곳이 위로). 어디가 덜 됐는지 한눈에 확인하세요.${
      surveyMode() ? `<br><b>1회차에 검수된 목록표 자산은 목록표 검수로도 인정됩니다</b> — 같은 물건을 두 번 찾아다니지 않아도 됩니다.` : ""
    }</p>` +
    // 재물조사는 '어디로 가야 하나'가 먼저라 목록표 모드에서는 위치별을 위로 올린다.
    (surveyMode() ? locBlock + deptBlock : deptBlock + locBlock);
  show("inspDetailOverlay");
}

// ===== 재물조사 목록표(산학협력단 제출본) 대상만 보기 =====
// 목록표에 실린 661건은 전부 '2025년도 자산' 안에 있다. 이 자산들을 우선 검수해야 하므로,
// '미검수' 옆에 목록표 대상만 추려 보는 버튼을 둔다. 평소 운영(전체 자산 관리)은 그대로다.
// survey_targets.json = 목록표(inventory_list.json)에서 자산관리번호만 뽑은 목록. 목록표가 바뀌면 다시 뽑으면 된다.
let surveyTargets = null;   // Set(정규화 자산번호). 로드 전에는 null → 버튼도 숨김
const normNum = (s) => String(s || "").replace(/[\s.\-]/g, "");
function loadSurveyTargets() {
  return fetch("survey_targets.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((rows) => { surveyTargets = new Set((rows || []).map(normNum).filter(Boolean)); })
    .catch(() => { surveyTargets = null; });  // 실패하면 버튼을 아예 안 띄운다(잘못된 목록으로 헷갈리지 않게)
}
const isSurveyTarget = (a) => !!surveyTargets && surveyTargets.has(normNum(a.assetNumber));
// '목록표'는 1·2회차 같은 정기 회차와 별개로 굴리는 독립 검수다(회차 개념 없음).
// 회차 드롭다운에서 '목록표'를 고르면 목록표 661건만 다루는 모드가 된다.
const SURVEY_ROUND = "목록표";
const SURVEY_LINKED_ROUND = "1회차";  // 이 회차 검수분은 목록표 검수로도 인정한다(inspectedRound 참고)
const ROUNDS = Array.from({ length: 8 }, (_, i) => `${i + 1}회차`);
const surveyMode = () => inspRound === SURVEY_ROUND;
// 회차 드롭다운 옵션 HTML. 목록표는 2025년도 자산에서만(목록표 자산이 전부 거기 있음).
function roundOptions(selected, withSurvey = true) {
  const list = (withSurvey && surveyTargets && currentGroup === GROUP_2024) ? [SURVEY_ROUND, ...ROUNDS] : [...ROUNDS];
  return list.map((r) => `<option value="${r}"${r === selected ? " selected" : ""}>${r === SURVEY_ROUND ? "📋 목록표" : r}</option>`).join("");
}
// 목록표를 볼 수 없는 화면(2024·전자 메뉴)으로 옮기면 회차로 되돌린다.
function normalizeRound() {
  if (surveyMode() && currentGroup !== GROUP_2024) inspRound = "1회차";
}
// 현재 모드에서 '검수 대상'이 되는 자산들 (목록표 모드면 목록표 661건, 아니면 메뉴 전체)
function inspScope() {
  const inGroup = assets.filter((a) => groupOf(a) === currentGroup);
  return surveyMode() ? inGroup.filter(isSurveyTarget) : inGroup;
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
    if (surveyMode() && !isSurveyTarget(a)) return false;  // 목록표 모드: 목록표 661건만
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
    // 검수자·소속·회차도 검색 대상 — '유현진' 으로 그 사람이 검수한 자산을 찾을 수 있다.
    // ('✅ 검수 완료' 필터와 같이 쓰면 "누가 무엇을 검수했는지" 를 바로 추릴 수 있다)
    const insps = Array.isArray(a.inspections) ? a.inspections : [];
    const hay = [a.assetName, a.assetNumber, a.labelSticker, a.location, a.manager, a.dept, a.org, a.maker, a.model, a.spec,
      ...insps.map((i) => `${i?.inspector || ""} ${i?.affiliation || ""} ${i?.period || ""}`)].join(" ").toLowerCase();
    if (hay.includes(kw)) return true;
    // 자산코드는 공백·하이픈·점을 무시하고도 검색되게 (예: "2026-0404 ..." 로 쳐도 매칭)
    const kwNorm = kw.replace(/[\s.\-]/g, "");
    return !!kwNorm && String(a.assetNumber || "").toLowerCase().replace(/[\s.\-]/g, "").includes(kwNorm);
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
  // 검수일은 자산의 직접 속성이 아니라 검수 기록의 시각으로 정렬한다.
  // 기록 '순서'가 아니라 checkedAt 이 가장 늦은 것을 기준으로 삼는다(초·밀리초까지 비교).
  // 배열 마지막 = 최신이 아닐 수 있기 때문(예: 1회차 뒤에 옛 회차 기록을 나중에 추가한 경우).
  // 미검수 자산은 0으로 취급 → 최신순(내림차순)이면 맨 아래로 밀린다.
  if (key === "inspDate") {
    const t = (x) => latestInspectedAt(x);
    filtered.sort((a, b) => (t(a) - t(b)) * dir);
    return;
  }
  filtered.sort((a, b) => {
    let va = a[key] ?? "", vb = b[key] ?? "";
    const na = parseFloat(va), nb = parseFloat(vb);
    const bothNum = va !== "" && vb !== "" && !isNaN(na) && !isNaN(nb) && String(va).trim() === String(na) && String(vb).trim() === String(nb);
    const cmp = bothNum ? na - nb : String(va).localeCompare(String(vb), "ko");
    return cmp * dir;
  });
}
// 처음 누를 때의 정렬 방향. 검수일은 '방금 검수한 것'을 확인하려고 누르므로 최신순(내림차순)부터.
const FIRST_SORT_DESC = new Set(["inspDate"]);
function setSort(key) {
  if (sortState.key === key) sortState.dir *= -1;
  else sortState = { key, dir: FIRST_SORT_DESC.has(key) ? -1 : 1 };
  document.querySelectorAll(".asset-table th.sortable").forEach((th) => {
    const arrow = th.querySelector(".sort-arrow");
    if (th.dataset.key === key) { arrow.textContent = sortState.dir === 1 ? "▲" : "▼"; th.classList.add("sorted"); }
    else { arrow.textContent = ""; th.classList.remove("sorted"); }
  });
  applyFilter();
}

// 검수 필터 버튼(회차·미검수·검수완료·목록표) 표시 상태를 현재 화면에 맞춘다.
function syncInspButtons() {
  const showInsp = currentGroup !== GROUP_ELEC; // 검수는 2025/2024년도 자산 전용 (전자 제외)
  normalizeRound();
  const roundFilter = document.getElementById("inspRoundFilter");
  if (roundFilter) {
    roundFilter.hidden = !showInsp;
    roundFilter.innerHTML = roundOptions(inspRound);   // '목록표'는 2025년도 자산에서만 나온다
    roundFilter.value = inspRound;
    roundFilter.classList.toggle("survey-on", surveyMode());
  }
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
}

// ===== 목록 렌더 =====
function render() {
  const tbody = document.getElementById("assetTbody");
  const emptyMsg = document.getElementById("emptyMsg");
  document.getElementById("resultCount").textContent = `총 ${filtered.length.toLocaleString()}건`;
  syncInspButtons();   // 결과가 0건이어도 버튼 상태(눌림 표시·남은 건수)는 항상 최신으로
  if (filtered.length === 0) {
    tbody.innerHTML = "";
    // 목록표 모드 + 미검수 보기에서 0건 = 재물조사를 다 끝냈다는 뜻 → '결과 없음'이 아니라 완료로 알린다.
    emptyMsg.innerHTML = (surveyMode() && inspView === "uninsp" && surveyTargets)
      ? `<div class="empty-ic">🎉</div><div class="empty-title">재물조사 목록표 검수 완료</div>
         <div class="empty-sub">목록표 ${surveyTargets.size.toLocaleString()}건을 모두 검수했습니다. ‘📋 재물조사 결과’로 내보내세요.</div>`
      : `<div class="empty-ic">🔍</div><div class="empty-title">검색 결과가 없습니다</div>
         <div class="empty-sub">검색어나 필터를 바꿔 다시 시도해 보세요.</div>`;
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
  const start = (currentPage - 1) * PER_PAGE;
  const pageItems = filtered.slice(start, start + PER_PAGE);
  tbody.innerHTML = pageItems.map((a) => {
    let tag = "";
    if (a._added) tag = `<span class="tag tag-added">직접</span>`;
    const li = showInsp ? lastInspection(a) : null;
    if (li) tag += ` <span class="tag tag-inspected">검수 ${esc(li.period || "완료")}</span>`;
    if (pending.has(String(a.id))) tag += ` <span class="tag tag-pending">요청중</span>`;
    // 같은 날 검수가 몰리므로 날짜만으로는 순서를 못 본다 → 시각(시:분)도 함께 보여준다.
    const inspDate = li ? `${fmtDate(li.checkedAt)}<span class="insp-hm">${fmtHM(li.checkedAt)}</span>` : "—";
    const inspBy = li && li.inspector ? `<span class="insp-by">${esc(li.inspector)}</span>` : ""; // 검수자 이름
    const thumbSrc = a.thumbUrl || a.imageUrl; // 목록은 가벼운 썸네일 우선(없으면 원본)
    const thumb = thumbSrc ? `<img class="thumb" src="${thumbSrc}" alt="" loading="lazy" decoding="async" />` : "";
    // 모바일 카드에서 빈 값은 숨기기 위한 표식(m-empty). 데스크톱 표에는 영향 없음.
    const labelHtml = labelCell(a);
    const mE = (v) => (!String(v == null ? "" : v).trim() ? " m-empty" : "");
    return `
    <tr>
      <td class="col-check"><input type="checkbox" class="row-check" data-id="${esc(a.id)}" ${selectedIds.has(String(a.id)) ? "checked" : ""} /></td>
      <td class="cell-name" title="${esc(a.assetName)}"><div class="name-wrap">${thumb}<span>${esc(a.assetName)} ${tag}</span></div></td>
      <td class="cell-num" data-label="자산코드">${esc(a.assetNumber)}</td>
      <td data-label="라벨" class="${labelHtml === "-" ? "m-empty" : ""}">${labelHtml}</td>
      <td class="cell-loc${mE(a.location)}" data-label="위치" title="${esc(a.location)}">${esc(val(a.location))}</td>
      <td data-label="사용자" class="${mE(a.manager).trim()}">${esc(val(a.manager))}</td>
      <td data-label="부서" class="${mE(a.dept).trim()}">${esc(val(a.dept))}</td>
      <td data-label="상태">${statusBadge(a.status)}</td>
      <td data-label="등재일">${esc(val(a.regDate))}</td>
      <td class="col-insp cell-insp${li ? "" : " m-empty"}" data-label="검수일"${li ? ` title="${esc(fmtSec(li.checkedAt))}${li.inspector ? ` · ${li.inspector}` : ""}${li.affiliation ? ` (${li.affiliation})` : ""}${li.period ? ` · ${li.period}` : ""}"` : ""}>${inspDate}${inspBy ? `<br>${inspBy}` : ""}</td>
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
  const roundOpts = roundOptions(inspRound);
  document.getElementById("bulk-insp-on").checked = false;
  document.getElementById("bulk-insp-fields").hidden = true;
  const bperiod = document.getElementById("bulk-insp-period");
  bperiod.innerHTML = roundOpts;
  bperiod.value = inspRound || "1회차";
  document.getElementById("bulk-insp-inspector").value = myProfile?.name || "";
  const baffil = document.getElementById("bulk-insp-affil");
  baffil.innerHTML = deptOptionsHtml(myProfile?.affiliation || "");
  baffil.value = myProfile?.affiliation || "";
  // 검수 취소 섹션 초기화
  document.getElementById("bulk-inspcancel-on").checked = false;
  document.getElementById("bulk-inspcancel-fields").hidden = true;
  const bcp = document.getElementById("bulk-inspcancel-period");
  bcp.innerHTML = roundOpts;
  bcp.value = inspRound || "1회차";
  show("bulkEditOverlay");
}
let bulkEditPhotoData = ""; // 일괄 수정에서 추가할 자산 사진(base64)
// 한 자산에 '필드 수정 + 검수 추가/취소'를 한 번의 저장으로 반영(따로 저장하면 서로 덮어써서 유실됨)
async function bulkApplyOne(a, fields, insp, cancelPeriod) {
  const id = String(a.id);
  const kind = id.startsWith("u") ? "added" : "override";
  const existing = overlay.find((o) => String(o.id) === id && o.kind === kind)?.data || {};
  const data = { ...existing, ...cleanFields(fields) };
  let list = Array.isArray(a.inspections) ? a.inspections.slice() : [];
  let touchedInsp = false;
  if (cancelPeriod) { list = list.filter((ins) => ins.period !== cancelPeriod); touchedInsp = true; } // 해당 회차 기록 삭제(되돌리기)
  if (insp) {
    list.push({ id: "i" + Date.now() + Math.floor(Math.random() * 1000), periodType: "회차", period: insp.period, inspector: insp.inspector, affiliation: insp.affiliation, photo: "", checkedAt: new Date().toISOString() });
    touchedInsp = true;
  }
  if (touchedInsp) data.inspections = list;
  const { error } = await sb.from("assets").upsert({ id, kind, data, updated_at: new Date().toISOString() });
  if (error) throw error;
  const notes = [];
  if (Object.keys(fields).length) notes.push("일괄 수정");
  if (cancelPeriod) notes.push(`검수 취소 · ${cancelPeriod}`);
  if (insp) notes.push(`검수 확인 · ${insp.period} · 확인자: ${insp.inspector}${insp.affiliation ? ` (${insp.affiliation})` : ""}`);
  await logHistory({ asset_id: id, asset_name: a.assetName, action: (insp || cancelPeriod) ? "inspect" : "update", before: null, after: null, requester: insp ? (insp.inspector + (insp.affiliation ? ` (${insp.affiliation})` : "")) : "", note: notes.join(" · ") || "일괄 처리" });
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
  // 검수 취소(되돌리기) 옵션
  const cancelOn = document.getElementById("bulk-inspcancel-on").checked;
  const cancelPeriod = cancelOn ? document.getElementById("bulk-inspcancel-period").value.trim() : "";
  if (inspOn && cancelOn && insp.period === cancelPeriod) { errEl.textContent = "같은 회차를 검수 처리와 취소 둘 다 선택할 수 없습니다."; errEl.hidden = false; return; }
  if (Object.keys(fields).length === 0 && !inspOn && !photoOn && !cancelOn) { errEl.textContent = "변경할 항목을 체크하거나 사진/검수 처리/검수 취소를 선택해주세요."; errEl.hidden = false; return; }
  if (cancelOn && !confirm(`선택한 자산들의 ‘${cancelPeriod}’ 검수 기록을 삭제(되돌리기)합니다.\n계속할까요?`)) return;
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
      if (insp || photoOn || cancelOn) await bulkApplyOne(a, perFields, insp, cancelPeriod); // 필드+사진+검수(추가/취소) 한 번에
      else await applyUpdate(id, perFields, { note: "일괄 수정" });    // 필드만 (기존 로직)
      done++;
    } catch (e) { console.error("일괄 수정 실패:", id, e); failed++; }
  }
  btn.disabled = false;
  hide("bulkEditOverlay");
  selectedIds.clear();
  await reloadAll(); rerender();
  const extra = [photoOn ? "사진" : "", insp ? "검수" : "", cancelOn ? "검수취소" : ""].filter(Boolean).join("·");
  alert(`일괄 처리 완료: ${done}건 적용${failed ? `, ${failed}건 실패` : ""}${extra ? ` (${extra} 포함)` : ""}`);
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
    ["자산명", a.assetName], ["자산코드", a.assetNumber], ["라벨스티커", a.labelSticker],
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
  // 사진 추가: 로그인해야 가능. 관리자는 즉시 반영, 일반 사용자는 수정 요청으로 접수.
  const photoBtn = document.getElementById("detailPhotoBtn");
  const full = pics.length >= MAX_PHOTOS;
  photoBtn.hidden = !currentUser;
  photoBtn.disabled = full;
  photoBtn.textContent = full ? `📷 사진 ${MAX_PHOTOS}장 가득참` : (isAdmin ? "📷 사진 추가" : "📷 사진 추가 요청");
  photoBtn.title = full
    ? `사진은 자산당 최대 ${MAX_PHOTOS}장입니다. 더 넣으려면 '수정'에서 기존 사진을 지워주세요.`
    : `현재 ${pics.length}/${MAX_PHOTOS}장 · 촬영하거나 앨범에서 골라 추가합니다`;
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
// 회원가입용 부서 선택지: 목록에 없으면 '직접 입력'으로 부서명을 적을 수 있게 한다.
function deptSignupOptionsHtml() {
  return `<option value="" disabled selected>부서를 선택하세요</option>`
    + DEPTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("")
    + `<option value="__custom__">＋ 기타 (직접 입력)</option>`;
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
// 이미지(dataURL)를 시계방향 90도 등으로 회전한 dataURL 반환 (색상 보존)
function rotateImageDataUrl(dataUrl, deg = 90) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const rot = ((deg % 360) + 360) % 360;
      const swap = rot === 90 || rot === 270;
      const w = img.width, h = img.height;
      const canvas = document.createElement("canvas");
      canvas.width = swap ? h : w; canvas.height = swap ? w : h;
      const ctx = canvas.getContext("2d");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rot * Math.PI / 180);
      ctx.drawImage(img, -w / 2, -h / 2);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
const MAX_PHOTOS = 6; // 자산당 물품 사진 최대 장수 (저장공간 보호)
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
      const data = await compressImage(f, 780, 0.55); // 저장공간 절약(무료 용량 연장)
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
// dataUrl을 한 번만 디코드해 두고 여러 인식 패스에서 재사용(큰 폰 사진의 반복 디코드 비용 제거).
function decodeImageOnce(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}
// 인식률을 높이기 위해 그레이스케일 + 대비 보정 후 캔버스로 변환. rotate(0/90/180/270)로 회전도 지원.
// src: dataUrl(문자열) 또는 이미 로드된 이미지(HTMLImageElement/ImageBitmap) — 이미지면 재디코딩 없이 즉시 처리.
function preprocessOcrImage(src, max, min, rotate = 0) {
  const render = (img) => {
    const longest = Math.max(img.width, img.height);
    // max/min 인자로 해상도 조절(1차 저해상도=빠름, 2차 고해상도=정확).
    const MAX = max || 2400, MIN = (min === undefined ? 1800 : min);
    const s = longest > MAX ? MAX / longest : (MIN && longest < MIN ? MIN / longest : 1);
    const w0 = Math.round(img.width * s), h0 = Math.round(img.height * s);
    const rot = ((rotate % 360) + 360) % 360;
    const rad = rot * Math.PI / 180;
    // 회전 후 이미지 전체가 들어가도록 캔버스를 '바운딩 박스'로 확장(모서리·오른쪽 끝 잘림 방지).
    // 대각선 보정 시 마지막 자리가 잘리지 않도록 하는 핵심. 0/90/180/270도 정확히 처리됨.
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const w = Math.max(1, Math.round(w0 * cos + h0 * sin));
    const h = Math.max(1, Math.round(w0 * sin + h0 * cos));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // 회전 여백은 라벨 배경과 같은 흰색(투명→검정 방지)
    // 흑백+대비를 GPU 가속 필터로 처리(픽셀 루프보다 훨씬 빠름). 미지원 브라우저는 수동 처리로 폴백.
    let filtered = false;
    try { ctx.filter = "grayscale(1) contrast(1.35)"; filtered = ctx.filter && ctx.filter !== "none"; } catch {}
    if (rot) { ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(rad); ctx.drawImage(img, -w0 / 2, -h0 / 2, w0, h0); ctx.restore(); }
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
    return canvas;
  };
  // 이미 디코드된 이미지면 즉시 렌더(재디코딩 없음)
  if (src && typeof src !== "string" && src.width) return Promise.resolve(render(src));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(render(img));
    img.onerror = reject;
    img.src = src;
  });
}
// 텍스트 기울기(대각선) 자동 감지: 작은 이미지를 여러 각도로 돌려보며 '행별 검은 픽셀 합의 분산'이
// 최대인 각도를 찾는다(수평일수록 글자가 특정 행에 몰려 분산↑). 반환값만큼 돌리면 수평이 된다.
// 작은 이미지에서만 계산해 빠르다(~수십 ms). 감지 실패/애매하면 0(보정 안 함).
function estimateSkew(img, limit = 32, step = 2) {
  try {
    if (!img || typeof img === "string" || !img.width) return 0;
    const W = 360, s = W / Math.max(img.width, img.height);
    const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
    const base = document.createElement("canvas"); base.width = w; base.height = h;
    const bx = base.getContext("2d");
    try { bx.filter = "grayscale(1) contrast(2.2)"; } catch {}
    bx.drawImage(img, 0, 0, w, h);
    const size = Math.ceil(Math.hypot(w, h));
    const t = document.createElement("canvas"); t.width = size; t.height = size;
    const tx = t.getContext("2d");
    const score = (deg) => {
      tx.save(); tx.fillStyle = "#fff"; tx.fillRect(0, 0, size, size);
      tx.translate(size / 2, size / 2); tx.rotate(deg * Math.PI / 180); tx.drawImage(base, -w / 2, -h / 2); tx.restore();
      const d = tx.getImageData(0, 0, size, size).data;
      const rows = new Float64Array(size);
      for (let y = 0; y < size; y++) { let sum = 0; const off = y * size * 4; for (let x = 0; x < size; x++) { if (d[off + x * 4] < 128) sum++; } rows[y] = sum; }
      let m = 0; for (let y = 0; y < size; y++) m += rows[y]; m /= size;
      let v = 0; for (let y = 0; y < size; y++) { const dv = rows[y] - m; v += dv * dv; }
      return v;
    };
    let best = 0, bs = -1;
    for (let a = -limit; a <= limit; a += step) { const sc = score(a); if (sc > bs) { bs = sc; best = a; } }
    return best;
  } catch { return 0; }
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
  if (!show) setScanProgress(null); // 닫힐 때 링 초기화(다음 촬영 대비)
}
// 인식 진행률 링 갱신: pct(0~100)면 파란색이 그만큼 차오르고 숫자 표시, null이면 회전(진행률 미상).
function setScanProgress(pct) {
  const ring = document.getElementById("scanRing");
  if (!ring) return;
  ring.classList.remove("done");
  const num = document.getElementById("scanRingNum");
  if (pct == null || isNaN(pct)) {
    ring.classList.add("indet");
    ring.style.setProperty("--p", 0);
    if (num) num.textContent = "";
  } else {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    ring.classList.remove("indet");
    ring.style.setProperty("--p", p);
    if (num) num.textContent = p + "%";
  }
}
// 인식 성공 순간: 링을 초록 ✓로 (아주 짧게 보여준 뒤 검수 화면으로)
function showScanSuccess() {
  const ring = document.getElementById("scanRing");
  const num = document.getElementById("scanRingNum");
  if (!ring) return;
  ring.classList.remove("indet");
  ring.classList.add("done");
  ring.style.setProperty("--p", 100);
  if (num) num.textContent = "✓";
}
// 촬영 결과 피드백용 진동(햅틱) — 지원 기기에서만. 성공은 짧게 톡, 실패는 두 번.
function scanHaptic(ok) { try { navigator.vibrate && navigator.vibrate(ok ? 35 : [40, 55, 40]); } catch {} }
// ===== 연속 검수 카운터 (이번 세션에 처리한 검수 건수) =====
let scanSessionCount = 0;
function bumpScanCount() { scanSessionCount++; updateScanCountBadge(); }
function updateScanCountBadge() {
  const btn = document.getElementById("scanInspectBtn");
  if (!btn) return;
  let b = document.getElementById("scanCountBadge");
  if (scanSessionCount <= 0) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement("span"); b.id = "scanCountBadge"; b.className = "scan-count-badge"; btn.appendChild(b); }
  b.textContent = scanSessionCount;
  b.title = `이번 세션에 ${scanSessionCount}건 검수`;
}
// ===== 인식 실패 시 자산코드 직접 입력(현장 안전장치) =====
let scanPendingFile = null; // 직접입력에서 재사용할 촬영 사진(있으면 검수 사진으로 저장)
let scanLastCode = "";      // 마지막으로 인식된 자산코드(수정 시 프리필용)
function openManualCode(file, prefill) {
  scanPendingFile = file || null;
  const inp = document.getElementById("manualCodeInput");
  const err = document.getElementById("manualCodeErr");
  const hint = document.getElementById("manualCodeHint");
  if (err) err.hidden = true;
  if (inp) inp.value = prefill || "";
  if (hint) hint.textContent = prefill
    ? `인식된 번호(${prefill})와 맞는 자산이 없어요. 번호를 확인해 고쳐 주세요.`
    : "자산코드를 못 읽었어요. 📷 다시 찍을 땐 라벨의 ‘자산번호(자산코드)’가 화면에 크고 또렷하게 나오도록 찍어 주세요. 또는 아래에 번호를 직접 입력하세요.";
  show("manualCodeOverlay");
  setTimeout(() => { if (inp) inp.focus(); }, 120);
}
async function submitManualCode() {
  const inp = document.getElementById("manualCodeInput");
  const err = document.getElementById("manualCodeErr");
  const code = (inp && inp.value || "").trim();
  if (!code) { if (err) { err.textContent = "자산코드를 입력해 주세요."; err.hidden = false; } return; }
  const a = findAssetByNumber(code) || findAsset2024ByCode(code);
  if (!a) { if (err) { err.textContent = "일치하는 자산이 없어요. 번호를 다시 확인해 주세요."; err.hidden = false; } return; }
  hide("manualCodeOverlay");
  let photo = "";
  try { if (scanPendingFile) photo = await compressImage(scanPendingFile, 780, 0.55); } catch {}
  scanLastCode = code; // 다시 틀렸을 때 또 고칠 수 있게 유지(scanPendingFile도 유지)
  openInspect(a.id, photo, true);
}
// 인식(OCR) 취소용 플래그 — 사용자가 '인식 취소'를 누르면 true. 각 인식 단계 앞에서 확인해 중단한다.
let scanCancelRequested = false;
function makeCancelError() { const e = new Error("인식이 취소되었습니다."); e.name = "AbortError"; return e; }
// 재사용 중인 숫자 OCR 워커를 종료해 '진행 중인' 인식까지 즉시 끊는다(다음 사용 시 자동으로 새로 만든다).
function terminateNumberOcrWorker() {
  if (!_numOcrWorkerPromise) return;
  const p = _numOcrWorkerPromise;
  _numOcrWorkerPromise = null;
  p.then((w) => { try { w && w.terminate && w.terminate(); } catch {} }).catch(() => {});
}
// 단일(카메라) 검수 인식 취소 — 로딩 오버레이의 '인식 취소' 버튼
function cancelScanRecognition() {
  scanCancelRequested = true;
  terminateNumberOcrWorker();
  batchSuppressScan = false;
  setScanLoading("", false);
}
// 인식 중 '직접 입력'으로 전환: 진행 중 인식을 멈추고 방금 촬영본으로 직접 입력창을 연다.
function switchToManualInput() {
  const f = scanPendingFile;      // 방금 촬영한 사진(있으면 검수 사진으로 저장)
  cancelScanRecognition();        // 진행 중이던 인식 중단(없어도 안전)
  openManualCode(f, "");
}
// 인식 중 '다시 촬영': 진행 중 인식을 멈추고 카메라를 다시 연다(느리거나 안 잡힐 때 즉시 재촬영).
function retakeFromScan() {
  cancelScanRecognition();
  const input = document.getElementById("scanCameraInput");
  if (input) { input.value = ""; input.click(); }
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
// 자산코드를 정규화(공백·하이픈 제거)해 비교하며 자산을 찾는다.
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
  // 4) 근접 매칭: 실제 등록된 자산코드 중 편집거리가 최소이면서 '유일하게 가까운' 후보만 채택.
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
// 2024년도 자산코드(예: G20250019-0001)처럼 '문자+숫자(+하이픈)' 형식 후보를 뽑는다.
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
      const logger = (m) => { if (_numOcrProgress) _numOcrProgress(m); };
      // 1순위: 로컬 번들(엔진·워커·코어·언어모델 모두 같은 서버에서 제공) → 첫 인식 다운로드 지연 제거.
      //   · corePath: LSTM 전용 SIMD 코어(약 3.9MB, wasm 내장 단일파일). eng+숫자만 쓰므로 legacy 불필요.
      //   · langPath: /vendor/tesseract/eng.traineddata.gz (fast 모델)
      let w = null;
      try {
        w = await Tesseract.createWorker("eng", 1, {
          workerPath: "/vendor/tesseract/worker.min.js",
          corePath: "/vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
          langPath: "/vendor/tesseract",
          gzip: false, // 압축 해제된 eng.traineddata 제공(호스팅의 Content-Encoding 이중해제 문제 회피)
          logger,
        });
      } catch (e) {
        // 로컬 번들 접근 실패(경로·SIMD 미지원 등) → CDN으로 폴백해 어떤 환경에서도 동작 보장.
        console.warn("로컬 OCR 엔진 로드 실패 → CDN 폴백:", e);
        w = await Tesseract.createWorker("eng", 1, {
          // fast 언어모델(약 2MB) — 표준(약 11MB)보다 다운로드·초기화·인식이 모두 빠르다. 숫자 인식엔 충분.
          langPath: "https://tessdata.projectnaptha.com/4.0.0_fast",
          logger,
        });
      }
      // tessedit_do_invert=0: 라벨은 항상 '흰 바탕·검은 글자'이므로 반전 이미지 재인식(기본 ON)을
      // 끈다 → 이미지당 인식 시간이 거의 절반. (흰 글자 라벨은 없으므로 정확도 손해 없음)
      try { await w.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "0123456789", tessedit_do_invert: "0" }); } catch {}
      // 예열 더미 인식: Tesseract는 '첫 recognize'에서 인식 엔진을 늦게 초기화한다(~1.5초+).
      // 작은 더미 이미지로 그 초기화를 예열 단계에 미리 끝내 두면, 사용자의 첫 촬영이 즉시 인식된다.
      try { const dc = document.createElement("canvas"); dc.width = 40; dc.height = 40; const dx = dc.getContext("2d"); dx.fillStyle = "#fff"; dx.fillRect(0, 0, 40, 40); dx.fillStyle = "#000"; dx.font = "20px monospace"; dx.fillText("0", 12, 28); await w.recognize(dc); } catch {}
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
  const ck = () => { if (scanCancelRequested) throw makeCancelError(); }; // 각 단계 앞에서 취소 여부 확인
  try {
    ck();
    setScanLoading("자산코드를 읽는 중이에요…", true);
    setScanProgress(null); // 준비 단계는 진행률 미상 → 회전
    // 진행률은 원형 링으로 표시(숫자 %가 차오름). 메시지는 안정적인 안내문 유지.
    _numOcrProgress = (m) => { if (m.status === "recognizing text") setScanProgress(Math.round((m.progress || 0) * 100)); };
    // 원본을 한 번만 디코드해 모든 인식 패스에서 재사용(큰 폰 사진의 반복 디코딩 비용 제거 → 빠름)
    //  · dataUrl이 이미 디코드된 이미지(ImageBitmap 등)면 그대로 사용(디코드 생략 → 초반 지연 제거)
    let ocrSrc = dataUrl;
    if (typeof dataUrl === "string") { try { ocrSrc = await decodeImageOnce(dataUrl); } catch {} }
    const worker = await getNumberOcrWorker();
    ck();
    if (worker) {
      // 1차: 메뉴에 맞는 화이트리스트 + 중간 해상도 (한 번에 끝나도록)
      try { await worker.setParameters({ tessedit_char_whitelist: alnumMode ? OCR_WL_ALNUM : OCR_WL_DIGIT }); } catch {}
      // 1차 해상도: 안정적으로 한 번에 읽히도록 1500(너무 낮추면 애매한 사진이 자주 2차로 넘어가
      // '다시 인식중'이 잦아지고 결과가 들쭉날쭉해진다). 초반 지연은 디코딩 최적화로 이미 줄임.
      const first = await preprocessOcrImage(ocrSrc, alnumMode ? 1800 : 1500, 0);
      let { data } = await worker.recognize(first);
      addFrom(data.text); if (alnumMode) tryAlnum(data.text);
      // 대각선(살짝 기울어진) 라벨 보정: 기울기를 감지해 '한 번에' 펴서 재시도(직각 회전보다 먼저).
      // 감지가 빨라 여러 각도를 OCR로 훑지 않아 빠르다. 똑바른 사진은 감지≈0이라 건드리지 않음.
      if (!done() && typeof ocrSrc !== "string") {
        ck();
        const skew = estimateSkew(ocrSrc);
        if (Math.abs(skew) >= 4) {
          setScanLoading("사진 기울기를 바로잡는 중…", true);
          setScanProgress(null);
          const desk = await preprocessOcrImage(ocrSrc, alnumMode ? 1800 : 1600, 0, skew);
          ({ data } = await worker.recognize(desk));
          addFrom(data.text); if (alnumMode) tryAlnum(data.text);
        }
      }
      // 1차 실패 시에만 고해상도로 정밀 재시도. 화이트리스트는 '비우지 않고' 메뉴에 맞게 유지
      // (숫자/영숫자만) → 모든 문자를 훑는 느린 인식을 피해 빠르고 정확하게. (2024는 영숫자 포함)
      if (!done()) {
        ck();
        setScanLoading("자산을 다시 확인하는 중…", true);
        setScanProgress(null);
        const high = await preprocessOcrImage(ocrSrc, 2000, 1600);
        try { await worker.setParameters({ tessedit_char_whitelist: alnumMode ? OCR_WL_ALNUM : OCR_WL_DIGIT }); } catch {}
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
        for (const deg of [90, 270]) {
          ck();
          setScanLoading("사진을 돌려서 다시 확인하는 중…", true);
          setScanProgress(null);
          const rimg = await preprocessOcrImage(ocrSrc, 1500, 1200, deg);
          ({ data } = await worker.recognize(rimg));
          addFrom(data.text); if (alnumMode) tryAlnum(data.text);
          if (done()) break;
        }
      }
    } else {
      const image = await preprocessOcrImage(ocrSrc, 2000, 1600);
      let { data } = await Tesseract.recognize(image, "eng");
      addFrom(data.text); tryAlnum(data.text);
      // 회전 재시도(옵션)
      if (tryRotate) for (const deg of [90, 270]) {
        if (done()) break;
        const rimg = await preprocessOcrImage(ocrSrc, 1500, 1200, deg);
        ({ data } = await Tesseract.recognize(rimg, "eng"));
        addFrom(data.text); tryAlnum(data.text);
      }
    }
  } catch (e) {
    // 취소(직접 AbortError이거나, 취소로 워커가 종료돼 생긴 오류)는 위로 전달해 조용히 중단
    if (scanCancelRequested || (e && e.name === "AbortError")) { _numOcrProgress = null; throw makeCancelError(); }
    console.error("자산코드 인식 오류:", e);
  } finally {
    _numOcrProgress = null;
  }
  if (scanCancelRequested) throw makeCancelError();
  // 우선순위: 숫자(20자리) 매칭 → 2024 문자형식 매칭 → 표시용 후보
  const hit = matched();
  if (hit) return hit;
  if (alnumHit) return alnumHit.assetNumber; // 정확한 자산코드를 돌려주면 handleScanCapture가 그대로 매칭
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
// 카메라로 찍은 사진 처리: 자산코드 인식 → 매칭 자산의 검수 확인 화면 열기
async function handleScanCapture(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) { alert("이미지(사진)만 사용할 수 있습니다."); return; }
  scanCancelRequested = false; // 새 촬영 시작 → 이전 취소 상태 초기화
  scanPendingFile = file;       // 인식 중 '직접 입력' 버튼이 이 촬영본을 재사용
  try {
    setScanLoading("사진을 준비하는 중…", true);
    setScanProgress(null);
    // 파일에서 '바로' 디코드(하드웨어 가속) → base64 인코딩·재디코딩 왕복 제거로 초반 지연 감소.
    // imageOrientation:'from-image'로 EXIF 회전 반영(세로 사진이 눕지 않게). 미지원 시 기존 방식 폴백.
    let ocrInput;
    try { ocrInput = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch { try { ocrInput = await createImageBitmap(file); } catch { ocrInput = await fileToDataURL(file); } }
    // 지금 메뉴가 2024면 문자+숫자(G형식) 우선 인식, 아니면 숫자(20자리) 우선
    const mode = currentGroup === GROUP_PAST ? "alnum" : "digit";
    // tryRotate=true: 옆으로/거꾸로 찍힌 라벨도 회전해가며 자동 인식(회전 해상도는 낮춰 빠르게).
    // 인식이 길어지면 로딩창의 '✏️ 직접 입력'으로 언제든 빠져 자산코드를 손으로 칠 수 있다.
    const code = await recognizeAssetNumber(ocrInput, mode, null, true);
    if (!code) {
      setScanLoading("", false);
      scanHaptic(false);
      openManualCode(file, ""); // 인식 실패 → 번호 직접 입력(또는 다시 촬영) 폴백
      return;
    }
    const a = findAssetByNumber(code);
    if (!a) {
      setScanLoading("", false);
      scanHaptic(false);
      openManualCode(file, code); // 인식은 됐으나 매칭 실패 → 인식된 번호 프리필해 수정
      return;
    }
    // 매칭 성공 → 초록 ✓를 잠깐 보여주고(확신 피드백) 검수 확인 화면으로
    scanHaptic(true);
    showScanSuccess();
    await new Promise((r) => setTimeout(r, 320));
    setScanLoading("", false);
    scanLastCode = typeof code === "string" ? code : (a.assetNumber || "");
    // 이미 이번 회차 검수된 자산이면 스캔 즉시 안내(중복 검수 방지) — 상세는 검수 화면 배너로도 표시.
    if (inspectedRound(a, inspRound)) toast(`⚠️ 이미 ${inspRound} 검수된 자산이에요.`, "warn");
    const photo = await compressImage(file, 780, 0.55);
    openInspect(a.id, photo, true); // fromScan=true → '코드 수정' 버튼 노출
  } catch (e) {
    setScanLoading("", false);
    if (e && e.name === "AbortError") return; // 사용자가 '인식 취소'를 누름 → 조용히 종료
    console.error("사진촬영 검수 오류:", e);
    alert("사진 처리 중 문제가 발생했습니다. 다시 시도해 주세요.");
  }
}
// ===== 여러 장 한번에 검수 (갤러리에서 라벨 사진 여러 장 업로드 → 각 사진의 자산코드 인식 → 일괄 검수 완료) =====
// 위치·자산명 필터를 넣으면 그 범위로 좁혀 인식·매칭하므로, 한 곳에서 모아 찍은 사진을 한꺼번에 올릴 때 정확도가 높아진다.
let batchItems = [];       // { name, photoData, code, asset, status, overwrite } — status: matched|dup|already|samephoto|nomatch|error
let batchMode = "label";   // "label"(라벨 사진 여러 장) | "pdf"(자산 등록 PDF) — PDF 모드는 사진 인식을 하지 않는다
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
  // 이미 이번 회차에 검수됨:
  //  · 라벨 사진 등록 모드 → 'relabel'(검수는 그대로 두고 라벨 사진만 추가)
  //  · PDF 검수 모드 → 'already'(건너뛰기/덮어쓰기 선택)
  if (inspectedRound(asset, period)) return batchMode === "pdf" ? "already" : "relabel";
  return "matched";
}
function openBatchInspect() {
  if (!requireLogin()) return false;
  if (currentGroup === GROUP_ELEC) { alert("여러 장/PDF 검수는 2025·2024년도 자산 메뉴에서 사용할 수 있습니다."); return false; }
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
  bp.innerHTML = roundOptions(inspRound);
  bp.value = inspRound || "1회차";
  document.getElementById("batch-inspector").value = myProfile?.name || "";
  const affil = myProfile?.affiliation || "";
  const bAffil = document.getElementById("batch-affil");
  bAffil.innerHTML = deptOptionsHtml(affil);
  bAffil.value = affil;
  setBatchMode("label");
  const note = document.getElementById("batchInspectNote");
  if (note) note.hidden = isAdmin;
  renderBatchList();
  show("batchInspectOverlay");
  return true;
}
// 검수 창을 '라벨 사진'용 / '자산 등록 PDF'용으로 전환 (제목·안내·버튼 노출을 함께 바꾼다)
function setBatchMode(mode) {
  batchMode = mode === "pdf" ? "pdf" : "label";
  const pdf = mode === "pdf";
  const title = document.getElementById("batchInspectTitle");
  const lead = document.getElementById("batchLead");
  const verb = isAdmin ? "" : " 요청";
  if (title) title.textContent = (pdf ? "자산 등록 PDF 검수" : "라벨 사진 등록") + verb;
  if (lead) lead.innerHTML = pdf
    ? "<b>자산 등록 PDF</b>(자산코드·위치 표)를 올리면 코드와 위치를 함께 인식해 한 번에 검수합니다. 등록 안 된 코드는 <b>‘미등록 코드’</b>로 표시되니 재확인하세요. 검수하면 <b>위치도 함께 저장</b>됩니다."
    : "<b>라벨 사진</b>을 여러 장 올리면 각 사진의 자산코드를 인식해 그 자산에 <b>라벨 사진을 등록</b>합니다. 아직 검수 안 된 자산은 <b>검수도 함께</b> 처리되고, 이미 검수된 자산은 <b>라벨 사진만 추가</b>됩니다.";
  // 라벨용/PDF용 버튼을 모드에 맞게만 노출
  const show1 = (id, on) => { const el = document.getElementById(id); if (el) el.hidden = !on; };
  show1("batchPickBtn", !pdf);
  show1("batchPdfBtn", pdf);
  show1("batchTemplateRow", pdf);   // 양식 다운로드/등록 줄은 PDF 모드에서만
  if (pdf) refreshTemplateUI();
}
// '📄 자산 등록 PDF 검수' 버튼 → 검수 창을 PDF 모드로 연다. (바로 파일창을 띄우지 않고, 창 안에서 직접 고르게 함)
function openPdfInspect() {
  if (!openBatchInspect()) return;               // 로그인·메뉴 확인 실패 시 중단
  setBatchMode("pdf");
}
// ===== 자산 등록 PDF 양식(한글 파일) — 최고관리자가 등록, 모두가 다운로드 =====
// 양식 정보(url·파일명)는 별도 테이블 없이 assets 테이블의 예약 행(kind='config')에 저장한다.
const TEMPLATE_CFG_ID = "config-pdf-template";
let templateCfgCache; // undefined=미로딩, null=없음, {url, filename}=등록됨
async function loadTemplateConfig(force) {
  if (!sb) return null;
  if (!force && templateCfgCache !== undefined) return templateCfgCache;
  try {
    const { data } = await sb.from("assets").select("data").eq("id", TEMPLATE_CFG_ID).maybeSingle();
    templateCfgCache = (data && data.data) || null;
  } catch (e) { console.warn("양식 정보 로드 실패:", e?.message || e); templateCfgCache = null; }
  return templateCfgCache;
}
async function saveTemplateConfig(cfg) {
  const { error } = await sb.from("assets").upsert({ id: TEMPLATE_CFG_ID, kind: "config", data: cfg, updated_at: new Date().toISOString() });
  if (error) throw error;
  templateCfgCache = cfg;
}
// 양식이 등록됐는지 (Storage URL 또는 DB 저장본)
function templateSrc(cfg) { return cfg && (cfg.url || cfg.dataUrl) ? (cfg.url || cfg.dataUrl) : ""; }
// PDF 모드가 열릴 때 양식 등록 여부/파일명, 업로드 버튼(최고관리자) 노출을 갱신
async function refreshTemplateUI() {
  const upBtn = document.getElementById("batchTemplateUpload");
  if (upBtn) upBtn.hidden = !isSuperAdmin;   // 양식 등록/교체는 최고관리자만
  const nameEl = document.getElementById("batchTemplateName");
  if (nameEl) nameEl.textContent = "양식 확인 중…";
  const cfg = await loadTemplateConfig(false); // 세션당 1회만 조회(용량 절약)
  if (!nameEl) return;
  if (templateSrc(cfg)) nameEl.textContent = `현재 양식: ${cfg.filename || "등록됨"}`;
  else nameEl.textContent = isSuperAdmin ? "등록된 양식이 없습니다. ‘양식 등록/교체’로 올려주세요." : "아직 등록된 양식이 없습니다. (최고관리자 등록 후 이용 가능)";
}
// 임의 파일(한글 등)을 Storage에 올리고 공개 URL 반환 — 원본 확장자·파일명 보존
async function uploadTemplateFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const safe = (file.name || "template").replace(/[^\w.\-가-힣]/g, "_");
  const path = `templates/${Date.now()}-${safe}`;
  const type = file.type || "application/octet-stream";
  const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, new Blob([buf], { type }), { contentType: type, upsert: true, cacheControl: MEDIA_CACHE_CONTROL });
  if (error) throw error;
  return sb.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}
// 최고관리자: 양식 파일 등록/교체
// 1차로 Storage에 올리고, 버킷이 한글(HWP) 등 파일형식을 막으면 2차로 DB(config 행)에 직접 저장한다.
async function handleTemplateUpload(file) {
  if (!file) return;
  if (!isSuperAdmin) { alert("양식 등록은 최고관리자만 할 수 있습니다."); return; }
  if (file.size > 20 * 1024 * 1024) { alert("양식 파일은 20MB 이하로 올려주세요."); return; }
  const nameEl = document.getElementById("batchTemplateName");
  if (nameEl) nameEl.textContent = "양식 올리는 중…";
  const base = { filename: file.name || "자산등록양식", updatedAt: new Date().toISOString() };
  let cfg = null, storageErr = "";
  try {
    const url = await uploadTemplateFile(file);          // 1차: Storage
    cfg = { ...base, url };
  } catch (e1) {
    storageErr = e1?.message || String(e1);
    console.warn("양식 Storage 업로드 실패 — DB 저장으로 대체:", storageErr);
    try {
      const dataUrl = await fileToDataURL(file);          // 2차: DB에 base64로 저장 (버킷 제한 우회)
      cfg = { ...base, dataUrl };
    } catch (e2) {
      alert("양식 파일을 읽지 못했습니다.\n원인: " + (e2?.message || e2));
      refreshTemplateUI(); return;
    }
  }
  try {
    await saveTemplateConfig(cfg);
    alert(`양식이 등록되었습니다. 이제 모든 사용자가 ‘양식 다운로드’로 받을 수 있습니다.${cfg.dataUrl ? "\n(저장소가 이 형식을 막아 DB에 저장했습니다 — 다운로드는 정상 동작합니다.)" : ""}`);
  } catch (e3) {
    console.error("양식 저장 오류:", e3);
    alert("양식 저장에 실패했습니다.\n원인: " + (e3?.message || e3) + (storageErr ? `\n(저장소 오류: ${storageErr})` : ""));
  }
  refreshTemplateUI();
}
// 양식 다운로드 (원본 파일명으로 저장되도록 blob으로 받아 내려줌)
async function downloadPdfTemplate() {
  const cfg = await loadTemplateConfig();
  const src = templateSrc(cfg);
  if (!src) { alert("아직 등록된 양식이 없습니다.\n최고관리자가 ‘양식 등록/교체’로 파일을 올린 뒤 이용할 수 있습니다."); return; }
  try {
    const res = await fetch(src);        // src는 Storage URL 또는 data:URL(DB 저장본) 둘 다 fetch 가능
    if (!res.ok) throw new Error("fetch 실패");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = cfg.filename || "자산등록양식";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) {
    console.warn("양식 blob 다운로드 실패 — 새 탭으로 엽니다:", e?.message || e);
    window.open(src, "_blank");
  }
}
// 여러 장 업로드 처리: 파일마다 순서대로 인식 → 결과를 즉시 목록에 반영
async function handleBatchFiles(files) {
  const list = Array.from(files || []).filter((f) => f && f.type && f.type.startsWith("image/"));
  if (!list.length) { alert("이미지(사진) 파일을 선택해 주세요."); return; }
  if (batchProcessing) return;
  scanCancelRequested = false; // 새 업로드 시작 → 이전 취소 상태 초기화
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
      if (scanCancelRequested) break; // '인식 취소' → 남은 사진은 처리하지 않음
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
        // tryRotate=true: 검수 촬영과 동일하게, 갤러리 사진이 EXIF 회전으로 눕혀져 실패하면
        // 90·180·270도 돌려가며 재인식. (회전은 일반 패스 실패 시에만 → 정상 사진은 속도 손해 없음)
        const { asset, code } = await recognizeAssetInPool(raw, mode, pool, true);
        item.code = code || null;
        if (!asset) {
          item.status = "nomatch";
        } else {
          item.asset = asset;
          item.photoData = await compressImage(file, 780, 0.55); // 라벨/검수 사진(압축).
          item.status = classifyBatchItem(item, asset, period);
          // '중복 처리 방법 선택'(건너뛰기/덮어쓰기) 안내는 PDF 검수 모드에만 해당. 라벨 등록 모드는 자동 처리.
          if (batchMode === "pdf" && (item.status === "dup" || item.status === "already")) newDup++;
        }
      } catch (e) {
        if (e && e.name === "AbortError") { item.status = "canceled"; renderBatchList(); break; } // 취소 → 이 사진 표시 후 중단
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
  if (newDup && !scanCancelRequested) {
    alert(`자산코드가 중복되는 사진이 ${newDup}장 있습니다.\n(같은 번호가 여러 장이거나, 이미 이번 회차에 검수된 자산)\n\n화면 아래 ‘⏭️ 건너뛰고 완료’ 또는 ‘🔁 덮어쓰기 완료’ 버튼으로 처리 방법을 한 번에 선택하세요.`);
  }
}
// ===== PDF 목록으로 검수 (PDF 안의 자산코드를 모두 읽어 한 번에 검수) =====
// PDF의 모든 페이지에서 글자를 추출한다. 같은 줄(y좌표 근접) 아이템을 x순으로 이어 붙여
// 표의 자산코드가 한 덩어리로 잡히게 한다. (텍스트가 들어있는 PDF에서 동작 — 스캔 이미지 PDF는 글자가 없음)
async function extractPdfText(dataUrl, onProgress) {
  await ensurePdfjs();
  if (!window.pdfjsLib) throw new Error("PDF 라이브러리 미로드");
  const base64 = (dataUrl.split(",")[1]) || "";
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const pdf = await window.pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/",
  }).promise;
  let out = "";
  const n = pdf.numPages;
  for (let p = 1; p <= n; p++) {
    if (scanCancelRequested) break;
    if (onProgress) onProgress(p, n);
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const lines = new Map();
    tc.items.forEach((it) => {
      if (!it.str) return;
      const key = Math.round((it.transform[5] || 0) / 2); // 2px 단위로 묶어 같은 줄로
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push({ x: it.transform[4] || 0, s: it.str });
    });
    [...lines.keys()].sort((a, b) => b - a).forEach((k) => {
      out += lines.get(k).sort((a, b) => a.x - b.x).map((o) => o.s).join(" ") + "\n";
    });
  }
  try { pdf.destroy && pdf.destroy(); } catch {}
  return out;
}
// PDF 표의 한 줄에서 '자산코드'와 '위치'를 함께 뽑는다.
//  · 코드: 숫자형 16~24자리(내부 .- 허용) 우선, 없으면 문자+숫자형(G20250019-0001)
//  · 위치: 그 줄에서 코드 부분을 뺀 나머지(한글·영어·숫자 무엇이든). 표 두 칸이 공백으로 붙어 나옴.
function parsePdfRow(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;
  let code = null, span = null;
  const digitMatches = raw.match(/\d[\d.\-]{14,26}/g) || [];   // 셀 안 코드는 공백 없이 붙어 있음
  for (const dm of digitMatches) {
    const d = dm.replace(/[.\-]/g, "");
    if (d.length >= 16 && d.length <= 24) { code = d; span = dm; break; }
  }
  if (!code) {
    const am = raw.match(/[A-Za-z][A-Za-z0-9\-]{5,}/g) || [];
    for (const a of am) { const up = a.toUpperCase(); if (/[A-Z]/.test(up) && /\d/.test(up)) { code = up.replace(/[^A-Z0-9\-]/g, ""); span = a; break; } }
  }
  if (!code) return null;
  const location = raw.replace(span, " ").replace(/\s+/g, " ").trim(); // 코드 뺀 나머지 = 위치
  return { code, location };
}
// PDF 추출 텍스트를 줄 단위로 훑어 {code, location} 목록을 만든다. 같은 코드가 여러 번이면 위치가 있는 행을 우선.
function extractPdfRows(text) {
  const map = new Map();
  String(text || "").split(/[\r\n]+/).forEach((line) => {
    const row = parsePdfRow(line);
    if (!row) return;
    const prev = map.get(row.code);
    if (!prev || (!prev.location && row.location)) map.set(row.code, row);
  });
  return [...map.values()];
}
// 자산 등록 PDF 파일 하나를 읽어 '자산코드+위치'를 인식하고, 매칭 자산을 검수 목록(batchItems)에 추가한다.
async function handlePdfInspect(file) {
  if (!file) return;
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  if (!isPdf) { alert("PDF 파일을 선택해 주세요."); return; }
  if (batchProcessing) return;
  scanCancelRequested = false;
  batchProcessing = true; batchSuppressScan = true; batchDone = false; batchApplyMsg = "";
  batchRunTotal = 0; batchRunDone = 0;
  setBatchBusy(true);
  const summary = document.getElementById("batchInspectSummary");
  if (summary) summary.innerHTML = "📄 PDF를 여는 중…";
  let matchN = 0, codeCount = 0;
  const unmatchedCodes = [];   // 등록 안 된(일치 자산 없는) 코드 — 사용자에게 그대로 알려준다
  try {
    const dataUrl = await fileToDataURL(file);
    const text = await extractPdfText(dataUrl, (p, n) => {
      if (summary) summary.innerHTML = `📄 PDF 읽는 중… <b class="batch-prog">${p}/${n}</b>`;
    });
    if (scanCancelRequested) return;
    const period = document.getElementById("batch-period").value;
    const pool = buildInspectPool(document.getElementById("batch-location").value, document.getElementById("batch-name").value);
    const rows = extractPdfRows(text);
    codeCount = rows.length;
    const addedIds = new Set(batchItems.filter((it) => it.asset).map((it) => String(it.asset.id)));
    for (const { code, location } of rows) {
      const asset = findAssetByNumber(code, pool) || findAsset2024ByCode(code, pool)
                 || findAssetByNumber(code) || findAsset2024ByCode(code);
      if (!asset) { unmatchedCodes.push(code); continue; }
      if (addedIds.has(String(asset.id))) continue; // 이미 목록에 있는 자산은 건너뜀
      addedIds.add(String(asset.id));
      const item = { name: asset.assetNumber, file: null, thumb: "", photoData: "", code, asset, status: "matched", overwrite: false, fromPdf: true, pdfLocation: location || "" };
      item.status = classifyBatchItem(item, asset, period);
      batchItems.push(item);
      matchN++;
    }
    // 등록 안 된 코드도 목록에 그대로 보여준다(어떤 코드가 미등록인지 재확인용). 최대 500개.
    unmatchedCodes.slice(0, 500).forEach((code) => {
      const loc = (rows.find((r) => r.code === code) || {}).location || "";
      batchItems.push({ name: code, file: null, thumb: "", photoData: "", code, asset: null, status: "nomatch", overwrite: false, fromPdf: true, pdfLocation: loc });
    });
  } catch (e) {
    console.error("PDF 검수 처리 오류:", e);
    if (!scanCancelRequested) alert("PDF를 읽는 중 문제가 발생했습니다.\n텍스트가 들어있는 PDF인지 확인해 주세요. (스캔한 이미지 PDF는 글자를 읽을 수 없습니다 — 이 경우 라벨 사진 검수를 이용하세요.)");
  } finally {
    batchProcessing = false; batchRunTotal = 0; batchSuppressScan = false; setBatchBusy(false); renderBatchList();
  }
  if (scanCancelRequested) return;
  if (!codeCount) {
    alert("PDF에서 자산코드를 찾지 못했습니다.\n\n· 표 ‘자산 코드’ 칸에 코드(20자리 등)가 글자로 들어있는 PDF인지 확인하세요.\n· 스캔한 이미지 PDF라면 글자를 읽을 수 없습니다 — 라벨 사진 검수를 이용하세요.");
  } else {
    // 등록 안 된 코드가 있으면 어떤 코드인지 목록으로 보여준다(재확인).
    let msg = `📄 자산 등록 PDF에서 자산코드 ${codeCount}개를 읽었습니다.\n\n· 검수 대상으로 찾음: ${matchN}건`;
    if (unmatchedCodes.length) {
      const shown = unmatchedCodes.slice(0, 30).join("\n");
      msg += `\n\n⚠️ 등록되지 않은(일치 자산 없는) 코드 ${unmatchedCodes.length}개 — 재확인 필요:\n${shown}${unmatchedCodes.length > 30 ? `\n… 외 ${unmatchedCodes.length - 30}개 (목록의 ‘미등록 코드’ 참고)` : ""}`;
    }
    msg += `\n\n위치까지 확인한 뒤, 회차를 고르고 하단의 ‘검수 완료’를 누르세요. (검수와 함께 위치도 저장됩니다)`;
    alert(msg);
  }
}
const BATCH_STATUS = {
  processing: { cls: "b-proc", label: "인식 중…" },
  matched: { cls: "b-ok", label: "검수 준비됨" },
  relabel: { cls: "b-ok", label: "라벨 추가" },   // 이미 검수됨 → 라벨 사진만 추가(라벨 사진 등록 모드)
  dup: { cls: "b-dup", label: "번호 중복" },
  already: { cls: "b-dup", label: "이미 검수됨" },
  samephoto: { cls: "b-same", label: "이미 올린 사진" },
  nomatch: { cls: "b-err", label: "인식 실패" },
  error: { cls: "b-err", label: "인식 실패" },
  canceled: { cls: "b-same", label: "인식 취소됨" },
  done: { cls: "b-done", label: "완료" },
  savefail: { cls: "b-err", label: "저장 실패" },
};
// 이 항목이 실제로 처리될지 여부.
//  · 라벨 사진 등록: 인식된 자산은 모두 적용(matched=검수+라벨, relabel=라벨만, dup=같은 자산 1개로 합침)
//  · PDF 검수: 준비됨(matched) 또는 중복/이미검수인데 '덮어쓰기' 선택한 것
function batchWillApply(it) {
  if (!it.asset) return false;
  if (batchMode === "pdf") return it.status === "matched" || ((it.status === "dup" || it.status === "already") && it.overwrite);
  return it.status === "matched" || it.status === "relabel" || it.status === "dup";
}
function renderBatchList() {
  const grid = document.getElementById("batchInspectList");
  const summary = document.getElementById("batchInspectSummary");
  if (!grid) return;
  if (!batchItems.length) {
    grid.innerHTML = batchMode === "pdf"
      ? `<div class="batch-empty"><b>‘📄 PDF 불러오기’</b>를 눌러 자산 등록 PDF(자산코드·위치 표)를 올리거나,<br>이 창으로 PDF를 <b>끌어다 놓으세요</b>. (PC)</div>`
      : `<div class="batch-empty">아직 올린 사진이 없습니다. <b>‘사진 선택’</b>을 눌러 라벨 사진을 여러 장 한꺼번에 선택하거나,<br>이 창으로 사진을 <b>끌어다 놓으세요</b>. (PC)</div>`;
  } else {
    grid.innerHTML = batchItems.map((it, i) => {
      const failed = it.status === "nomatch" || it.status === "error";
      const s = BATCH_STATUS[it.status] || BATCH_STATUS.processing;
      const src = it.thumb || it.photoData;
      const thumb = src ? `<img src="${src}" alt="" />` : `<span class="batch-thumb-ph">${it.status === "processing" ? "…" : (it.fromPdf ? "📄" : "🏷️")}</span>`;
      // PDF 검수: 위치를 함께 표시. 미등록 코드는 '미등록 코드'로 분명히 표기.
      const loc = it.pdfLocation ? ` · 📍 ${esc(it.pdfLocation)}` : "";
      const title = it.asset ? esc(it.asset.assetName)
        : (it.fromPdf ? "미등록 코드" : (it.code ? `인식: ${esc(it.code)}` : "인식되지 않음"));
      const sub = it.asset ? (esc(it.asset.assetNumber) + loc) : (esc(it.code || it.name) + loc);
      const badge = (it.fromPdf && it.status === "nomatch") ? "미등록" : s.label;
      // 실패 항목엔 재시도 버튼을 준다. (중복 건너뛰기/덮어쓰기는 하단 완료 버튼으로 한 번에 결정)
      const action = (failed && it.file) ? `<button type="button" class="batch-toggle batch-retry" data-batch-retry="${i}">↻ 재시도</button>` : "";
      // 어떤 항목이든 목록에서 삭제(제거) 가능. (처리 중에는 숨김)
      const removeBtn = batchProcessing ? "" : `<button type="button" class="batch-toggle batch-remove" data-batch-remove="${i}" title="목록에서 제거">✕ 삭제</button>`;
      const clickable = src ? ' batch-thumb-click" data-batch-preview="' + i + '"' : '"';
      return `<div class="batch-row ${s.cls}" data-idx="${i}"><div class="batch-thumb${clickable}>${thumb}</div><div class="batch-info"><div class="batch-title">${title}</div><div class="batch-sub">${sub}</div></div>${action}${removeBtn}<div class="batch-badge">${badge}</div></div>`;
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
      if (!batchItems.length) summary.innerHTML = "";
      else if (batchMode === "pdf")
        summary.innerHTML = `총 <b>${batchItems.length}</b>건 · 검수 준비 <b class="b-ok-t">${readyN}</b> · 건너뜀 <b>${skip}</b> · 실패 <b class="b-err-t">${nomatch}</b>`;
      else
        summary.innerHTML = `총 <b>${batchItems.length}</b>장 · 등록 준비 <b class="b-ok-t">${readyN}</b>${samePhoto ? ` · 이미 올림 <b>${samePhoto}</b>` : ""} · 실패 <b class="b-err-t">${nomatch}</b>`;
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
  const busyD = batchProcessing ? "disabled" : "";
  if (!batchItems.length) { wrap.innerHTML = ""; return; }
  // 라벨 사진 등록: 중복 선택 없이 한 번에 적용 (검수 안 된 자산=검수+라벨, 이미 검수된 자산=라벨만 추가)
  if (batchMode !== "pdf") {
    const n = new Set(batchItems.filter(batchWillApply).map((it) => String(it.asset.id))).size;
    const verbL = isAdmin ? "등록" : "등록 요청";
    wrap.innerHTML = `<button class="btn btn-primary batch-apply-btn" data-batch-apply="all" ${n ? "" : "disabled"} ${busyD}>✅ ${n}건 라벨 사진 ${verbL}</button>`;
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
  const pdf = document.getElementById("batchPdfBtn");
  const spin = document.getElementById("batchSpinner");
  const cancel = document.getElementById("batchCancelBtn");
  if (pick) pick.disabled = busy;
  if (pdf) pdf.disabled = busy;
  if (spin) spin.hidden = !busy;
  if (cancel) cancel.hidden = !busy; // 인식 중일 때만 '인식 취소' 노출
}
// 한 항목(사진)을 원본 파일로 인식해 상태를 채운다. (업로드/재시도 공용)
async function recognizeIntoItem(item, mode, pool, period, tryRotate = false) {
  const raw = await fileToDataURL(item.file);
  if (!item.thumb) { try { item.thumb = await resizeDataUrl(raw, 160, 0.5); } catch {} }
  const { asset, code } = await recognizeAssetInPool(raw, mode, pool, tryRotate);
  item.code = code || null;
  if (!asset) { item.status = "nomatch"; return; }
  item.asset = asset;
  item.photoData = await compressImage(item.file, 780, 0.55); // 검수 증빙 사진(압축)
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
// 목록에서 항목 1개 삭제(제거). 같은 사진을 다시 올릴 수 있도록 파일 서명도 해제한다.
function removeBatchItem(index) {
  if (batchProcessing) return;
  const it = batchItems[index];
  if (!it) return;
  if (it.file) {
    const sig = `${it.file.name || ""}|${it.file.size || 0}|${it.file.lastModified || 0}`;
    batchFileSigs.delete(sig);
  }
  batchItems.splice(index, 1);
  batchDone = false;      // 삭제 후에도 남은 항목으로 계속 검수할 수 있게
  renderBatchList();
}
async function retryBatchItem(index, tryRotate = false) {
  if (batchProcessing) return;
  const it = batchItems[index];
  if (!it || !it.file) return;
  scanCancelRequested = false;
  batchProcessing = true; batchSuppressScan = true; batchDone = false; batchApplyMsg = ""; setBatchBusy(true);
  it.status = "processing"; renderBatchList();
  const { mode, pool, period } = currentBatchScan();
  try { await recognizeIntoItem(it, mode, pool, period, tryRotate); }
  catch (e) { if (e && e.name === "AbortError") it.status = "canceled"; else { console.error("재시도 인식 오류:", e); it.status = "error"; } }
  finally { batchProcessing = false; batchSuppressScan = false; setScanLoading("", false); setBatchBusy(false); renderBatchList(); }
  if (it.status === "canceled") return;
  if (it.status === "nomatch" || it.status === "error") {
    alert("이 사진은 여전히 자산코드를 인식하지 못했어요.\n\n· 위치·자산명 칸을 채우면 범위가 좁아져 잘 잡혀요\n· 옆으로 찍혔다면 ‘🔄 회전 재시도’를 눌러 보세요\n· 그래도 안 되면 그 자산은 상세 화면에서 직접 검수하세요.");
  }
}
// 인식 실패한 사진들만 한 번에 모두 다시 인식. tryRotate=true면 90·180·270도 회전까지 시도.
async function retryAllFailed(tryRotate = false) {
  if (batchProcessing) return;
  const fails = batchItems.filter((it) => (it.status === "nomatch" || it.status === "error") && it.file);
  if (!fails.length) return;
  scanCancelRequested = false;
  batchProcessing = true; batchSuppressScan = true; batchDone = false; batchApplyMsg = ""; setBatchBusy(true);
  const { mode, pool, period } = currentBatchScan();
  batchRunTotal = fails.length; batchRunDone = 0;
  try {
    for (const it of fails) {
      if (scanCancelRequested) break;
      it.status = "processing"; renderBatchList();
      try { await recognizeIntoItem(it, mode, pool, period, tryRotate); }
      catch (e) { if (e && e.name === "AbortError") { it.status = "canceled"; renderBatchList(); break; } console.error("일괄 재시도 오류:", e); it.status = "error"; }
      batchRunDone++; renderBatchList();
    }
  } finally {
    batchProcessing = false; batchRunTotal = 0; batchSuppressScan = false; setScanLoading("", false); setBatchBusy(false); renderBatchList();
  }
  const still = batchItems.filter((it) => it.status === "nomatch" || it.status === "error").length;
  if (still && !scanCancelRequested) alert(`아직 ${still}장은 인식되지 않았어요.\n${tryRotate ? "" : "옆으로 찍힌 사진이면 ‘🔄 전체 회전 재시도’를 눌러 보세요.\n"}위치·자산명 칸을 채우고 다시 시도하거나, 그 자산은 상세 화면에서 직접 검수하세요.`);
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
  const isPdfMode = batchMode === "pdf";
  // (PDF 검수) 전역 버튼(건너뛰기/덮어쓰기)을 누르면 모든 중복 항목의 처리 방식을 한 번에 정한다.
  if (policy === "skip" || policy === "overwrite") {
    const ov = policy === "overwrite";
    batchItems.forEach((it) => { if (it.status === "dup" || it.status === "already") it.overwrite = ov; });
  }
  // 적용 대상. 같은 자산은 한 번만(마지막 사진 우선) 처리.
  const byId = new Map();
  batchItems.filter(batchWillApply).forEach((it) => byId.set(String(it.asset.id), it));
  const targets = [...byId.values()];
  if (!targets.length) { alert("처리할 자산이 없습니다. 먼저 라벨 사진이나 자산 등록 PDF를 올려 인식하세요."); return; }
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
  const verb = isPdfMode ? (isAdmin ? "검수" : "검수 신청") : (isAdmin ? "등록" : "등록 신청");
  const bid = newBatchId(); // 비관리자 신청을 한 작업으로 묶기
  let ok = 0, fail = 0;
  for (const it of targets) {
    batchApplyMsg = `💾 ${verb} 처리 중… <b class="batch-prog">${ok + fail + 1}/${targets.length}</b>`;
    const summary = document.getElementById("batchInspectSummary");
    if (summary) summary.innerHTML = batchApplyMsg;
    const viaPdf = !!it.fromPdf;                 // 자산 등록 PDF 검수는 증빙 사진이 없다
    // 라벨 사진 등록: 이미 이번 회차 검수된 자산이면 '라벨 사진만 추가'(검수 기록은 그대로), 아니면 검수+라벨.
    const labelOnly = !isPdfMode && inspectedRound(it.asset, period);
    const srcLabel = viaPdf ? "자산 등록 PDF 검수" : (labelOnly ? "라벨 사진 추가" : "라벨 사진 등록");
    const fields = (viaPdf && it.pdfLocation) ? { location: it.pdfLocation } : undefined;
    const note = viaPdf
      ? `${period} 검수 확인 · ${srcLabel}${it.pdfLocation ? ` · 위치: ${it.pdfLocation}` : ""}`
      : (labelOnly ? `라벨 사진 추가` : `${period} 검수 확인 · 라벨 사진 등록`);
    try {
      if (isAdmin) {
        await applyInspect(it.asset.id, { periodType: "회차", period, inspector, affiliation, photo: it.photoData, photos: [], label: !viaPdf, fields, labelOnly });
      } else {
        await submitRequest({
          action: "inspect", target_id: it.asset.id,
          payload: { periodType: "회차", period, inspector, affiliation, photo: it.photoData, photos: [], label: !viaPdf, fields, labelOnly, assetName: it.asset.assetName, assetNumber: it.asset.assetNumber, batch: bid, batchLabel: srcLabel },
          requester: reqName, note,
        });
      }
      it.status = "done"; ok++;
    } catch (e) {
      console.error("일괄 처리 오류:", e);
      it.status = "savefail"; fail++;
    }
  }
  batchProcessing = false;
  batchDone = true;
  setBatchBusy(false);
  // 창은 닫지 않는다 — 그 자리에서 결과를 보여준다.
  const doneWord = isPdfMode ? (isAdmin ? "검수 완료" : "검수 신청 완료") : (isAdmin ? "라벨 사진 등록 완료" : "라벨 사진 등록 신청 완료");
  batchApplyMsg = `✅ <b class="b-ok-t">${ok}건</b> ${doneWord}${fail ? ` · <b class="b-err-t">${fail}건 실패</b>` : ""}${isAdmin ? "" : " · 관리자 승인 후 반영"}`;
  renderBatchList();
  // 뒤 목록/통계는 갱신하되 검수 창은 그대로 열어둔다.
  await reloadAll(); rerender();
}

// 인식 텍스트에서 '자산코드(20자리)'와 '취득금액(천단위 숫자)'만 채운다.
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
  // 자산코드: 20자리 자산코드 (구입일·금액 등 다른 숫자와 섞이지 않게 줄 단위로 추출)
  const code = extractAssetCode(t);
  if (code) setIfEmpty("assetNumber", code, "자산코드");
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
    showFormError("필수 항목을 입력해주세요. (자산명, 자산코드, 위치)");
    return;
  }
  // 자산코드 중복 (값이 있을 때만, 편집중인 자산/요청 제외)
  if (assetNumber && !editingRequestId) {
    const dup = assets.find((a) => a.assetNumber === assetNumber && String(a.id) !== String(id));
    if (dup) { showFormError("이미 등록된 자산코드입니다."); return; }
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
function openInspect(id, photo, fromScan) {
  if (!requireLogin()) return;
  const a = findAsset(id);
  if (!a) return;
  inspectTargetId = id;
  inspectPhoto = photo || "";
  inspectExtraPhotos = [];
  renderInspExtra();
  document.getElementById("inspectError").hidden = true;
  // 촬영/직접입력으로 열렸을 때만 '자산코드 수정' 버튼 노출(잘못 인식된 자산을 바로잡기 위함).
  const fixBtn = document.getElementById("inspFixCodeBtn");
  if (fixBtn) fixBtn.hidden = !fromScan;
  fillInspPeriod();
  document.getElementById("insp-inspector").value = myProfile?.name || "";
  const affil = myProfile?.affiliation || "";
  const affilSel = document.getElementById("insp-affil");
  affilSel.innerHTML = deptOptionsHtml(affil);
  affilSel.value = affil;
  document.getElementById("insp-checked").checked = true;
  document.getElementById("inspectTarget").innerHTML = `<b>${esc(a.assetName)}</b> (${esc(a.assetNumber)})`;
  // 이미 검수된 자산이면 '몇 회차 검수됨'을 안내(중복 검수 방지). 회차·검수일 요약.
  const already = document.getElementById("inspAlreadyMsg");
  if (already) {
    const insps = Array.isArray(a.inspections) ? a.inspections : [];
    if (insps.length) {
      const byRound = {};
      insps.forEach((i) => { const p = i && i.period ? i.period : "(회차없음)"; const d = (i && i.checkedAt) || ""; if (!byRound[p] || d > byRound[p]) byRound[p] = d; });
      const parts = Object.keys(byRound).sort().map((p) => `${p}${byRound[p] ? ` (${fmtDate(byRound[p])})` : ""}`);
      const thisRound = inspectedRound(a, inspRound);
      already.className = "insp-already" + (thisRound ? " warn" : "");
      already.innerHTML = (thisRound
        ? `⚠️ <b>${esc(inspRound)}에 이미 검수된 자산이에요.</b> 다시 저장하면 검수 기록이 하나 더 추가됩니다.<br>`
        : `ℹ️ 이미 검수된 자산이에요.<br>`) + `검수 이력: <b>${parts.map(esc).join(" · ")}</b>`;
      already.hidden = false;
    } else {
      already.hidden = true;
    }
  }
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
// 검수 회차 드롭다운을 채운다. (📋 목록표 + 1~8회차)
function fillInspPeriod() {
  const sel = document.getElementById("insp-period");
  sel.innerHTML = roundOptions(inspRound);
}
// 검수 화면에서 이어 찍은 '물품 사진' 미리보기/버튼 상태 갱신
function renderInspExtra() {
  const grid = document.getElementById("inspExtraPreview");
  const btn = document.getElementById("inspExtraBtn");
  const hint = document.getElementById("inspExtraHint");
  if (!grid || !btn) return;
  grid.innerHTML = inspectExtraPhotos.map((src, i) =>
    `<div class="insp-extra-thumb"><img src="${src}" alt="물품 사진 ${i + 1}" /><button type="button" class="insp-extra-rot" data-insp-rot="${i}" title="이 사진 회전">↻</button><button type="button" class="insp-extra-del" data-insp-extra="${i}" title="이 사진 제거">✕</button></div>`
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
    const data = await compressImage(file, 780, 0.55); // 저장공간 절약(무료 용량 연장)
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
  const saveInspect = (ph, phs) => isAdmin
    ? applyInspect(inspectTargetId, { periodType, period, inspector, affiliation, photo: ph, photos: phs })
    : submitRequest({
        action: "inspect", target_id: inspectTargetId,
        payload: { periodType, period, inspector, affiliation, photo: ph, photos: phs, assetName: a.assetName, assetNumber: a.assetNumber },
        requester: reqName, note: `${period} 검수 확인${phs.length ? ` · 물품사진 ${phs.length}장` : ""}${!ph && !phs.length && (photo || photos.length) ? " (사진 업로드 실패)" : ""}`,
      });
  let photoDropped = false;
  try {
    await saveInspect(photo, photos);
  } catch (e) {
    console.error("검수 저장 1차 실패:", e);
    // 사진(업로드/네트워크) 때문에 실패했을 수 있으니 '사진 없이 검수만' 저장 재시도.
    // → 검수 기록은 절대 사진 때문에 날리지 않는다. 사진은 나중에 좋은 환경에서 상세화면에서 추가.
    if (photo || photos.length) {
      try { await saveInspect("", []); photoDropped = true; }
      catch (e2) {
        console.error("검수 저장 2차(사진 제외) 실패:", e2);
        btn.disabled = false; btn.textContent = origLabel;
        errEl.textContent = "저장 실패: " + (e2 && e2.message ? e2.message : String(e2)); errEl.hidden = false; return;
      }
    } else {
      btn.disabled = false; btn.textContent = origLabel;
      errEl.textContent = "저장 실패: " + (e && e.message ? e.message : String(e)); errEl.hidden = false; return;
    }
  }
  btn.disabled = false; btn.textContent = origLabel;
  hide("inspectOverlay");
  inspectPhoto = "";
  inspectExtraPhotos = [];
  bumpScanCount(); // 이번 세션 검수 건수 +1 (검수 버튼에 배지로 표시)
  await reloadAll(); rerender();
  const sessN = `이번 세션 ${scanSessionCount}건째`;
  if (photoDropped) {
    // 검수는 저장됨, 사진만 실패 → 명확히 안내(검수를 잃지 않았음을 강조)
    if (isAdmin) openDetail(inspectTargetId); else hide("detailOverlay");
    alert(`✅ 검수는 저장됐어요 (${sessN}).\n다만 네트워크 문제로 사진 업로드에 실패해 사진은 빠졌습니다.\n와이파이가 좋은 곳에서 상세화면 → 사진만 다시 올려 주세요.`);
    return;
  }
  const photoMsg = photos.length ? `물품 사진 ${photos.length}장이 자산에 추가되었습니다. ` : "";
  if (isAdmin) { openDetail(inspectTargetId); alert(`✅ 검수가 완료되었습니다 (${sessN}). ${photoMsg}${photo ? "검수 사진이 기록에 추가되었습니다." : ""}`.trim()); }
  else { hide("detailOverlay"); alert(`검수 승인 신청이 접수되었습니다 (${sessN}). 관리자 승인 후 ${photos.length ? "물품 사진과 함께 " : ""}${photo ? "검수 사진과 함께 " : ""}기록에 반영됩니다.`); }
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
async function applyInspect(id, { periodType, period, inspector, affiliation, photo, photos, label, batch, fields, labelOnly }, meta = {}) {
  const current = findAsset(id);
  if (!current) throw new Error("자산 없음");
  // 검수 사진은 Storage에 올리고 DB에는 URL만 저장한다.
  // (base64로 DB에 넣으면 모든 접속자가 목록 로드마다 통째로 내려받아 전송량이 폭증한다.)
  let photoStored = photo || "";
  if (photoStored && photoStored.startsWith("data:")) {
    try { photoStored = await uploadMedia(photoStored, "inspections"); }
    catch (e) { console.warn("검수 사진 업로드 실패 — base64로 저장합니다:", e?.message || e); notifyStorageIssue(e); }
  }
  // labelOnly=true: 검수 기록은 추가하지 않고 '라벨 사진만' 자산에 붙인다(이미 검수된 자산 재등록 방지).
  const prevList = Array.isArray(current.inspections) ? current.inspections.slice() : [];
  let list = prevList;
  if (!labelOnly) {
    const insp = { id: "i" + Date.now() + Math.floor(Math.random() * 1000), periodType: periodType || "", period: period || "", inspector: inspector || "", affiliation: affiliation || "", photo: photoStored || "", checkedAt: new Date().toISOString(), ...(batch ? { batch } : {}) };
    list = [...prevList, insp];
  }
  let mediaFields = {};
  // 이어 찍은 물품 사진(최대 3장)이 있으면 기존 자산 사진 뒤에 병합해 함께 저장
  const extra = Array.isArray(photos) ? photos.filter(Boolean) : [];
  // 자산당 사진 장수 제한(최근 MAX_PHOTOS장 유지) — 검수마다 사진이 무한정 쌓여 용량이 커지는 것 방지
  if (extra.length) mediaFields.imageUrls = [...photosOf(current), ...extra].slice(-MAX_PHOTOS);
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
  // 검수와 함께 자산 필드도 갱신(예: PDF 검수의 '위치'). 값이 있을 때만 덮어쓴다.
  let locNote = "";
  const locVal = fields && typeof fields.location === "string" ? fields.location.trim() : "";
  if (locVal) { photoFields = { ...(photoFields || {}), location: locVal }; locNote = ` · 위치: ${locVal}`; }
  await writeInspections(id, list, photoFields);
  const who = inspector + (affiliation ? ` (${affiliation})` : "");
  const photoNote = extra.length ? ` · 물품사진 ${extra.length}장 추가` : "";
  const labelNote = label ? " · 라벨 저장" : "";
  const note = labelOnly
    ? `라벨 사진 추가${who ? ` · ${who}` : ""}`
    : `검수 확인 · ${period} · 확인자: ${who}${locNote}${photoNote}${labelNote}`;
  await logHistory({ asset_id: id, asset_name: current.assetName, action: "inspect", before: null, after: null, requester: meta.requester || who, note });
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
      user_id: currentUser?.id || null,   // 처리자(작성자) — '본인 기록만 되돌리기·삭제' 권한 판별용
    });
  } catch (e) { console.error("이력 기록 실패:", e); }
}
// ===== 이미지 저장소(Storage) : base64를 파일로 올리고 URL만 DB에 저장 (속도 개선) =====
const MEDIA_BUCKET = "asset-media";
// 업로드 파일명은 매번 새로 생성되는 '불변' 이름이라(같은 URL의 내용이 바뀌지 않음) 캐시를 길게 잡아도 안전하다.
// 기본값(1시간) 대신 1년으로 두면 재방문 시 사진을 다시 내려받지 않아 월 전송량(무료 5GB)을 크게 아낀다.
const MEDIA_CACHE_CONTROL = "31536000"; // 1년(초)
// [안전장치] 저장공간이 거의 찼으면 새 사진 업로드만 막는다.
// 자산 등록·수정·검수 자체는 계속 되므로 '시스템이 멈추는' 일은 없다. 사진만 나중에 올리면 된다.
const STORAGE_BLOCK_RATIO = 0.95;
const STORAGE_FULL_MSG =
  "⚠️ 사진 저장공간이 거의 찼습니다.\n\n" +
  "자산 등록·수정·검수는 그대로 됩니다. 사진만 잠시 올릴 수 없습니다.\n" +
  "관리자에게 ‘관리자 > 저장공간’에서 정리를 요청해 주세요.";
let _storageFullUntil = 0;          // 이 시각까지는 '가득참'으로 간주(반복 조회 방지)
function markStorageFull() { _storageFullUntil = Date.now() + 10 * 60 * 1000; }
function storageBlocked() {
  if (Date.now() < _storageFullUntil) return true;
  // 관리자가 저장공간 탭에서 스캔한 최신 수치가 있으면 그걸로 판단
  if (storageStat && storageStat.used / STORAGE_FREE_LIMIT >= STORAGE_BLOCK_RATIO) return true;
  return false;
}

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
  const blob = new Blob([bytes], { type: mime });
  // [중복 방지] 파일명을 '내용의 해시'로 짓는다.
  // 같은 사진·같은 라벨을 여러 자산에 붙여도 저장소에는 딱 한 벌만 남는다.
  // (실제로 같은 라벨 PDF가 8벌씩 쌓여 있었다) 내용이 곧 이름이라 캐시 1년도 그대로 안전하다.
  const contentPath = await hashPath(bytes, folder, ext);
  // 일시적 실패(약한 네트워크·순간 오류)는 3회까지 재시도(짧은 백오프). 정상 브라우저는 1회에 성공.
  // (인앱 브라우저는 아무리 재시도해도 실패하므로 과도한 재시도로 버튼이 오래 잠기지 않게 3회로 제한)
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const path = contentPath || `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    try {
      const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: mime, upsert: false, cacheControl: MEDIA_CACHE_CONTROL });
      // 같은 내용이 이미 올라가 있으면(중복) 그 파일을 그대로 재사용한다 — 성공으로 취급.
      if (!error || isDuplicateError(error)) return sb.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
      // 용량 초과는 재시도해도 소용없다 → 즉시 중단하고 한동안 업로드를 막는다
      if (isQuotaError(error)) { markStorageFull(); throw error; }
      lastErr = error;
    } catch (e) { lastErr = e; } // 네트워크 예외도 재시도 대상
    await new Promise((r) => setTimeout(r, 350 * (attempt + 1))); // 0.35 → 0.7s
  }
  throw lastErr;
}
// 내용 해시로 경로 만들기. crypto.subtle 을 못 쓰면(구형·비보안 컨텍스트) null → 기존 방식으로 되돌아간다.
async function hashPath(bytes, folder, ext) {
  try {
    if (!(crypto && crypto.subtle)) return null;
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${folder}/${hex.slice(0, 40)}.${ext}`;
  } catch { return null; }
}
function isDuplicateError(err) {
  const s = `${err?.statusCode || ""} ${err?.error || ""} ${err?.message || ""}`.toLowerCase();
  return s.includes("409") || s.includes("duplicate") || s.includes("already exists");
}
// 용량·한도 초과 계열 오류(재시도 무의미)
function isQuotaError(err) {
  const s = `${err?.statusCode || ""} ${err?.error || ""} ${err?.message || ""}`.toLowerCase();
  return s.includes("413") || s.includes("507") || s.includes("quota") || s.includes("exceeded")
    || s.includes("storage limit") || s.includes("payload too large");
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
    return stripInlineMedia(out);  // 혹시라도 남은 base64는 DB에 넣지 않는다
  } catch (e) {
    console.warn("이미지 업로드 실패 — 사진은 저장하지 않습니다:", e?.message || e);
    notifyStorageIssue(e); // 저장공간 가득참 등 → 관리자에게 명확히 안내(조용히 넘어가지 않음)
    // [중요] 업로드에 실패해도 base64를 DB에 넣지 않는다.
    //  넣으면 사진 한 장이 DB에 통째로 들어가고, 목록을 여는 모든 사람이 그걸 매번 내려받게 된다.
    //  DB 한도(500MB)와 전송량이 동시에 무너져 '앱 전체가 느려지다 멈추는' 진짜 사고가 된다.
    //  사진만 버리고 나머지 정보는 정상 저장한다 — 사진은 나중에 다시 올리면 된다.
    return stripInlineMedia(fields);
  }
}
// 필드에서 base64(data:) 이미지를 걷어낸다. Storage URL 과 일반 값은 그대로 둔다.
function stripInlineMedia(f) {
  const is64 = (v) => typeof v === "string" && v.startsWith("data:");
  const out = { ...f };
  if (is64(out.imageUrl)) out.imageUrl = "";
  if (is64(out.labelFile)) { out.labelFile = ""; out.labelFileName = ""; }
  if (is64(out.labelPreview)) out.labelPreview = "";
  if (is64(out.thumbUrl)) out.thumbUrl = "";
  if (Array.isArray(out.imageUrls)) {
    out.imageUrls = out.imageUrls.filter((u) => u && !is64(u));
    if (!out.imageUrl && out.imageUrls.length) out.imageUrl = out.imageUrls[0];
  }
  if (Array.isArray(out.inspections)) out.inspections = out.inspections.map((ins) =>
    ins && is64(ins.photo) ? { ...ins, photo: "" } : ins);
  return out;
}
// 저장소 업로드 실패(용량 초과 등) 시 1회 안내. 사진은 임시 보존되지만 조치가 필요함을 알린다.
let _storageIssueNotified = false;
function notifyStorageIssue(err) {
  // 실제 업로드 에러를 서버에 남겨(access_logs 재사용) 최고관리자가 원인을 확인할 수 있게 한다.
  // (아이폰 등 특정 기기 오류를 개발자가 직접 못 보므로 원격 진단용) — 알림과 별개로 매번 기록.
  try {
    if (sb && currentUser) {
      const detail = String((err && (err.message || err.error || err.name)) || err || "unknown").slice(0, 250);
      const ua = (navigator.userAgent || "").slice(0, 120);
      sb.from("access_logs").insert({
        user_id: currentUser.id, email: currentUser.email || "",
        name: (myProfile && myProfile.name) || "",
        affiliation: (myProfile && myProfile.affiliation) || "",
        event: "upload_error: " + detail + " | UA: " + ua,
      }).then(() => {}, () => {});
    }
  } catch {}
  if (_storageIssueNotified) return;
  _storageIssueNotified = true;
  console.warn("사진 업로드 실패:", err?.message || err);
  setTimeout(() => {
    alert(
      "⚠️ 사진을 저장소에 올리지 못했어요. (일시적 오류일 수 있어요)\n\n" +
      "사진을 뺀 나머지 정보는 정상 저장됐습니다.\n" +
      "잠시 후 상세 화면의 ‘📷 사진 추가’로 다시 올려 주세요.\n" +
      "계속 반복되면 관리자 비상연락처(☎ 3123)로 알려 주세요."
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

// ===== 저장공간(Storage) 사용량 확인 · 고아 파일 정리 =====
// 무료 플랜(1GB)을 넘기지 않도록, 관리자 페이지에서 실제 사용량을 눈으로 확인하고
// 어디에서도 참조하지 않는 '고아 파일'(사진 교체·삭제·저장 실패로 남은 찌꺼기)을 정리한다.
const STORAGE_FREE_LIMIT = 1024 * 1024 * 1024;    // 무료 플랜 Storage 한도 = 1GB
const STORAGE_WARN_RATIO = 0.8;                   // 80% 넘으면 경고 표시
const MEDIA_FOLDERS = ["photos", "thumbs", "labels", "inspections", "templates"];
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;    // 24시간 유예: 방금 올라간(아직 저장 안 끝난) 파일 보호
const FOLDER_LABEL = { photos: "물품 사진", thumbs: "목록 썸네일", labels: "라벨 파일", inspections: "검수 사진", templates: "등록 양식" };
let storageStat = null;   // 마지막 스캔 결과 (세션 내 캐시)
let storageBusy = false;

function fmtBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

// 버킷에 실제로 들어있는 파일 전체 목록(폴더별로 1000개씩 페이지네이션)
async function listMediaFiles() {
  const out = [];
  for (const folder of MEDIA_FOLDERS) {
    let offset = 0;
    for (;;) {
      const { data, error } = await sb.storage.from(MEDIA_BUCKET).list(folder, { limit: 1000, offset });
      if (error) throw error;
      if (!data || !data.length) break;
      for (const o of data) {
        const size = o.metadata && o.metadata.size;
        if (typeof size === "number") out.push({ path: folder + "/" + o.name, folder, size,
          createdAt: o.created_at || o.updated_at || null,
          etag: String((o.metadata && o.metadata.eTag) || "").replace(/"/g, "") });  // eTag = 내용 MD5 → 중복 판별용
      }
      offset += data.length;
      if (data.length < 1000) break;
    }
  }
  return out;
}

// DB 어딘가에서 참조 중인 파일 경로 집합.
// 자산(assets: 사진·라벨·검수·양식) + 이력 스냅샷(history) + 요청(requests)을 모두 훑는다.
// ※ 이력 스냅샷을 빼먹으면 '되돌리기' 후 사진이 깨지므로 반드시 포함해야 한다.
const MEDIA_PATH_RE = new RegExp(MEDIA_BUCKET + "\\/((?:" + MEDIA_FOLDERS.join("|") + ")\\/[^\"'\\\\\\s)?]+)", "g");
function collectMediaPaths(text, into) {
  for (const m of String(text).matchAll(MEDIA_PATH_RE)) {
    let p = m[1];
    try { p = decodeURIComponent(p); } catch {}  // 한글 파일명(양식)은 URL 인코딩되어 저장됨
    into.add(p);
  }
}
async function scanTableForMedia(table, columns, into) {
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 499);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    if (!data || !data.length) break;
    collectMediaPaths(JSON.stringify(data), into);
    from += data.length;
    if (data.length < 500) break;
  }
}
// 한 곳이라도 조회에 실패하면 예외를 던진다 — 참조 목록이 불완전한 상태로 삭제하면 안 되기 때문.
async function collectReferencedPaths() {
  const used = new Set();
  await scanTableForMedia("assets", "data", used);
  await scanTableForMedia("history", "before_snap, after_snap", used);
  await scanTableForMedia("requests", "payload", used);
  return used;
}

// 사용량 + 고아 파일 스캔
async function scanStorageUsage() {
  const files = await listMediaFiles();
  const used = await collectReferencedPaths();
  const byFolder = {};
  const orphans = [];
  const now = Date.now();
  let total = 0;
  for (const f of files) {
    total += f.size;
    const b = byFolder[f.folder] || (byFolder[f.folder] = { count: 0, size: 0 });
    b.count++; b.size += f.size;
    const age = f.createdAt ? now - new Date(f.createdAt).getTime() : Infinity;
    if (!used.has(f.path) && age > ORPHAN_MIN_AGE_MS) orphans.push(f);
  }
  // [안전장치] 파일은 있는데 '사용 중'으로 잡힌 게 하나도 없다면, DB를 제대로 못 읽은 것(권한·네트워크)이다.
  // 이 상태로 정리를 돌리면 멀쩡한 사진을 전부 지우게 되므로 아예 결과를 만들지 않는다.
  if (files.length && used.size === 0) throw new Error("사용 중인 사진 목록을 읽지 못했습니다. (권한 또는 네트워크 문제) 안전을 위해 정리를 중단합니다.");
  // 내용이 완전히 같은 파일 묶기(eTag=MD5). 한 벌만 남기고 나머지는 참조를 옮긴 뒤 지울 수 있다.
  const byTag = new Map();
  for (const f of files) { if (!f.etag) continue; const g = byTag.get(f.etag) || []; g.push(f); byTag.set(f.etag, g); }
  const dupGroups = [...byTag.values()].filter((g) => g.length > 1)
    .map((g) => { const s = g.slice().sort((a, b) => (used.has(b.path) ? 1 : 0) - (used.has(a.path) ? 1 : 0));
      return { keep: s[0], drop: s.slice(1) }; });
  const dupWaste = dupGroups.reduce((n, g) => n + g.drop.reduce((m, f) => m + f.size, 0), 0);
  storageStat = { at: Date.now(), fileCount: files.length, used: total, byFolder, orphans, refCount: used.size, dupGroups, dupWaste };
  updateStorageWarnBadge();
  return storageStat;
}

// 고아 파일 삭제 (100개씩 나눠서)
async function deleteOrphanFiles(orphans) {
  let count = 0, freed = 0;
  for (let i = 0; i < orphans.length; i += 100) {
    const chunk = orphans.slice(i, i + 100);
    const { error } = await sb.storage.from(MEDIA_BUCKET).remove(chunk.map((f) => f.path));
    if (error) throw error;
    count += chunk.length;
    freed += chunk.reduce((s, f) => s + f.size, 0);
  }
  return { count, freed };
}

function updateStorageWarnBadge() {
  const el = document.getElementById("adminStorageWarn");
  if (!el) return;
  const over = !!storageStat && storageStat.used / STORAGE_FREE_LIMIT >= STORAGE_WARN_RATIO;
  el.hidden = !over;
}

function renderStorage() {
  const body = document.getElementById("adminStorageBody");
  if (!body) return;
  if (!isAdmin) { body.innerHTML = `<div class="empty-msg">관리자만 볼 수 있습니다.</div>`; return; }
  if (storageBusy) {
    body.innerHTML = `<div class="empty-msg"><div class="empty-ic">⏳</div><div class="empty-title">저장공간을 확인하는 중…</div><div class="empty-sub">파일 목록과 사용 중인 사진을 대조하고 있습니다.</div></div>`;
    return;
  }
  if (!storageStat) { refreshStorage(); return; }  // 탭을 처음 열면 자동으로 1회 스캔

  const s = storageStat;
  const pct = Math.min(100, (s.used / STORAGE_FREE_LIMIT) * 100);
  const level = pct >= 80 ? "danger" : pct >= 60 ? "warn" : "ok";
  const orphanSize = s.orphans.reduce((n, f) => n + f.size, 0);
  const rows = MEDIA_FOLDERS.map((f) => {
    const b = s.byFolder[f] || { count: 0, size: 0 };
    return `<tr><td>${FOLDER_LABEL[f] || f}</td><td class="num">${b.count.toLocaleString()}개</td><td class="num">${fmtBytes(b.size)}</td></tr>`;
  }).join("");
  const msg = level === "danger"
    ? "⚠️ 무료 한도의 80%를 넘었습니다. 아래 ‘고아 파일 정리’를 실행하고, 그래도 부족하면 사진 압축률을 높여야 합니다."
    : level === "warn"
      ? "여유는 있지만 60%를 넘었습니다. 가끔 ‘고아 파일 정리’를 실행해 주세요."
      : "여유롭습니다. 특별히 조치할 것은 없습니다.";

  body.innerHTML = `
    <div class="stor-card">
      <div class="stor-head">
        <div>
          <div class="stor-title">Supabase 저장공간 (무료 1GB)</div>
          <div class="stor-sub">파일 ${s.fileCount.toLocaleString()}개 · 마지막 확인 ${_fmtLogDT(new Date(s.at).toISOString())}</div>
        </div>
        <button class="btn btn-secondary" id="storRefreshBtn">다시 확인</button>
      </div>
      <div class="stor-bar"><div class="stor-fill ${level}" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="stor-legend"><b class="${level}">${fmtBytes(s.used)}</b> / 1 GB 사용 <span class="stor-pct">(${pct.toFixed(1)}%)</span></div>
      <div class="stor-msg ${level}">${msg}</div>
    </div>

    <table class="stor-table">
      <thead><tr><th>종류</th><th class="num">파일 수</th><th class="num">용량</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>합계</th><th class="num">${s.fileCount.toLocaleString()}개</th><th class="num">${fmtBytes(s.used)}</th></tr></tfoot>
    </table>

    <div class="stor-card">
      <div class="stor-title">🧹 고아 파일 정리</div>
      <div class="stor-sub">사진을 교체·삭제하거나 저장이 중간에 실패하면, 아무 자산도 쓰지 않는 파일이 저장소에 남습니다.
        자산·결재 이력·신청 내역 어디에서도 참조하지 않고 올라온 지 24시간이 지난 파일만 정리 대상입니다.
        (확인 자체에도 통신량이 들어가니 한 달에 한두 번이면 충분합니다.)</div>
      ${s.orphans.length
        ? `<div class="stor-orphan">정리 가능: <b>${s.orphans.length.toLocaleString()}개 · ${fmtBytes(orphanSize)}</b></div>
           ${isSuperAdmin
             ? `<button class="btn btn-danger" id="storCleanBtn">고아 파일 ${s.orphans.length.toLocaleString()}개 정리</button>`
             : `<div class="stor-sub">삭제는 최고관리자만 실행할 수 있습니다.</div>`}`
        : `<div class="stor-orphan clean">정리할 파일이 없습니다. 깨끗합니다. ✅</div>`}
    </div>

    <div class="stor-card">
      <div class="stor-title">🧩 중복 사진 합치기</div>
      <div class="stor-sub">같은 사진·같은 라벨을 여러 자산에 붙이면 예전에는 그만큼 따로 저장됐습니다.
        내용이 완전히 같은 파일을 한 벌로 합치고 나머지를 지웁니다. 자산에 보이는 사진은 그대로입니다.
        (지금은 올릴 때 자동으로 합쳐지므로 새로 생기지는 않습니다.)</div>
      ${(s.dupGroups || []).length
        ? `<div class="stor-orphan">합치면 <b>${s.dupGroups.reduce((n, g) => n + g.drop.length, 0).toLocaleString()}개 · ${fmtBytes(s.dupWaste)}</b> 확보</div>
           ${isSuperAdmin
             ? `<button class="btn btn-danger" id="storDedupBtn">중복 ${s.dupGroups.length.toLocaleString()}묶음 합치기</button>`
             : `<div class="stor-sub">실행은 최고관리자만 가능합니다.</div>`}`
        : `<div class="stor-orphan clean">중복이 없습니다. ✅</div>`}
    </div>`;

  const rb = document.getElementById("storRefreshBtn");
  if (rb) rb.addEventListener("click", () => refreshStorage());
  const cb = document.getElementById("storCleanBtn");
  if (cb) cb.addEventListener("click", () => cleanupStorage());
  const db = document.getElementById("storDedupBtn");
  if (db) db.addEventListener("click", () => dedupeStorage());
}

// 중복 파일 합치기: 참조를 대표 파일로 옮긴 뒤 나머지를 삭제한다.
// URL 만 바뀌고 내용은 동일하므로 화면에 보이는 사진은 그대로다.
async function dedupeStorage() {
  if (!isSuperAdmin) { alert("중복 합치기는 최고관리자만 실행할 수 있습니다."); return; }
  const groups = (storageStat && storageStat.dupGroups) || [];
  if (!groups.length || storageBusy) return;
  const dropN = groups.reduce((n, g) => n + g.drop.length, 0);
  if (!confirm(`내용이 같은 파일 ${dropN.toLocaleString()}개(${fmtBytes(storageStat.dupWaste)})를 한 벌로 합칩니다.\n\n` +
    `· 자산에 보이는 사진은 그대로입니다(같은 내용의 다른 파일을 가리키게만 바꿉니다).\n· 되돌릴 수 없습니다.\n\n계속할까요?`)) return;
  storageBusy = true; renderStorage();
  try {
    // 1) 지울 경로 → 대표 경로 매핑
    const remap = new Map();
    for (const g of groups) for (const d of g.drop) remap.set(d.path, g.keep.path);
    // 2) DB에서 참조를 대표 경로로 치환 (assets / requests). history 는 과거 스냅샷이라 손대지 않는다.
    let rows = 0;
    for (const [table, cols] of [["assets", "id,data"], ["requests", "id,payload"]]) {
      for (let from = 0; ; ) {
        const { data, error } = await sb.from(table).select(cols).range(from, from + 199);
        if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
        if (!data || !data.length) break;
        for (const r of data) {
          const key = table === "assets" ? "data" : "payload";
          let s = JSON.stringify(r[key] ?? null);
          let hit = false;
          for (const [from_, to] of remap) {
            if (s.includes(from_)) { s = s.split(from_).join(to); hit = true; }
          }
          if (!hit) continue;
          const { error: ue } = await sb.from(table).update({ [key]: JSON.parse(s) }).eq("id", r.id);
          if (ue) throw new Error(`${table} 수정 실패: ${ue.message}`);
          rows++;
        }
        from += data.length;
        if (data.length < 200) break;
      }
    }
    // 3) history 가 아직 가리키는 파일은 남겨둔다(되돌리기 시 사진이 깨지지 않게).
    //    다음 스캔에서 '고아'로도 잡히지 않으므로 안전하다.
    const used = await collectReferencedPaths();
    const del = [...remap.keys()].filter((p) => !used.has(p));
    let freed = 0;
    for (let i = 0; i < del.length; i += 100) {
      const chunk = del.slice(i, i + 100);
      const { error } = await sb.storage.from(MEDIA_BUCKET).remove(chunk);
      if (error) throw error;
      for (const g of groups) for (const d of g.drop) if (chunk.includes(d.path)) freed += d.size;
    }
    storageBusy = false;
    await sbLoadOverlay(); buildAssets(); rerender();
    await scanStorageUsage(); renderStorage();
    toast(`🧩 중복 ${del.length.toLocaleString()}개를 합쳤습니다. (${fmtBytes(freed)} 확보 · 자산 ${rows}건 갱신)`, "success");
  } catch (e) {
    console.error(e);
    storageBusy = false; renderStorage();
    alert("중복 합치기에 실패했습니다.\n원인: " + (e?.message || e));
  }
}

async function refreshStorage() {
  if (storageBusy || !sb) return;
  storageBusy = true;
  renderStorage();
  try {
    await scanStorageUsage();
  } catch (e) {
    console.error(e);
    storageStat = null;
    const body = document.getElementById("adminStorageBody");
    if (body) body.innerHTML = `<div class="empty-msg"><div class="empty-ic">⚠️</div><div class="empty-title">저장공간을 확인하지 못했습니다</div><div class="empty-sub">${esc(e?.message || String(e))}</div></div>
      <div style="text-align:center"><button class="btn btn-secondary" id="storRefreshBtn">다시 시도</button></div>`;
    const rb = document.getElementById("storRefreshBtn");
    if (rb) rb.addEventListener("click", () => refreshStorage());
    storageBusy = false;
    return;
  }
  storageBusy = false;
  renderStorage();
}

async function cleanupStorage() {
  if (!isSuperAdmin) { alert("고아 파일 정리는 최고관리자만 실행할 수 있습니다."); return; }
  if (!storageStat || !storageStat.orphans.length || storageBusy) return;
  const n = storageStat.orphans.length;
  const size = fmtBytes(storageStat.orphans.reduce((s, f) => s + f.size, 0));
  if (!confirm(`아무 자산에서도 쓰지 않는 파일 ${n.toLocaleString()}개(${size})를 삭제합니다.\n\n· 자산 사진, 라벨, 검수 사진, 결재 이력에 남은 사진은 삭제되지 않습니다.\n· 삭제한 파일은 되돌릴 수 없습니다.\n\n계속할까요?`)) return;
  storageBusy = true;
  renderStorage();
  try {
    const { count, freed } = await deleteOrphanFiles(storageStat.orphans);
    storageBusy = false;
    await scanStorageUsage();   // 삭제 후 실제 사용량 다시 확인
    renderStorage();
    toast(`🧹 고아 파일 ${count.toLocaleString()}개를 정리했습니다. (${fmtBytes(freed)} 확보)`, "success");
  } catch (e) {
    console.error(e);
    storageBusy = false;
    renderStorage();
    alert("정리에 실패했습니다.\n원인: " + (e?.message || e));
  }
}

// ===== 페이지 내장 카메라 (후면 고정) =====
// <input capture="environment"> 는 '요청'일 뿐이라 기기·인앱브라우저에 따라 셀카(전면)가 열린다.
// getUserMedia 로 직접 열면 facingMode 를 우리가 지정할 수 있어 후면이 확실히 잡힌다.
// 카메라를 못 쓰는 환경(권한 거부·구형 브라우저)에서는 파일 선택으로 자동 전환한다.
let camStream = null, camFacing = "environment", camShots = [], camResolve = null, camMax = 1;
function camSupported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

async function camStart() {
  const video = document.getElementById("camVideo");
  const msg = document.getElementById("camMsg");
  camStop();
  msg.hidden = false; msg.textContent = "카메라를 준비하는 중…";
  try {
    // ideal 로 주면 후면이 없는 기기(노트북 등)에서도 실패하지 않고 있는 카메라를 쓴다.
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: camFacing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = camStream;
    await video.play().catch(() => {});
    msg.hidden = true;
    return true;
  } catch (e) {
    console.warn("카메라 열기 실패:", e?.name || e);
    const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    msg.hidden = false;
    msg.textContent = denied
      ? "카메라 권한이 거부되었습니다.\n브라우저 설정에서 카메라를 허용하거나, 아래 ‘앨범에서 선택’을 사용하세요."
      : "이 브라우저에서 카메라를 열 수 없습니다.\n아래 ‘앨범에서 선택’을 사용하세요.";
    return false;
  }
}
function camStop() {
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
  const v = document.getElementById("camVideo");
  if (v) v.srcObject = null;
}
function camRenderShots() {
  const wrap = document.getElementById("camShots");
  wrap.innerHTML = camShots.map((src, i) =>
    `<div class="cam-thumb"><img src="${src}" alt="촬영 ${i + 1}" /><button type="button" class="cam-thumb-del" data-cam-del="${i}" title="삭제">✕</button></div>`).join("");
  document.getElementById("camDoneBtn").disabled = camShots.length === 0;
  document.getElementById("camDoneBtn").textContent = camShots.length ? `사진 추가 (${camShots.length})` : "사진 추가";
  const shotBtn = document.getElementById("camShotBtn");
  shotBtn.disabled = camShots.length >= camMax;
  shotBtn.textContent = camShots.length >= camMax ? `최대 ${camMax}장` : "📷 촬영";
}
function camCapture() {
  const video = document.getElementById("camVideo");
  if (!video.videoWidth || camShots.length >= camMax) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  // 등록 폼과 같은 규격으로 축소·압축(저장공간 절약)
  const max = 780, scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const out = document.createElement("canvas");
  out.width = Math.round(canvas.width * scale); out.height = Math.round(canvas.height * scale);
  out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
  camShots.push(encodeCanvas(out, 0.55));
  camRenderShots();
}
// 카메라 모달을 열고, 사용자가 담은 사진(dataURL 배열)을 돌려준다. 취소하면 빈 배열.
function openCamera({ title = "사진 촬영", max = 1 } = {}) {
  camShots = []; camMax = Math.max(1, max); camFacing = "environment";
  document.getElementById("camTitle").textContent = title;
  camRenderShots();
  show("camOverlay");
  camStart();
  return new Promise((resolve) => { camResolve = resolve; });
}
function closeCamera(result) {
  camStop();
  hide("camOverlay");
  const r = camResolve; camResolve = null;
  if (r) r(result || []);
}

// ===== 상세 화면에서 물품 사진 추가 (검수·등록 뒤에 사진만 덧붙일 때) =====
// 관리자는 바로 반영, 일반 사용자는 '수정 요청'으로 접수된다.
// 상세의 '사진 추가' 버튼 → 후면 카메라를 켠다(못 켜면 모달 안에서 앨범 선택으로 전환).
async function startDetailPhoto() {
  const a = findAsset(detailCurrentId);
  if (!a) return;
  if (!currentUser) { alert("사진 추가는 로그인 후 이용할 수 있습니다."); return; }
  if (storageBlocked()) { alert(STORAGE_FULL_MSG); return; }
  const room = MAX_PHOTOS - photosOf(a).length;
  if (room <= 0) { alert(`사진은 자산당 최대 ${MAX_PHOTOS}장입니다.\n'수정'에서 기존 사진을 지운 뒤 다시 시도해주세요.`); return; }
  if (!camSupported()) { document.getElementById("detailPhotoInput").click(); return; }
  const shots = await openCamera({ title: `${a.assetName || "물품"} · 사진 촬영`, max: room });
  if (shots.length) await saveDetailPhotos(shots);
}

// 파일 선택으로 들어온 경우 → 압축 후 동일 저장 경로로
async function addDetailPhotos(fileList) {
  const a = findAsset(detailCurrentId);
  if (!a || !fileList || !fileList.length) return;
  if (!currentUser) { alert("사진 추가는 로그인 후 이용할 수 있습니다."); return; }
  const room = MAX_PHOTOS - photosOf(a).length;
  if (room <= 0) { alert(`사진은 자산당 최대 ${MAX_PHOTOS}장입니다.`); return; }
  const files = [...fileList];
  const imgs = files.filter((f) => f && f.type && f.type.startsWith("image/"));
  if (!imgs.length) { alert("이미지 파일만 업로드할 수 있습니다."); return; }
  const use = imgs.slice(0, room);
  const shots = [];
  for (const f of use) shots.push(await compressImage(f, 780, 0.55)); // 등록 폼과 같은 압축
  await saveDetailPhotos(shots, imgs.length - use.length + (files.length - imgs.length));
}

async function saveDetailPhotos(shots, skipped = 0) {
  const id = detailCurrentId;
  const a = findAsset(id);
  if (!a || !shots.length) return;
  const existing = photosOf(a);
  const btn = document.getElementById("detailPhotoBtn");
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "사진 올리는 중…";
  try {
    const imageUrls = [...existing, ...shots].slice(-MAX_PHOTOS);
    const fields = { imageUrls };
    if (isAdmin) {
      await applyUpdate(id, fields, { note: `사진 ${shots.length}장 추가` });
      await reloadAll(); rerender();
      toast(`사진 ${shots.length}장을 추가했습니다.`, "success");
    } else {
      // 일반 사용자: 승인 대기 요청으로 접수 (base64는 관리자가 승인할 때 Storage로 올라간다)
      await submitRequest({ action: "update", target_id: String(id),
        payload: { ...fields, assetName: a.assetName, assetNumber: a.assetNumber },
        note: `사진 ${shots.length}장 추가 요청` });
      await sbLoadMyRequests(); updateUI();
      toast(`사진 ${shots.length}장 추가를 요청했습니다. 관리자 승인 후 반영됩니다.`, "success");
    }
    if (skipped > 0) toast(`${skipped}장은 제외했습니다 (최대 ${MAX_PHOTOS}장 / 이미지 파일만).`, "warn");
    openDetail(id);   // 방금 추가한 사진이 보이도록 상세를 다시 그린다
  } catch (e) {
    console.error(e);
    alert("사진 추가에 실패했습니다.\n원인: " + (e?.message || e));
    btn.disabled = false; btn.textContent = label;
  }
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
// 이력 기록 관리(되돌리기·삭제) 권한: 최고관리자는 전체, 일반 관리자는 '본인이 처리한 기록'만.
// (user_id 가 없는 옛 기록은 최고관리자만 관리 가능 — 안전한 기본값)
function canManageHist(h) {
  if (isSuperAdmin) return true;
  return !!(h && h.user_id && currentUser && String(h.user_id) === String(currentUser.id));
}
async function revertHistory(histId) {
  if (!isAdmin) { alert("원상복구(되돌리기)는 관리자만 할 수 있습니다."); return; }
  const h = history.find((x) => String(x.id) === String(histId));
  if (!h) return;
  if (!canManageHist(h)) { alert("본인이 처리한 기록만 되돌릴 수 있습니다.\n(다른 관리자의 기록은 최고관리자만 되돌릴 수 있습니다.)"); return; }
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
  if (!isAdmin) { alert("기록 삭제는 관리자만 할 수 있습니다."); return; }
  const h = history.find((x) => String(x.id) === String(histId));
  if (!h) return;
  if (!canManageHist(h)) { alert("본인이 처리한 기록만 삭제할 수 있습니다.\n(다른 관리자의 기록은 최고관리자만 삭제할 수 있습니다.)"); return; }
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
  let t = ADMIN_TABS.includes(tab) ? tab : "review";
  if (t === "access" && !isSuperAdmin) t = "review"; // 접속 로그는 최고관리자 전용
  currentAdminTab = t;
  renderNav();
  setAdminTab(currentAdminTab);        // 먼저 화면 틀을 보여주고
  // 최신 데이터 로드 후 다시 렌더 (탭 전환도 빠르게 보이도록)
  await Promise.all([sbLoadRequests(), sbLoadHistory(), sbLoadMembers(), sbLoadAccessLogs()]);
  updateUI();
  setAdminTab(currentAdminTab);
}
// 탭 전환: 활성 표시 + 패널 노출 + 해당 목록 렌더
function setAdminTab(tab) {
  currentAdminTab = tab;
  // [data-atab] 로 좁힌다 — '내 정보' 모달 탭도 같은 .admin-tab 클래스를 쓰기 때문
  document.querySelectorAll(".admin-tab[data-atab]").forEach((b) => b.classList.toggle("active", b.dataset.atab === tab));
  ADMIN_TABS.forEach((t) => { const el = document.getElementById("admin-" + t); if (el) el.hidden = t !== tab; });
  if (tab === "review") renderReview();
  else if (tab === "hist") renderHistory();
  else if (tab === "members") renderMembers();
  else if (tab === "access") { _accessLogUser = null; renderAccessLog(); } // 탭 열면 사용자 목록부터
  else if (tab === "storage") renderStorage();
}
// 접속 로그 렌더 (최고관리자 전용): 누가 언제 접속했는지
let _accessLogUser = null; // 상세를 보고 있는 사용자(이메일). null이면 사용자 목록.
function _fmtLogDT(iso) { try { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; } catch { return iso; } }
function renderAccessLog() {
  const body = document.getElementById("adminAccessBody");
  if (!body) return;
  if (!isSuperAdmin) { body.innerHTML = `<div class="empty-msg">최고관리자만 볼 수 있습니다.</div>`; return; }
  // 실제 '접속(login)'만. 업로드 오류 등 진단 로그는 접속 로그에서 제외.
  const logs = accessLogs.filter((l) => String(l.event || "") === "login");
  if (!logs.length) {
    body.innerHTML = `<div class="empty-msg"><div class="empty-ic">🧾</div><div class="empty-title">접속 기록이 없습니다</div><div class="empty-sub">사용자가 로그인하면 여기에 표시됩니다.</div></div>`;
    return;
  }
  // 사용자별 그룹(이메일 기준)
  const byUser = new Map();
  for (const l of logs) {
    const key = l.email || l.user_id || "(알수없음)";
    const o = byUser.get(key) || { name: "", email: l.email || "", affiliation: "", logs: [] };
    if (l.name && !o.name) o.name = l.name;
    if (l.affiliation && !o.affiliation) o.affiliation = l.affiliation;
    o.logs.push(l);
    byUser.set(key, o);
  }
  // ── 상세 화면(특정 사용자) ──
  if (_accessLogUser && byUser.has(_accessLogUser)) {
    const u = byUser.get(_accessLogUser);
    const hhmm = (iso) => { try { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}`; } catch { return iso; } };
    // 날짜별로 묶기(최신 날짜 위로), 각 날짜 안 시각은 최근순
    const groups = {};
    u.logs.forEach((l) => { const d = fmtDate(l.created_at); (groups[d] = groups[d] || []).push(l); });
    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    const groupHtml = dates.map((d) => {
      const times = groups[d].slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return `<div class="al-daygroup">
        <div class="al-day-head"><span class="al-day-date">📅 ${d}</span><span class="al-day-count">${times.length}회</span></div>
        <div class="al-day-times">${times.map((l) => `<span class="al-time-chip">${hhmm(l.created_at)}</span>`).join("")}</div>
      </div>`;
    }).join("");
    body.innerHTML =
      `<button type="button" class="btn btn-secondary btn-sm" data-al-back>← 사용자 목록</button>` +
      `<h3 class="al-detail-h">${esc(u.name || u.email)} <span class="al-detail-sub">· 총 <b>${u.logs.length}</b>회 접속 · ${dates.length}일</span></h3>` +
      `<div class="al-detail-meta">${esc(u.email)}${u.affiliation ? " · " + esc(u.affiliation) : ""}</div>` +
      `<div class="al-daygroups">${groupHtml}</div>`;
    return;
  }
  // ── 메인 화면: 날짜별 → 그날 접속한 사람 + 횟수 ──
  const byDate = {};
  for (const l of logs) {
    const d = fmtDate(l.created_at);
    const key = l.email || l.user_id || "(알수없음)";
    byDate[d] = byDate[d] || {};
    const e = byDate[d][key] || (byDate[d][key] = { name: "", email: l.email || "", count: 0 });
    if (l.name && !e.name) e.name = l.name;
    e.count++;
  }
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a)); // 최신 날짜 위로
  const html = dates.map((d) => {
    const dayUsers = Object.values(byDate[d]).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name))); // 많이 온 순
    const totalDay = dayUsers.reduce((s, u) => s + u.count, 0);
    return `<div class="al-daygroup">
      <div class="al-day-head"><span class="al-day-date">📅 ${d}</span><span class="al-day-count">${dayUsers.length}명 · ${totalDay}회</span></div>
      <div class="al-day-users">${dayUsers.map((u) => `
        <button type="button" class="al-dayuser" data-al-user="${esc(u.email)}">
          <span class="al-dayuser-name">${esc(u.name || u.email)}</span>
          <span class="al-dayuser-count">${u.count}회</span>
        </button>`).join("")}</div>
    </div>`;
  }).join("");
  body.innerHTML =
    `<div class="notice" style="margin-bottom:12px;">날짜별 접속 현황. 이름을 누르면 그 사용자의 전체 접속 기록이 보여요. (사용자별 하루 1회 기록 · 최고관리자 전용)</div>` +
    `<div class="al-daygroups">${html}</div>`;
}
function renderReview() {
  const body = document.getElementById("adminReviewBody");
  if (!body) return;
  // 관리자 승격 요청(grant_admin)은 자산 결재 목록이 아니라 '회원 관리'에서 처리한다.
  const reviewable = requests.filter((r) => r.action !== "grant_admin");
  if (reviewable.length === 0) { selectedReqIds.clear(); body.innerHTML = `<div class="empty-msg">대기 중인 요청이 없습니다.</div>`; return; }
  // 유효한 선택만 유지
  const validIds = new Set(reviewable.map((r) => String(r.id)));
  selectedReqIds.forEach((id) => { if (!validIds.has(id)) selectedReqIds.delete(id); });
  const actionLabel = { create: "등록 요청", update: "수정 요청", delete: "삭제 요청", inspect: "검수 요청" };
  const actionCls = { create: "req-create", update: "req-update", delete: "req-delete", inspect: "req-inspect" };
  // 묶음(batch) 요청은 하나의 그룹 카드로, 나머지는 개별 카드로
  const groups = new Map();
  const singles = [];
  reviewable.forEach((r) => {
    const b = r.payload && r.payload.batch;
    if (b) {
      let g = groups.get(b);
      if (!g) { g = { batch: b, label: (r.payload.batchLabel || "일괄 작업"), action: r.action, requester: r.requester, created: r.created_at, items: [] }; groups.set(b, g); }
      g.items.push(r);
    } else singles.push(r);
  });
  const allChecked = singles.length > 0 && singles.every((r) => selectedReqIds.has(String(r.id)));
  const selCount = selectedReqIds.size;
  const bar = singles.length ? `
    <div class="req-bulkbar">
      <label class="req-selall"><input type="checkbox" id="reqSelectAll" ${allChecked ? "checked" : ""} /> 개별 전체 선택 <span class="req-total">(${singles.length}건)</span></label>
      <span class="req-selcount">${selCount ? `${selCount}건 선택됨` : ""}</span>
      <span class="form-info req-prog" id="reqBulkProgress" hidden></span>
      <span class="req-bulk-actions">
        <button class="btn btn-primary btn-sm" id="reqBulkApprove" ${selCount ? "" : "disabled"}>✅ 선택 결재</button>
        <button class="btn btn-danger btn-sm" id="reqBulkReject" ${selCount ? "" : "disabled"}>✖ 선택 반려</button>
      </span>
    </div>` : `<div class="req-bulkbar"><span class="form-info req-prog" id="reqBulkProgress" hidden></span></div>`;
  // 묶음 그룹 카드
  const groupHtml = [...groups.values()].map((g) => {
    const meta = [`요청일시: ${fmtTime(g.created)}`, g.requester && `신청자: ${esc(g.requester)}`].filter(Boolean).join(" · ");
    const names = g.items.slice(0, 5).map((r) => esc((r.payload || {}).assetName || "")).filter(Boolean).join(", ");
    return `
      <div class="req-card req-group">
        <div class="req-top">
          <span class="req-badge ${actionCls[g.action] || ""}">${esc(g.label)}</span>
          <span class="req-groupcount">📦 ${g.items.length}건 묶음</span>
          ${meta ? `<span class="req-meta">${meta}</span>` : ""}
        </div>
        <div class="req-summary">${names}${g.items.length > 5 ? ` 외 ${g.items.length - 5}건` : ""}</div>
        <div class="req-actions">
          <button class="btn btn-primary btn-sm" data-approvebatch="${g.batch}">✅ 묶음 전체 결재 (${g.items.length})</button>
          <button class="btn btn-danger btn-sm" data-rejectbatch="${g.batch}">✖ 묶음 전체 반려</button>
        </div>
      </div>`;
  }).join("");
  const singleHtml = singles.map((r) => renderReqCard(r, actionLabel, actionCls)).join("");
  body.innerHTML = bar + groupHtml + singleHtml;
}
// 개별 요청 카드 1개 렌더
function renderReqCard(r, actionLabel, actionCls) {
  const p = r.payload || {};
  let summary;
  if (r.action === "inspect") summary = `<b>${esc(p.assetName || "")}</b> (${esc(p.assetNumber || "")}) · 검수 회차: <b>${esc(p.period || "-")}</b> · 확인자: ${esc(p.inspector || "-")}${p.affiliation ? ` (${esc(p.affiliation)})` : ""}`;
  else summary = r.action === "delete"
    ? `<b>${esc(p.assetName || "")}</b> (${esc(p.assetNumber || "")})`
    : `<div class="req-fields">
          <span><b>${esc(p.assetName || "")}</b></span>
          <span>자산코드: ${esc(p.assetNumber || "-")}</span>
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
// 묶음(batch) 요청 한 작업 전체를 결재/반려
async function approveBatchRequests(bid) {
  if (reqBulkBusy) return;
  const items = requests.filter((r) => r.payload && r.payload.batch === bid);
  if (!items.length) return;
  if (!confirm(`이 작업 묶음 ${items.length}건을 모두 결재(승인)합니다.\n계속할까요?`)) return;
  reqBulkBusy = true;
  let ok = 0, fail = 0;
  for (const r of items) {
    setReqProgress(`결재 중… ${ok + fail + 1}/${items.length}`);
    try { await approveRequestCore(r); ok++; }
    catch (e) { console.error("묶음 결재 실패:", r.id, e); fail++; }
  }
  setReqProgress(""); reqBulkBusy = false;
  await reloadAll(); rerender(); renderReview();
  alert(`묶음 결재 완료: ${ok}건${fail ? ` · ${fail}건 실패` : ""}`);
}
async function rejectBatchRequests(bid) {
  if (reqBulkBusy) return;
  const items = requests.filter((r) => r.payload && r.payload.batch === bid);
  if (!items.length) return;
  if (!confirm(`이 작업 묶음 ${items.length}건을 모두 반려합니다.\n계속할까요?`)) return;
  reqBulkBusy = true;
  let ok = 0, fail = 0;
  for (const r of items) {
    setReqProgress(`반려 중… ${ok + fail + 1}/${items.length}`);
    try { const { error } = await sb.from("requests").update({ status: "rejected", decided_at: new Date().toISOString() }).eq("id", r.id); if (error) throw error; ok++; }
    catch (e) { console.error("묶음 반려 실패:", r.id, e); fail++; }
  }
  setReqProgress(""); reqBulkBusy = false;
  await reloadAll(); rerender(); renderReview();
  alert(`묶음 반려 완료: ${ok}건${fail ? ` · ${fail}건 실패` : ""}`);
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
const HIST_LABELS = { assetName: "자산명", assetNumber: "자산코드", labelSticker: "라벨스티커", labelFile: "라벨 파일", status: "상태", location: "위치", manager: "사용자", dept: "부서", model: "모델", spec: "규격", maker: "제작사", acquireCost: "취득금액", note: "비고", imageUrl: "사진" };
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
  const notice = isSuperAdmin ? "" : `<div class="notice" style="margin-bottom:12px;">전체 기록을 <b>확인</b>할 수 있습니다. 되돌리기·삭제는 <b>본인이 처리한 기록</b>만 가능합니다. (다른 관리자 기록은 최고관리자만)</div>`;
  body.innerHTML = notice + `<div class="hist-list">` + rows.map((h) => {
    const summary = histSummary(h);
    const who = [h.approved_by && `결재 ${esc(h.approved_by)}`, h.requester && `신청 ${esc(h.requester)}`].filter(Boolean).join(" · ");
    const mine = canManageHist(h);
    const canRevert = h.action !== "inspect" && mine;
    const actions = mine
      ? `<span class="hist-actions">${canRevert ? `<button class="btn-mini btn-edit" data-revert="${h.id}">되돌리기</button>` : ""}<button class="btn-mini btn-del" data-delhist="${h.id}">삭제</button></span>`
      : "";
    // 기록을 누르면 그 물품의 상세를 연다.
    // 자산 데이터(특히 2024년분)는 뒤늦게 로드되므로, 여기서 미리 걸러내지 않고 항상 누를 수 있게 둔다.
    // 실제로 못 찾는 경우(삭제됨·로딩중)는 누른 시점에 안내한다.
    const tip = stripTags(`${h.asset_name || h.asset_id} · ${summary}${who ? " · " + who : ""}`) + " — 눌러서 물품 상세 보기";
    return `
      <div class="hist-row hist-openable" data-hist-asset="${esc(h.asset_id)}" title="${esc(tip)}">
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
          const isAdminRole = m.role === "admin";
          const status = m.status || "pending";
          const pendingGrant = pendingGrantFor(m.id);
          // 가입 승인/거절 — '일반 사용자'에게만. 다른 관리자·최고관리자는 여기서 건드릴 수 없다.
          let approveBtns = "";
          if (!isSelf && !isSuper && !isAdminRole) {
            if (status !== "approved") approveBtns += `<button class="btn-mini btn-view" data-setstatus="approved" data-id="${esc(m.id)}">승인</button> `;
            if (status === "pending") approveBtns += `<button class="btn-mini btn-del" data-setstatus="rejected" data-id="${esc(m.id)}">거절</button> `;
            if (status === "approved") approveBtns += `<button class="btn-mini btn-edit" data-setstatus="pending" data-id="${esc(m.id)}">승인취소</button> `;
          }
          // 관리자 승격: 일반 관리자는 '요청', 최고관리자는 즉시 지정 또는 요청 승인/거절 (승인된 일반 사용자만)
          let promoBtns = "";
          if (!isSelf && !isSuper && !isAdminRole && status === "approved") {
            if (isSuperAdmin) {
              promoBtns += pendingGrant
                ? `<button class="btn-mini btn-view" data-approveadmin="${esc(m.id)}">✅ 승격 승인</button> <button class="btn-mini btn-del" data-rejectadmin="${esc(m.id)}">요청 거절</button> `
                : `<button class="btn-mini btn-view" data-role="admin" data-id="${esc(m.id)}">관리자로</button> `;
            } else {
              promoBtns += pendingGrant
                ? `<span class="member-pending">승격 요청됨 · 최고관리자 승인 대기</span> `
                : `<button class="btn-mini btn-view" data-reqadmin="${esc(m.id)}">관리자 승격 요청</button> `;
            }
          }
          // 관리자 강등/회원 삭제 — 최고관리자만
          let superBtns = "";
          if (!isSelf && !isSuper && isSuperAdmin) {
            if (isAdminRole) superBtns += `<button class="btn-mini btn-edit" data-role="user" data-id="${esc(m.id)}">사용자로</button> `;
            superBtns += `<button class="btn-mini btn-del" data-delmember="${esc(m.id)}">삭제</button>`;
          }
          let actions;
          if (isSelf) actions = `<span class="member-self">본인</span>`;
          else if (isSuper) actions = `<span class="member-self">최고관리자</span>`;
          else actions = (approveBtns + promoBtns + superBtns).trim() || `<span class="member-self">—</span>`;
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
    <p class="member-count">총 ${members.length}명 · 가입 승인은 관리자가, <b>관리자 승격은 최고관리자 승인</b>으로, 권한 변경·삭제는 최고관리자만 할 수 있습니다. (관리자는 다른 관리자를 건드릴 수 없습니다.)</p>`;
}
// 이 회원에 대한 '관리자 승격' 대기 요청 (없으면 undefined)
function pendingGrantFor(memberId) {
  return requests.find((r) => r.action === "grant_admin" && String(r.target_id) === String(memberId));
}
// 일반 관리자: 사용자를 관리자로 '승격 요청' (최고관리자 승인 대기)
async function requestAdminGrant(id) {
  if (!isAdmin) return;
  const m = members.find((x) => String(x.id) === String(id));
  if (!m) return;
  if (m.role === "admin" || m.role === "superadmin") { alert("이미 관리자입니다."); return; }
  if ((m.status || "pending") !== "approved") { alert("가입 승인이 완료된 사용자만 관리자 승격을 요청할 수 있습니다."); return; }
  if (pendingGrantFor(id)) { alert("이미 승격 요청이 접수되어 최고관리자 승인 대기 중입니다."); return; }
  if (!confirm(`${m.name || m.username || m.email} 님을 관리자로 승격 요청하시겠습니까?\n최고관리자 승인 후 관리자가 됩니다.`)) return;
  const who = myProfile?.name || myProfile?.username || (currentUser.email || "").split("@")[0];
  try {
    const { error } = await sb.from("requests").insert({
      action: "grant_admin", target_id: String(id),
      payload: { name: m.name || "", username: m.username || "", email: m.email || "", requestedRole: "admin", batchLabel: "관리자 승격" },
      requester: who, note: `관리자 승격 요청 · 대상: ${m.name || m.username || m.email}`,
      user_id: currentUser.id, status: "pending",
    });
    if (error) throw error;
  } catch (e) { console.error(e); alert("승격 요청에 실패했습니다."); return; }
  await sbLoadRequests(); renderMembers(); updateUI();
  alert("관리자 승격 요청이 접수되었습니다. 최고관리자 승인 후 반영됩니다.");
}
// 최고관리자: 승격 요청 승인 → 실제 관리자로 지정
async function approveAdminGrant(id) {
  if (!isSuperAdmin) { alert("관리자 승격 승인은 최고관리자만 할 수 있습니다."); return; }
  const m = members.find((x) => String(x.id) === String(id));
  const req = pendingGrantFor(id);
  if (!m) return;
  if (!confirm(`${m.name || m.username || m.email} 님을 관리자로 승격하시겠습니까?`)) return;
  try {
    const { error } = await sb.from("profiles").update({ role: "admin" }).eq("id", id);
    if (error) throw error;
    if (req) await sb.from("requests").update({ status: "approved", decided_at: new Date().toISOString() }).eq("id", req.id);
  } catch (e) { console.error(e); alert("승격 승인에 실패했습니다."); return; }
  await sbLoadMembers(); await sbLoadRequests(); renderMembers(); updateUI();
}
// 최고관리자: 승격 요청 거절
async function rejectAdminGrant(id) {
  if (!isSuperAdmin) { alert("최고관리자만 처리할 수 있습니다."); return; }
  const req = pendingGrantFor(id);
  if (!req) { renderMembers(); return; }
  if (!confirm("이 관리자 승격 요청을 거절하시겠습니까?")) return;
  try {
    const { error } = await sb.from("requests").update({ status: "rejected", decided_at: new Date().toISOString() }).eq("id", req.id);
    if (error) throw error;
  } catch (e) { console.error(e); alert("처리에 실패했습니다."); return; }
  await sbLoadRequests(); renderMembers(); updateUI();
}
async function setMemberStatus(id, status) {
  const m = members.find((x) => String(x.id) === String(id));
  if (!m) return;
  // 다른 관리자·최고관리자 계정은 최고관리자만 건드릴 수 있다.
  if ((m.role === "admin" || m.role === "superadmin") && !isSuperAdmin) { alert("다른 관리자 계정은 최고관리자만 변경할 수 있습니다."); return; }
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
  if (!isSuperAdmin) { alert("권한 변경은 최고관리자만 할 수 있습니다."); return; }
  const m = members.find((x) => String(x.id) === String(id));
  if (!m) return;
  if (m.role === "superadmin") { alert("최고관리자의 권한은 변경할 수 없습니다."); return; }
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
  if (!isSuperAdmin) { alert("회원 삭제는 최고관리자만 할 수 있습니다."); return; }
  const m = members.find((x) => String(x.id) === String(id));
  if (!m) return;
  if (m.role === "superadmin") { alert("최고관리자 계정은 삭제할 수 없습니다."); return; }
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
    "자산명": a.assetName || "", "자산코드": a.assetNumber || "", "라벨스티커": a.labelSticker || "", "라벨파일": a.labelFile ? (a.labelFileName || "있음") : "",
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
// 재물조사 결과 내보내기(관리자 전용): '업로드된 재물조사 목록표(inventory_list.json)' 기준.
//  · 목록표에 있는 자산만 내보낸다(시스템 전체 X). 검수완료 자산에 '정상 O' + 검수일·검수자 채움.
//  · 목록표 원본 열(자산관리번호…정상/요정비/폐품/불용)을 그대로 유지 → 그대로 제출/붙여넣기 가능.
// ===== 재물조사 결과 내보내기 =====
// 목록표 원본(survey_template.xlsx)을 그대로 받아 '정상(T열)'에 O 만 찍어 돌려준다.
// 표를 새로 그리지 않으므로 서식·머리글·병합셀·열너비·메모가 원본 그대로 유지된다.
// survey_template.xlsx = 원본 목록표에서 데이터 아래 빈 행 103만 개만 걷어낸 것(build-survey-template.js).

// --- 브라우저용 zip 최소 구현 (라이브러리 없이) ---
const ZIP_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function zipCrc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = ZIP_CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function streamBytes(u8, mode) {   // mode: "deflate-raw" 압축 / "deflate-raw" 해제
  const S = mode === "inflate" ? DecompressionStream : CompressionStream;
  const st = new S("deflate-raw");
  const w = st.writable.getWriter(); w.write(u8); w.close();
  const parts = []; const rd = st.readable.getReader();
  for (;;) { const { value, done } = await rd.read(); if (done) break; parts.push(value); }
  let len = 0; parts.forEach((p) => (len += p.length));
  const out = new Uint8Array(len); let o = 0;
  parts.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
}
function zipRead(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("zip 형식이 아닙니다.");
  let p = dv.getUint32(eocd + 16, true);
  const n = dv.getUint16(eocd + 10, true), out = [];
  const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), time = dv.getUint16(p + 12, true), date = dv.getUint16(p + 14, true);
    const crc = dv.getUint32(p + 16, true), compSize = dv.getUint32(p + 20, true), uncompSize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const dataStart = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    out.push({ name, method, time, date, crc, compSize, uncompSize, data: u8.subarray(dataStart, dataStart + compSize) });
    p += 46 + nl + el + cl;
  }
  return out;
}
function zipWrite(entries) {
  const enc = new TextEncoder();
  const chunks = []; let offset = 0; const central = [];
  for (const e of entries) {
    const nb = enc.encode(e.name);
    const lh = new Uint8Array(30); const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
    dv.setUint16(8, e.method, true); dv.setUint16(10, e.time, true); dv.setUint16(12, e.date, true);
    dv.setUint32(14, e.crc, true); dv.setUint32(18, e.data.length, true); dv.setUint32(22, e.uncompSize, true);
    dv.setUint16(26, nb.length, true); dv.setUint16(28, 0, true);
    central.push({ ...e, nb, localOffset: offset });
    chunks.push(lh, nb, e.data); offset += 30 + nb.length + e.data.length;
  }
  const cdStart = offset;
  for (const c of central) {
    const h = new Uint8Array(46); const dv = new DataView(h.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true);
    dv.setUint16(10, c.method, true); dv.setUint16(12, c.time, true); dv.setUint16(14, c.date, true);
    dv.setUint32(16, c.crc, true); dv.setUint32(20, c.data.length, true); dv.setUint32(24, c.uncompSize, true);
    dv.setUint16(28, c.nb.length, true); dv.setUint32(42, c.localOffset, true);
    chunks.push(h, c.nb); offset += 46 + c.nb.length;
  }
  const eo = new Uint8Array(22); const dv = new DataView(eo.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, central.length, true); dv.setUint16(10, central.length, true);
  dv.setUint32(12, offset - cdStart, true); dv.setUint32(16, cdStart, true);
  chunks.push(eo);
  return new Blob(chunks, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function exportInspectionResult() {
  if (!isAdmin) { alert("재물조사 결과 내보내기는 관리자만 할 수 있습니다."); return; }
  if (typeof DecompressionStream === "undefined" || typeof CompressionStream === "undefined") {
    alert("이 브라우저에서는 지원되지 않습니다.\n크롬·엣지·사파리 최신 버전에서 이용해주세요."); return;
  }
  const btn = document.getElementById("exportInspBtn");
  const label = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "만드는 중…"; }
  try {
    const res = await fetch("survey_template.xlsx");
    if (!res.ok) throw new Error("목록표 원본을 불러오지 못했습니다.");
    const entries = zipRead(await res.arrayBuffer());
    const sheet = entries.find((e) => e.name === "xl/worksheets/sheet1.xml");
    const ssEnt = entries.find((e) => e.name === "xl/sharedStrings.xml");
    if (!sheet || !ssEnt) throw new Error("목록표 원본 구조가 예상과 다릅니다.");

    const inflate = async (e) => new TextDecoder().decode(e.method === 0 ? e.data : await streamBytes(e.data, "inflate"));
    const shared = [];
    for (const si of (await inflate(ssEnt)).match(/<si>[\s\S]*?<\/si>/g) || [])
      shared.push((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<t[^>]*>/, "").replace(/<\/t>$/, "")).join(""));

    // 검수 완료 자산번호 집합 — '목록표' 기준(연동된 1회차 검수도 포함)
    const nrm = (s) => String(s || "").replace(/[\s.\-_]/g, "").toUpperCase();
    const doneNums = new Set();
    for (const a of assets) if (inspectedRound(a, SURVEY_ROUND)) doneNums.add(nrm(a.assetNumber));

    // 시트 XML에서 각 행의 B(자산관리번호)를 보고, 검수됐으면 T셀에 O 를 넣는다
    let xml = await inflate(sheet);
    let marked = 0, total = 0;
    xml = xml.replace(/<row [^>]*r="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (row, rn) => {
      const bm = new RegExp(`<c r="B${rn}"([^>]*)>\\s*<v>([^<]*)</v>`).exec(row);
      if (!bm) return row;
      const num = / t="s"/.test(bm[1]) ? (shared[Number(bm[2])] ?? "") : bm[2];
      if (!/^[0-9A-Za-z]{6,}$/.test(num)) return row;   // 머리글·부속표 행 제외
      total++;
      if (!doneNums.has(nrm(num))) return row;
      marked++;
      const ref = `T${rn}`;
      const cell = `<c r="${ref}"$1 t="inlineStr"><is><t>O</t></is></c>`;
      if (new RegExp(`<c r="${ref}"[^>]*/>`).test(row))                       // 빈 셀 → 서식 유지하고 값만
        return row.replace(new RegExp(`<c r="${ref}"([^>]*?)\\s*/>`), cell);
      if (new RegExp(`<c r="${ref}"[^>]*>`).test(row))                        // 값 있는 셀 → 통째로 교체
        return row.replace(new RegExp(`<c r="${ref}"([^>]*)>[\\s\\S]*?</c>`), (m, at) =>
          `<c r="${ref}"${at.replace(/\s*t="[^"]*"/, "")} t="inlineStr"><is><t>O</t></is></c>`);
      return row.replace("</row>", `<c r="${ref}" t="inlineStr"><is><t>O</t></is></c></row>`);
    });

    const raw = new TextEncoder().encode(xml);
    sheet.data = await streamBytes(raw, "deflate");
    sheet.method = 8; sheet.crc = zipCrc32(raw); sheet.uncompSize = raw.length;

    const blob = zipWrite(entries);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `2026년 재물조사 목록표_검수표시_${todayStr()}.xlsx`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`재물조사 결과를 내려받았어요. 목록표 ${total.toLocaleString()}건 중 정상 O ${marked.toLocaleString()}건.`, "success");
  } catch (e) {
    console.error(e);
    alert("재물조사 결과를 만들지 못했습니다.\n원인: " + (e?.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
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
document.getElementById("exportInspBtn").addEventListener("click", exportInspectionResult);
document.getElementById("uninspBtn").addEventListener("click", () => { inspView = inspView === "uninsp" ? "all" : "uninsp"; applyFilter(); });
document.getElementById("inspDoneBtn").addEventListener("click", () => { inspView = inspView === "done" ? "all" : "done"; applyFilter(); });
document.getElementById("inspRoundFilter").addEventListener("change", (e) => { inspRound = e.target.value; renderStats(); applyFilter(); });
document.getElementById("stats").addEventListener("change", (e) => {
  if (e.target && e.target.id === "inspRoundSel") { inspRound = e.target.value; renderStats(); applyFilter(); }
});
// 진척 상세의 장소 줄 클릭 → 그 장소의 미검수만 보기 (한 곳씩 찾아가 몰아서 끝내는 동선)
document.getElementById("inspDetailBody").addEventListener("click", (e) => {
  const row = e.target.closest("[data-ipd-loc]");
  if (!row) return;
  const loc = row.dataset.ipdLoc;
  const locInput = document.getElementById("locFilter");
  if (locInput) locInput.value = loc === "(미지정)" ? "" : loc;
  inspView = "uninsp";
  hide("inspDetailOverlay");
  applyFilter();
  const tbl = document.querySelector(".table-wrap");
  if (tbl) tbl.scrollIntoView({ behavior: "smooth", block: "start" });
});
// 검수 대시보드의 '미검수 N건 →' 클릭 → 미검수 필터로 이동 + 목록으로 스크롤
document.getElementById("stats").addEventListener("click", (e) => {
  if (e.target.closest("[data-insp-detail]")) { openInspProgressDetail(); return; }
  const jump = e.target.closest("[data-insp-jump]");
  if (!jump) return;
  inspView = "uninsp";
  applyFilter();
  const tbl = document.querySelector(".table-wrap");
  if (tbl) tbl.scrollIntoView({ behavior: "smooth", block: "start" });
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
  if (e.target.id === "bulk-inspcancel-on") {
    document.getElementById("bulk-inspcancel-fields").hidden = !e.target.checked;
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
    bulkEditPhotoData = await compressImage(file, 820, 0.58);
    document.getElementById("bulk-photo-preview").innerHTML = `<img src="${bulkEditPhotoData}" alt="선택한 사진" />`;
  } catch (err) { console.error("사진 처리 오류:", err); alert("사진 처리 중 문제가 발생했습니다."); }
});

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
document.getElementById("detailPhotoBtn").addEventListener("click", startDetailPhoto);
// 카메라 모달
document.getElementById("camShotBtn").addEventListener("click", camCapture);
document.getElementById("camDoneBtn").addEventListener("click", () => closeCamera(camShots.slice()));
document.getElementById("camFlipBtn").addEventListener("click", async () => {
  camFacing = camFacing === "environment" ? "user" : "environment";
  await camStart();
});
document.getElementById("camPickBtn").addEventListener("click", () => {
  closeCamera([]);                                    // 카메라를 닫고 파일 선택으로 전환
  document.getElementById("detailPhotoInput").click();
});
document.getElementById("camShots").addEventListener("click", (e) => {
  const d = e.target.closest("[data-cam-del]");
  if (!d) return;
  camShots.splice(Number(d.dataset.camDel), 1);
  camRenderShots();
});
// 카메라 모달을 어떤 방법으로 닫든 스트림을 반드시 끈다(카메라 표시등이 계속 켜져 있지 않도록)
document.getElementById("camOverlay").addEventListener("click", (e) => {
  if (e.target.closest("[data-close]") || e.target.id === "camOverlay") closeCamera([]);
});
document.getElementById("detailPhotoInput").addEventListener("change", async (e) => {
  const files = e.target.files;
  e.target.value = "";                 // 같은 파일을 연속으로 골라도 change 가 다시 뜨도록
  await addDetailPhotos(files);
});
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
// 단일(카메라) 검수 인식 취소
document.getElementById("scanCancelBtn").addEventListener("click", cancelScanRecognition);
// 인식 중 '직접 입력'으로 전환(느릴 때 기다리지 않고 바로 손입력)
document.getElementById("scanManualBtn").addEventListener("click", switchToManualInput);
// 인식 중 '다시 촬영'(안 잡히거나 느릴 때 즉시 재촬영)
document.getElementById("scanRetakeBtn").addEventListener("click", retakeFromScan);
// 검수 화면에서 '자산코드 수정'(인식된 자산이 틀렸을 때) → 코드 입력창으로(인식된 코드 프리필)
document.getElementById("inspFixCodeBtn").addEventListener("click", () => {
  hide("inspectOverlay");
  openManualCode(scanPendingFile, scanLastCode);
});
// 자산코드 직접 입력(인식 실패 폴백)
document.getElementById("manualCodeSubmit").addEventListener("click", submitManualCode);
document.getElementById("manualCodeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitManualCode(); } });
document.getElementById("manualCodeRetake").addEventListener("click", () => {
  hide("manualCodeOverlay"); scanPendingFile = null;
  const input = document.getElementById("scanCameraInput");
  if (input) { input.value = ""; input.click(); }
});
// 여러 장 한번에 검수
document.getElementById("batchInspectBtn").addEventListener("click", openBatchInspect);
// PDF 검수: 버튼 클릭 → 검수 창 + PDF 파일 선택창 바로 열기
document.getElementById("pdfInspectBtn").addEventListener("click", openPdfInspect);
document.getElementById("batchPickBtn").addEventListener("click", () => {
  const input = document.getElementById("batchInspectInput");
  if (input) { input.value = ""; input.click(); }
});
document.getElementById("batchInspectInput").addEventListener("change", (e) => { handleBatchFiles(e.target.files); });
// PDF 목록으로 검수
document.getElementById("batchPdfBtn").addEventListener("click", () => {
  const input = document.getElementById("batchPdfInput");
  if (input) { input.value = ""; input.click(); }
});
document.getElementById("batchPdfInput").addEventListener("change", (e) => { handlePdfInspect(e.target.files && e.target.files[0]); });
// 자산 등록 PDF 양식: 다운로드 / (최고관리자) 등록·교체
document.getElementById("batchTemplateDownload").addEventListener("click", downloadPdfTemplate);
document.getElementById("batchTemplateUpload").addEventListener("click", () => {
  const input = document.getElementById("batchTemplateInput");
  if (input) { input.value = ""; input.click(); }
});
document.getElementById("batchTemplateInput").addEventListener("change", (e) => { handleTemplateUpload(e.target.files && e.target.files[0]); });
// 여러 장/PDF 인식 취소
document.getElementById("batchCancelBtn").addEventListener("click", () => { scanCancelRequested = true; terminateNumberOcrWorker(); });
document.getElementById("batchRetryAllBtn").addEventListener("click", () => retryAllFailed(false));
document.getElementById("batchRetryRotateBtn").addEventListener("click", () => retryAllFailed(true));
document.getElementById("batchActions").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-batch-apply]");
  if (b) applyBatchInspect(b.dataset.batchApply);
});
document.getElementById("batchInspectList").addEventListener("click", (e) => {
  const remove = e.target.closest("button[data-batch-remove]");
  if (remove) { removeBatchItem(Number(remove.dataset.batchRemove)); return; }
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
    const arr = Array.from(files);
    const pdf = arr.find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""));
    if (batchMode === "pdf") {
      // 자산 등록 PDF 검수: PDF 파일만 받는다. (사진 인식 안 함)
      if (pdf) handlePdfInspect(pdf);
      else alert("자산 등록 PDF 검수에는 PDF 파일만 올릴 수 있습니다.");
      return;
    }
    // 라벨 여러 장 검수: 사진만 처리
    handleBatchFiles(files);
  });
})();
// 검수 화면: 물품 사진 이어 찍기(최대 3장)
document.getElementById("inspExtraBtn").addEventListener("click", () => {
  const input = document.getElementById("inspExtraInput");
  if (input) { input.value = ""; input.click(); }
});
document.getElementById("inspExtraInput").addEventListener("change", (e) => { handleInspExtraCapture(e.target.files && e.target.files[0]); });
document.getElementById("inspExtraPreview").addEventListener("click", async (e) => {
  const del = e.target.closest("button[data-insp-extra]");
  if (del) { inspectExtraPhotos.splice(Number(del.dataset.inspExtra), 1); renderInspExtra(); return; }
  const rot = e.target.closest("button[data-insp-rot]");
  if (rot) {
    const i = Number(rot.dataset.inspRot);
    try { inspectExtraPhotos[i] = await rotateImageDataUrl(inspectExtraPhotos[i], 90); renderInspExtra(); } catch (err) { console.error("회전 오류:", err); }
  }
});
// 검수 사진 회전
document.getElementById("inspPhotoRotateBtn").addEventListener("click", async () => {
  if (!inspectPhoto) return;
  const btn = document.getElementById("inspPhotoRotateBtn");
  btn.disabled = true;
  try {
    inspectPhoto = await rotateImageDataUrl(inspectPhoto, 90);
    const prev = document.getElementById("inspPhotoPreview");
    if (prev) prev.innerHTML = `<img src="${inspectPhoto}" alt="검수 사진" />`;
  } catch (err) { console.error("검수 사진 회전 오류:", err); }
  btn.disabled = false;
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
document.getElementById("myProfileBtn").addEventListener("click", () => { myHistCache = null; openMyProfile(); });
document.querySelectorAll(".mp-tabs .admin-tab").forEach((b) => b.addEventListener("click", () => setMyProfileTab(b.dataset.mptab)));
document.getElementById("myHistBody").addEventListener("click", (e) => {
  const row = e.target.closest("[data-hist-asset]");
  if (row) openAssetFromRecord(row.dataset.histAsset);
});
document.getElementById("mpSaveBtn").addEventListener("click", saveMyProfile);
document.getElementById("myProfileForm").addEventListener("submit", (e) => { e.preventDefault(); saveMyProfile(); });
document.getElementById("authSubmit").addEventListener("click", authSubmit);
document.getElementById("authForm").addEventListener("submit", (e) => { e.preventDefault(); authSubmit(); });
// 소속(부서) '기타(직접 입력)' 선택 시 직접 입력칸 표시
document.getElementById("authAffil").addEventListener("change", (e) => {
  const custom = document.getElementById("authAffilCustom");
  const on = e.target.value === "__custom__";
  custom.hidden = !on;
  if (on) custom.focus();
});
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
// [data-atab] 만 — '내 정보' 모달 탭(.mp-tabs)은 여기 걸리면 관리자 페이지로 튕겨나간다
document.querySelectorAll(".admin-tab[data-atab]").forEach((b) => b.addEventListener("click", () => navTo("admin/" + b.dataset.atab)));

// 승인 대기 목록
document.getElementById("adminReviewBody").addEventListener("click", (e) => {
  const ap = e.target.closest("button[data-approve]");
  const rj = e.target.closest("button[data-reject]");
  if (ap) { approveRequest(ap.dataset.approve); return; }
  if (rj) { rejectRequest(rj.dataset.reject); return; }
  const apb = e.target.closest("button[data-approvebatch]");
  if (apb) { approveBatchRequests(apb.dataset.approvebatch); return; }
  const rjb = e.target.closest("button[data-rejectbatch]");
  if (rjb) { rejectBatchRequests(rjb.dataset.rejectbatch); return; }
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
    // 개별(묶음이 아닌) 요청만 전체 선택
    const singles = requests.filter((r) => !(r.payload && r.payload.batch));
    if (e.target.checked) singles.forEach((r) => selectedReqIds.add(String(r.id)));
    else selectedReqIds.clear();
    renderReview();
  }
});
// 결재/변경 이력
document.getElementById("adminHistSearch").addEventListener("input", renderHistory);
// 접속 로그: 사용자 이름 클릭 → 그 사용자 상세 / '← 사용자 목록' 뒤로
document.getElementById("adminAccessBody").addEventListener("click", (e) => {
  const u = e.target.closest("[data-al-user]");
  if (u) { _accessLogUser = u.dataset.alUser; renderAccessLog(); return; }
  if (e.target.closest("[data-al-back]")) { _accessLogUser = null; renderAccessLog(); }
});
document.getElementById("adminHistBody").addEventListener("click", (e) => {
  const rv = e.target.closest("button[data-revert]");
  const dl = e.target.closest("button[data-delhist]");
  if (rv) { revertHistory(rv.dataset.revert); return; }
  if (dl) { deleteHistory(dl.dataset.delhist); return; }
  // 되돌리기·삭제 버튼이 아닌 곳을 누르면 그 기록의 물품 상세를 연다
  const row = e.target.closest("[data-hist-asset]");
  if (row) openAssetFromRecord(row.dataset.histAsset);
});
// 회원 관리
document.getElementById("adminMembersBody").addEventListener("click", (e) => {
  const statusBtn = e.target.closest("button[data-setstatus]");
  const roleBtn = e.target.closest("button[data-role]");
  const delBtn = e.target.closest("button[data-delmember]");
  const reqAdminBtn = e.target.closest("button[data-reqadmin]");
  const approveAdminBtn = e.target.closest("button[data-approveadmin]");
  const rejectAdminBtn = e.target.closest("button[data-rejectadmin]");
  if (statusBtn) setMemberStatus(statusBtn.dataset.id, statusBtn.dataset.setstatus);
  else if (roleBtn) setMemberRole(roleBtn.dataset.id, roleBtn.dataset.role);
  else if (delBtn) deleteMember(delBtn.dataset.delmember);
  else if (reqAdminBtn) requestAdminGrant(reqAdminBtn.dataset.reqadmin);
  else if (approveAdminBtn) approveAdminGrant(approveAdminBtn.dataset.approveadmin);
  else if (rejectAdminBtn) rejectAdminGrant(rejectAdminBtn.dataset.rejectadmin);
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
const ALL_MODALS = ["detailOverlay", "formOverlay", "delReqOverlay", "authOverlay", "myProfileOverlay", "bulkEditOverlay", "myReqOverlay", "inspectOverlay", "batchInspectOverlay", "postFormOverlay", "postViewOverlay", "scanGuideOverlay", "manualCodeOverlay", "inspDetailOverlay", "installGuideOverlay"];
document.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => { inspectPhoto = ""; ALL_MODALS.forEach(hide); }));
// 배경(어두운 부분) 클릭 시 닫기 — 단, 여러 장 검수 창은 실수로 닫히면 인식한 사진이 날아가므로 제외(‘닫기’ 버튼으로만)
// 모바일: 카메라·사진 선택창을 다녀올 때 배경에 '유령 클릭'이 들어가 창이 꺼지는 문제 방지
const NO_BACKDROP_CLOSE = new Set(["batchInspectOverlay", "inspectOverlay", "formOverlay", "bulkEditOverlay"]);
document.querySelectorAll(".modal-overlay").forEach((ov) => ov.addEventListener("click", (e) => { if (e.target === ov && !NO_BACKDROP_CLOSE.has(ov.id)) ov.hidden = true; }));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeLightbox();
  // 작업 중인 창은 Esc로도 닫지 않는다 (사진 유실 방지)
  ALL_MODALS.forEach((id) => { const el = document.getElementById(id); if (NO_BACKDROP_CLOSE.has(id) && el && !el.hidden) return; hide(id); });
});

// 시작
loadData();
