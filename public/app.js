const el = (id) => document.getElementById(id);

const authCard = el("authCard");
const appRoot = el("appRoot");
const btnSignOut = el("btnSignOut");
const btnRefresh = el("btnRefresh");
const btnTheme = el("btnTheme");
let quickBound = false;


const pad2 = (n) => (n < 10 ? "0" + n : "" + n);
const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseISODate = (s) => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtRU = (iso) => { const d = parseISODate(iso); return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}.${d.getFullYear()}`; };

const csvToTags = (s) => (s || "").split(",").map(t => t.trim()).filter(Boolean).slice(0, 12);

const showErr = (node, msg) => {
  node.textContent = msg || "";
  node.classList.toggle("hidden", !msg);
};

const rafYield = () => new Promise((r) => requestAnimationFrame(() => r()));

async function copyToClipboard(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch{
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand("copy"); }catch{}
    document.body.removeChild(ta);
    return true;
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

// -------------------------
// Theme (light/dark)
// -------------------------
const THEME_KEY = "lj_theme";

function getSystemTheme(){
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme){
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = t;

  // update button icon
  const b = el("btnTheme");
  if (b) b.textContent = (t === "dark" ? "☀" : "☾");

  // update theme-color for mobile
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "dark" ? "#120a0b" : "#f7a7aa");
}

function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    applyTheme(saved);
  } else {
    applyTheme(getSystemTheme());
  }
}

btnTheme?.addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const next = cur === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}, { passive: true });

// Simple fetch wrapper (cookie auth)
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {})
    }
  });

  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const data = isJson ? await res.json().catch(() => ({})) : {};

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Image downscale to max 1600px (only if needed)
async function downscaleIfNeeded(file, maxDim = 1600) {
  if (file.size < 700_000) return file;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const w = bmp.width, h = bmp.height;
  const max = Math.max(w, h);
  if (max <= maxDim) return file;

  const scale = maxDim / max;
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  ctx.drawImage(bmp, 0, 0, tw, th);
  bmp.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/webp", 0.86));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
}

// -------------------------
// Auth
// -------------------------
async function setAuthedUI(authed) {
  btnSignOut.classList.toggle("hidden", !authed);
  btnRefresh.classList.toggle("hidden", !authed);

  authCard.classList.toggle("hidden", authed);
  appRoot.classList.toggle("hidden", !authed);

  if (!authed) { disconnectLiveWS(); return; }

  const todayISO = toISODate(new Date());
  el("entryDate").value = todayISO;
  el("eventDate").value = todayISO;
  el("photoDate").value = todayISO;

  await refreshAll();

  // Quick actions (bind once)
  if (!quickBound) {
    el("btnQuickSeed")?.addEventListener("click", () => el("btnSeedDates")?.click(), { passive: true });
    el("btnQuickLive")?.addEventListener("click", () => setActiveTab("live"), { passive: true });
    quickBound = true;
  }

  connectLiveWS();
}

async function checkSession() {
  try {
    await api("/api/me");
    await setAuthedUI(true);
  } catch {
    await setAuthedUI(false);
  }
}

btnSignOut.addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  disconnectLiveWS();
  await setAuthedUI(false);
}, { passive: true });

btnRefresh.addEventListener("click", () => refreshAll(), { passive: true });

el("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  showErr(el("authError"), "");

  const email = el("email").value.trim();
  const password = el("password").value;

  el("btnLogin").disabled = true;
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
    await setAuthedUI(true);
  } catch (err) {
    showErr(el("authError"), err?.message || "Ошибка входа");
  } finally {
    el("btnLogin").disabled = false;
  }
});


function setActiveTab(tab){
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll(".tabPanel").forEach(p => p.classList.add("hidden"));
  el("tab-" + tab)?.classList.remove("hidden");

  // Lazy init per-tab
  if (tab === "live") ensureLiveReady();
  if (tab === "feed") renderFeed();
}

// Tabs (event delegation)
document.querySelector(".tabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  const tab = btn.dataset.tab;
  if (!tab) return;
  setActiveTab(tab);
}, { passive: true });

// -------------------------
// Calendar
// -------------------------
const calendarGrid = el("calendarGrid");
const eventList = el("eventList");
const selectedDateTitle = el("selectedDateTitle");
const monthLabel = el("monthLabel");
const monthMeta = el("monthMeta");

let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-based
let selectedISO = toISODate(new Date());

let eventsByDate = new Map();

const DOW = ["ПН","ВТ","СР","ЧТ","ПТ","СБ","ВС"];
const MONTHS = ["ЯНВАРЬ","ФЕВРАЛЬ","МАРТ","АПРЕЛЬ","МАЙ","ИЮНЬ","ИЮЛЬ","АВГУСТ","СЕНТЯБРЬ","ОКТЯБРЬ","НОЯБРЬ","ДЕКАБРЬ"];

function startOfMonth(y, m){ return new Date(y, m, 1); }
function endOfMonth(y, m){ return new Date(y, m + 1, 0); }
function mondayIndex(jsDay){ return (jsDay + 6) % 7; }

function rebuildEventsMap(events){
  const map = new Map();
  for (const ev of events) {
    const iso = ev.event_date;
    const arr = map.get(iso) || [];
    arr.push(ev);
    map.set(iso, arr);
  }
  for (const [k, arr] of map.entries()) {
    arr.sort((a,b) => (a.created_at < b.created_at ? -1 : 1));
  }
  eventsByDate = map;
}

async function loadMonthEvents(){
  const from = toISODate(startOfMonth(calYear, calMonth));
  const to = toISODate(endOfMonth(calYear, calMonth));
  const data = await api(`/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  rebuildEventsMap(data.events || []);
}

