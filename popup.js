// FactLens Popup Script – v2.0

let allResults = [];
let currentFilter = "all";
let currentType = "text";
let undoTimer = null;
let savedResults = null;

const VERDICT_ICON = { Verified:"✅", False:"❌", Misleading:"⚠️", Uncertain:"❓" };
const VERDICT_COLOR = { Verified:"#16a34a", False:"#DC2626", Misleading:"#D97706", Uncertain:"#6B7280" };
const CAT_COLOR = { health:"#f43f5e", politics:"#8b5cf6", technology:"#06b6d4", climate:"#22c55e", economy:"#f59e0b", science:"#3b82f6", general:"#94a3b8" };
const CLAIM_TYPE_COLOR = { Factual:"#1D4ED8", Opinion:"#7C3AED", Misleading:"#D97706", Unverifiable:"#6B7280" };
const CLAIM_TYPE_ICON = { Factual:"📊", Opinion:"💬", Misleading:"⚠️", Unverifiable:"🔮" };

// ─── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setupTheme();
  setupTabs();
  setupTypeButtons();
  setupFilters();
  setupModal();
  renderInputArea();
  await loadResults();
  checkPageAlert();
});

// ─── THEME ─────────────────────────────────────────────────────────────────────
function setupTheme() {
  const btn = document.getElementById("themeBtn");
  const saved = localStorage.getItem("factlens-theme") || "light";
  document.body.dataset.theme = saved;
  btn.textContent = saved === "dark" ? "☀️" : "🌙";
  btn.addEventListener("click", () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = next;
    btn.textContent = next === "dark" ? "☀️" : "🌙";
    localStorage.setItem("factlens-theme", next);
  });
}

// ─── TABS ──────────────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add("active");
      if (tab.dataset.tab === "history") renderHistory();
      if (tab.dataset.tab === "trends") renderTrends();
    });
  });
}

// ─── INPUT TYPE ─────────────────────────────────────────────────────────────────
function setupTypeButtons() {
  document.querySelectorAll(".type-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".type-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentType = btn.dataset.type;
      renderInputArea();
    });
  });
}

function renderInputArea() {
  const area = document.getElementById("inputArea");
  const btn = document.getElementById("analyzeBtn");
  const icons = { text:"🔍", url:"🔗", page:"🌐", audio:"🎤", image:"🖼️" };
  const labels = { text:"Analyze Claim", url:"Fetch & Analyze URL", page:"Analyze Current Page", audio:"Transcribe & Analyze", image:"Extract & Analyze Text" };
  document.getElementById("btnIcon").textContent = icons[currentType];
  document.getElementById("btnText").textContent = labels[currentType];

  if (currentType === "text") {
    area.innerHTML = `<label class="input-lbl">Enter claim or text to analyze</label><textarea id="claimInput" placeholder="Paste your claim, article excerpt, or any text here…"></textarea>`;
  } else if (currentType === "url") {
    area.innerHTML = `<label class="input-lbl">Enter article URL</label><input type="url" id="claimInput" placeholder="https://example.com/article…"><div style="margin-top:6px;font-size:11px;color:var(--muted)">📌 The page will be fetched and its main content analyzed</div>`;
  } else if (currentType === "page") {
    area.innerHTML = `<div class="info-box"><div class="info-icon">🌐</div><div class="info-text">Analyzes the <strong>currently active tab</strong>.<br>Page content is extracted and monitored in real-time.</div></div>`;
  } else if (currentType === "audio") {
    area.innerHTML = `<div class="info-box"><div class="info-icon">🎤</div><div class="info-text">Click Analyze to start <strong>microphone recording</strong>.<br>Speech will be transcribed and fact-checked.<br><span style="font-size:10px;color:var(--muted)">⚠️ Requires microphone permission</span></div></div>`;
  } else if (currentType === "image") {
    area.innerHTML = `<label class="input-lbl">Upload image for OCR extraction</label><input type="file" id="imgInput" accept="image/*" style="display:none"><div id="imgDrop" style="background:var(--surface);border:2px dashed var(--border);border-radius:var(--r);padding:20px;text-align:center;cursor:pointer;transition:border-color .15s;font-size:12px;color:var(--muted)" onclick="document.getElementById('imgInput').click()">🖼️ Click to upload or drag & drop image<br><span style="font-size:10px">PNG, JPG, WebP supported</span></div><div id="imgPreview" style="display:none;margin-top:8px"></div>`;
    setupImageInput();
  }
}

