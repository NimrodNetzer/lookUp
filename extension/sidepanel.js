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

// ── Tab drag state ────────────────────────────────────────────────────────────
let dragConvId     = null;
let mergeTimer     = null;
let mergeTargetId  = null;

function clearDropIndicators() {
  convTabs.querySelectorAll(".tab-drop-before,.tab-drop-after,.tab-drop-merge")
    .forEach(t => t.classList.remove("tab-drop-before","tab-drop-after","tab-drop-merge"));
}
function clearMergeTimer() {
  if (mergeTimer) { clearTimeout(mergeTimer); mergeTimer = null; }
  mergeTargetId = null;
}

// ── Tab bar scroll arrows ─────────────────────────────────────────────────────
const tabsArrowLeft  = document.getElementById("tabsArrowLeft");
const tabsArrowRight = document.getElementById("tabsArrowRight");

function updateTabArrows() {
  const { scrollLeft, scrollWidth, clientWidth } = convTabs;
  tabsArrowLeft.classList.toggle("visible",  scrollLeft > 2);
  tabsArrowRight.classList.toggle("visible", scrollLeft + clientWidth < scrollWidth - 2);
}

tabsArrowLeft.addEventListener("click",  () => { convTabs.scrollBy({ left: -80, behavior: "smooth" }); });
tabsArrowRight.addEventListener("click", () => { convTabs.scrollBy({ left:  80, behavior: "smooth" }); });
convTabs.addEventListener("scroll", updateTabArrows);
convTabs.addEventListener("wheel", (e) => { e.preventDefault(); convTabs.scrollBy({ left: e.deltaY !== 0 ? e.deltaY : e.deltaX, behavior: "smooth" }); }, { passive: false });
new ResizeObserver(updateTabArrows).observe(convTabs);

// ── Dashboard / Chat links ───────────────────────────────────────────────────
dashboardBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "http://localhost:18789" });
});
chatExpandBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "http://localhost:18789/chat" });
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
    const isQuiz = data.reply.includes("**Answer:**");
    appendCard(`
      <div class="result-card">
        ${isQuiz ? renderQuiz(data.reply) : `<div class="md-body">${renderMarkdown(data.reply)}</div>`}
      </div>`,
      isQuiz ? () => {
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

    tab.addEventListener("click", () => switchConversation(conv.id));
    tab.addEventListener("mousedown", (e) => { if (e.button === 1) { e.preventDefault(); deleteConvTab(conv.id); } });
    tab.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showTabContextMenu(e.clientX, e.clientY, conv.id, conv.title ?? "New conversation", label);
    });

    // ── Drag to reorder / merge ──
    tab.draggable = true;
    tab.addEventListener("dragstart", (e) => {
      dragConvId = conv.id;
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => tab.classList.add("tab-drag-ghost"), 0);
    });
    tab.addEventListener("dragend", () => {
      tab.classList.remove("tab-drag-ghost");
      dragConvId = null;
      clearDropIndicators();
      clearMergeTimer();
    });
    tab.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (dragConvId === null || dragConvId === conv.id) return;
      const { left, width } = tab.getBoundingClientRect();
      const rel = (e.clientX - left) / width;
      clearDropIndicators();
      clearMergeTimer();
      if (rel < 0.3) {
        tab.classList.add("tab-drop-before");
      } else if (rel > 0.7) {
        tab.classList.add("tab-drop-after");
      } else {
        mergeTargetId = conv.id;
        mergeTimer = setTimeout(() => {
          clearDropIndicators();
          convTabs.querySelector(`.conv-tab[data-id="${conv.id}"]`)?.classList.add("tab-drop-merge");
        }, 350);
      }
    });
    tab.addEventListener("dragleave", (e) => {
      if (!tab.contains(e.relatedTarget)) {
        tab.classList.remove("tab-drop-before","tab-drop-after","tab-drop-merge");
        clearMergeTimer();
      }
    });
    tab.addEventListener("drop", async (e) => {
      e.preventDefault();
      if (dragConvId === null || dragConvId === conv.id) return;
      const isMerge  = tab.classList.contains("tab-drop-merge");
      const isBefore = tab.classList.contains("tab-drop-before");
      clearDropIndicators();
      clearMergeTimer();
      if (isMerge) {
        await mergeConvTabs(conv.id, dragConvId);
      } else {
        const srcIdx = conversations.findIndex(c => c.id === dragConvId);
        const newArr = [...conversations];
        const [removed] = newArr.splice(srcIdx, 1);
        const tgtIdx = newArr.findIndex(c => c.id === conv.id);
        newArr.splice(isBefore ? tgtIdx : tgtIdx + 1, 0, removed);
        conversations = newArr;
        renderConvTabs();
        await fetch(`${GATEWAY}/conversations/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: conversations.map(c => c.id) }),
        });
      }
    });
    tab.dataset.id = String(conv.id);

    convTabs.insertBefore(tab, newConvBtn);
  }
  updateTabArrows();
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
        if (messages.length > 0) {
          renderAllMessages(messages);
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

async function mergeConvTabs(targetId, sourceId) {
  try {
    const r = await fetch(`${GATEWAY}/conversations/${targetId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId }),
    });
    if (!r.ok) return;
    tabResults.delete(sourceId);
    tabResults.delete(targetId); // force re-fetch from DB
    if (activeConversationId === sourceId) activeConversationId = targetId;
    await loadConversations();
    if (activeConversationId === targetId) await switchConversation(targetId);
  } catch (err) { console.error(err); }
}

