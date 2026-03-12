const GATEWAY = "http://127.0.0.1:18789";

// --- DOM refs ---
const convTabs         = document.getElementById("convTabs");
const newConvBtn       = document.getElementById("newConvBtn");
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
const chatSendBtn      = document.getElementById("chatSendBtn");
const chatExpandBtn    = document.getElementById("chatExpandBtn");
const addPageBtn       = document.getElementById("addPageBtn");

// --- State ---
let selectedMode        = "summary";
let selectedText        = "";
let sessionFrames       = [];
let inSession           = false;
let mediaRecorder       = null;
let audioChunks         = [];
let timerInterval       = null;
let recSeconds          = 0;
let activeConversationId = null;
const tabResults        = new Map(); // conversationId → saved resultArea innerHTML
let _uid = 0; // unique ID counter for quiz/flashcard elements
const SPINNER_ID = "inlineSpinner";

// ── Dashboard / Chat links ───────────────────────────────────────────────────
dashboardBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "http://localhost:3000" });
});
chatExpandBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "http://localhost:3000/chat" });
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

// ── Shared chat send logic ────────────────────────────────────────────────────
async function sendChatMessage() {
  const message = titleInput.value.trim();
  if (!message) { captureBtn.click(); return; }

  titleInput.disabled = true;
  chatSendBtn.disabled = true;

  appendCard(`<div class="msg-user">${escapeHtml(message)}</div>`);
  titleInput.value = "";
  showSpinner("Thinking…");

  try {
    const res = await fetch(`${GATEWAY}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, conversationId: activeConversationId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gateway error");
    if (data.conversationId) activeConversationId = data.conversationId;
    appendCard(`
      <div class="result-card">
        <div class="md-body">${renderMarkdown(data.reply)}</div>
      </div>`);
    loadConversations(); // refresh tab titles
  } catch (err) { showError(err.message); }
  titleInput.disabled = false;
  chatSendBtn.disabled = false;
}

titleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); sendChatMessage(); }
});

chatSendBtn.addEventListener("click", sendChatMessage);

// ── Gateway health check ────────────────────────────────────────────────────
async function checkGateway() {
  try {
    const r = await fetch(`${GATEWAY}/health`, { signal: AbortSignal.timeout(2000) });
    statusDot.classList.toggle("online", r.ok);
  } catch { statusDot.classList.remove("online"); }
}
checkGateway();
setInterval(checkGateway, 10_000);

// ── Conversation tabs ─────────────────────────────────────────────────────────
let conversations = [];

function renderConvTabs() {
  convTabs.querySelectorAll(".conv-tab").forEach(t => t.remove());
  for (const conv of conversations) {
    const tab = document.createElement("button");
    tab.className = "conv-tab" + (conv.id === activeConversationId ? " active" : "");
    tab.title = conv.title ?? "New conversation";

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = conv.title ?? "New conversation";
    tab.appendChild(label);

    const delBtn = document.createElement("span");
    delBtn.className = "tab-del";
    delBtn.textContent = "×";
    delBtn.title = "Delete conversation";
    delBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteConvTab(conv.id); });
    tab.appendChild(delBtn);

    tab.addEventListener("click", () => switchConversation(conv.id));
    tab.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const newName = prompt("Rename conversation:", conv.title ?? "New conversation");
      if (newName?.trim()) renameConvTab(conv.id, newName.trim());
    });

    convTabs.insertBefore(tab, newConvBtn);
  }
}

async function loadConversations() {
  try {
    const r = await fetch(`${GATEWAY}/conversations/list`);
    if (!r.ok) return;
    conversations = await r.json();
    renderConvTabs();
  } catch { /* gateway not running */ }
}

const PLACEHOLDER_HTML = `<p class="placeholder">Choose a mode, then hit <strong>⚡ Capture</strong>.<br>Or select text on any page to <strong>Ask</strong> about it.</p>`;

async function switchConversation(id) {
  // Save current tab's content before leaving
  if (activeConversationId !== null) {
    tabResults.set(activeConversationId, resultArea.innerHTML);
  }
  activeConversationId = id;

  const cached = tabResults.get(id);
  if (cached !== undefined) {
    resultArea.innerHTML = cached;
    reattachResultListeners();
  } else {
    try {
      const hr = await fetch(`${GATEWAY}/chat/history?conversationId=${id}`);
      if (hr.ok) {
        const messages = await hr.json();
        const lastAI = [...messages].reverse().find(m => m.role === "assistant");
        if (lastAI) {
          resultArea.innerHTML = `
            <div class="result-card">
              <div class="md-body">${renderMarkdown(lastAI.content)}</div>
            </div>`;
        } else {
          resultArea.innerHTML = PLACEHOLDER_HTML;
        }
      }
    } catch (err) { console.error(err); }
  }
  renderConvTabs();
}

async function deleteConvTab(id) {
  try {
    const r = await fetch(`${GATEWAY}/conversations/${id}`, { method: "DELETE" });
    if (!r.ok) return;
    tabResults.delete(id);
    conversations = conversations.filter(c => c.id !== id);
    if (activeConversationId === id) {
      if (conversations.length > 0) {
        await switchConversation(conversations[0].id);
      } else {
        const nr = await fetch(`${GATEWAY}/conversations/new`, { method: "POST" });
        if (nr.ok) {
          const { id: newId } = await nr.json();
          activeConversationId = newId;
          resultArea.innerHTML = PLACEHOLDER_HTML;
          await loadConversations();
        }
      }
    } else {
      renderConvTabs();
    }
  } catch (err) { console.error(err); }
}

async function renameConvTab(id, title) {
  try {
    await fetch(`${GATEWAY}/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    await loadConversations();
  } catch (err) { console.error(err); }
}

function reattachResultListeners() {
  resultArea.querySelectorAll(".quiz-reveal-btn").forEach((btn) => {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const el = document.getElementById(btn.dataset.answerId);
      if (!el) return;
      const hidden = el.style.display === "none";
      el.style.display = hidden ? "block" : "none";
      btn.textContent = hidden ? "▼ Hide Answer" : "▶ Show Answer";
    });
  });
  resultArea.querySelectorAll(".flashcard").forEach((fc) => {
    fc.addEventListener("click", function () { this.classList.toggle("flipped"); });
  });
}