function setupImageInput() {
  const fileInput = document.getElementById("imgInput");
  const drop = document.getElementById("imgDrop");
  if (!fileInput) return;

  fileInput.addEventListener("change", e => handleImageFile(e.target.files[0]));
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.style.borderColor = "var(--blue-light)"; });
  drop.addEventListener("dragleave", () => { drop.style.borderColor = "var(--border)"; });
  drop.addEventListener("drop", e => { e.preventDefault(); drop.style.borderColor = "var(--border)"; handleImageFile(e.dataTransfer.files[0]); });
}

function handleImageFile(file) {
  if (!file) return;
  const preview = document.getElementById("imgPreview");
  const reader = new FileReader();
  reader.onload = e => {
    preview.style.display = "block";
    preview.innerHTML = `<img src="${e.target.result}" style="max-width:100%;border-radius:8px;border:1px solid var(--border)">`;
    // Store for use during analyze
    window._imgDataUrl = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── ANALYZE ───────────────────────────────────────────────────────────────────
document.addEventListener("click", e => {
  if (e.target.closest("#analyzeBtn")) handleAnalyze();
});

async function handleAnalyze() {
  const btn = document.getElementById("analyzeBtn");
  const resultArea = document.getElementById("resultArea");
  let text = "", url = "";

  if (currentType === "text") {
    text = document.getElementById("claimInput")?.value?.trim();
    url = "manual";
  } else if (currentType === "url") {
    url = document.getElementById("claimInput")?.value?.trim();
    text = `Article from: ${url}`;
  } else if (currentType === "page") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    url = tab.url;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          for (const s of ["article","main",'[role="main"]',".article-body","h1"]) {
            const el = document.querySelector(s);
            if (el?.innerText?.trim().length > 100) return el.innerText.slice(0, 1000);
          }
          return document.body.innerText.slice(0, 1000);
        }
      });
      text = res.result;
    } catch { text = "Could not extract page content."; }
  } else if (currentType === "audio") {
    text = await recordAudio();
    if (!text) return;
    url = "audio-input";
  } else if (currentType === "image") {
    text = await extractImageText();
    if (!text) return;
    url = "image-ocr";
  }

  if (!text || text.length < 10) {
    showToast("Please enter some text to analyze", "error");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px"></div><span>Analyzing…</span>`;
  resultArea.innerHTML = `<div class="loading"><div class="spinner"></div><span>Cross-checking sources…</span></div>`;

  try {
    const response = await chrome.runtime.sendMessage({ type: "ANALYZE_CLAIM", text, url });
    if (response.success) {
      allResults.unshift(response.data);
      renderResultCard(response.data, resultArea);
    } else {
      resultArea.innerHTML = `<div style="margin-top:12px;padding:12px;background:var(--red-bg);border:1px solid var(--red-bd);border-radius:var(--r);color:var(--red);font-size:12px">⚠️ Analysis failed: ${response.error || "Unknown error"}</div>`;
    }
  } catch (err) {
    resultArea.innerHTML = `<div style="margin-top:12px;padding:12px;background:var(--red-bg);border:1px solid var(--red-bd);border-radius:var(--r);color:var(--red);font-size:12px">⚠️ ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span id="btnIcon">${{text:"🔍",url:"🔗",page:"🌐",audio:"🎤",image:"🖼️"}[currentType]}</span><span id="btnText">${{text:"Analyze Claim",url:"Fetch & Analyze URL",page:"Analyze Current Page",audio:"Transcribe & Analyze",image:"Extract & Analyze Text"}[currentType]}</span>`;
  }
}

// Audio recording stub (Web Speech API)
async function recordAudio() {
  return new Promise(resolve => {
    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
      showToast("Speech recognition not supported in this browser", "error");
      resolve(null); return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
    showToast("🎤 Listening… speak your claim", "info");
    rec.start();
    rec.onresult = e => resolve(e.results[0][0].transcript);
    rec.onerror = () => { showToast("Microphone error", "error"); resolve(null); };
  });
}

// Image OCR stub (basic canvas-based approach; real OCR needs Tesseract)
async function extractImageText() {
  if (!window._imgDataUrl) { showToast("Please upload an image first", "error"); return null; }
  // In a real extension, you'd use Tesseract.js here
  // For now, return a placeholder prompting the user
  showToast("OCR: Using image description for analysis", "info");
  return "Image uploaded for fact-checking. Please also enter a text description of the claim in the image for better results.";
}