function renderDayEvents(){
  const list = eventsByDate.get(selectedISO) || [];
  if (!list.length) {
    eventList.innerHTML = "<div class='muted'>Нет событий на эту дату.</div>";
    return;
  }
  eventList.innerHTML = list.map(ev => {
    const tag = ev.icon || (ev.kind === "birthday" ? "🎂" : (ev.kind === "memory" ? "❤" : "•"));
    const note = ev.note ? `<div class="eventNote">${escapeHtml(ev.note)}</div>` : "";
    return `
      <div class="eventItem" data-date="${ev.event_date}" data-title="${escapeHtml(ev.title)}" data-note="${escapeHtml(ev.note || "")}" data-kind="${escapeHtml(ev.kind)}" data-icon="${escapeHtml(ev.icon || "")}">
        <div class="eventLeft">
          <div class="eventTitle">${tag} ${escapeHtml(ev.title)}</div>
          ${note}
        </div>
        <div class="row" style="gap:8px; align-items:center;">
          <div class="eventTag">${fmtRU(ev.event_date)}</div>
          <button class="btn ghost eventDel" data-evdel="${ev.id}" type="button" aria-label="Удалить">✕</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderCalendar(){
  monthLabel.textContent = MONTHS[calMonth] + ".";
  monthMeta.textContent = `${calYear} • выбранная дата: ${fmtRU(selectedISO)}`;

  const first = startOfMonth(calYear, calMonth);
  const last = endOfMonth(calYear, calMonth);

  const startPad = mondayIndex(first.getDay());
  const daysInMonth = last.getDate();
  const totalCells = 42; // 6 weeks stable

  const todayISO = toISODate(new Date());

  let html = "";
  html += "<div class='calHeader'>" + DOW.map(d => `<div>${d}</div>`).join("") + "</div>";
  html += "<div class='calGrid'>";

  for (let i=0; i<totalCells; i++){
    const dayNum = i - startPad + 1;
    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;

    let y = calYear, m = calMonth, d = dayNum;
    let out = false;

    if (!inMonth) {
      out = true;
      if (dayNum < 1) {
        const pm = new Date(calYear, calMonth, 0);
        y = pm.getFullYear(); m = pm.getMonth(); d = pm.getDate() + dayNum;
      } else {
        const nm = new Date(calYear, calMonth + 1, dayNum - daysInMonth);
        y = nm.getFullYear(); m = nm.getMonth(); d = nm.getDate();
      }
    }

    const iso = `${y}-${pad2(m+1)}-${pad2(d)}`;
    const hasEvents = (eventsByDate.get(iso)?.length || 0) > 0;

    const cls = [
      "day",
      out ? "out" : "",
      iso === selectedISO ? "selected" : "",
      iso === todayISO ? "today" : ""
    ].filter(Boolean).join(" ");

    let mark = "";
    if (hasEvents) {
      const icon = (eventsByDate.get(iso)?.[0]?.icon) || "❤";
      mark = `<div class='mark'>${escapeHtml(icon)}</div>`;
    }
    html += `<div class="${cls}" data-date="${iso}" role="gridcell" aria-label="${iso}">
      <div class="n">${d}</div>${mark}
    </div>`;
  }
  html += "</div>";

  calendarGrid.innerHTML = html;
  selectedDateTitle.textContent = fmtRU(selectedISO);
  renderDayEvents();
}

calendarGrid.addEventListener("click", (e) => {
  const cell = e.target.closest(".day");
  if (!cell) return;
  const iso = cell.dataset.date;
  if (!iso) return;
  selectedISO = iso;
  el("eventDate").value = iso;
  renderCalendar();
}, { passive: true });

eventList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-evdel]");
  if (!btn) return;
  const id = btn.getAttribute("data-evdel");
  if (!id) return;
  btn.disabled = true;
  try{
    await api(`/api/events/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadMonthEvents();
    renderCalendar();
  }catch(err){
    showErr(el("eventError"), err?.message || "Не удалось удалить");
  }finally{
    btn.disabled = false;
  }
});

el("btnMonthPrev").addEventListener("click", async () => {
  calMonth -= 1;
  if (calMonth < 0){ calMonth = 11; calYear -= 1; }
  await loadMonthEvents();
  renderCalendar();
  renderStats();
  await loadFeedEvents();
  buildFeed();
  renderFeed();
}, { passive: true });

el("btnMonthNext").addEventListener("click", async () => {
  calMonth += 1;
  if (calMonth > 11){ calMonth = 0; calYear += 1; }
  await loadMonthEvents();
  renderCalendar();
  renderStats();
  await loadFeedEvents();
  buildFeed();
  renderFeed();
}, { passive: true });

