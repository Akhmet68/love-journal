const el = (id) => document.getElementById(id);

const THEME_KEY = "lj_theme";
function getSystemTheme(){
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme(theme){
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  const b = el("btnTheme");
  if (b) b.textContent = (t === "dark" ? "☀" : "☾");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "dark" ? "#120a0b" : "#f7a7aa");
}
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === "dark" || saved === "light" ? saved : getSystemTheme());
}
function pick(arr){ return arr[(Math.random()*arr.length)|0]; }

export function initLanding(){
  initTheme();
  el("btnTheme")?.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = cur === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }, { passive: true });

  // App url from config.js (optional)
  const APP_URL = (window.__LANDING_CONFIG__ && window.__LANDING_CONFIG__.APP_URL) || "";
  const openApp = el("openApp");
  if (openApp) {
    openApp.href = APP_URL || "#";
    openApp.addEventListener("click", (e) => {
      if (!APP_URL) {
        e.preventDefault();
        alert("Сначала укажи APP_URL в docs/config.js (куда задеплоил сервер).");
      }
    });
  }

  // Surprise modal
  const modal = el("surpriseModal");
  const msg = el("surpriseMsg");
  const confetti = el("confettiCanvas");
  const SURPRISES = [
    "Ты — мой самый любимый человек ❤",
    "Спасибо, что ты есть. Я рядом 🙂",
    "С тобой даже обычный день — праздник ✨",
    "Давай соберём ещё больше воспоминаний 🌹"
  ];

  function prefersReduced(){
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  let raf = 0;
  function startConfetti(){
    if (!confetti || prefersReduced()) return;
    const ctx = confetti.getContext("2d");
    if (!ctx) return;
    confetti.classList.remove("hidden");
    const dpr = Math.min(2, devicePixelRatio || 1);
    confetti.width = Math.floor(innerWidth * dpr);
    confetti.height = Math.floor(innerHeight * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const parts = Array.from({length: Math.min(70, Math.floor(innerWidth/11))}, () => ({
      x: Math.random()*innerWidth, y: -20-Math.random()*200, vy: 60+Math.random()*140,
      vx: -30+Math.random()*60, a: .6+Math.random()*.4, ch: pick(["❤","💗","✨"])
    }));
    const t0 = performance.now();
    function tick(t){
      const dt = Math.min(0.033, (t-(tick._t||t))/1000); tick._t=t;
      ctx.clearRect(0,0,innerWidth,innerHeight);
      for (const p of parts){
        p.x += p.vx*dt; p.y += p.vy*dt;
        if (p.y > innerHeight+40){ p.y=-20; p.x=Math.random()*innerWidth; }
        ctx.globalAlpha = p.a;
        ctx.font = "16px ui-sans-serif, system-ui";
        ctx.fillText(p.ch, p.x, p.y);
      }
      ctx.globalAlpha=1;
      if (t-t0 < 1800) raf = requestAnimationFrame(tick);
      else stopConfetti();
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }
  function stopConfetti(){
    cancelAnimationFrame(raf);
    raf=0;
    if (!confetti) return;
    const ctx = confetti.getContext("2d");
    ctx && ctx.clearRect(0,0,confetti.width, confetti.height);
    confetti.classList.add("hidden");
  }

  function open(){
    if (msg) msg.textContent = pick(SURPRISES);
    modal?.classList.remove("hidden");
    startConfetti();
  }
  function close(){
    modal?.classList.add("hidden");
    stopConfetti();
  }

  el("btnSurprise")?.addEventListener("click", open, { passive: true });
  el("btnSurpriseAgain")?.addEventListener("click", () => { if (msg) msg.textContent = pick(SURPRISES); startConfetti(); }, { passive: true });
  el("btnSurpriseClose")?.addEventListener("click", close, { passive: true });
  modal?.addEventListener("click", (e) => { if (e.target?.getAttribute?.("data-close")==="1") close(); }, { passive: true });
}
