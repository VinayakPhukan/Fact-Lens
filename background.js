// FactLens Background Service Worker – v2.2
// Full 7-Step AI Fact-Checking Engine + Local India Knowledge Base
// Verdicts: Verified / False / Misleading / Uncertain
// Claim Types: Factual / Opinion / Misleading / Unverifiable

const GOOGLE_FACT_CHECK_API_KEY = "AIzaSyCzYjanda72LDJgR698VpgAX7McvIG6YBc";
const GOOGLE_FACT_CHECK_ENDPOINT = "https://factchecktools.googleapis.com/v1alpha1/claims:search";
const NEWS_API_KEY = "b0bbfc98bcef4ee7ae52c9e69b387551";
const NEWS_API_ENDPOINT = "https://newsapi.org/v2/everything";
const HUGGINGFACE_API_KEY = "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";
const HUGGINGFACE_ENDPOINT = "https://api-inference.huggingface.co/models/facebook/bart-large-mnli";
const LOCAL_KB_ENDPOINT = "http://localhost:5000/knowledge-base";

// Similarity threshold: ≥0.80 → direct KB result, ≥0.65 → KB as strong signal
const KB_DIRECT_THRESHOLD  = 0.80;
const KB_SIGNAL_THRESHOLD  = 0.65;

// ─── CONTEXT MENU ─────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "factlens-selection", title: "🔍 FactLens: Fact-check this", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "factlens-selection" && info.selectionText) {
    const result = await analyzeClaim(info.selectionText, tab.url);
    await chrome.storage.local.set({ latestResult: result, timestamp: Date.now() });
    chrome.action.setBadgeText({ text: getBadgeText(result.verdict), tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: getVerdictColor(result.verdict) });
  }
});

// ─── MESSAGE LISTENER ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_CLAIM") {
    analyzeClaim(message.text, message.url || sender.tab?.url || "manual")
      .then(result => { saveResult(result); sendResponse({ success: true, data: result }); })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.type === "GET_RESULTS") {
    chrome.storage.local.get(["results", "latestResult"], data => sendResponse({ results: data.results || [], latest: data.latestResult }));
    return true;
  }
  if (message.type === "CLEAR_RESULTS") {
    chrome.storage.local.set({ results: [], latestResult: null }, () => sendResponse({ success: true }));
    return true;
  }
  if (message.type === "PAGE_TEXT") {
    extractAndAnalyzePageClaim(message.text, message.url).then(result => {
      if (result) {
        saveResult(result);
        chrome.action.setBadgeText({ text: getBadgeText(result.verdict), tabId: sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: getVerdictColor(result.verdict) });
      }
    });
    return false;
  }
  if (message.type === "SUBMIT_FEEDBACK") {
    saveFeedback(message.resultId, message.feedback).then(() => sendResponse({ success: true }));
    return true;
  }
});

// ─── STEP 1: CLASSIFY CLAIM TYPE ──────────────────────────────────────────────
function classifyClaimType(text) {
  const lower = text.toLowerCase();

  // Opinion / Subjective / Comparative patterns
  const opinionPatterns = [
    /\bbetter than\b/, /\bworse than\b/, /\bbest\b/, /\bworst\b/,
    /\bi think\b/, /\bi believe\b/, /\bin my opinion\b/, /\bshould\b/,
    /\bmore (beautiful|important|powerful|great|amazing)\b/,
    /\bis (amazing|terrible|awesome|horrible|beautiful|ugly)\b/,
    /\bpretty sure\b/, /\bprobably\b/, /\bseems like\b/,
    /\b(greatest|most popular|most hated)\b/,
    /\b(love|hate|prefer|like|dislike)\b/
  ];
  if (opinionPatterns.some(p => p.test(lower))) return "Opinion";

  // Unverifiable: future predictions, hypotheticals
  const unverifiablePatterns = [
    /\bwill (happen|occur|be|become|change)\b/,
    /\bgoing to \w+ in (the future|20\d\d|next century)\b/,
    /\bpredicted? to\b/, /\bmight eventually\b/,
    /\bcould (potentially|possibly) \w+ in \d+ years\b/,
    /\b(god|heaven|soul|spirit|afterlife)\b/
  ];
  if (unverifiablePatterns.some(p => p.test(lower))) return "Unverifiable";

  // Misleading: partial truth keywords
  const misleadingPatterns = [
    /\bwithout (mentioning|noting|context)\b/,
    /\bout of context\b/, /\bselectively\b/,
    /\bonly part\b/, /\bhalf[- ]truth\b/
  ];
  if (misleadingPatterns.some(p => p.test(lower))) return "Misleading";

  // Default: Factual
  return "Factual";
}