el("eventForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  showErr(el("eventError"), "");

  const payload = {
    event_date: el("eventDate").value,
    title: el("eventTitle").value.trim(),
    note: el("eventNote").value.trim(),
    kind: el("eventKind").value,
    icon: el("eventIcon").value
  };

  el("btnAddEvent").disabled = true;
  try{
    await api("/api/events", { method: "POST", body: JSON.stringify(payload) });
    el("eventTitle").value = "";
    el("eventNote").value = "";
    selectedISO = payload.event_date;
    await loadMonthEvents();
    renderCalendar();
  }catch(err){
    showErr(el("eventError"), err?.message || "Не удалось сохранить");
  }finally{
    el("btnAddEvent").disabled = false;
  }
});

el("btnSeedDates").addEventListener("click", async () => {
  showErr(el("eventError"), "");
  const items = [
    { event_date: "2025-11-07", title: "Познакомились", note: "", kind: "memory", icon: "❤" },
    { event_date: "2026-01-26", title: "Начали встречаться", note: "", kind: "memory", icon: "💍" },
    { event_date: "2006-05-20", title: "Её день рождения", note: "", kind: "birthday", icon: "🎂" },
    { event_date: "2006-08-01", title: "Мой день рождения", note: "", kind: "birthday", icon: "🎂" }
  ];

  el("btnSeedDates").disabled = true;
  try{
    // sequential inserts (simple)
    for (const it of items) {
      try { await api("/api/events", { method: "POST", body: JSON.stringify(it) }); } catch {}
      await rafYield();
    }
    await loadMonthEvents();
    renderCalendar();
  }catch(err){
    showErr(el("eventError"), err?.message || "Не удалось добавить даты");
  }finally{
    el("btnSeedDates").disabled = false;
  }
}, { passive: true });

// -------------------------
// Diary
// -------------------------
const entriesList = el("entriesList");
let entriesCache = [];

let entriesPage = 0;
const ENTRIES_PAGE_SIZE = 8;

async function loadEntriesPage(){
  const offset = entriesPage * ENTRIES_PAGE_SIZE;
  const data = await api(`/api/entries?offset=${offset}&limit=${ENTRIES_PAGE_SIZE}`);
  entriesCache = data.entries || [];
  renderEntries(entriesCache);
  el("entriesPageLabel").textContent = String(entriesPage + 1);
}

function renderEntries(list){
  if (!list.length){
    entriesList.innerHTML = "<div class='muted'>Пока нет записей. Добавьте первую 🙂</div>";
    return;
  }
  entriesList.innerHTML = list.map(en => {
    const tags = (en.tags || []).map(t => `<span class="pill">#${escapeHtml(t)}</span>`).join("");
    return `
      <article class="entry">
        <div class="entryHead">
          <div class="entryDate">${fmtRU(en.entry_date)}</div>
        </div>
        <div class="entryBody">${escapeHtml(en.body)}</div>
        <div class="entryTags">${tags}</div>
      </article>
    `;
  }).join("");
}

el("btnEntriesPrev").addEventListener("click", async () => {
  if (entriesPage === 0) return;
  entriesPage -= 1;
  await loadEntriesPage();
}, { passive: true });

el("btnEntriesNext").addEventListener("click", async () => {
  entriesPage += 1;
  await loadEntriesPage();
}, { passive: true });

el("entryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  showErr(el("entryError"), "");

  const payload = {
    entry_date: el("entryDate").value,
    body: el("entryBody").value.trim(),
    tags: csvToTags(el("entryTags").value)
  };

  el("btnAddEntry").disabled = true;
  try{
    await api("/api/entries", { method: "POST", body: JSON.stringify(payload) });
    el("entryBody").value = "";
    el("entryTags").value = "";
    entriesPage = 0;
    await loadEntriesPage();
  }catch(err){
    showErr(el("entryError"), err?.message || "Не удалось добавить");
  }finally{
    el("btnAddEntry").disabled = false;
  }
});

// -------------------------
// Album
// -------------------------
const photoGrid = el("photoGrid");
const photoSentinel = el("photoSentinel");
const albumMeta = el("albumMeta");
let photosCache = [];


let photosOffset = 0;
const PHOTOS_BATCH = 18;
let loadingPhotos = false;
let reachedEnd = false;

function photoCardHTML(p){
  const cap = p.caption ? `<div class="c">${escapeHtml(p.caption)}</div>` : "";
  // src is private endpoint (cookie)
  const src = `/media/${encodeURIComponent(p.file_name)}`;
  return `
    <figure class="photoCard">
      <img alt="" loading="lazy" decoding="async" src="${src}" />
      <figcaption class="photoCap">
        <div class="d">${fmtRU(p.taken_date)}</div>
        ${cap}
      </figcaption>
    </figure>
  `;
}

async function loadMorePhotos(){
  if (loadingPhotos || reachedEnd) return;
  loadingPhotos = true;
  try{
    const data = await api(`/api/photos?offset=${photosOffset}&limit=${PHOTOS_BATCH}`);
    const list = data.photos || [];
    if (photosOffset === 0) photosCache = [];
    photosCache = photosCache.concat(list);
    if (!list.length){ reachedEnd = true; return; }

    const wrap = document.createElement("div");
    wrap.innerHTML = list.map(photoCardHTML).join("");
    const nodes = Array.from(wrap.children);

    const frag = document.createDocumentFragment();
    for (const n of nodes) frag.appendChild(n);
    photoGrid.appendChild(frag);

    photosOffset += list.length;
    albumMeta.textContent = `показано: ${photosOffset}`;
  }catch(err){
    showErr(el("albumError"), err?.message || "Не удалось загрузить фото");
  }finally{
    loadingPhotos = false;
  }
}

