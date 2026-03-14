import { Settings, Conversations, Messages, Notes } from "./storage.js";
import { analyzeScreenshot, analyzeMulti, analyzeText, transcribeAndSummarize, chat, verifyApiKey, analyzeWithQuestion } from "./groq-client.js";

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
const searchBtn        = document.getElementById("searchBtn");
const searchOverlay    = document.getElementById("searchOverlay");
const searchInput      = document.getElementById("searchInput");
const searchClose      = document.getElementById("searchClose");
const searchResults    = document.getElementById("searchResults");
const searchEmpty      = document.getElementById("searchEmpty");
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

// Attached file state
let attachedFile = null; // { base64, mimeType, name, isImage }

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
  chrome.tabs.create({ url: chrome.runtime.getURL("built/dashboard.html") });
});
chatExpandBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("built/chat.html") });
});

// ── Note search ──────────────────────────────────────────────────────────────
const MODE_ICONS = { summary:"📄", explain:"📖", quiz:"❓", flashcard:"🃏", session:"📚", chat:"💬" };

searchBtn.addEventListener("click", () => openSearch());
searchClose.addEventListener("click", () => closeSearch());
searchOverlay.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSearch(); });

function openSearch() {
  searchOverlay.classList.remove("hidden");
  searchInput.value = "";
  searchInput.focus();
  renderSearchResults([]);
}
function closeSearch() { searchOverlay.classList.add("hidden"); }

let _searchTimer = null;
searchInput.addEventListener("input", () => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(runSearch, 180);
});

async function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { renderSearchResults([]); return; }
  const all = await Notes.list();
  const hits = all.filter((n) =>
    (n.title ?? n.filename).toLowerCase().includes(q) ||
    (n.mode ?? "").toLowerCase().includes(q)
  ).slice(0, 20);
  renderSearchResults(hits, q);
}

function renderSearchResults(notes, q = "") {
  searchResults.innerHTML = "";
  if (notes.length === 0) {
    const p = document.createElement("p");
    p.className = "search-empty";
    p.textContent = q ? "No notes found." : "Type to search notes…";
    searchResults.appendChild(p);
    return;
  }
  for (const note of notes) {
    const icon = MODE_ICONS[note.mode] ?? MODE_ICONS[(note.mode ?? "").replace(/^audio-/, "")] ?? "📄";
    const date = note.modified ?? note.updatedAt ?? note.createdAt;
    const item = document.createElement("div");
    item.className = "search-result-item";
    item.innerHTML = `
      <span class="search-result-icon">${icon}</span>
      <div class="search-result-text">
        <div class="search-result-title">${escapeHtml(note.title ?? note.filename)}</div>
        <div class="search-result-meta">${date ? new Date(date).toLocaleDateString() : ""}</div>
      </div>
      <button class="search-result-open" data-filename="${escapeHtml(note.filename)}">↗ Open</button>
    `;
    item.querySelector(".search-result-open").addEventListener("click", (e) => {
      e.stopPropagation();
      openNoteInDashboard(note.filename);
    });
    searchResults.appendChild(item);
  }
}

async function openNoteInDashboard(filename) {
  await chrome.storage.local.set({ pendingOpenNote: filename });
  chrome.tabs.create({ url: chrome.runtime.getURL("built/dashboard.html") });
  closeSearch();
}

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

// ── Conversation → note mapping (persisted so captures group per tab) ────────
let conversationNoteMap = {}; // { [conversationId]: filename }

async function loadConvNoteMap() {
  const result = await chrome.storage.local.get("convNoteMap");
  conversationNoteMap = result.convNoteMap ?? {};
}

async function saveConvNoteMap() {
  await chrome.storage.local.set({ convNoteMap: conversationNoteMap });
}

function broadcastNotesUpdate() {
  try { new BroadcastChannel("lookup-data").postMessage({ type: "notes-updated" }); } catch {}
}

