const GATEWAY = "http://127.0.0.1:18789";

// --- DOM refs ---
const captureBtn       = document.getElementById("captureBtn");
const sessionBtn       = document.getElementById("sessionBtn");
const sessionBar       = document.getElementById("sessionBar");
const sessionCount     = document.getElementById("sessionCount");
const sessionFinish    = document.getElementById("sessionFinish");
const sessionCancel    = document.getElementById("sessionCancel");
const audioBar         = document.getElementById("audioBar");
const stopAudio        = document.getElementById("stopAudio");
const recTimer         = document.getElementById("recTimer");
const resultArea       = document.getElementById("resultArea");
const statusDot        = document.getElementById("statusDot");
const titleInput       = document.getElementById("titleInput");
const modeTrigger      = document.getElementById("modeTrigger");
const modeDropdown     = document.getElementById("modeDropdown");
const modeLabel        = document.getElementById("modeLabel");
const dropdownItems    = document.querySelectorAll(".dropdown-item");
const dashboardBtn     = document.getElementById("dashboardBtn");
const selectionBar     = document.getElementById("selectionBar");
const selectionPreview = document.getElementById("selectionPreview");
const askBtn           = document.getElementById("askBtn");
const selectionDismiss = document.getElementById("selectionDismiss");

// --- State ---
let selectedMode  = "summary";
let selectedText  = "";
let sessionFrames = [];
let inSession     = false;
let mediaRecorder = null;
let audioChunks   = [];
let timerInterval = null;
let recSeconds    = 0;

// ── Dashboard link ───────────────────────────────────────────────────────────
dashboardBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "http://localhost:3000" });
});

// ── Mode dropdown ────────────────────────────────────────────────────────────
modeTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  if (mediaRecorder) return;
  const isOpen = modeDropdown.classList.toggle("open");
  modeTrigger.classList.toggle("open", isOpen);
});

document.addEventListener("click", () => {
  modeDropdown.classList.remove("open");
  modeTrigger.classList.remove("open");
});

dropdownItems.forEach((item) => {
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    if (mediaRecorder) return;

    selectedMode = item.dataset.mode;

    modeTrigger.querySelector(".mode-icon").textContent = item.dataset.icon;
    modeLabel.textContent = item.querySelector(".d-name").textContent;
    modeTrigger.style.setProperty("--mode-color", item.dataset.color);

    dropdownItems.forEach((d) => d.classList.remove("active"));
    item.classList.add("active");

    modeDropdown.classList.remove("open");
    modeTrigger.classList.remove("open");

    resetCaptureBtn();
    sessionBtn.classList.toggle("hidden", selectedMode === "audio");
  });
});

// ── Gateway health check ────────────────────────────────────────────────────
async function checkGateway() {
  try {
    const r = await fetch(`${GATEWAY}/health`, { signal: AbortSignal.timeout(2000) });
    statusDot.classList.toggle("online", r.ok);
  } catch { statusDot.classList.remove("online"); }
}
checkGateway();
setInterval(checkGateway, 10_000);

// ── Tab capture helper ──────────────────────────────────────────────────────
async function captureTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.windowId) throw new Error("No active tab found.");
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return { base64: dataUrl.replace(/^data:image\/png;base64,/, ""), mimeType: "image/png" };
}