newConvBtn.addEventListener("click", async () => {
  if (activeConversationId !== null) {
    tabResults.set(activeConversationId, resultArea.innerHTML);
  }
  try {
    const r = await fetch(`${GATEWAY}/conversations/new`, { method: "POST" });
    if (!r.ok) return;
    const { id } = await r.json();
    activeConversationId = id;
    resultArea.innerHTML = PLACEHOLDER_HTML;
    await loadConversations();
  } catch (err) { console.error(err); }
});

// ── Restore conversation on open ─────────────────────────────────────────────
async function loadActiveConversation() {
  try {
    const r = await fetch(`${GATEWAY}/conversations/active`);
    if (!r.ok) return;
    const { id, messages } = await r.json();
    activeConversationId = id;
    await loadConversations();
    // Show last AI reply if there is one
    const lastAI = [...messages].reverse().find(m => m.role === "assistant");
    if (lastAI) {
      resultArea.innerHTML = `
        <div class="result-card">
          <span class="saved-badge" style="background:#1e1e36;color:#888">↩ Previous conversation</span>
          <div class="md-body">${renderMarkdown(lastAI.content)}</div>
        </div>`;
    }
  } catch { /* gateway not running yet */ }
}
loadActiveConversation();

// ── Tab capture helper ──────────────────────────────────────────────────────
async function captureTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.windowId) throw new Error("No active tab found.");
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return { base64: dataUrl.replace(/^data:image\/png;base64,/, ""), mimeType: "image/png" };
}

// ── Main capture button ─────────────────────────────────────────────────────
// ── Add Page button (multi-page session) ─────────────────────────────────────
addPageBtn.addEventListener("click", async () => {
  addPageBtn.disabled = true;
  showSpinner("Capturing page…");
  try {
    const frame = await captureTab();
    sessionFrames.push(frame);
    updateSessionBar();
    showSpinner(`${sessionFrames.length} page${sessionFrames.length > 1 ? "s" : ""} captured — add more or click Done ✓`);
  } catch (err) { showError(err.message); }
  addPageBtn.disabled = false;
});

captureBtn.addEventListener("click", async () => {
  if (selectedMode === "audio") { startAudioCapture(); return; }

  captureBtn.disabled = true;

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
      showResult(data.markdown, data.filename, selectedMode);
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
    showResult(data.markdown, data.filename, selectedMode);
  } catch (err) { showError(err.message); }
  askBtn.disabled = false;
});

// ── Session ─────────────────────────────────────────────────────────────────
sessionBtn.addEventListener("click", () => {
  inSession = true;
  sessionFrames = [];
  sessionBar.classList.add("active");
  updateSessionBar();
});