// ─── RESULT CARD ───────────────────────────────────────────────────────────────
function renderResultCard(data, container) {
  const score = data.credibilityScore || data.confidence || 0;
  const circumference = 2 * Math.PI * 20;
  const dashOffset = circumference - (score / 100) * circumference;
  const vc = VERDICT_COLOR[data.verdict] || "#6B7280";
  const vi = VERDICT_ICON[data.verdict] || "❓";
  const ctColor = CLAIM_TYPE_COLOR[data.claimType] || "#6B7280";
  const ctIcon  = CLAIM_TYPE_ICON[data.claimType]  || "📋";

  // Score label
  let scoreLabel = "";
  if (score >= 81) scoreLabel = "Strongly Supported";
  else if (score >= 61) scoreLabel = "Mostly Supported";
  else if (score >= 41) scoreLabel = "Uncertain";
  else if (score >= 21) scoreLabel = "Likely Refuted";
  else scoreLabel = "Strongly Refuted";

  // Confidence breakdown bars
  const cb = data.confidenceBreakdown || {};
  const breakdownHTML = (cb.dataReliability !== undefined) ? `
    <div class="csec">
      <div class="sechd">📈 Confidence Breakdown</div>
      <div class="cbreak">
        ${[['Data Reliability', cb.dataReliability, '#3b82f6'], ['Source Quality', cb.sourceQuality, '#8b5cf6'], ['Consistency', cb.consistency, '#06b6d4']].map(([lbl, val, clr]) => `
          <div class="cbar-row">
            <span class="cbar-lbl">${lbl}</span>
            <div class="cbar-track"><div class="cbar-fill" style="width:${val || 0}%;background:${clr}"></div></div>
            <span class="cbar-val">${val || 0}</span>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  // Evidence section (structured)
  const evidenceHTML = data.evidence?.length ? `
    <div class="csec">
      <div class="sechd">🔎 Evidence Log</div>
      ${data.evidence.map(ev => `
        <div class="nitem" ${ev.url ? `onclick="chrome.tabs.create({url:'${ev.url}'})"` : ''}>
          <div class="ndot" style="background:${vc}"></div>
          <div>
            <div class="ntitle">${(ev.title || 'Evidence').slice(0, 90)}${ev.title?.length > 90 ? '…' : ''}</div>
            <div class="nmeta">
              <span>${ev.source || 'Unknown'}</span>
              ${ev.url ? `<span style="color:var(--blue-light)">↗</span>` : ''}
            </div>
            <div style="font-size:10.5px;color:var(--muted);line-height:1.4;margin-top:2px">${ev.summary || ''}</div>
          </div>
        </div>
      `).join('')}
    </div>
  ` : '';

  // Fallback: related news if no structured evidence
  const newsHTML = (!data.evidence?.length && data.relatedNews?.length) ? `
    <div class="csec">
      <div class="sechd">📰 Related News</div>
      ${data.relatedNews.map(n => `
        <div class="nitem" onclick="chrome.tabs.create({url:'${n.url}'})">
          <div class="ndot" style="background:${vc}"></div>
          <div>
            <div class="ntitle">${n.title?.slice(0,80) || 'Article'}…</div>
            <div class="nmeta">
              <span>${n.source || 'Unknown'}</span>
              ${n.credibility ? `<span class="cbadge cbadge-${n.credibility}">${n.credibility}</span>` : ''}
              ${data.recency ? `<span>🕐 ${data.recency}</span>` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  ` : '';

  const reasonHTML = data.reasoning?.length ? `
    <div class="csec">
      <div class="sechd">💡 Reasoning</div>
      <ul class="rlist">${data.reasoning.map(r => `<li>${r}</li>`).join('')}</ul>
    </div>
  ` : '';

  const sentLabel = data.sentiment > 0.1 ? 'Positive' : data.sentiment < -0.1 ? 'Negative' : 'Neutral';
  const sentColor = data.sentiment > 0.1 ? 'var(--green)' : data.sentiment < -0.1 ? 'var(--red)' : 'var(--yellow)';

  container.innerHTML = `
    <div class="rcard V-${data.verdict}">
      <div class="vhdr">
        <div class="vleft">
          <div class="vicon V-${data.verdict}">${vi}</div>
          <div>
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
              <span class="vbadge V-${data.verdict}">${data.verdict}</span>
              <span class="ctbadge" style="background:${ctColor}18;color:${ctColor};border-color:${ctColor}30">${ctIcon} ${data.claimType || 'Factual'}</span>
            </div>
            <div class="vsub">🏷️ ${data.category} · 🌐 ${data.sourceType}${data.kbMatch ? ` · <span style="color:#f59e0b;font-weight:700">🇮🇳 KB-${data.kbId || '?'}</span>` : ''}</div>
          </div>
        </div>
        <div class="cring">
          <svg width="50" height="50" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="20" fill="none" stroke="var(--gray-200)" stroke-width="6"/>
            <circle cx="25" cy="25" r="20" fill="none" stroke="${vc}" stroke-width="6"
              stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"
              stroke-linecap="round" transform="rotate(-90 25 25)"
              style="transition:stroke-dashoffset 1s ease"/>
          </svg>
          <div class="cring-txt" style="color:${vc}">${score}%</div>
        </div>
      </div>

      <div class="claim-q">"${(data.claim || data.originalText || '').slice(0, 180)}${(data.claim || data.originalText || '').length > 180 ? '…' : ''}"</div>

      <div class="mstrip">
        <div class="mcell"><div class="mclbl">Score</div><div class="mcval" style="color:${vc}">${score}</div></div>
        <div class="mcell"><div class="mclbl">Virality</div><div class="mcval" style="color:var(--blue)">${data.viralityScore || 0}</div></div>
        <div class="mcell"><div class="mclbl">Sentiment</div><div class="mcval" style="color:${sentColor};font-size:10px">${sentLabel}</div></div>
        <div class="mcell"><div class="mclbl">Source</div><div class="mcval" style="font-size:10px;color:var(--muted)">${data.sourceCredibility || 'N/A'}</div></div>
      </div>

      <div class="score-lbl-row"><span class="score-lbl" style="color:${vc}">${scoreLabel}</span><span class="score-range">${getScoreRange(score)}</span></div>

      ${reasonHTML}${breakdownHTML}${evidenceHTML}${newsHTML}

      <div class="fbrow">
        <span class="fblbl">Was this accurate?</span>
        <button class="fbbtn" onclick="submitFeedback('${data.id}', 'correct', this)">👍 Yes</button>
        <button class="fbbtn" onclick="submitFeedback('${data.id}', 'incorrect', this)">👎 No</button>
      </div>
    </div>
  `;
}

function getScoreRange(score) {
  if (score >= 81) return 'Score 81–100';
  if (score >= 61) return 'Score 61–80';
  if (score >= 41) return 'Score 41–60';
  if (score >= 21) return 'Score 21–40';
  return 'Score 1–20';
}

function submitFeedback(id, fb, btn) {
  document.querySelectorAll(".fbbtn").forEach(b => b.classList.remove("sel"));
  btn.classList.add("sel");
  chrome.runtime.sendMessage({ type: "SUBMIT_FEEDBACK", resultId: id, feedback: fb });
  showToast("Thanks for your feedback!", "info");
}

// ─── HISTORY ───────────────────────────────────────────────────────────────────
function setupFilters() {
  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      currentFilter = chip.dataset.filter;
      renderHistory();
    });
  });
}

function setupModal() {
  const modal = document.getElementById("modal");
  document.getElementById("clearBtn").addEventListener("click", () => modal.classList.add("show"));
  document.getElementById("mCancel").addEventListener("click", () => modal.classList.remove("show"));
  document.getElementById("mConfirm").addEventListener("click", async () => {
    modal.classList.remove("show");
    savedResults = [...allResults];
    allResults = [];
    await chrome.runtime.sendMessage({ type: "CLEAR_RESULTS" });
    renderHistory();
    showUndoBar();
  });
}

function showUndoBar() {
  const existing = document.querySelector(".undo-bar");
  if (existing) existing.remove();
  if (undoTimer) clearTimeout(undoTimer);

  const bar = document.createElement("div");
  bar.className = "undo-bar";
  bar.innerHTML = `Cleared ${savedResults?.length || 0} results <button class="undo-btn" id="undoBtn">Undo</button>`;
  document.body.appendChild(bar);

  document.getElementById("undoBtn").addEventListener("click", async () => {
    if (savedResults) {
      allResults = [...savedResults];
      await chrome.storage.local.set({ results: allResults });
      savedResults = null;
    }
    bar.remove();
    clearTimeout(undoTimer);
    renderHistory();
  });

  undoTimer = setTimeout(() => { bar.remove(); savedResults = null; }, 5000);
}

function renderHistory() {
  const list = document.getElementById("historyList");
  const filtered = currentFilter === "all" ? allResults : allResults.filter(r => r.verdict === currentFilter);

  if (!filtered.length) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">${currentFilter === "all" ? "🔍" : VERDICT_ICON[currentFilter] || "📋"}</div><div class="empty-title">${currentFilter === "all" ? "No claims analyzed yet" : `No ${currentFilter} results`}</div><div class="empty-desc">${currentFilter === "all" ? "Switch to Analyze tab to fact-check a claim." : "Try a different filter."}</div></div>`;
    return;
  }

  list.innerHTML = filtered.map(r => {
    const vc = VERDICT_COLOR[r.verdict] || "#6B7280";
    const vi = VERDICT_ICON[r.verdict] || "❓";
    return `<div class="hcard" onclick="showResultInAnalyze('${r.id}')">
      <div class="htop">
        <div class="hclaim">${(r.claim || r.originalText || "").slice(0, 90)}…</div>
        <span style="background:${vc}15;color:${vc};border:1.5px solid ${vc}30;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap">${vi} ${r.verdict}</span>
      </div>
      <div class="hmeta">
        <span class="hmt">🏷️ ${r.category}</span>
        <span class="hmt">🌐 ${r.sourceType}</span>
        <span class="hmt">🕐 ${fmtDate(r.timestamp)}</span>
        <span class="hconf" style="color:${vc}">${r.confidence}%</span>
      </div>
    </div>`;
  }).join("");
}