const sentinelObserver = new IntersectionObserver((entries) => {
  const ent = entries[0];
  if (!ent?.isIntersecting) return;
  loadMorePhotos();
}, { root: null, rootMargin: "800px 0px", threshold: 0.01 });

sentinelObserver.observe(photoSentinel);

el("albumForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  showErr(el("albumError"), "");

  const files = el("photoFiles").files;
  if (!files || !files.length){
    showErr(el("albumError"), "Выберите фото");
    return;
  }

  const taken_date = el("photoDate").value;
  const caption = el("photoCaption").value.trim();

  el("btnUploadPhotos").disabled = true;

  try{
    // Build FormData; downscale sequentially to keep UI smooth
    const fd = new FormData();
    fd.set("taken_date", taken_date);
    fd.set("caption", caption);

    for (let i=0; i<files.length; i++){
      const processed = await downscaleIfNeeded(files[i], 1600);
      fd.append("photos", processed, processed.name);
      await rafYield();
    }

    await api("/api/photos", { method: "POST", body: fd });

    el("photoFiles").value = "";
    el("photoCaption").value = "";

    // Reload album from scratch
    photoGrid.innerHTML = "";
    photosOffset = 0;
    reachedEnd = false;
    await loadMorePhotos();
  }catch(err){
    showErr(el("albumError"), err?.message || "Не удалось загрузить");
  }finally{
    el("btnUploadPhotos").disabled = false;
  }
});



// -------------------------
// Live (collaborative drawing via WebSocket)
// -------------------------
const liveCanvas = el("liveCanvas");
const liveStage = el("liveStage");
const liveHint = el("liveHint");
const liveError = el("liveError");
const livePeers = el("livePeers");

let liveWS = null;
let liveReady = false;
let livePeerNames = new Set();
let liveMyName = "";
let liveTool = "pen";
let liveColor = "#c5364a";
let liveSize = 6;

// Canvas state
let liveCtx = null;
let liveDpr = 1;
let liveW = 0;
let liveH = 0;
let liveCssW = 0;
let liveCssH = 0;

// Strokes storage (for undo)
let strokes = [];
let strokeMap = new Map(); // strokeId -> { last:[x,y], color,size,mode, author }

function setLiveStatus(text){
  const n = el("liveStatus");
  if (n) n.textContent = text;
}

function showLiveErr(msg){
  if (!liveError) return;
  showErr(liveError, msg);
}

function disconnectLiveWS(){
  try { liveWS?.close(); } catch {}
  liveWS = null;
  liveReady = false;
  livePeerNames.clear();
  if (livePeers) livePeers.textContent = "—";
  setLiveStatus("Live: отключено");
  if (liveHint) liveHint.textContent = "Live: отключено";
}

