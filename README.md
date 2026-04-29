# 🛡️ FactGuard – Chrome Extension

Real-time misinformation detection powered by AI, fact-checking APIs, and NLP.

---

## 📁 Project Structure

```
factguard-extension/
├── manifest.json          # Chrome Extension Manifest V3
├── background.js          # Service worker – API calls, scoring, routing
├── content.js             # Content script – page monitoring, tooltips
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic – tabs, rendering, charts
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── backend/
    ├── server.py          # Flask backend (sentiment + trends)
    └── requirements.txt   # Python dependencies
```

---

## 🚀 Installation Guide

### Step 1: Install the Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer Mode** (toggle top-right)
3. Click **"Load unpacked"**
4. Select the `factguard-extension/` folder
5. The FactGuard shield icon will appear in your toolbar

---

### Step 2: Set Up the Python Backend (Optional but recommended)

The backend adds NLTK sentiment analysis and Google Trends virality scores.

```bash
cd factguard-extension/backend

# Install dependencies
pip install -r requirements.txt

# Download NLTK data
python -c "import nltk; nltk.download('vader_lexicon')"

# Install pytrends
pip install pytrends

# Start the server
python server.py
```

The backend runs on `http://localhost:5000`.

---

## 🔑 APIs Used

| API | Purpose | Key |
|-----|---------|-----|
| Google Fact Check Tools | Fetch fact-check ratings | `AIzaSy...` |
| NewsAPI | Related news headlines | `b0bbfc...` |
| HuggingFace (BART) | AI claim classification | `hf_nEh...` |
| NLTK VADER | Sentiment analysis | (local) |
| pytrends | Google Trends virality | (no key needed) |

---

## 🧩 Features

### ✅ Auto-Detection
- Monitors active web pages in real-time using MutationObserver
- Floating badge shows verdict at bottom-right of any page
- Highlight any text → click tooltip to instantly fact-check

### 🔍 Analyze Tab
- **Text Mode**: Paste any text or claim
- **URL Mode**: Analyze content from a URL
- **Page Mode**: Auto-analyze the current active tab

### 📋 History Tab
- Filter results by: All / Supported / Uncertain / Refuted
- Click any entry to re-view full analysis
- Stores last 50 results in Chrome local storage

### 📊 Trends Tab
- Total checks, supported/refuted counts
- Donut chart showing verdict distribution
- Bar chart showing category breakdown

---

## 🎯 Scoring Logic

Credibility score (0–100%) is computed from:

| Factor | Weight |
|--------|--------|
| HuggingFace BART NLI | 40% |
| Google Fact Check ratings | 40% |
| News coverage breadth | 20% |

**Verdicts:**
- 🟢 **Supported** – Score ≥ 70%
- 🟡 **Uncertain** – Score 45–69%
- 🔴 **Refuted** – Score < 45%

---

## 🏷️ Categories

Claims are auto-categorized into: `health`, `politics`, `technology`, `climate`, `economy`, `science`, `general`

---

## 🔒 Privacy

- All API calls go directly to the APIs (no intermediary)
- Results stored locally in `chrome.storage.local`
- No data sent to external servers (except the fact-check APIs)
- Page content is never permanently stored

---

## ⚡ Quick Usage

1. **Browse any news site** → FactGuard auto-analyzes the article
2. **Select text** → Click the tooltip → Instantly fact-checked
3. **Right-click selected text** → "FactGuard: Check this claim"
4. **Click extension icon** → Open popup for manual analysis

---

## 🛠️ Troubleshooting

**Extension not loading:**
- Make sure Developer Mode is ON in `chrome://extensions/`
- Check the console for errors (click "Inspect views: service worker")

**API errors:**
- HuggingFace model may take 20–30s to warm up on first call
- NewsAPI free tier: 100 requests/day
- Google Fact Check: 1000 requests/day

**Backend not connecting:**
- Ensure `python server.py` is running
- Backend is optional; extension works without it