// ── Note saving helper ────────────────────────────────────────────────────────
// All captures in the same conversation tab are appended to the same note file.
async function saveNote({ title, mode, markdown, cards = null }) {
  // Store flashcard JSON directly so the dashboard can render flip cards properly
  const storedContent = cards && Array.isArray(cards) ? JSON.stringify(cards) : markdown;
  let existingFilename = conversationNoteMap[activeConversationId];

  // Self-heal: if map entry is missing (e.g. storage was cleared), recover from IndexedDB
  if (!existingFilename && activeConversationId) {
    const allNotes = await Notes.list();
    const match = allNotes.find((n) => n.conversation_id === activeConversationId);
    if (match) {
      existingFilename = match.filename;
      conversationNoteMap[activeConversationId] = existingFilename;
      await saveConvNoteMap();
    }
  }

  if (existingFilename) {
    const existing = await Notes.get(existingFilename);
    if (existing) {
      const newContent = existing.content + `\n\n---\n\n### ${title}\n\n` + storedContent;
      const mergedCards = cards && Array.isArray(cards)
        ? [...(existing.cards ?? []), ...cards]
        : existing.cards ?? null;
      await Notes.save(existingFilename, { ...existing }, newContent, mergedCards);
      broadcastNotesUpdate();
      return { filename: existingFilename, title: existing.title };
    }
  }

  // Create a fresh note and record it for this conversation
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = (title || mode).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const filename = `${ts}_${slug}.md`;
  await Notes.save(filename, { title: title ?? mode, mode, createdAt: Date.now(), conversation_id: activeConversationId }, storedContent, cards);
  conversationNoteMap[activeConversationId] = filename;
  await saveConvNoteMap();
  broadcastNotesUpdate();
  return { filename, title: title ?? mode };
}