function updateSessionBar() {
  const n = sessionFrames.length;
  sessionCount.textContent = `${n} page${n !== 1 ? "s" : ""}`;
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
  showSpinner(`Analyzing ${sessionFrames.length} pages…`);

  try {
    const res = await fetch(`${GATEWAY}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames: sessionFrames, mode: selectedMode, title: titleInput.value.trim() || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gateway error");

    if (selectedMode === "flashcard" && data.cards) {
      showFlashcards(data.cards, data.filename);
    } else {
      showResult(data.markdown, data.filename, selectedMode);
    }
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

function appendCard(htmlStr, afterInsert) {
  document.getElementById(SPINNER_ID)?.remove();
  resultArea.querySelector(".placeholder")?.remove();
  const wrap = document.createElement("div");
  wrap.innerHTML = htmlStr;
  while (wrap.firstChild) resultArea.appendChild(wrap.firstChild);
  if (afterInsert) afterInsert();
  resultArea.scrollTop = resultArea.scrollHeight;
}

function showSpinner(msg) {
  document.getElementById(SPINNER_ID)?.remove();
  resultArea.querySelector(".placeholder")?.remove();
  const div = document.createElement("div");
  div.id = SPINNER_ID;
  div.className = "spinner";
  div.textContent = msg;
  resultArea.appendChild(div);
  resultArea.scrollTop = resultArea.scrollHeight;
}

function showResult(markdown, filename, mode) {
  const bodyHtml = (mode === "quiz")
    ? renderQuiz(markdown)
    : `<div class="md-body">${renderMarkdown(markdown)}</div>`;

  appendCard(`
    <div class="result-card">
      <span class="saved-badge">✓ ${escapeHtml(filename)}</span>
      ${bodyHtml}
    </div>`,
    mode === "quiz" ? () => {
      resultArea.querySelectorAll(".quiz-reveal-btn:not([data-bound])").forEach((btn) => {
        btn.dataset.bound = "1";
        btn.addEventListener("click", () => {
          const el = document.getElementById(btn.dataset.answerId);
          if (!el) return;
          const hidden = el.style.display === "none";
          el.style.display = hidden ? "block" : "none";
          btn.textContent = hidden ? "▼ Hide Answer" : "▶ Show Answer";
        });
      });
    } : null
  );
}

function showFlashcards(cards, filename) {
  const prefix = `fc${++_uid}_`;
  const grid = cards.map((card, i) => `
    <div class="flashcard" id="${prefix}${i}">
      <div class="flashcard-inner">
        <div class="flashcard-front">${escapeHtml(card.front)}</div>
        <div class="flashcard-back">${escapeHtml(card.back)}</div>
      </div>
    </div>
    <p class="card-hint">Tap to flip</p>
  `).join("");

  appendCard(`
    <div class="result-card" style="background:transparent;border:none;padding:0">
      <span class="saved-badge" style="margin-bottom:10px;display:block">
        ✓ ${escapeHtml(filename)} — ${cards.length} cards
      </span>
      <div class="flashcard-grid">${grid}</div>
    </div>`,
    () => {
      cards.forEach((_, i) => {
        document.getElementById(`${prefix}${i}`)?.addEventListener("click", function () {
          this.classList.toggle("flipped");
        });
      });
    }
  );
}

function showError(msg) {
  document.getElementById(SPINNER_ID)?.remove();
  appendCard(`<div class="error-card"><strong>Error:</strong> ${escapeHtml(msg)}</div>`);
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Quiz renderer — shows questions with hidden answers ──────────────────────
function renderQuiz(markdown) {
  const blocks = markdown.split(/\n---\n/);
  let html = "";
  let qNum = 0;
  const quizPrefix = `qz${++_uid}`;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const answerIdx = trimmed.indexOf("**Answer:**");
    if (answerIdx === -1) {
      // Non-Q&A block (e.g. intro text) — render normally
      html += `<div class="md-body">${renderMarkdown(trimmed)}</div>`;
      continue;
    }

    qNum++;
    const questionPart = trimmed.slice(0, answerIdx).trim();
    const answerPart   = trimmed.slice(answerIdx + "**Answer:**".length).trim();
    const id = `${quizPrefix}-ans-${qNum}`;

    html += `
      <div class="quiz-block">
        <div class="quiz-question md-body">${renderMarkdown(questionPart)}</div>
        <button class="quiz-reveal-btn" data-answer-id="${id}">▶ Show Answer</button>
        <div class="quiz-answer md-body" id="${id}" style="display:none">${renderMarkdown(answerPart)}</div>
      </div>`;
  }

  return html || `<div class="md-body">${renderMarkdown(markdown)}</div>`;
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