function connectLiveWS(){
  if (liveWS || authCard?.classList.contains("hidden") === false) return; // only when authed UI is shown
  // Note: cookies handle auth
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws`;

  try{
    liveWS = new WebSocket(url);
  }catch{
    disconnectLiveWS();
    return;
  }

  liveWS.addEventListener("open", () => {
    setLiveStatus("Live: подключено");
    if (liveHint) liveHint.textContent = "Рисуйте вместе 🙂";
    showLiveErr("");
  });

  liveWS.addEventListener("close", () => {
    // keep status but do not spam
    liveReady = false;
    setLiveStatus("Live: отключено");
    if (liveHint) liveHint.textContent = "Live: отключено";
  });

  liveWS.addEventListener("message", (e) => {
    const msg = safeParseJson(e.data);
    if (!msg) return;

    if (msg.t === "hello"){
      liveMyName = msg.name || "";
      livePeerNames.add(liveMyName);
      liveReady = true;
      updatePeersUI();
      return;
    }
    if (msg.t === "peer-join"){
      if (msg.name) livePeerNames.add(msg.name);
      updatePeersUI();
      return;
    }
    if (msg.t === "peer-leave"){
      if (msg.name) livePeerNames.delete(msg.name);
      updatePeersUI();
      return;
    }

    if (msg.t === "clear"){
      strokes = [];
      strokeMap.clear();
      clearCanvas();
      return;
    }

    if (msg.t === "stroke"){
      drawRemoteStroke(msg);
      return;
    }
    if (msg.t === "end"){
      strokeMap.delete(msg.id);
      return;
    }
  });
}

function updatePeersUI(){
  if (!livePeers) return;
  const names = Array.from(livePeerNames).filter(Boolean);
  livePeers.textContent = names.length ? `подключены: ${names.join(", ")}` : "—";
}

function safeParseJson(s){
  try { return JSON.parse(s); } catch { return null; }
}

function ensureLiveReady(){
  if (!liveCanvas || liveReady === false) {
    // still show if not connected
  }
  if (!liveCtx && liveCanvas){
    initLiveCanvas();
  }
}

function clearCanvas(){
  if (!liveCtx) return;
  liveCtx.clearRect(0,0,liveCssW,liveCssH);
  // keep a subtle paper-like base if needed (empty)
}

function resizeLiveCanvas(){
  if (!liveCanvas || !liveStage) return;
  const rect = liveStage.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  liveCssW = w;
  liveCssH = h;
  liveDpr = Math.min(2, window.devicePixelRatio || 1);
  liveCanvas.width = Math.floor(w * liveDpr);
  liveCanvas.height = Math.floor(h * liveDpr);
  liveCanvas.style.width = w + "px";
  liveCanvas.style.height = h + "px";
  liveW = liveCanvas.width;
  liveH = liveCanvas.height;

  liveCtx = liveCanvas.getContext("2d", { alpha: true, desynchronized: true });
  liveCtx.setTransform(liveDpr, 0, 0, liveDpr, 0, 0);

  redrawAllStrokes();
}

function redrawAllStrokes(){
  if (!liveCtx) return;
  liveCtx.clearRect(0,0,liveCssW,liveCssH);
  for (const st of strokes){
    drawStrokeVector(st, true);
  }
}

function drawStrokeVector(st, isReplay){
  if (!liveCtx) return;
  const ctx = liveCtx;

  const mode = st.mode || "pen";
  const size = st.size || 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = size;
  ctx.globalCompositeOperation = mode === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = st.color || "#c5364a";

  const pts = st.pts || [];
  if (pts.length < 2) return;

  ctx.beginPath();
  const p0 = pts[0];
  ctx.moveTo(p0[0], p0[1]);
  for (let i=1; i<pts.length; i++){
    const p = pts[i];
    ctx.lineTo(p[0], p[1]);
  }
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

function toCanvasXY(clientX, clientY){
  const r = liveCanvas.getBoundingClientRect();
  const x = clientX - r.left;
  const y = clientY - r.top;
  return [x, y];
}

let activeStrokeId = "";
let activePts = [];
let sendScheduled = false;
let lastSentIndex = 0;

function scheduleSend(){
  if (sendScheduled) return;
  sendScheduled = true;
  requestAnimationFrame(() => {
    sendScheduled = false;
    flushSend();
  });
}

function flushSend(){
  if (!liveWS || liveWS.readyState !== 1) return;
  if (!activeStrokeId) return;

  const slice = activePts.slice(lastSentIndex);
  if (slice.length < 2) return;

  lastSentIndex = activePts.length;

  liveWS.send(JSON.stringify({
    t: "stroke",
    id: activeStrokeId,
    mode: liveTool,
    color: liveColor,
    size: liveSize,
    pts: slice
  }));
}

function endStroke(){
  if (!activeStrokeId) return;
  try{
    liveWS?.readyState === 1 && liveWS.send(JSON.stringify({ t: "end", id: activeStrokeId }));
  }catch{}
  strokeMap.delete(activeStrokeId);
  activeStrokeId = "";
  activePts = [];
  lastSentIndex = 0;
}

function initLiveCanvas(){
  if (!liveStage || !liveCanvas) return;

  // toolbar
  const toolPen = el("toolPen");
  const toolEraser = el("toolEraser");
  const brushSize = el("brushSize");
  const btnUndo = el("btnLiveUndo");
  const btnClear = el("btnLiveClear");
  const btnSave = el("btnLiveSave");
  const caption = el("liveCaption");
  const presets = el("colorPresets");

  function setTool(t){
    liveTool = t;
    toolPen?.classList.toggle("active", t === "pen");
    toolEraser?.classList.toggle("active", t === "eraser");
  }

  toolPen?.addEventListener("click", () => setTool("pen"), { passive: true });
  toolEraser?.addEventListener("click", () => setTool("eraser"), { passive: true });

  brushSize?.addEventListener("input", (e) => {
    liveSize = Number(e.target.value) || 6;
  }, { passive: true });

  presets?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-color]");
    if (!b) return;
    liveColor = b.getAttribute("data-color") || liveColor;
  }, { passive: true });

  btnUndo?.addEventListener("click", () => {
    // remove last local stroke (best effort)
    for (let i=strokes.length-1; i>=0; i--){
      if (strokes[i].author === liveMyName){
        strokes.splice(i,1);
        break;
      }
    }
    redrawAllStrokes();
  }, { passive: true });

  btnClear?.addEventListener("click", () => {
    if (!confirm("Очистить доску для всех?")) return;
    try { liveWS?.readyState === 1 && liveWS.send(JSON.stringify({ t: "clear" })); } catch {}
    strokes = [];
    strokeMap.clear();
    clearCanvas();
  });

  btnSave?.addEventListener("click", async () => {
    showLiveErr("");
    try{
      const blob = await new Promise((resolve) => liveCanvas.toBlob(resolve, "image/webp", 0.92));
      if (!blob) throw new Error("Не удалось сохранить изображение");

      const fd = new FormData();
      fd.set("taken_date", toISODate(new Date()));
      fd.set("caption", (caption?.value || "").trim() || "Live рисунок");
      fd.append("photos", new File([blob], `live-${Date.now()}.webp`, { type: "image/webp" }));

      await api("/api/photos", { method: "POST", body: fd });

      // go to album
      setActiveTab("album");
      await refreshAll();
    }catch(err){
      showLiveErr(err?.message || "Ошибка сохранения");
    }
  });

  // resize
  const ro = new ResizeObserver(() => resizeLiveCanvas());
  ro.observe(liveStage);
  resizeLiveCanvas();

  // pointer drawing
  const onDown = (e) => {
    if (!liveCtx) return;
    if (e.button !== undefined && e.button !== 0) return;
    liveCanvas.setPointerCapture?.(e.pointerId);

    activeStrokeId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [x,y] = toCanvasXY(e.clientX, e.clientY);
    activePts = [[x,y]];
    lastSentIndex = 0;

    const st = { id: activeStrokeId, author: liveMyName, mode: liveTool, color: liveColor, size: liveSize, pts: [[x,y]] };
    strokes.push(st);
    strokeMap.set(activeStrokeId, { last: [x,y] });

    // draw dot
    drawStrokeVector({ mode: liveTool, color: liveColor, size: liveSize, pts: [[x,y],[x+0.01,y+0.01]] });

    scheduleSend();
  };

  const onMove = (e) => {
    if (!activeStrokeId) return;
    const [x,y] = toCanvasXY(e.clientX, e.clientY);
    const last = activePts[activePts.length-1];
    // ignore tiny moves
    const dx = x - last[0], dy = y - last[1];
    if ((dx*dx + dy*dy) < 0.8) return;

    activePts.push([x,y]);
    // append to last stroke in strokes
    const st = strokes[strokes.length-1];
    st.pts.push([x,y]);

    // draw incremental segment
    drawStrokeVector({ mode: liveTool, color: liveColor, size: liveSize, pts: [last,[x,y]] });

    scheduleSend();
  };

  const onUp = (_e) => {
    if (!activeStrokeId) return;
    flushSend();
    endStroke();
  };

  liveCanvas.addEventListener("pointerdown", onDown);
  liveCanvas.addEventListener("pointermove", onMove, { passive: true });
  liveCanvas.addEventListener("pointerup", onUp, { passive: true });
  liveCanvas.addEventListener("pointercancel", onUp, { passive: true });
}

function drawRemoteStroke(msg){
  if (!liveCtx || !msg || !msg.id || !Array.isArray(msg.pts)) return;

  const id = msg.id;
  const pts = msg.pts;
  const author = msg.name || "";
  const mode = msg.mode === "eraser" ? "eraser" : "pen";
  const color = msg.color || "#c5364a";
  const size = Number(msg.size) || 6;

  let entry = strokeMap.get(id);
  if (!entry){
    entry = { last: pts[0], mode, color, size, author };
    strokeMap.set(id, entry);
    strokes.push({ id, author, mode, color, size, pts: [pts[0]] });
  }

  // append to stored stroke
  const st = strokes.find(s => s.id === id);
  if (st) st.pts.push(...pts.slice(1));

  // draw segments
  for (let i=1; i<pts.length; i++){
    const a = pts[i-1];
    const b = pts[i];
    drawStrokeVector({ mode, color, size, pts: [a,b] });
  }
}

// -------------------------
// Feed (events + entries + photos)
// -------------------------
const feedList = el("feedList");
const feedSearch = el("feedSearch");
const btnFeedMore = el("btnFeedMore");
let feedLimit = 30;
let feedAll = [];
let feedQuery = "";
let feedEvents = [];

async function loadFeedEvents(){
  const now = new Date();
  const fromD = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 365);
  const toD = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
  const from = toISODate(fromD);
  const to = toISODate(toD);
  const data = await api(`/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  feedEvents = data.events || [];
}

