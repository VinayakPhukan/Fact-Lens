// FactLens Content Script – Real-time page monitoring

(function () {
  'use strict';
  let lastText = "", debounce = null, observer = null;
  let tooltip = null;

  // ─── Floating Badge ─────────────────────────────────────────────────────────
  function createBadge() {
    if (document.getElementById("factlens-badge")) return;
    const badge = document.createElement("div");
    badge.id = "factlens-badge";
    badge.innerHTML = `<span id="fl-icon">🔍</span><span id="fl-status">FactLens</span>`;
    badge.style.cssText = `
      position:fixed;bottom:20px;right:20px;z-index:2147483647;
      background:linear-gradient(135deg,#0A1F44,#1a3a7a);
      color:#fff;border:1px solid rgba(59,130,246,.4);border-radius:999px;
      padding:7px 14px;font-family:'Segoe UI',sans-serif;font-size:11.5px;
      box-shadow:0 4px 20px rgba(10,31,68,.35);cursor:pointer;
      display:flex;align-items:center;gap:6px;opacity:.88;
      transition:all .25s;user-select:none;
    `;
    badge.addEventListener("mouseenter", () => badge.style.opacity = "1");
    badge.addEventListener("mouseleave", () => badge.style.opacity = ".88");
    document.body.appendChild(badge);
  }

  function updateBadge(verdict, confidence) {
    const badge = document.getElementById("factlens-badge");
    const status = document.getElementById("fl-status");
    if (!badge || !status) return;
    const icons = { Verified:"✅", False:"❌", Misleading:"⚠️", Uncertain:"❓" };
    const colors = { Verified:"rgba(22,163,74,.5)", False:"rgba(220,38,38,.5)", Misleading:"rgba(217,119,6,.5)", Uncertain:"rgba(107,114,128,.5)" };
    badge.style.borderColor = colors[verdict] || "rgba(59,130,246,.4)";
    status.textContent = `${icons[verdict]||"❓"} ${verdict} · ${confidence}%`;
    document.getElementById("fl-icon").textContent = "";
  }

  // ─── Text Extraction ─────────────────────────────────────────────────────────
  function getPageText() {
    const sels = ["article","main",'[role="main"]',".article-body",".post-content",".entry-content","h1"];
    for (const s of sels) {
      const el = document.querySelector(s);
      const t = el?.innerText?.trim();
      if (t && t.length > 100) return t.slice(0, 1000);
    }
    return Array.from(document.querySelectorAll("p"))
      .map(p => p.innerText?.trim()).filter(t => t?.length > 40)
      .join(" ").slice(0, 1000);
  }

  function triggerAnalysis() {
    const text = getPageText();
    if (!text || text === lastText || text.length < 80) return;
    lastText = text;
    chrome.runtime.sendMessage({ type: "PAGE_TEXT", text, url: location.href });
  }

  // ─── Observer ────────────────────────────────────────────────────────────────
  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(triggerAnalysis, 3000);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Selection Tooltip ───────────────────────────────────────────────────────
  document.addEventListener("mouseup", () => {
    const sel = window.getSelection()?.toString()?.trim();
    if (!sel || sel.length < 20) { removeTooltip(); return; }
    showTooltip(sel);
  });

  function showTooltip(text) {
    removeTooltip();
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();

    tooltip = document.createElement("div");
    tooltip.id = "factlens-tooltip";
    tooltip.innerHTML = `🔍 <strong>FactLens</strong> – Fact-check this?`;
    tooltip.style.cssText = `
      position:fixed;top:${rect.top - 42}px;left:${rect.left + rect.width/2}px;
      transform:translateX(-50%);z-index:2147483647;
      background:#0A1F44;color:#fff;border:1px solid rgba(59,130,246,.5);
      border-radius:8px;padding:6px 13px;
      font-family:'Segoe UI',sans-serif;font-size:12.5px;
      cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.4);white-space:nowrap;
    `;
    tooltip.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "ANALYZE_CLAIM", text, url: location.href });
      removeTooltip();
    });
    document.body.appendChild(tooltip);
  }

  function removeTooltip() {
    if (tooltip) { tooltip.remove(); tooltip = null; }
  }

  document.addEventListener("mousedown", e => {
    if (e.target !== tooltip) removeTooltip();
  });

  // ─── Listen for results ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "VERDICT_UPDATE") {
      updateBadge(msg.verdict, msg.confidence);
    }
  });

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    createBadge();
    setTimeout(triggerAnalysis, 2500);
    startObserver();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