// ─── STEP 2: OPINION GUARD ────────────────────────────────────────────────────
function buildOpinionResult(claim, text, sourceUrl) {
  const score = 10 + Math.floor(Math.random() * 30); // 10–39
  return {
    id: Date.now().toString(),
    claim, originalText: text.slice(0, 300), sourceUrl,
    sourceType: detectSourceType(sourceUrl),
    sourceCredibility: rateSourceCredibility(sourceUrl),
    category: categorize(claim),
    verdict: "Uncertain",
    confidence: score,
    credibilityScore: score,
    claimType: "Opinion",
    reasoning: [
      "This claim is subjective or comparative in nature and cannot be objectively fact-checked.",
      "Opinions, preferences, or comparative statements (e.g., 'X is better than Y') depend on personal values and criteria.",
      "No verifiable factual data can conclusively support or refute this claim.",
      "For objective analysis, please rephrase the claim with measurable, verifiable facts."
    ],
    evidence: [],
    confidenceBreakdown: { dataReliability: 10, sourceQuality: 10, consistency: 10 },
    sentiment: analyzeSentiment(claim),
    viralityScore: 0,
    factCheckResults: [],
    relatedNews: [],
    hfConfidence: null, hfLabel: null,
    recency: null,
    timestamp: Date.now()
  };
}

// ─── LOCAL KNOWLEDGE BASE LOOKUP ─────────────────────────────────────────────
/**
 * Query the local Flask server's /knowledge-base endpoint.
 * Returns the matched KB entry or null if no match / server offline.
 */
async function queryLocalKnowledgeBase(claim) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000); // 2s timeout — don't block UX
  try {
    const res = await fetch(LOCAL_KB_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim, threshold: KB_SIGNAL_THRESHOLD }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return data.matched ? data : null;
  } catch {
    clearTimeout(timeout);
    return null;  // Server offline or network error — fail silently
  }
}