// ── Main capture button ─────────────────────────────────────────────────────
captureBtn.addEventListener("click", async () => {
  if (selectedMode === "audio") { startAudioCapture(); return; }

  captureBtn.disabled = true;

  if (inSession) {
    showSpinner("Capturing slide…");
    try {
      const frame = await captureTab();
      sessionFrames.push(frame);
      updateSessionBar();
      showSpinner(`${sessionFrames.length} slide${sessionFrames.length > 1 ? "s" : ""} captured — keep going or click Finish.`);
    } catch (err) { showError(err.message); }
    captureBtn.disabled = false;
    return;
  }

  showSpinner("Capturing screen…");
  try {
    const { base64, mimeType } = await captureTab();
    showSpinner("Analyzing…");
    const res = await fetch(`${GATEWAY}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screenshot: base64,
        mimeType,
        mode: selectedMode,
        title: titleInput.value.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gateway error");

    if (selectedMode === "flashcard" && data.cards) {
      showFlashcards(data.cards, data.filename);
    } else {
      showResult(data.markdown, data.filename);
    }
  } catch (err) { showError(err.message); }
  captureBtn.disabled = false;
});

// ── Text selection (from content script) ───────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "textSelection") return;
  if (msg.text && msg.text.length >= 3) {
    selectedText = msg.text;
    selectionPreview.textContent = msg.text.length > 140 ? msg.text.slice(0, 140) + "…" : msg.text;
    selectionBar.classList.add("active");
  } else {
    selectedText = "";
    selectionBar.classList.remove("active");
  }
});

selectionDismiss.addEventListener("click", () => {
  selectedText = "";
  selectionBar.classList.remove("active");
});

askBtn.addEventListener("click", async () => {
  if (!selectedText) return;
  askBtn.disabled = true;
  showSpinner("Analyzing selected text…");
  try {
    const res = await fetch(`${GATEWAY}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selectedText,
        mode: selectedMode,
        title: titleInput.value.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gateway error");
    showResult(data.markdown, data.filename);
  } catch (err) { showError(err.message); }
  askBtn.disabled = false;
});

// ── Session ─────────────────────────────────────────────────────────────────
sessionBtn.addEventListener("click", () => {
  inSession = true;
  sessionFrames = [];
  sessionBar.classList.add("active");
  updateSessionBar();
  captureBtn.textContent = "➕ Add Slide";
});

function updateSessionBar() {
  const n = sessionFrames.length;
  sessionCount.textContent = `${n} slide${n !== 1 ? "s" : ""}`;
  sessionFinish.disabled = n === 0;
}

sessionCancel.addEventListener("click", () => {
  inSession = false;
  sessionFrames = [];
  sessionBar.classList.remove("active");
  resetCaptureBtn();
});

sessionFinish.addEventListener("click", async () => {
  if (sessionFrames.length === 0) return;
  sessionBar.classList.remove("active");
  captureBtn.disabled = true;
  showSpinner(`Analyzing ${sessionFrames.length} slides as one session…`);

  try {
    const res = await fetch(`${GATEWAY}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames: sessionFrames, title: titleInput.value.trim() || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gateway error");
    showResult(data.markdown, data.filename);
  } catch (err) { showError(err.message); }

  inSession = false;
  sessionFrames = [];
  resetCaptureBtn();
  captureBtn.disabled = false;
});

// ── Audio capture ───────────────────────────────────────────────────────────
async function startAudioCapture() {
  captureBtn.disabled = true;
  try {
    const stream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({ audio: true, video: false }, (s) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!s) reject(new Error("Could not capture tab audio. Make sure a tab with audio is active."));
        else resolve(s);
      });
    });

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(audioCtx.destination);

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      audioCtx.close();
      finishAudio();
    };
    mediaRecorder.start(1000);

    recSeconds = 0;
    audioBar.classList.add("active");
    timerInterval = setInterval(() => {
      recSeconds++;
      const m = Math.floor(recSeconds / 60);
      const s = String(recSeconds % 60).padStart(2, "0");
      recTimer.textContent = `${m}:${s}`;
    }, 1000);

  } catch (err) {
    showError(err.message);
    captureBtn.disabled = false;
  }
}

stopAudio.addEventListener("click", () => {
  if (mediaRecorder?.state !== "inactive") mediaRecorder.stop();
  clearInterval(timerInterval);
  audioBar.classList.remove("active");
  showSpinner("Transcribing audio with Whisper…");
});

async function finishAudio() {
  try {
    const blob = new Blob(audioChunks, { type: "audio/webm" });
    const base64 = await blobToBase64(blob);
    const res = await fetch(`${GATEWAY}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio: base64,
        mode: "summary",
        title: titleInput.value.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Transcription error");
    showResult(data.markdown, data.filename);
  } catch (err) { showError(err.message); }
  mediaRecorder = null;
  captureBtn.disabled = false;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── UI helpers ──────────────────────────────────────────────────────────────
function resetCaptureBtn() {
  captureBtn.textContent = selectedMode === "audio" ? "🎙️ Record" : "⚡ Capture";
}

function showSpinner(msg) {
  resultArea.innerHTML = `<div class="spinner">${escapeHtml(msg)}</div>`;
}

function showResult(markdown, filename) {
  resultArea.innerHTML = `
    <div class="result-card">
      <span class="saved-badge">✓ ${escapeHtml(filename)}</span>
      <div class="md-body">${renderMarkdown(markdown)}</div>
    </div>`;
}

function showFlashcards(cards, filename) {
  const grid = cards.map((card, i) => `
    <div class="flashcard" id="fc${i}">
      <div class="flashcard-inner">
        <div class="flashcard-front">${escapeHtml(card.front)}</div>
        <div class="flashcard-back">${escapeHtml(card.back)}</div>
      </div>
    </div>
    <p class="card-hint">Tap to flip</p>
  `).join("");

  resultArea.innerHTML = `
    <div class="result-card" style="background:transparent;border:none;padding:0">
      <span class="saved-badge" style="margin-bottom:10px;display:block">
        ✓ ${escapeHtml(filename)} — ${cards.length} cards
      </span>
      <div class="flashcard-grid">${grid}</div>
    </div>`;

  cards.forEach((_, i) => {
    document.getElementById(`fc${i}`)?.addEventListener("click", function () {
      this.classList.toggle("flipped");
    });
  });
}

function showError(msg) {
  resultArea.innerHTML = `<div class="error-card"><strong>Error:</strong> ${escapeHtml(msg)}</div>`;
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Markdown renderer ────────────────────────────────────────────────────────
function renderMarkdown(raw) {
  const blocks = [];

  // 1. Extract fenced code blocks → placeholder (before HTML escaping)
  let text = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    const i = blocks.length;
    const escaped = code.trim()
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    blocks.push(`<pre class="md-pre"><code>${escaped}</code></pre>`);
    return `\x00B${i}\x00`;
  });

  // 2. Escape remaining HTML
  text = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // 3. Extract inline code → placeholder (content already escaped)
  text = text.replace(/`([^`\n]+)`/g, (_, c) => {
    const i = blocks.length;
    blocks.push(`<code class="md-code">${c}</code>`);
    return `\x00B${i}\x00`;
  });

  // 4. Headers
  text = text.replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  text = text.replace(/^### (.+)$/gm,  '<h3 class="md-h3">$1</h3>');
  text = text.replace(/^## (.+)$/gm,   '<h2 class="md-h2">$1</h2>');
  text = text.replace(/^# (.+)$/gm,    '<h2 class="md-h2">$1</h2>');

  // 5. Bold & italic
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g,     '<em>$1</em>');
  text = text.replace(/__(.+?)__/g,     '<strong>$1</strong>');
  text = text.replace(/_(.+?)_/g,       '<em>$1</em>');

  // 6. Horizontal rule
  text = text.replace(/^---+$/gm, '<hr class="md-hr">');

  // 7. Blockquote (&gt; after HTML escaping)
  text = text.replace(/^&gt; (.+)$/gm, '<blockquote class="md-bq">$1</blockquote>');

  // 8. Line-by-line: lists → <ul>/<ol>, everything else → <p>
  const BLOCK_STARTS = ['<h2', '<h3', '<h4', '<hr', '<blockquote', '<pre', '\x00B'];
  const lines = text.split('\n');
  const out = [];
  let inUl = false, inOl = false;

  for (const line of lines) {
    if (/^[*-] /.test(line)) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul class="md-ul">'); inUl = true; }
      out.push(`<li>${line.replace(/^[*-] /, '')}</li>`);
    } else if (/^\d+\. /.test(line)) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol class="md-ol">'); inOl = true; }
      out.push(`<li>${line.replace(/^\d+\. /, '')}</li>`);
    } else {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
      const t = line.trim();
      if (!t) {
        out.push('<div class="md-gap"></div>');
      } else if (BLOCK_STARTS.some(b => t.startsWith(b))) {
        out.push(t);
      } else {
        out.push(`<p class="md-p">${t}</p>`);
      }
    }
  }
  if (inUl) out.push('</ul>');
  if (inOl) out.push('</ol>');

  // 9. Restore code blocks
  return out.join('').replace(/\x00B(\d+)\x00/g, (_, i) => blocks[+i]);
}