function norm(s){ return (s || "").toLowerCase(); }

function buildFeed(){
  // events (wide range)
  const evs = feedEvents && feedEvents.length ? feedEvents : (() => { const out=[]; for (const arr of eventsByDate.values()) for (const ev of arr) out.push(ev); return out; })();

  const items = [];

  for (const ev of evs){
    items.push({
      type: "event",
      date: ev.event_date,
      created_at: ev.created_at,
      title: `${ev.icon || "❤"} ${ev.title}`,
      body: ev.note || ""
    });
  }

  for (const en of (entriesCache || [])){
    items.push({
      type: "entry",
      date: en.entry_date,
      created_at: en.created_at,
      title: "✍ Запись",
      body: en.body || "",
      tags: en.tags || []
    });
  }

  for (const p of (photosCache || [])){
    items.push({
      type: "photo",
      date: p.taken_date,
      created_at: p.created_at,
      title: "📸 Фото",
      body: p.caption || "",
      file_name: p.file_name
    });
  }

  items.sort((a,b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const ac = a.created_at || "";
    const bc = b.created_at || "";
    return ac < bc ? 1 : -1;
  });

  feedAll = items;
}

function feedItemHTML(it){
  const meta = `${fmtRU(it.date)} • ${it.type === "event" ? "событие" : it.type === "entry" ? "запись" : "фото"}`;
  const body = it.body ? `<div class="feedBody">${escapeHtml(it.body.slice(0, 420))}</div>` : "";
  const thumb = it.file_name ? `
    <div class="feedThumb">
      <img loading="lazy" decoding="async" alt="" src="/media/${encodeURIComponent(it.file_name)}" />
    </div>` : "";
  return `
    <article class="feedItem">
      <div class="feedTop">
        <div class="feedTitle">${escapeHtml(it.title)}</div>
        <div class="feedMeta">${meta}</div>
      </div>
      ${body}
      ${thumb}
    </article>
  `;
}