function showResultInAnalyze(id) {
  const r = allResults.find(x => x.id === id);
  if (!r) return;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelector('[data-tab="analyze"]').classList.add("active");
  document.getElementById("panel-analyze").classList.add("active");
  renderResultCard(r, document.getElementById("resultArea"));
}

// ─── TRENDS ────────────────────────────────────────────────────────────────────
function renderTrends() {
  if (!allResults.length) return;
  const total = allResults.length;
  const counts = { Verified:0, False:0, Misleading:0, Uncertain:0 };
  allResults.forEach(r => { counts[r.verdict] = (counts[r.verdict]||0) + 1; });

  document.getElementById("st-total").textContent = total;
  document.getElementById("st-false").textContent = counts.False;
  document.getElementById("st-verified").textContent = counts.Verified;

  // Donut
  const circ = 2 * Math.PI * 33;
  let offset = 0;
  const order = ["Verified","Misleading","False","Uncertain"];
  order.forEach(v => {
    const el = document.getElementById(`d-${v}`);
    const frac = counts[v] / total;
    const dash = frac * circ;
    el.style.strokeDasharray = `${dash} ${circ - dash}`;
    el.style.strokeDashoffset = `-${offset}`;
    offset += dash;
  });

  document.getElementById("donutLeg").innerHTML = order.map(v => `
    <div class="drow">
      <div class="ddot" style="background:${VERDICT_COLOR[v]}"></div>
      <span class="dname">${VERDICT_ICON[v]} ${v}</span>
      <span class="dpct">${total ? Math.round(counts[v]/total*100) : 0}%</span>
      <span class="dcnt" style="color:${VERDICT_COLOR[v]}">${counts[v]}</span>
    </div>
  `).join("");

  // Category chart
  const cats = {};
  allResults.forEach(r => { cats[r.category] = (cats[r.category]||0) + 1; });
  const maxCat = Math.max(...Object.values(cats), 1);
  document.getElementById("catChart").innerHTML = Object.entries(cats)
    .sort((a,b) => b[1]-a[1])
    .map(([cat,n]) => `
      <div class="brow">
        <span class="blbl">${cat}</span>
        <div class="btrk"><div class="bfil" style="width:${(n/maxCat)*100}%;background:${CAT_COLOR[cat]||"#94a3b8"}"></div></div>
        <span class="bn">${n}</span>
      </div>
    `).join("") || `<div style="color:var(--muted);font-size:12px;text-align:center">No data</div>`;
}

// ─── PAGE ALERT ────────────────────────────────────────────────────────────────
async function checkPageAlert() {
  const data = await chrome.storage.local.get(["latestResult"]);
  const r = data.latestResult;
  if (!r || Date.now() - r.timestamp > 60000) return;
  const alert = document.getElementById("pageAlert");
  const dot = document.getElementById("paDot");
  const text = document.getElementById("paText");
  const vc = VERDICT_COLOR[r.verdict] || "#6B7280";
  dot.style.background = vc;
  text.textContent = `Page: ${r.verdict} · ${r.confidence}% confidence`;
  alert.classList.remove("hidden");
  alert.addEventListener("click", () => renderResultCard(r, document.getElementById("resultArea")));
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────
async function loadResults() {
  const res = await chrome.runtime.sendMessage({ type: "GET_RESULTS" });
  allResults = res.results || [];
}

function fmtDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
}

function showToast(msg, type = "info") {
  const t = document.createElement("div");
  const bg = type === "error" ? "var(--red)" : type === "success" ? "var(--green)" : "var(--navy)";
  t.style.cssText = `position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:${bg};color:#fff;padding:8px 16px;border-radius:8px;font-size:12px;z-index:99999;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.3)`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