// ─── MAIN ANALYSIS ORCHESTRATOR ───────────────────────────────────────────────
async function analyzeClaim(text, sourceUrl = "manual") {
  const claim = extractClaim(text);
  let claimType = classifyClaimType(claim);

  // STEP 2: Short-circuit for Opinions
  if (claimType === "Opinion") return buildOpinionResult(claim, text, sourceUrl);

  // STEP 2: Short-circuit for Unverifiable
  if (claimType === "Unverifiable") {
    return {
      id: Date.now().toString(),
      claim, originalText: text.slice(0, 300), sourceUrl,
      sourceType: detectSourceType(sourceUrl),
      sourceCredibility: rateSourceCredibility(sourceUrl),
      category: categorize(claim),
      verdict: "Uncertain", confidence: 20, credibilityScore: 20,
      claimType: "Unverifiable",
      reasoning: [
        "This claim refers to future events, hypothetical scenarios, or metaphysical concepts that cannot be verified with current data.",
        "No reliable, verifiable sources exist to confirm or deny this claim.",
        "Fact-checking is limited to observable, recorded, or measurable phenomena."
      ],
      evidence: [],
      confidenceBreakdown: { dataReliability: 15, sourceQuality: 10, consistency: 15 },
      sentiment: analyzeSentiment(claim), viralityScore: 0,
      factCheckResults: [], relatedNews: [], hfConfidence: null, hfLabel: null,
      recency: null, timestamp: Date.now()
    };
  }

  // ── KNOWLEDGE BASE: query local server in parallel with external APIs ───────
  const [kbMatch, fcData, newsData, hfData] = await Promise.allSettled([
    queryLocalKnowledgeBase(claim),
    fetchFactCheck(claim),
    fetchNews(claim),
    fetchHuggingFace(claim)
  ]);

  const kb       = kbMatch.status === "fulfilled" ? kbMatch.value : null;
  const factCheck = fcData.status === "fulfilled" ? fcData.value : null;
  const news      = newsData.status === "fulfilled" ? newsData.value : [];
  const hf        = hfData.status === "fulfilled" ? hfData.value : null;

  // ── HIGH-CONFIDENCE KB MATCH: return KB result directly ─────────────────
  if (kb && kb.similarity >= KB_DIRECT_THRESHOLD) {
    const kbVerdict = mapKbVerdict(kb.verdict);
    const kbReasoning = [
      `✓ Matched India Knowledge Base entry "${kb.claim_id}" (similarity: ${Math.round(kb.similarity * 100)}%).`,
      `Ground-truth claim: "${kb.matched_claim}".`,
      ...kb.reasoning
    ];
    return {
      id: Date.now().toString(),
      claim, originalText: text.slice(0, 300), sourceUrl,
      sourceType: detectSourceType(sourceUrl),
      sourceCredibility: rateSourceCredibility(sourceUrl),
      category: kb.category || categorize(claim),
      verdict: kbVerdict,
      confidence: kb.credibility_score,
      credibilityScore: kb.credibility_score,
      claimType: kb.claim_type || claimType,
      reasoning: kbReasoning,
      evidence: kb.evidence || [],
      confidenceBreakdown: kb.confidence_breakdown || { dataReliability: 80, sourceQuality: 85, consistency: 82 },
      sentiment: analyzeSentiment(claim),
      viralityScore: estimateVirality(news),
      factCheckResults: [],
      relatedNews: news.slice(0, 3),
      hfConfidence: null, hfLabel: null,
      recency: getRecency(news),
      kbMatch: true, kbId: kb.claim_id, kbSimilarity: kb.similarity,
      timestamp: Date.now()
    };
  }

  // Override claim type from KB if we have a partial match
  if (kb && kb.claim_type) claimType = kb.claim_type;
  const category = kb?.category || categorize(claim);

  // STEPS 3–7: Full scoring, injecting KB as a signal if partial match
  const analysis = computeVerdictFull(factCheck, hf, news, claim, claimType, kb);

  return {
    id: Date.now().toString(),
    claim, originalText: text.slice(0, 300), sourceUrl,
    sourceType: detectSourceType(sourceUrl),
    sourceCredibility: rateSourceCredibility(sourceUrl),
    category,
    verdict: analysis.verdict,
    confidence: analysis.credibilityScore,
    credibilityScore: analysis.credibilityScore,
    claimType,
    reasoning: analysis.reasoning,
    evidence: analysis.evidence,
    confidenceBreakdown: analysis.confidenceBreakdown,
    sentiment: analyzeSentiment(claim),
    viralityScore: estimateVirality(news),
    factCheckResults: factCheck?.claims?.slice(0, 3) || [],
    relatedNews: news.slice(0, 3),
    hfConfidence: hf?.confidence || null,
    hfLabel: hf?.label || null,
    recency: getRecency(news),
    kbMatch: !!kb, kbId: kb?.claim_id || null, kbSimilarity: kb?.similarity || null,
    timestamp: Date.now()
  };
}

/** Map KB verdict strings to internal verdict names. */
function mapKbVerdict(v) {
  const map = { "Verified": "Verified", "False": "False", "Misleading": "Misleading", "Uncertain": "Uncertain" };
  return map[v] || "Uncertain";
}