// ── Shared chat send logic ────────────────────────────────────────────────────
async function sendChatMessage() {
  const message = titleInput.value.trim();
  if (!message && !attachedFile) { captureBtn.click(); return; }

  titleInput.disabled = true;
  chatSendBtn.disabled = true;
  const attachBtn = document.getElementById("attachBtn");
  if (attachBtn) attachBtn.disabled = true;

  // Build user bubble (show attachment thumbnail if present)
  const localAttached = attachedFile;
  let userBubbleHtml = "";
  if (localAttached?.isImage) {
    userBubbleHtml += `<img src="data:${localAttached.mimeType};base64,${localAttached.base64}" class="msg-attachment-thumb" alt="${escapeHtml(localAttached.name)}" />`;
  } else if (localAttached) {
    userBubbleHtml += `<div class="msg-attachment-file">📎 ${escapeHtml(localAttached.name)}</div>`;
  }
  if (message) userBubbleHtml += `<div>${escapeHtml(message)}</div>`;
  appendCard(`<div class="msg-user">${userBubbleHtml}</div>`);

  titleInput.value = "";
  clearAttachment();
  showSpinner("Thinking…");

  try {
    const history = await Messages.listByConversation(activeConversationId);
    let reply;

    if (localAttached?.isImage) {
      // User attached an image — use vision model with that image
      reply = await analyzeWithQuestion(localAttached.base64, localAttached.mimeType, message || "Describe and analyze this image.");
    } else {
      // Always capture current tab as visual context; fall back to text-only if tab can't be captured
      try {
        const { base64, mimeType } = await captureTab();
        reply = await analyzeWithQuestion(base64, mimeType, message);
      } catch {
        const msgs = [...history.map(m => ({ role: m.role, content: m.content })), { role: "user", content: message }];
        reply = await chat(msgs);
      }
    }

    await Messages.append(activeConversationId, "user", message);
    await Messages.append(activeConversationId, "assistant", reply);

    if (history.length === 0) {
      await Conversations.rename(activeConversationId, message.slice(0, 60));
    }

    const isQuiz = reply.includes("**Answer:**");
    appendCard(`
      <div class="result-card">
        ${isQuiz ? renderQuiz(reply) : `<div class="md-body">${renderMarkdown(reply)}</div>`}
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
    loadConversations();
  } catch (err) { showError(err.message); }
  titleInput.disabled = false;
  chatSendBtn.disabled = false;
  if (attachBtn) attachBtn.disabled = false;
}

// ── Attachment helpers ────────────────────────────────────────────────────────
function clearAttachment() {
  attachedFile = null;
  const preview = document.getElementById("attachPreview");
  if (preview) { preview.innerHTML = ""; preview.style.display = "none"; }
}

function handleFileAttach(file) {
  if (!file) return;
  const isImage = file.type.startsWith("image/");
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const base64 = dataUrl.split(",")[1];
    attachedFile = { base64, mimeType: file.type, name: file.name, isImage };

    const preview = document.getElementById("attachPreview");
    if (!preview) return;
    if (isImage) {
      preview.innerHTML = `
        <div class="attach-chip">
          <img src="${dataUrl}" class="attach-chip-thumb" alt="" />
          <span class="attach-chip-name">${escapeHtml(file.name)}</span>
          <button class="attach-chip-remove" id="attachRemove">✕</button>
        </div>`;
    } else {
      preview.innerHTML = `
        <div class="attach-chip">
          <span class="attach-chip-icon">📎</span>
          <span class="attach-chip-name">${escapeHtml(file.name)}</span>
          <button class="attach-chip-remove" id="attachRemove">✕</button>
        </div>`;
    }
    preview.style.display = "flex";
    document.getElementById("attachRemove")?.addEventListener("click", clearAttachment);
  };
  reader.readAsDataURL(file);
}

titleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); sendChatMessage(); }
});

chatSendBtn.addEventListener("click", sendChatMessage);

// ── Attach button ─────────────────────────────────────────────────────────────
const attachBtn      = document.getElementById("attachBtn");
const attachFileInput = document.getElementById("attachFileInput");

attachBtn.addEventListener("click", () => attachFileInput.click());
attachFileInput.addEventListener("change", () => {
  const file = attachFileInput.files?.[0];
  if (file) handleFileAttach(file);
  attachFileInput.value = "";
});

// ── Drag-and-drop image onto input bar ────────────────────────────────────────
const chatInputBar = document.querySelector(".chat-input-bar");

chatInputBar.addEventListener("dragover", (e) => {
  e.preventDefault();
  chatInputBar.classList.add("drag-over");
});
chatInputBar.addEventListener("dragleave", (e) => {
  if (!chatInputBar.contains(e.relatedTarget)) chatInputBar.classList.remove("drag-over");
});
chatInputBar.addEventListener("drop", (e) => {
  e.preventDefault();
  chatInputBar.classList.remove("drag-over");
  const file = e.dataTransfer.files?.[0];
  if (file) handleFileAttach(file);
});

// ── Paste image from clipboard ────────────────────────────────────────────────
document.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith("image/"));
  if (!item) return;
  const file = item.getAsFile();
  if (file) handleFileAttach(file);
});


// ── Setup overlay ─────────────────────────────────────────────────────────────
const setupOverlay  = document.getElementById("setupOverlay");
const setupKeyInput = document.getElementById("setupKeyInput");
const setupSaveBtn  = document.getElementById("setupSaveBtn");
const setupError    = document.getElementById("setupError");
const groqLink      = document.getElementById("groqLink");

// Open the Groq keys page in a new tab (links don't work directly in sidepanel)
groqLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "https://console.groq.com/keys" });
});

setupSaveBtn.addEventListener("click", async () => {
  const key = setupKeyInput.value.trim();
  if (!key) { setupError.textContent = "Please paste your API key first."; return; }

  setupSaveBtn.disabled = true;
  setupSaveBtn.textContent = "Verifying…";
  setupError.textContent = "";

  const { ok, error } = await verifyApiKey(key);
  if (!ok) {
    setupError.textContent = error ?? "Invalid key — please check and try again.";
    setupSaveBtn.disabled = false;
    setupSaveBtn.textContent = "Verify & Save →";
    return;
  }

  await Settings.setApiKey(key);
  setupOverlay.classList.add("hidden");
  statusDot.classList.add("online");
  await loadActiveConversation();
});

// Show overlay if not configured, otherwise boot normally
async function initSetup() {
  const configured = await Settings.isConfigured();
  if (configured) {
    setupOverlay.classList.add("hidden");
    await loadActiveConversation();
  }
  // If not configured, overlay stays visible — loadActiveConversation runs after save
}
initSetup();

// ── API key status indicator ──────────────────────────────────────────────────
async function checkStatus() {
  const configured = await Settings.isConfigured();
  statusDot.classList.toggle("online", configured);
}
checkStatus();
setInterval(checkStatus, 10_000);

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
        await Conversations.reorder(conversations.map(c => c.id));
      }
    });
    tab.dataset.id = String(conv.id);

    convTabs.insertBefore(tab, newConvBtn);
  }
  updateTabArrows();
}

async function loadConversations() {
  try {
    conversations = await Conversations.list();
    renderConvTabs();
  } catch (err) { console.error(err); }
}

const PLACEHOLDER_HTML = `<p class="placeholder">Choose a mode, then hit <strong>⚡ Capture</strong>.<br>Or select text on any page to <strong>Ask</strong> about it.</p>`;

async function switchConversation(id) {
  // Save current tab's content before leaving
  if (activeConversationId !== null) {
    tabResults.set(activeConversationId, resultArea.innerHTML);
  }
  activeConversationId = id;
  await Conversations.setActive(id);

  const cached = tabResults.get(id);
  if (cached !== undefined) {
    resultArea.innerHTML = cached;
    reattachResultListeners();
  } else {
    try {
      const messages = await Messages.listByConversation(id);
      if (messages.length > 0) {
        renderAllMessages(messages);
      } else {
        resultArea.innerHTML = PLACEHOLDER_HTML;
      }
    } catch (err) { console.error(err); }
  }
  renderConvTabs();
}

async function deleteConvTab(id) {
  try {
    await Conversations.delete(id);
    tabResults.delete(id);
    delete conversationNoteMap[id];
    await saveConvNoteMap();
    conversations = conversations.filter(c => c.id !== id);
    if (activeConversationId === id) {
      if (conversations.length > 0) {
        await switchConversation(conversations[0].id);
      } else {
        const conv = await Conversations.create();
        activeConversationId = conv.id;
        await Conversations.setActive(conv.id);
        resultArea.innerHTML = PLACEHOLDER_HTML;
        await loadConversations();
      }
    } else {
      renderConvTabs();
    }
  } catch (err) { console.error(err); }
}

async function mergeConvTabs(targetId, sourceId) {
  try {
    await Conversations.merge(targetId, sourceId);
    tabResults.delete(sourceId);
    tabResults.delete(targetId); // force re-fetch
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
    await Conversations.rename(id, title);
    const noteFilename = conversationNoteMap[id];
    if (noteFilename) {
      try { await Notes.updateMeta(noteFilename, { title }); } catch {}
    }
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
        if (Array.isArray(p) && p[0]?.front !== undefined) cards = p;
      } catch {}
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
    const conv = await Conversations.create();
    activeConversationId = conv.id;
    await Conversations.setActive(conv.id);
    resultArea.innerHTML = PLACEHOLDER_HTML;
    await loadConversations();
  } catch (err) { console.error(err); }
});

// ── Restore conversation on open ─────────────────────────────────────────────
async function loadActiveConversation() {
  await loadConvNoteMap();
  try {
    // Ensure at least one conversation exists
    let conv = await Conversations.getActive();
    if (!conv) {
      const all = await Conversations.list();
      conv = all.length > 0 ? all[0] : await Conversations.create();
      await Conversations.setActive(conv.id);
    }
    activeConversationId = conv.id;
    await loadConversations();
    const messages = await Messages.listByConversation(conv.id);
    if (messages.length > 0) renderAllMessages(messages);
  } catch (err) { console.error(err); }
}

// ── Tab capture helper ──────────────────────────────────────────────────────
async function captureTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.windowId) throw new Error("No active tab found.");
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return { base64: dataUrl.replace(/^data:image\/png;base64,/, ""), mimeType: "image/png" };
}

// ── Main capture button ─────────────────────────────────────────────────────
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

    const raw = await analyzeScreenshot(base64, mimeType, selectedMode);
    const noteTitle = titleInput.value.trim() || selectedMode;

    let markdown = raw;
    let cards = null;

    if (selectedMode === "flashcard") {
      try {
        const jsonStr = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
        cards = JSON.parse(jsonStr);
      } catch {
        cards = [{ front: "Parse error", back: raw }];
      }
      markdown = cards.map((c, i) => `**Q${i + 1}:** ${c.front}\n**A:** ${c.back}`).join("\n\n");
    }

    const saved = await saveNote({ title: noteTitle, mode: selectedMode, markdown, cards });

    // Append to conversation
    await Messages.append(activeConversationId, "user", `📸 Screenshot (${selectedMode})`);
    await Messages.append(activeConversationId, "assistant", selectedMode === "flashcard" ? JSON.stringify(cards) : markdown);

    if (cards) {
      showFlashcards(cards, saved.title, selectedMode, saved.filename);
    } else {
      showResult(markdown, saved.title, selectedMode, saved.filename);
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
    const raw = await analyzeText(selectedText, selectedMode);
    const noteTitle = titleInput.value.trim() || "Selected text";

    let markdown = raw;
    let cards = null;

    if (selectedMode === "flashcard") {
      try {
        const jsonStr = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
        cards = JSON.parse(jsonStr);
      } catch {
        cards = [{ front: "Parse error", back: raw }];
      }
      markdown = cards.map((c, i) => `**Q${i + 1}:** ${c.front}\n**A:** ${c.back}`).join("\n\n");
    }

    const saved = await saveNote({ title: noteTitle, mode: selectedMode, markdown, cards });

    await Messages.append(activeConversationId, "user", `📝 Selected text (${selectedMode})`);
    await Messages.append(activeConversationId, "assistant", cards ? JSON.stringify(cards) : markdown);

    if (cards) {
      showFlashcards(cards, saved.title, selectedMode, saved.filename);
    } else {
      showResult(markdown, saved.title, selectedMode, saved.filename);
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
    const raw = await analyzeMulti(sessionFrames, selectedMode);
    const noteTitle = titleInput.value.trim() || `Multi (${sessionFrames.length} pages)`;

    let markdown = raw;
    let cards = null;

    if (selectedMode === "flashcard") {
      try {
        const jsonStr = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
        cards = JSON.parse(jsonStr);
      } catch {
        cards = [{ front: "Parse error", back: raw }];
      }
      markdown = cards.map((c, i) => `**Q${i + 1}:** ${c.front}\n**A:** ${c.back}`).join("\n\n");
    }

    const saved = await saveNote({ title: noteTitle, mode: selectedMode, markdown, cards });

    await Messages.append(activeConversationId, "user", `📸 ${sessionFrames.length} pages (${selectedMode})`);
    await Messages.append(activeConversationId, "assistant", cards ? JSON.stringify(cards) : markdown);

    if (cards) {
      showFlashcards(cards, saved.title, selectedMode, saved.filename);
    } else {
      showResult(markdown, saved.title, selectedMode, saved.filename);
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
    const { transcript, markdown } = await transcribeAndSummarize(blob, selectedMode);
    const noteTitle = titleInput.value.trim() || "Audio recording";
    const audioMode = `audio-${selectedMode}`;

    let cards = null;
    let finalMarkdown = markdown;

    if (selectedMode === "flashcard") {
      try { cards = JSON.parse(markdown); } catch { cards = [{ front: "Parse error", back: markdown }]; }
      finalMarkdown = cards.map((c, i) => `**Q${i + 1}:** ${c.front}\n**A:** ${c.back}`).join("\n\n");
    }

    const saved = await saveNote({ title: noteTitle, mode: audioMode, markdown: finalMarkdown, cards });

    await Messages.append(activeConversationId, "user", `🎙️ Audio recording (${selectedMode})`);
    await Messages.append(activeConversationId, "assistant", cards ? JSON.stringify(cards) : finalMarkdown);

    if (cards) {
      showFlashcards(cards, saved.title, audioMode, saved.filename);
    } else {
      showResult(finalMarkdown, saved.title, audioMode, saved.filename);
    }
  } catch (err) { showError(err.message); }
  mediaRecorder = null;
  captureBtn.disabled = false;
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
  div.innerHTML = `<span></span><span></span><span></span>`;
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

function showResult(markdown, title, mode, filename) {
  const bodyHtml = (mode === "quiz")
    ? renderQuiz(markdown)
    : `<div class="md-body">${renderMarkdown(markdown)}</div>`;
  const dashLink = filename ? `<div class="open-dash-row"><button class="open-dash-btn" data-filename="${escapeHtml(filename)}">↗ View in Dashboard</button></div>` : "";

  appendCard(`
    <div class="result-card">
      ${resultHeadline(mode, title)}
      ${bodyHtml}
      ${dashLink}
    </div>`,
    () => {
      if (mode === "quiz") {
        resultArea.querySelectorAll(".quiz-reveal-btn:not([data-bound])").forEach((btn) => {
          btn.dataset.bound = "1";
          btn.addEventListener("click", () => {
            const el2 = document.getElementById(btn.dataset.answerId);
            if (!el2) return;
            const hidden = el2.style.display === "none";
            el2.style.display = hidden ? "block" : "none";
            btn.textContent = hidden ? "▼ Hide Answer" : "▶ Show Answer";
          });
        });
      }
      if (filename) bindDashBtn(filename);
    }
  );
}

function showFlashcards(cards, title, mode = "flashcard", filename) {
  const prefix = `fc${++_uid}_`;
  const grid = cards.map((card, i) => `
    <div class="flashcard" id="${prefix}${i}">
      <div class="flashcard-inner">
        <div class="flashcard-front">${renderMarkdown(card.front)}</div>
        <div class="flashcard-back">${renderMarkdown(card.back)}</div>
      </div>
    </div>
  `).join("");
  const dashLink = filename ? `<div class="open-dash-row"><button class="open-dash-btn" data-filename="${escapeHtml(filename)}">↗ View in Dashboard</button></div>` : "";

  appendCard(`
    <div class="result-card" style="background:transparent;border:none;padding:0">
      ${resultHeadline(mode, title)}
      <div class="flashcard-grid">${grid}</div>
      ${dashLink}
    </div>`,
    () => {
      cards.forEach((_, i) => {
        document.getElementById(`${prefix}${i}`)?.addEventListener("click", function () {
          this.classList.toggle("flipped");
        });
      });
      if (filename) bindDashBtn(filename);
    }
  );
}

function showError(msg) {
  document.getElementById(SPINNER_ID)?.remove();
  appendCard(`<div class="error-card"><strong>Error:</strong> ${escapeHtml(msg)}</div>`);
}

function bindDashBtn(filename) {
  resultArea.querySelectorAll(`.open-dash-btn[data-filename="${CSS.escape(filename)}"]:not([data-bound])`).forEach((btn) => {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("built/dashboard.html") });
    });
  });
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Quiz renderer — shows questions with hidden answers ──────────────────────
function renderQuiz(markdown) {
  let blocks = markdown.split(/\n[ \t]*---[ \t]*\n/);

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

// ── Math renderer ────────────────────────────────────────────────────────────
const MATH_SYMBOLS = {
  '\\alpha':'α','\\beta':'β','\\gamma':'γ','\\delta':'δ','\\epsilon':'ε',
  '\\varepsilon':'ε','\\zeta':'ζ','\\eta':'η','\\theta':'θ','\\vartheta':'ϑ',
  '\\iota':'ι','\\kappa':'κ','\\lambda':'λ','\\mu':'μ','\\nu':'ν','\\xi':'ξ',
  '\\pi':'π','\\varpi':'ϖ','\\rho':'ρ','\\varrho':'ϱ','\\sigma':'σ',
  '\\varsigma':'ς','\\tau':'τ','\\upsilon':'υ','\\phi':'φ','\\varphi':'φ',
  '\\chi':'χ','\\psi':'ψ','\\omega':'ω',
  '\\Gamma':'Γ','\\Delta':'Δ','\\Theta':'Θ','\\Lambda':'Λ','\\Xi':'Ξ',
  '\\Pi':'Π','\\Sigma':'Σ','\\Upsilon':'Υ','\\Phi':'Φ','\\Psi':'Ψ','\\Omega':'Ω',
  '\\cup':'∪','\\cap':'∩','\\in':'∈','\\notin':'∉','\\ni':'∋',
  '\\subset':'⊂','\\subseteq':'⊆','\\supset':'⊃','\\supseteq':'⊇',
  '\\emptyset':'∅','\\varnothing':'∅','\\setminus':'∖','\\complement':'∁',
  '\\leq':'≤','\\geq':'≥','\\neq':'≠','\\approx':'≈','\\equiv':'≡',
  '\\sim':'∼','\\simeq':'≃','\\cong':'≅','\\ll':'≪','\\gg':'≫','\\propto':'∝',
  '\\rightarrow':'→','\\leftarrow':'←','\\Rightarrow':'⇒','\\Leftarrow':'⇐',
  '\\leftrightarrow':'↔','\\Leftrightarrow':'⟺','\\to':'→','\\gets':'←',
  '\\uparrow':'↑','\\downarrow':'↓','\\mapsto':'↦',
  '\\forall':'∀','\\exists':'∃','\\nexists':'∄','\\neg':'¬','\\lnot':'¬',
  '\\land':'∧','\\wedge':'∧','\\lor':'∨','\\vee':'∨',
  '\\top':'⊤','\\bot':'⊥','\\vdash':'⊢','\\models':'⊨',
  '\\cdot':'·','\\times':'×','\\div':'÷','\\pm':'±','\\mp':'∓',
  '\\oplus':'⊕','\\otimes':'⊗','\\circ':'∘','\\bullet':'•',
  '\\infty':'∞','\\partial':'∂','\\nabla':'∇','\\sqrt':'√',
  '\\ldots':'…','\\cdots':'⋯','\\vdots':'⋮','\\ddots':'⋱',
  '\\langle':'⟨','\\rangle':'⟩','\\lfloor':'⌊','\\rfloor':'⌋',
  '\\lceil':'⌈','\\rceil':'⌉','\\{':'{','\\}':'}','\\|':'‖',
};

function renderMath(expr) {
  let s = expr;
  s = s.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_, body) => {
    const lines = body.split(/\\\\/).map(l => renderMath(l.trim())).filter(Boolean);
    return lines.join('<br>');
  });
  s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
  s = s.replace(/\\text\{([^}]*)\}/g, '$1');
  s = s.replace(/\\math\w+\{([^}]*)\}/g, '$1');
  for (const [cmd, sym] of Object.entries(MATH_SYMBOLS)) {
    s = s.split(cmd).join(sym);
  }
  s = s.replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>');
  s = s.replace(/\^([A-Za-z0-9])/g, '<sup>$1</sup>');
  s = s.replace(/_\{([^}]+)\}/g, '<sub>$1</sub>');
  s = s.replace(/_([A-Za-z0-9])/g, '<sub>$1</sub>');
  s = s.replace(/\\([A-Za-z]+)/g, '$1');
  return s;
}

// ── Markdown renderer ────────────────────────────────────────────────────────
function renderMarkdown(raw) {
  const blocks = [];

  let text = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    const i = blocks.length;
    const escaped = code.trim()
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    blocks.push(`<pre class="md-pre"><code>${escaped}</code></pre>`);
    return `\x00B${i}\x00`;
  });

  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    const i = blocks.length;
    blocks.push(`<div class="math-block">${renderMath(math.trim())}</div>`);
    return `\x00B${i}\x00`;
  });

  text = text.replace(/\$([^$\n]+?)\$/g, (_, math) => {
    const i = blocks.length;
    blocks.push(`<span class="math-inline">${renderMath(math.trim())}</span>`);
    return `\x00B${i}\x00`;
  });

  text = text.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_, body) => {
    const i = blocks.length;
    const lines = body.split(/\\\\/).map(l => renderMath(l.trim())).filter(Boolean);
    blocks.push(`<div class="math-block">${lines.join('<br>')}</div>`);
    return `\x00B${i}\x00`;
  });

  text = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  for (const [cmd, sym] of Object.entries(MATH_SYMBOLS)) {
    text = text.split(cmd).join(sym);
  }
  text = text.replace(/\\([A-Za-z]+)/g, '$1');

  text = text.replace(/`([^`\n]+)`/g, (_, c) => {
    const i = blocks.length;
    blocks.push(`<code class="md-code">${c}</code>`);
    return `\x00B${i}\x00`;
  });

  text = text.replace(/^#### (.+)$/gm, '<h4 class="md-h4" dir="auto">$1</h4>');
  text = text.replace(/^### (.+)$/gm,  '<h3 class="md-h3" dir="auto">$1</h3>');
  text = text.replace(/^## (.+)$/gm,   '<h2 class="md-h2" dir="auto">$1</h2>');
  text = text.replace(/^# (.+)$/gm,    '<h2 class="md-h2" dir="auto">$1</h2>');

  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g,     '<em>$1</em>');
  text = text.replace(/__(.+?)__/g,     '<strong>$1</strong>');
  text = text.replace(/_(.+?)_/g,       '<em>$1</em>');

  text = text.replace(/^---+$/gm, '<hr class="md-hr">');
  text = text.replace(/^&gt; (.+)$/gm, '<blockquote class="md-bq">$1</blockquote>');

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

  return out.join('').replace(/\x00B(\d+)\x00/g, (_, i) => blocks[+i]);
}