function showTabContextMenu(x, y, convId, currentTitle, labelEl) {
  document.getElementById("tabCtxMenu")?.remove();

  const menu = document.createElement("div");
  menu.id = "tabCtxMenu";
  menu.className = "tab-ctx-menu";
  menu.style.left = x + "px";
  menu.style.top = y + "px";

  const deleteItem = document.createElement("div");
  deleteItem.className = "tab-ctx-item tab-ctx-delete";
  deleteItem.textContent = "🗑️  Delete";
  deleteItem.addEventListener("click", () => {
    menu.remove();
    deleteConvTab(convId);
  });
  menu.appendChild(deleteItem);

  const renameItem = document.createElement("div");
  renameItem.className = "tab-ctx-item";
  renameItem.textContent = "✏️  Rename";
  renameItem.addEventListener("click", () => {
    menu.remove();
    startInlineRename(convId, currentTitle, labelEl);
  });
  menu.appendChild(renameItem);

  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth)   menu.style.left = (x - rect.width) + "px";
  if (rect.bottom > window.innerHeight) menu.style.top  = (y - rect.height) + "px";

  setTimeout(() => {
    const dismiss = (e) => {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("click", dismiss, true); }
    };
    document.addEventListener("click", dismiss, true);
  }, 0);
}

function startInlineRename(convId, currentTitle, labelEl) {
  labelEl.style.display = "none";

  const input = document.createElement("input");
  input.className = "tab-rename-input";
  input.type = "text";
  input.value = currentTitle;
  input.maxLength = 60;
  labelEl.parentElement.insertBefore(input, labelEl);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    input.remove();
    labelEl.style.display = "";
    if (save && input.value.trim() && input.value.trim() !== currentTitle) {
      renameConvTab(convId, input.value.trim());
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter")  { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
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

function renderAllMessages(messages) {
  resultArea.innerHTML = "";
  for (const msg of messages) {
    if (msg.role === "user") {
      const el = document.createElement("div");
      el.className = "msg-user";
      el.textContent = msg.content;
      resultArea.appendChild(el);
    } else if (msg.role === "assistant") {
      let cards = null;
      try {
        const p = JSON.parse(msg.content);
        console.log("[LookUp] assistant msg parsed:", p);
        if (Array.isArray(p) && p[0]?.front !== undefined) cards = p;
      } catch (e) {
        console.log("[LookUp] assistant msg not JSON, content:", msg.content.slice(0, 80));
      }
      if (cards) {
        showFlashcards(cards, null, "flashcard");
      } else {
        const isQuiz = msg.content.includes("**Answer:**");
        const wrap = document.createElement("div");
        wrap.innerHTML = `<div class="result-card">${isQuiz ? renderQuiz(msg.content) : `<div class="md-body">${renderMarkdown(msg.content)}</div>`}</div>`;
        while (wrap.firstChild) resultArea.appendChild(wrap.firstChild);
      }
    }
  }
  reattachResultListeners();
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
    if (messages.length > 0) {
      renderAllMessages(messages);
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
        conversationId: activeConversationId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gateway error");

    if (data.conversationId) activeConversationId = data.conversationId;
    if (selectedMode === "flashcard" && data.cards) {
      showFlashcards(data.cards, data.title, selectedMode);
    } else {
      showResult(data.markdown, data.title, selectedMode);
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
        conversationId: activeConversationId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gateway error");
    if (data.conversationId) activeConversationId = data.conversationId;
    if (selectedMode === "flashcard" && data.cards) {
      showFlashcards(data.cards, data.title, selectedMode);
    } else {
      showResult(data.markdown, data.title, selectedMode);
    }
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
      body: JSON.stringify({ frames: sessionFrames, mode: selectedMode, title: titleInput.value.trim() || undefined, conversationId: activeConversationId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gateway error");

    if (data.conversationId) activeConversationId = data.conversationId;
    if (selectedMode === "flashcard" && data.cards) {
      showFlashcards(data.cards, data.title, selectedMode);
    } else {
      showResult(data.markdown, data.title, selectedMode);
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
        mode: selectedMode,
        title: titleInput.value.trim() || undefined,
        conversationId: activeConversationId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Transcription error");
    if (data.conversationId) activeConversationId = data.conversationId;
    if (selectedMode === "flashcard" && data.cards) {
      showFlashcards(data.cards, data.title, selectedMode);
    } else {
      showResult(data.markdown, data.title, selectedMode);
    }
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

const MODE_LABELS = { summary:"Summary", explain:"Explanation", quiz:"Quiz", flashcard:"Flashcards", session:"Session" };
function resultHeadline(mode, title) {
  const base = (mode ?? "summary").replace(/^audio-/, "");
  const label = MODE_LABELS[base] ?? (base.charAt(0).toUpperCase() + base.slice(1));
  const display = mode?.startsWith("audio-") ? `${label} · Audio` : label;
  const hasTitle = title && title !== mode && title !== base;
  return `<div class="result-headline">${display}${hasTitle ? `: ${escapeHtml(title)}` : ""}</div>`;
}

function showResult(markdown, title, mode) {
  const bodyHtml = (mode === "quiz")
    ? renderQuiz(markdown)
    : `<div class="md-body">${renderMarkdown(markdown)}</div>`;

  appendCard(`
    <div class="result-card">
      ${resultHeadline(mode, title)}
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

function showFlashcards(cards, title, mode = "flashcard") {
  const prefix = `fc${++_uid}_`;
  const grid = cards.map((card, i) => `
    <div class="flashcard" id="${prefix}${i}">
      <div class="flashcard-inner">
        <div class="flashcard-front">${renderMarkdown(card.front)}</div>
        <div class="flashcard-back">${renderMarkdown(card.back)}</div>
      </div>
    </div>
  `).join("");

  appendCard(`
    <div class="result-card" style="background:transparent;border:none;padding:0">
      ${resultHeadline(mode, title)}
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
  let blocks = markdown.split(/\n[ \t]*---[ \t]*\n/);

  // If no --- separators but multiple **Answer:** found, split at question boundaries (**Q1., **Q2. etc.)
  if (blocks.length <= 1 && (markdown.match(/\*\*Answer:\*\*/g) ?? []).length > 1) {
    blocks = markdown.split(/\n\n(?=\*\*Q\d)/);
  }

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

// ── Math renderer — converts LaTeX commands to Unicode/HTML ──────────────────
const MATH_SYMBOLS = {
  // Greek lowercase
  '\\alpha':'α','\\beta':'β','\\gamma':'γ','\\delta':'δ','\\epsilon':'ε',
  '\\varepsilon':'ε','\\zeta':'ζ','\\eta':'η','\\theta':'θ','\\vartheta':'ϑ',
  '\\iota':'ι','\\kappa':'κ','\\lambda':'λ','\\mu':'μ','\\nu':'ν','\\xi':'ξ',
  '\\pi':'π','\\varpi':'ϖ','\\rho':'ρ','\\varrho':'ϱ','\\sigma':'σ',
  '\\varsigma':'ς','\\tau':'τ','\\upsilon':'υ','\\phi':'φ','\\varphi':'φ',
  '\\chi':'χ','\\psi':'ψ','\\omega':'ω',
  // Greek uppercase
  '\\Gamma':'Γ','\\Delta':'Δ','\\Theta':'Θ','\\Lambda':'Λ','\\Xi':'Ξ',
  '\\Pi':'Π','\\Sigma':'Σ','\\Upsilon':'Υ','\\Phi':'Φ','\\Psi':'Ψ','\\Omega':'Ω',
  // Set theory
  '\\cup':'∪','\\cap':'∩','\\in':'∈','\\notin':'∉','\\ni':'∋',
  '\\subset':'⊂','\\subseteq':'⊆','\\supset':'⊃','\\supseteq':'⊇',
  '\\emptyset':'∅','\\varnothing':'∅','\\setminus':'∖','\\complement':'∁',
  // Relations
  '\\leq':'≤','\\geq':'≥','\\neq':'≠','\\approx':'≈','\\equiv':'≡',
  '\\sim':'∼','\\simeq':'≃','\\cong':'≅','\\ll':'≪','\\gg':'≫','\\propto':'∝',
  // Arrows
  '\\rightarrow':'→','\\leftarrow':'←','\\Rightarrow':'⇒','\\Leftarrow':'⇐',
  '\\leftrightarrow':'↔','\\Leftrightarrow':'⟺','\\to':'→','\\gets':'←',
  '\\uparrow':'↑','\\downarrow':'↓','\\mapsto':'↦',
  // Logic
  '\\forall':'∀','\\exists':'∃','\\nexists':'∄','\\neg':'¬','\\lnot':'¬',
  '\\land':'∧','\\wedge':'∧','\\lor':'∨','\\vee':'∨',
  '\\top':'⊤','\\bot':'⊥','\\vdash':'⊢','\\models':'⊨',
  // Operators
  '\\cdot':'·','\\times':'×','\\div':'÷','\\pm':'±','\\mp':'∓',
  '\\oplus':'⊕','\\otimes':'⊗','\\circ':'∘','\\bullet':'•',
  // Misc math
  '\\infty':'∞','\\partial':'∂','\\nabla':'∇','\\sqrt':'√',
  '\\ldots':'…','\\cdots':'⋯','\\vdots':'⋮','\\ddots':'⋱',
  '\\langle':'⟨','\\rangle':'⟩','\\lfloor':'⌊','\\rfloor':'⌋',
  '\\lceil':'⌈','\\rceil':'⌉','\\{':'{','\\}':'}','\\|':'‖',
};

function renderMath(expr) {
  let s = expr;
  // \begin{cases}...\end{cases} → one line per row, processed recursively
  s = s.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_, body) => {
    const lines = body.split(/\\\\/).map(l => renderMath(l.trim())).filter(Boolean);
    return lines.join('<br>');
  });
  // \frac{a}{b} → (a/b)
  s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
  // \text{...} → just the text
  s = s.replace(/\\text\{([^}]*)\}/g, '$1');
  // \mathbf, \mathrm, \mathcal etc. → strip wrapper
  s = s.replace(/\\math\w+\{([^}]*)\}/g, '$1');
  // symbol substitutions
  for (const [cmd, sym] of Object.entries(MATH_SYMBOLS)) {
    s = s.split(cmd).join(sym);
  }
  // superscripts: ^{...} or ^x
  s = s.replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>');
  s = s.replace(/\^([A-Za-z0-9])/g, '<sup>$1</sup>');
  // subscripts: _{...} or _x
  s = s.replace(/_\{([^}]+)\}/g, '<sub>$1</sub>');
  s = s.replace(/_([A-Za-z0-9])/g, '<sub>$1</sub>');
  // strip remaining lone backslashes before letters (unknown commands)
  s = s.replace(/\\([A-Za-z]+)/g, '$1');
  return s;
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

  // 1b. Extract block math $$...$$ → placeholder (before HTML escaping)
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    const i = blocks.length;
    blocks.push(`<div class="math-block">${renderMath(math.trim())}</div>`);
    return `\x00B${i}\x00`;
  });

  // 1c. Extract inline math $...$ → placeholder (before HTML escaping)
  text = text.replace(/\$([^$\n]+?)\$/g, (_, math) => {
    const i = blocks.length;
    blocks.push(`<span class="math-inline">${renderMath(math.trim())}</span>`);
    return `\x00B${i}\x00`;
  });

  // 1d. Handle bare \begin{cases}...\end{cases} (AI sometimes skips $ delimiters)
  text = text.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_, body) => {
    const i = blocks.length;
    const lines = body.split(/\\\\/).map(l => renderMath(l.trim())).filter(Boolean);
    blocks.push(`<div class="math-block">${lines.join('<br>')}</div>`);
    return `\x00B${i}\x00`;
  });

  // 2. Escape remaining HTML
  text = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // 2b. Apply bare LaTeX symbol substitution (AI output outside $...$)
  for (const [cmd, sym] of Object.entries(MATH_SYMBOLS)) {
    text = text.split(cmd).join(sym);
  }
  // Strip remaining bare \command sequences not in the symbol table
  text = text.replace(/\\([A-Za-z]+)/g, '$1');

  // 3. Extract inline code → placeholder (content already escaped)
  text = text.replace(/`([^`\n]+)`/g, (_, c) => {
    const i = blocks.length;
    blocks.push(`<code class="md-code">${c}</code>`);
    return `\x00B${i}\x00`;
  });

  // 4. Headers
  text = text.replace(/^#### (.+)$/gm, '<h4 class="md-h4" dir="auto">$1</h4>');
  text = text.replace(/^### (.+)$/gm,  '<h3 class="md-h3" dir="auto">$1</h3>');
  text = text.replace(/^## (.+)$/gm,   '<h2 class="md-h2" dir="auto">$1</h2>');
  text = text.replace(/^# (.+)$/gm,    '<h2 class="md-h2" dir="auto">$1</h2>');

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
      out.push(`<li dir="auto">${line.replace(/^[*-] /, '')}</li>`);
    } else if (/^\d+\. /.test(line)) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol class="md-ol">'); inOl = true; }
      out.push(`<li dir="auto">${line.replace(/^\d+\. /, '')}</li>`);
    } else {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
      const t = line.trim();
      if (!t) {
        out.push('<div class="md-gap"></div>');
      } else if (BLOCK_STARTS.some(b => t.startsWith(b))) {
        out.push(t);
      } else {
        out.push(`<p class="md-p" dir="auto">${t}</p>`);
      }
    }
  }
  if (inUl) out.push('</ul>');
  if (inOl) out.push('</ol>');

  // 9. Restore code blocks
  return out.join('').replace(/\x00B(\d+)\x00/g, (_, i) => blocks[+i]);
}