// ─── STEPS 3–7: CORE SCORING ENGINE ──────────────────────────────────────────
function computeVerdictFull(factCheck, hf, news, claim, claimType, kb = null) {
  let signals = [];
  let reasoning = [];
  let evidence = [];
  let dataReliability = 30;
  let sourceQuality = 30;
  let consistency = 50;

  // ── KNOWLEDGE BASE partial-match signal (weight ~1.0 — highest single-source priority) ──
  if (kb && kb.similarity >= KB_SIGNAL_THRESHOLD) {
    const kbVerdictLabel = kb.verdict.toLowerCase();
    const kbSignalType = kbVerdictLabel === "verified" ? "supported"
      : kbVerdictLabel === "false" ? "refuted"
      : kbVerdictLabel === "misleading" ? "misleading" : "uncertain";
    const kbWeight = 0.8 + kb.similarity * 0.4; // 0.92–1.12 based on similarity
    signals.push({ type: kbSignalType, weight: kbWeight });
    reasoning.push(`India Knowledge Base (${kb.claim_id}, ${Math.round(kb.similarity * 100)}% match): verdict is "${kb.verdict}" — credibility score ${kb.credibility_score}/100.`);
    if (kb.evidence?.length) evidence.push(...kb.evidence.slice(0, 2));
    // dataset uses camelCase keys: dataReliability, sourceQuality, consistency
    const kbCB = kb.confidence_breakdown || {};
    dataReliability = Math.max(dataReliability, kbCB.dataReliability || kbCB.data_reliability || 60);
    sourceQuality   = Math.max(sourceQuality,   kbCB.sourceQuality   || kbCB.source_quality   || 65);
    consistency     = Math.max(consistency,     kbCB.consistency                              || 65);
  }

  // ── HuggingFace NLI signal ─────────────────────────────────────────────────
  // Weight scales linearly 0.3–0.80 based on model confidence
  if (hf) {
    const hfScore = Math.round(hf.confidence * 100);
    const hfWeight = 0.3 + hf.confidence * 0.5; // 0.30 at 0% conf → 0.80 at 100% conf
    signals.push({ type: hf.label, weight: hfWeight });
    reasoning.push(`AI model (BART-large-MNLI) classified this claim as "${hf.label}" with ${hfScore}% confidence.`);
    dataReliability = Math.max(dataReliability, hfScore * 0.7);
    sourceQuality = Math.max(sourceQuality, 50);
  }

  // ── Google Fact Check signals ──────────────────────────────────────────────
  if (factCheck?.claims?.length > 0) {
    const fcClaims = factCheck.claims.slice(0, 5);
    sourceQuality = Math.max(sourceQuality, 75); // official fact-checkers = high quality
    fcClaims.forEach(c => {
      const rating = (c.claimReview?.[0]?.textualRating || "").toLowerCase();
      const pub = c.claimReview?.[0]?.publisher?.name || "Fact-checker";
      const url = c.claimReview?.[0]?.url || "";
      let signalType = "uncertain", signalWeight = 0.5;
      let summary = "";

      if (/true|correct|accurate|confirmed|real/.test(rating)) {
        signalType = "supported"; signalWeight = 0.9;
        summary = `${pub} rated this claim as "${c.claimReview[0].textualRating}" — supports the claim.`;
        dataReliability = Math.min(dataReliability + 20, 95);
      } else if (/false|wrong|fabricat|debunk|fake|no evidence/.test(rating)) {
        signalType = "refuted"; signalWeight = 0.9;
        summary = `${pub} rated this claim as "${c.claimReview[0].textualRating}" — refutes the claim.`;
        dataReliability = Math.min(dataReliability + 15, 90);
        consistency = Math.max(consistency - 10, 20);
      } else if (/mislead|partial|context|mix|mostly false|half/.test(rating)) {
        signalType = "misleading"; signalWeight = 0.75;
        summary = `${pub} rated this as "${c.claimReview[0].textualRating}" — partial truth or missing context.`;
        dataReliability = Math.min(dataReliability + 10, 75);
      } else {
        summary = `${pub} reviewed this claim with rating: "${c.claimReview[0].textualRating}".`;
      }

      signals.push({ type: signalType, weight: signalWeight });
      reasoning.push(`${pub}: "${c.claimReview[0].textualRating}"`);
      evidence.push({ title: (c.text || "Fact-check result").slice(0, 100), summary, source: pub, url });
    });
  }

  // ── NewsAPI corroboration ──────────────────────────────────────────────────
  if (news.length > 0) {
    const highCredNews = news.filter(n => n.credibility === "High");
    const medCredNews = news.filter(n => n.credibility === "Medium");
    const boost = highCredNews.length * 0.15 + medCredNews.length * 0.07;

    if (news.length >= 5) {
      signals.push({ type: "supported", weight: 0.3 + boost });
      reasoning.push(`Widely reported across ${news.length} news sources${highCredNews.length ? `, including ${highCredNews.length} high-credibility outlet(s)` : ""}.`);
      sourceQuality = Math.min(sourceQuality + 20, 90);
      consistency = Math.min(consistency + 15, 90);
    } else if (news.length >= 2) {
      signals.push({ type: "supported", weight: 0.15 + boost });
      reasoning.push(`Found in ${news.length} news sources — moderate corroboration.`);
      sourceQuality = Math.min(sourceQuality + 10, 80);
    } else if (news.length === 1) {
      signals.push({ type: "uncertain", weight: 0.1 });
      reasoning.push("Only 1 news source found — limited corroboration.");
    }

    // Add top news as evidence
    news.slice(0, 3).forEach(n => {
      evidence.push({
        title: (n.title || "News Article").slice(0, 100),
        summary: `Reported by ${n.source || "Unknown"} — ${n.credibility || "Unknown"} credibility source.`,
        source: n.source || "Unknown",
        url: n.url || ""
      });
    });
  }

  // ── Conflict detection — reduces score ────────────────────────────────────
  const supportedW = signals.filter(s => s.type === "supported").reduce((a, s) => a + s.weight, 0);
  const refutedW   = signals.filter(s => s.type === "refuted").reduce((a, s) => a + s.weight, 0);
  const misleadW   = signals.filter(s => s.type === "misleading").reduce((a, s) => a + s.weight, 0);
  const uncertainW = signals.filter(s => s.type === "uncertain").reduce((a, s) => a + s.weight, 0);

  if (supportedW > 0 && refutedW > 0) {
    consistency = Math.max(consistency - 30, 15);
    reasoning.push("Conflicting sources found — some support while others refute this claim. Context may be missing.");
  }

  // ── No evidence fallback ───────────────────────────────────────────────────
  if (!signals.length) {
    return {
      verdict: "Uncertain",
      credibilityScore: 30,
      reasoning: ["Insufficient evidence found. No matching fact-checks or credible news coverage located.", "The claim may be too niche, too recent, or use terminology not indexed by available sources."],
      evidence: [],
      confidenceBreakdown: { dataReliability: 20, sourceQuality: 20, consistency: 40 }
    };
  }

  // ── STEP 4: Credibility Score Calculation (1–100) ─────────────────────────
  // Dominance = ratio of winner vs runner-up (not share of total)
  // This ensures a clearly winning signal reaches the top of its zone.
  const allW = [supportedW, refutedW, misleadW, uncertainW];
  const sorted = [...allW].sort((a, b) => b - a);
  const winnerW  = sorted[0] || 1;
  const runnerW  = sorted[1] || 0;
  // dominance: 0 = tied, 1 = no competition
  const dominance = Math.min((winnerW - runnerW) / (winnerW + 0.001), 1);

  let rawScore;

  if (refutedW > supportedW && refutedW > misleadW) {
    // Refuted zone: 1–40  (dominance 0→1 maps to 20→40, base at 1)
    rawScore = Math.round(1 + dominance * 39);
  } else if (misleadW > supportedW && misleadW > refutedW) {
    // Misleading zone: 30–55
    rawScore = Math.round(30 + dominance * 25);
  } else if (supportedW > refutedW && supportedW > misleadW) {
    // Supported zone: 61–99  (dominance 0→1 maps to 61→99)
    rawScore = Math.round(61 + dominance * 38);
  } else {
    // Uncertain / tie zone: 41–60
    rawScore = Math.round(41 + dominance * 19);
  }

  // Boost: each high-credibility news source adds 3 points (capped at +12)
  const highCredCount = news ? news.filter(n => n.credibility === "High").length : 0;
  const newsBoost = Math.min(highCredCount * 3, 12);

  // Conflict penalty: only when both supported & refuted signals are meaningful
  const conflictPenalty = (supportedW > 0.3 && refutedW > 0.3) ? Math.round(refutedW / (supportedW + refutedW) * 20) : 0;

  const credibilityScore = Math.min(Math.max(rawScore + newsBoost - conflictPenalty, 1), 99);

  // ── STEP 5: Final Verdict Based on Score ─────────────────────────────────
  let verdict;
  if (credibilityScore >= 61) verdict = "Verified";
  else if (credibilityScore >= 41) verdict = "Uncertain";
  else verdict = "False";

  // Override with Misleading ONLY when misleading clearly dominates both support & refuted
  if (misleadW > supportedW * 1.2 && misleadW > refutedW * 1.2 && misleadW > 0.6) verdict = "Misleading";
  // Conflicting equal signals → Misleading
  if (supportedW > 0.3 && refutedW > 0.3 && Math.abs(supportedW - refutedW) < 0.25) verdict = "Misleading";

  // ── Confidence Breakdown (1–100 each) ────────────────────────────────────
  const finalDataReliability = Math.min(Math.max(Math.round(dataReliability), 1), 99);
  const finalSourceQuality   = Math.min(Math.max(Math.round(sourceQuality), 1), 99);
  const finalConsistency     = Math.min(Math.max(Math.round(consistency), 1), 99);

  return {
    verdict,
    credibilityScore,
    reasoning,
    evidence: evidence.slice(0, 5), // max 5 evidence items
    confidenceBreakdown: {
      dataReliability: finalDataReliability,
      sourceQuality: finalSourceQuality,
      consistency: finalConsistency
    }
  };
}