function renderFeed(){
  if (!feedList) return;
  if (!feedAll.length) buildFeed();

  const q = feedQuery;
  const list = q
    ? feedAll.filter(it => norm(it.title).includes(q) || norm(it.body).includes(q))
    : feedAll;

  const slice = list.slice(0, feedLimit);
  feedList.innerHTML = slice.length ? slice.map(feedItemHTML).join("") : "<div class='muted'>Пока пусто.</div>";
}

let feedDebounce = 0;
feedSearch?.addEventListener("input", (e) => {
  const v = e.target.value;
  window.clearTimeout(feedDebounce);
  feedDebounce = window.setTimeout(() => {
    feedQuery = norm(v);
    renderFeed();
  }, 200);
}, { passive: true });

btnFeedMore?.addEventListener("click", () => {
  feedLimit = Math.min(feedLimit + 30, 300);
  renderFeed();
}, { passive: true });

function daysBetween(aIso, bIso){
  const a = parseISODate(aIso);
  const b = parseISODate(bIso);
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86400000);
}

function renderStats(){
  const node = el("statsRow");
  if (!node) return;

  const today = toISODate(new Date());
  const meet = "2025-11-07";
  const dateStart = "2026-01-26";

  const dMeet = Math.max(0, daysBetween(meet, today));
  const dRel = Math.max(0, daysBetween(dateStart, today));

  const items = [
    { t: "❤ знакомы", v: `${dMeet} дней` },
    { t: "💍 вместе", v: `${dRel} дней` },
  ];

  node.innerHTML = items.map(x => `<div class="stat"><b>${escapeHtml(x.v)}</b> — ${escapeHtml(x.t)}</div>`).join("");
}
// -------------------------
// Refresh all
// -------------------------
async function refreshAll(){
  await loadMonthEvents();
  renderCalendar();
  renderStats();
  await loadFeedEvents();
  buildFeed();
  renderFeed();

  entriesPage = 0;
  await loadEntriesPage();

  photoGrid.innerHTML = "";
  photosOffset = 0;
  reachedEnd = false;
  await loadMorePhotos();
}



// -------------------------
// Surprise (cute modal + lightweight hearts confetti)
// -------------------------
const btnSurprise = el("btnSurprise");
const surpriseModal = el("surpriseModal");
const surpriseMsg = el("surpriseMsg");
const btnSurpriseClose = el("btnSurpriseClose");
const btnSurpriseAgain = el("btnSurpriseAgain");
const btnSurpriseCopy = el("btnSurpriseCopy");
const confettiCanvas = el("confettiCanvas");

const SURPRISES = [
  "Ты — моё любимое место на земле ❤",
  "Сегодня я выбираю тебя. И завтра тоже.",
  "Ты делаешь мой мир мягче и светлее ✨",
  "Я горжусь тобой — очень сильно.",
  "Самый красивый момент дня — когда ты улыбаешься 🙂",
  "Я рядом. Всегда.",
  "Ты моё спокойствие и мой праздник одновременно 🌹",
  "Мы — команда. И это навсегда 💍"
];

function pickSurprise(){
  const i = Math.floor(Math.random() * SURPRISES.length);
  return SURPRISES[i];
}

function openSurprise(){
  if (!surpriseModal) return;
  if (surpriseMsg) surpriseMsg.textContent = pickSurprise();
  surpriseModal.classList.remove("hidden");
  startConfetti();
}

function closeSurprise(){
  surpriseModal?.classList.add("hidden");
  stopConfetti();
}

btnSurprise?.addEventListener("click", openSurprise, { passive: true });
btnSurpriseAgain?.addEventListener("click", () => {
  if (surpriseMsg) surpriseMsg.textContent = pickSurprise();
  startConfetti();
}, { passive: true });

btnSurpriseCopy?.addEventListener("click", async () => {
  const t = surpriseMsg?.textContent || "";
  await copyToClipboard(t);
}, { passive: true });

btnSurpriseClose?.addEventListener("click", closeSurprise, { passive: true });
surpriseModal?.addEventListener("click", (e) => {
  const t = e.target;
  if (t && t.getAttribute && t.getAttribute("data-close") === "1") closeSurprise();
}, { passive: true });