// ─── PAGE CLAIM EXTRACTOR ─────────────────────────────────────────────────────
async function extractAndAnalyzePageClaim(text, url) {
  if (!text || text.trim().length < 50) return null;
  const claim = extractClaim(text);
  if (!claim || claim.length < 20) return null;
  return analyzeClaim(claim, url);
}

// ─── EXTERNAL API FETCHERS ────────────────────────────────────────────────────
async function fetchFactCheck(query) {
  const res = await fetch(`${GOOGLE_FACT_CHECK_ENDPOINT}?key=${GOOGLE_FACT_CHECK_API_KEY}&query=${encodeURIComponent(query)}&pageSize=5`);
  if (!res.ok) throw new Error(`FactCheck ${res.status}`);
  return res.json();
}

async function fetchNews(query) {
  const res = await fetch(`${NEWS_API_ENDPOINT}?apiKey=${NEWS_API_KEY}&q=${encodeURIComponent(query)}&pageSize=5&sortBy=relevancy&language=en`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.articles || []).map(a => ({
    title: a.title, source: a.source?.name, url: a.url,
    publishedAt: a.publishedAt, credibility: rateOutlet(a.source?.name)
  }));
}

async function fetchHuggingFace(claim) {
  const labels = ["supported", "refuted", "misleading", "uncertain"];
  const res = await fetch(HUGGINGFACE_ENDPOINT, {
    method: "POST",
    headers: { "Authorization": `Bearer ${HUGGINGFACE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: claim, parameters: { candidate_labels: labels } })
  });
  if (!res.ok) throw new Error(`HuggingFace ${res.status}`);
  const data = await res.json();
  const topIdx = data.scores ? data.scores.indexOf(Math.max(...data.scores)) : 0;
  return { label: data.labels?.[topIdx] || "uncertain", confidence: data.scores?.[topIdx] || 0.5 };
}

// ─── UTILITY FUNCTIONS ────────────────────────────────────────────────────────
function extractClaim(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/[A-Z][^.!?]*(?:is|are|was|were|has|have|will|can|causes?|leads? to|proves?|shows?)[^.!?]*[.!?]/g);
  return (m?.[0] || cleaned).slice(0, 250);
}

function categorize(text) {
  const lower = text.toLowerCase();
  const cats = {
    health: ["vaccine", "covid", "cancer", "virus", "disease", "health", "medical", "drug"],
    politics: ["president", "election", "vote", "government", "congress", "senate", "democrat", "republican"],
    technology: ["ai", "robot", "tech", "software", "hack", "data", "internet", "cyber"],
    climate: ["climate", "warming", "carbon", "emission", "environment", "pollution"],
    economy: ["economy", "stock", "inflation", "gdp", "market", "recession", "jobs"],
    science: ["study", "research", "scientist", "nasa", "space", "physics"]
  };
  for (const [cat, kws] of Object.entries(cats)) if (kws.some(kw => lower.includes(kw))) return cat;
  return "general";
}

function analyzeSentiment(text) {
  const pos = ["good", "true", "correct", "accurate", "confirm", "verified"];
  const neg = ["false", "fake", "wrong", "mislead", "hoax", "lie", "debunk"];
  const words = text.toLowerCase().split(/\W+/);
  let s = 0;
  words.forEach(w => { if (pos.includes(w)) s += 0.15; if (neg.includes(w)) s -= 0.15; });
  return Math.min(Math.max(s, -1), 1);
}

function estimateVirality(news) { return Math.min(news.length * 20, 100); }

function rateOutlet(name = "") {
  const h = ["reuters", "associated press", "bbc", "npr", "guardian", "new york times", "washington post"];
  const m = ["cnn", "fox", "abc", "cbs", "nbc", "axios"];
  const l = name.toLowerCase();
  if (h.some(x => l.includes(x))) return "High";
  if (m.some(x => l.includes(x))) return "Medium";
  return "Unknown";
}

function rateSourceCredibility(url) {
  if (!url || url === "manual") return "N/A";
  try { return rateOutlet(new URL(url).hostname); } catch { return "Unknown"; }
}

function getRecency(news) {
  if (!news.length) return null;
  const dates = news.map(n => new Date(n.publishedAt)).filter(d => !isNaN(d));
  if (!dates.length) return null;
  const h = Math.floor((Date.now() - Math.max(...dates)) / 3600000);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function detectSourceType(url) {
  if (!url || url === "manual") return "Manual Input";
  try { return new URL(url).hostname.replace("www.", ""); } catch { return "Unknown"; }
}

function getBadgeText(v) { return { Verified: "✓", False: "✗", Misleading: "!", Uncertain: "?" }[v] || "?"; }
function getVerdictColor(v) { return { Verified: "#16a34a", False: "#dc2626", Misleading: "#d97706", Uncertain: "#6b7280" }[v] || "#6b7280"; }

async function saveResult(result) {
  const d = await chrome.storage.local.get(["results"]);
  const r = (d.results || []);
  r.unshift(result);
  await chrome.storage.local.set({ results: r.slice(0, 50), latestResult: result });
}

async function saveFeedback(id, fb) {
  const d = await chrome.storage.local.get(["results"]);
  const r = (d.results || []).map(x => x.id === id ? { ...x, userFeedback: fb } : x);
  await chrome.storage.local.set({ results: r });
}