let confettiRAF = 0;
let confettiParts = [];
function prefersReduced(){
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function startConfetti(){
  if (!confettiCanvas || prefersReduced()) return;
  const ctx = confettiCanvas.getContext("2d");
  if (!ctx) return;
  confettiCanvas.classList.remove("hidden");

  const w = confettiCanvas.width = Math.floor(window.innerWidth * Math.min(2, devicePixelRatio || 1));
  const h = confettiCanvas.height = Math.floor(window.innerHeight * Math.min(2, devicePixelRatio || 1));
  const dpr = w / Math.max(1, window.innerWidth);

  const count = Math.min(80, Math.floor(window.innerWidth / 10));
  const hearts = ["❤","💗","💖","✨"];
  confettiParts = Array.from({ length: count }, () => ({
    x: Math.random() * window.innerWidth,
    y: -20 - Math.random() * window.innerHeight * 0.3,
    vy: 40 + Math.random() * 120,
    vx: -30 + Math.random() * 60,
    r: 6 + Math.random() * 10,
    a: 0.7 + Math.random() * 0.3,
    spin: (-2 + Math.random() * 4),
    ch: hearts[(Math.random()*hearts.length)|0]
  }));

  const t0 = performance.now();
  function tick(t){
    const dt = Math.min(0.033, (t - (tick._t || t)) / 1000);
    tick._t = t;

    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,window.innerWidth, window.innerHeight);

    for (const p of confettiParts){
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.spin * dt;
      if (p.y > window.innerHeight + 40) {
        p.y = -20;
        p.x = Math.random() * window.innerWidth;
      }
      ctx.globalAlpha = p.a;
      ctx.font = "16px ui-sans-serif, system-ui";
      ctx.fillText(p.ch, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    // auto-stop after 2.2s to save battery
    if (t - t0 < 2200) confettiRAF = requestAnimationFrame(tick);
    else stopConfetti();
  }
  cancelAnimationFrame(confettiRAF);
  confettiRAF = requestAnimationFrame(tick);
}
function stopConfetti(){
  cancelAnimationFrame(confettiRAF);
  confettiRAF = 0;
  confettiParts = [];
  if (!confettiCanvas) return;
  const ctx = confettiCanvas.getContext("2d");
  if (ctx) ctx.clearRect(0,0,confettiCanvas.width, confettiCanvas.height);
  confettiCanvas.classList.add("hidden");
}

// -------------------------
// Photo viewer (lightbox) for Album + Feed
// -------------------------
const photoViewer = el("photoViewer");
const viewerImg = el("viewerImg");
const viewerMeta = el("viewerMeta");
const viewerCaption = el("viewerCaption");
const btnViewClose = el("btnViewClose");
const btnViewPrev = el("btnViewPrev");
const btnViewNext = el("btnViewNext");
let viewIndex = -1;

function openViewerAt(idx){
  if (!photoViewer || !viewerImg) return;
  if (!photosCache || idx < 0 || idx >= photosCache.length) return;
  viewIndex = idx;
  const p = photosCache[idx];
  const src = `/media/${encodeURIComponent(p.file_name)}`;
  viewerImg.src = src;
  if (viewerMeta) viewerMeta.textContent = `${fmtRU(p.taken_date)} • ${idx+1}/${photosCache.length}`;
  if (viewerCaption) viewerCaption.textContent = p.caption || "";
  photoViewer.classList.remove("hidden");
}

function closeViewer(){
  photoViewer?.classList.add("hidden");
  if (viewerImg) viewerImg.src = "";
  viewIndex = -1;
}

btnViewClose?.addEventListener("click", closeViewer, { passive: true });
photoViewer?.addEventListener("click", (e) => {
  const t = e.target;
  if (t && t.getAttribute && t.getAttribute("data-close") === "1") closeViewer();
}, { passive: true });

btnViewPrev?.addEventListener("click", () => openViewerAt(Math.max(0, viewIndex - 1)), { passive: true });
btnViewNext?.addEventListener("click", () => openViewerAt(Math.min(photosCache.length - 1, viewIndex + 1)), { passive: true });

// open from album grid: map click -> index via src file_name lookup
photoGrid?.addEventListener("click", (e) => {
  const fig = e.target.closest(".photoCard");
  if (!fig) return;
  const img = fig.querySelector("img");
  const src = img?.getAttribute("src") || "";
  const m = src.match(/\/media\/(.+)$/);
  if (!m) return;
  const name = decodeURIComponent(m[1]);
  const idx = photosCache.findIndex(p => p.file_name === name);
  if (idx >= 0) openViewerAt(idx);
}, { passive: true });

// keyboard navigation (desktop)
window.addEventListener("keydown", (e) => {
  if (photoViewer?.classList.contains("hidden")) return;
  if (e.key === "Escape") closeViewer();
  if (e.key === "ArrowLeft") openViewerAt(Math.max(0, viewIndex - 1));
  if (e.key === "ArrowRight") openViewerAt(Math.min(photosCache.length - 1, viewIndex + 1));
});

// -------------------------
// Event “edit” UX: click an event to prefill form (upsert updates it)
// -------------------------
eventList?.addEventListener("click", (e) => {
  // ignore delete button
  if (e.target.closest("[data-evdel]")) return;
  const item = e.target.closest(".eventItem");
  if (!item) return;

  const date = item.getAttribute("data-date");
  const title = item.getAttribute("data-title");
  const note = item.getAttribute("data-note") || "";
  const kind = item.getAttribute("data-kind") || "memory";
  const icon = item.getAttribute("data-icon") || "❤";
  if (!date || !title) return;

  el("eventDate").value = date;
  el("eventTitle").value = title;
  el("eventNote").value = note;
  el("eventKind").value = kind;
  el("eventIcon").value = icon;
}, { passive: true });


initTheme();
await checkSession();
