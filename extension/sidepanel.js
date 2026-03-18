import { Settings, Conversations, Messages, Notes, TokenUsage } from "./storage.js";
import { analyzeScreenshot, analyzeMulti, analyzeText, transcribeAndSummarize, chatStream, verifyApiKey, analyzeWithQuestionStream, setResponseLanguage } from "./groq-client.js";

// --- DOM refs ---
const convTabs         = document.getElementById("convTabs");
const newConvBtn       = document.getElementById("newConvBtn");
const captureBtn       = document.getElementById("captureBtn");
const sessionBar       = document.getElementById("sessionBar");
const sessionCount     = document.getElementById("sessionCount");
const sessionFinish    = document.getElementById("sessionFinish");
const sessionCancel    = document.getElementById("sessionCancel");
const audioBar         = document.getElementById("audioBar");
const stopAudio        = document.getElementById("stopAudio");
const audioInputToggle = document.getElementById("audioInputToggle");
const aitChat          = document.getElementById("aitChat");
const aitInstructions  = document.getElementById("aitInstructions");
const aitHint          = document.getElementById("aitHint");
const recTimer         = document.getElementById("recTimer");
const resultArea       = document.getElementById("resultArea");
const statusDot        = document.getElementById("statusDot");
const titleInput       = document.getElementById("titleInput");
const modeTrigger      = document.getElementById("modeTrigger");
const modeDropdown     = document.getElementById("modeDropdown");
const modeLabel        = document.getElementById("modeLabel");
const dropdownItems    = document.querySelectorAll(".dropdown-item");
// (dashboardBtn and searchBtn now live inside the more-dropdown — handled below)
const searchInput      = document.getElementById("searchInput");
const searchResults    = document.getElementById("searchResults");
const selectionBar     = document.getElementById("selectionBar");
const selectionPreview = document.getElementById("selectionPreview");
const askBtn           = document.getElementById("askBtn");
const selectionDismiss = document.getElementById("selectionDismiss");
const chatSendBtn      = document.getElementById("chatSendBtn");
const addPageBtn       = document.getElementById("addPageBtn");
const avToggleRow      = document.getElementById("avToggleRow");
const avOptAudio       = document.getElementById("avOptAudio");
const avOptMic         = document.getElementById("avOptMic");
const moreBtn          = document.getElementById("moreBtn");
const moreDropdown     = document.getElementById("moreDropdown");
const infoBtn          = document.getElementById("infoBtn");
const infoDropdown     = document.getElementById("infoDropdown");
const winSubMenu       = document.getElementById("winSubMenu");
const winCurrentLabel  = document.getElementById("winCurrentLabel");
const moreWinItem      = document.getElementById("moreWinItem");
const noteCtxMenu      = document.getElementById("noteCtxMenu");
const ctxOpenSide      = document.getElementById("ctxOpenSide");
const ctxOpenChat      = document.getElementById("ctxOpenChat");
const ctxRename        = document.getElementById("ctxRename");
const ctxDelete        = document.getElementById("ctxDelete");

const moreDashboard    = document.getElementById("moreDashboard");
const moreChatBtn      = document.getElementById("moreChatBtn");
const moreMultiBtn     = document.getElementById("moreMultiBtn");
const langOptEN        = document.getElementById("langOptEN");
const langOptHE        = document.getElementById("langOptHE");
const micPermBanner    = document.getElementById("micPermBanner");
const micPermGrantBtn  = document.getElementById("micPermGrantBtn");
const micPermDismiss   = document.getElementById("micPermDismiss");

// --- State ---
let selectedMode        = "summary";
let audioInputMode      = "chat"; // "chat" | "instructions"
let _pendingAudioNote   = "";    // snapshotted at stop-click so DOM changes can't lose it

let selectedText        = "";
let sessionFrames       = [];
let inSession           = false;
let targetWindowId      = null; // null = sidepanel's own window (default)
let timerInterval       = null;
let recSeconds          = 0;
let activeConversationId = null;
const tabResults        = new Map(); // conversationId → saved resultArea innerHTML
let _uid = 0; // unique ID counter for quiz/flashcard elements
const SPINNER_ID = "inlineSpinner";

// Attached files state — supports multiple images / files
let attachedFiles = []; // [{ base64, mimeType, name, isImage }, ...]

// Screenshot cache — reuse within 20s for follow-up screen references to save image tokens
let _cachedScreenshot = null;
let _cacheTs = 0;
const SCREENSHOT_CACHE_TTL = 20_000;

// ── Tab drag state ────────────────────────────────────────────────────────────
let dragConvId     = null;
let mergeTimer     = null;

function clearDropIndicators() {
  convTabs.querySelectorAll(".tab-drop-before,.tab-drop-after,.tab-drop-merge")
    .forEach(t => t.classList.remove("tab-drop-before","tab-drop-after","tab-drop-merge"));
}
function clearMergeTimer() {
  if (mergeTimer) { clearTimeout(mergeTimer); mergeTimer = null; }
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

// ── Language toggle ───────────────────────────────────────────────────────────
let _lang = "en";

async function initLang() {
  const prefs = await Settings.getPreferences();
  _lang = prefs.language ?? "en";
  applyLang();
}

function applyLang() {
  setResponseLanguage(_lang);
  langOptEN.classList.toggle("active", _lang === "en");
  langOptHE.classList.toggle("active", _lang === "he");
}

// ── More-options dropdown ─────────────────────────────────────────────────────
const DAILY_TOKEN_LIMIT = 500_000;

// Live countdown interval handle — started when the info dropdown opens, cleared on close.
let _usageCountdownInterval = null;

function _updateResetHint() {
  const usageResetHint = document.getElementById("usageResetHint");
  if (!usageResetHint) return;
  const now = new Date();
  const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
  const hh = Math.floor(msUntilMidnight / 3600000);
  const mm = Math.floor((msUntilMidnight % 3600000) / 60000);
  usageResetHint.textContent = `Resets in ${hh}h ${mm}m`;
}

function _stopUsageCountdown() {
  if (_usageCountdownInterval !== null) {
    clearInterval(_usageCountdownInterval);
    _usageCountdownInterval = null;
  }
}

document.getElementById("usageWidget")?.addEventListener("click", (e) => {
  // Don't flip if clicking the Groq upgrade link
  if (e.target.closest("a")) return;
  document.getElementById("usageWidget").classList.toggle("flipped");
});

async function refreshUsageDisplay() {
  const usageCount   = document.getElementById("usageCount");
  const usageBarFill = document.getElementById("usageBarFill");
  const usageUpgrade = document.getElementById("usageUpgrade");
  if (!usageCount) return;

  const { tokens } = await TokenUsage.get();
  const pct = Math.min(tokens / DAILY_TOKEN_LIMIT, 1);

  usageCount.textContent = tokens >= 1000
    ? `${(tokens / 1000).toFixed(1)}k / 500k`
    : `${tokens} / 500,000`;

  usageBarFill.style.width = (pct * 100).toFixed(1) + "%";
  usageBarFill.classList.toggle("warn", pct >= 0.7 && pct < 0.9);
  usageBarFill.classList.toggle("crit", pct >= 0.9);

  usageUpgrade.style.display = pct >= 0.85 ? "block" : "none";

  // Update reset hint immediately, then start live 1-minute countdown.
  _updateResetHint();
}

moreBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  _stopUsageCountdown();
  infoDropdown.classList.remove("open");
  infoBtn.classList.remove("open");
  const open = moreDropdown.classList.toggle("open");
  moreBtn.classList.toggle("open", open);
  if (open) refreshWindowPicker();
});
infoBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  moreDropdown.classList.remove("open");
  moreBtn.classList.remove("open");
  winSubMenu.classList.remove("open");
  moreWinItem.classList.remove("expanded");
  searchInput.value = "";
  renderSearchResults([]);
  const open = infoDropdown.classList.toggle("open");
  infoBtn.classList.toggle("open", open);
  if (open) {
    refreshUsageDisplay();
    // Tick every 60s so the countdown stays accurate while the dropdown is open.
    _stopUsageCountdown();
    _usageCountdownInterval = setInterval(_updateResetHint, 60_000);
  } else {
    _stopUsageCountdown();
  }
});
document.addEventListener("click", () => {
  _stopUsageCountdown();
  moreDropdown.classList.remove("open");
  moreBtn.classList.remove("open");
  infoDropdown.classList.remove("open");
  infoBtn.classList.remove("open");
  winSubMenu.classList.remove("open");
  moreWinItem.classList.remove("expanded");
  // Clear inline search when dropdown closes
  searchInput.value = "";
  renderSearchResults([]);
});
moreDropdown.addEventListener("click", (e) => e.stopPropagation());
infoDropdown.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("keydown", (e) => {
  // Shift+S — trigger capture (only when input is not focused)
  if (e.shiftKey && e.key === "S" && !captureBtn.disabled && !audioBar?.classList.contains("active") &&
      document.activeElement !== titleInput) {
    e.preventDefault();
    captureBtn.click();
  }
  if (e.key === "Escape" && moreDropdown.classList.contains("open")) {
    moreDropdown.classList.remove("open");
    moreBtn.classList.remove("open");
  }
  if (e.key === "Escape" && infoDropdown.classList.contains("open")) {
    infoDropdown.classList.remove("open");
    infoBtn.classList.remove("open");
    searchInput.value = "";
    renderSearchResults([]);
  }
});

moreDashboard.addEventListener("click", () => {
  moreDropdown.classList.remove("open"); moreBtn.classList.remove("open");
  chrome.tabs.create({ url: chrome.runtime.getURL("built/dashboard.html") });
});
moreChatBtn.addEventListener("click", () => {
  moreDropdown.classList.remove("open"); moreBtn.classList.remove("open");
  chrome.tabs.create({ url: chrome.runtime.getURL("built/chat.html") });
});
document.getElementById("moreFullscreenBtn").addEventListener("click", () => {
  moreDropdown.classList.remove("open"); moreBtn.classList.remove("open");
  chrome.windows.create({
    url: chrome.runtime.getURL("sidepanel.html"),
    type: "popup",
    width: 420,
    height: 800
  });
});

langOptEN.addEventListener("click", async () => {
  if (_lang === "en") return;
  _lang = "en"; applyLang();
  await Settings.setPreferences({ language: _lang });
});
langOptHE.addEventListener("click", async () => {
  if (_lang === "he") return;
  _lang = "he"; applyLang();
  await Settings.setPreferences({ language: _lang });
});

// ── Note search ──────────────────────────────────────────────────────────────
const MODE_ICONS = { summary:"📄", explain:"📖", quiz:"❓", flashcard:"🃏", session:"📚", chat:"💬" };

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
    if (q) {
      const p = document.createElement("p");
      p.className = "more-search-empty";
      p.textContent = "No notes found.";
      searchResults.appendChild(p);
    }
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
    `;
    // Left-click: open in sidepanel
    item.addEventListener("click", () => openNoteInSidepanel(note));
    // Right-click: context menu
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showNoteCtxMenu(e.clientX, e.clientY, note);
    });
    searchResults.appendChild(item);
  }
}

async function openNoteInSidepanel(note) {
  const full = await Notes.get(note.filename);
  if (!full) return;
  moreDropdown.classList.remove("open");
  moreBtn.classList.remove("open");

  // Reuse the note's linked conversation if it still exists; otherwise create one
  let convId = full.conversation_id;
  if (convId) {
    const existing = await Conversations.get(convId).catch(() => null);
    if (!existing) convId = null;
  }
  if (!convId) {
    const conv = await Conversations.create(full.title ?? note.filename);
    convId = conv.id;
    await Notes.updateMeta(note.filename, { conversation_id: convId }).catch(() => {});
  }

  await loadConversations();
  await switchConversation(convId);

  // Persist the note content as a message so the chatpage can show it
  const existingMsgs = await Messages.listByConversation(convId).catch(() => []);
  if (existingMsgs.length === 0 && full.content) {
    await Messages.append(convId, "assistant", full.content).catch(() => {});
  }

  const cards = full.cards ?? (() => { try { return JSON.parse(full.content); } catch { return null; } })();
  if (Array.isArray(cards) && cards[0]?.front !== undefined) {
    showFlashcards(cards, full.title, full.mode);
  } else {
    showResult(full.content, full.title, full.mode);
  }

  // Cache the rendered content so switching away and back restores it
  tabResults.set(convId, resultArea.innerHTML);
}

async function openNoteInDashboard(filename) {
  await chrome.storage.local.set({ pendingOpenNote: filename });
  chrome.tabs.create({ url: chrome.runtime.getURL("built/dashboard.html") });
  moreDropdown.classList.remove("open");
  moreBtn.classList.remove("open");
  searchInput.value = "";
  renderSearchResults([]);
}

// ── Note context menu ────────────────────────────────────────────────────────
let _ctxNote = null;

function showNoteCtxMenu(x, y, note) {
  _ctxNote = note;
  noteCtxMenu.style.display = "block";
  // Keep within viewport
  const menuW = 170, menuH = 130;
  noteCtxMenu.style.left = Math.min(x, window.innerWidth  - menuW) + "px";
  noteCtxMenu.style.top  = Math.min(y, window.innerHeight - menuH) + "px";
}

function hideNoteCtxMenu() {
  noteCtxMenu.style.display = "none";
  _ctxNote = null;
}

ctxOpenSide.addEventListener("click", () => { if (_ctxNote) openNoteInSidepanel(_ctxNote); hideNoteCtxMenu(); });
ctxOpenChat.addEventListener("click", () => { if (_ctxNote) openNoteInDashboard(_ctxNote.filename); hideNoteCtxMenu(); });

ctxRename.addEventListener("click", async () => {
  if (!_ctxNote) return;
  const note = _ctxNote;
  hideNoteCtxMenu();
  const newTitle = prompt("Rename note:", note.title ?? note.filename);
  if (!newTitle || newTitle === note.title) return;
  await Notes.updateMeta(note.filename, { title: newTitle });
  // Refresh results
  searchInput.dispatchEvent(new Event("input"));
});

ctxDelete.addEventListener("click", async () => {
  if (!_ctxNote) return;
  const note = _ctxNote;
  hideNoteCtxMenu();
  if (!confirm(`Delete "${note.title ?? note.filename}"?`)) return;
  await Notes.delete(note.filename);
  searchInput.dispatchEvent(new Event("input"));
});

document.addEventListener("click",       hideNoteCtxMenu);
document.addEventListener("contextmenu", (e) => { if (!e.target.closest(".search-result-item")) hideNoteCtxMenu(); });

// ── Mode dropdown ────────────────────────────────────────────────────────────
modeTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  if (audioBar?.classList.contains("active")) return;
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
    if (audioBar?.classList.contains("active")) return;

    selectedMode = item.dataset.mode;
    if (selectedMode !== "audio") {
      audioInputMode = "chat";
      aitChat.classList.add("active");
      aitInstructions.classList.remove("active");
    }
    chrome.storage.local.set({ savedMode: selectedMode });

    modeTrigger.querySelector(".mode-icon").textContent = item.dataset.icon;
    modeLabel.textContent = item.querySelector(".d-name").textContent;
    modeTrigger.style.setProperty("--mode-color", item.dataset.color);

    dropdownItems.forEach((d) => d.classList.remove("active"));
    item.classList.add("active");

    modeDropdown.classList.remove("open");
    modeTrigger.classList.remove("open");

    resetCaptureBtn();
    avToggleRow.classList.toggle("active", selectedMode === "audio");
    updateInputPlaceholder();
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

// ── Screen-reference detection ───────────────────────────────────────────────
// Returns true if the message is likely asking about the current screen.
function isScreenReference(msg) {
  if (!msg) return false;
  const m = msg.toLowerCase();
  // Explicit screen references
  if (/\b(screen|screenshot|page|slide|diagram|image|picture|photo|chart|graph|formula|equation|table|figure|shown|display|visible|here|this)\b/.test(m)) return true;
  // Short vague questions with no named subject likely refer to what's on screen
  // e.g. "what is this?", "explain this", "what does it mean?"
  if (/\bthis\b/.test(m)) return true;
  // Hebrew equivalents
  if (/\b(מסך|תמונה|שקף|דיאגרמה|נוסחה|טבלה|כאן|זה|הנוכחי)\b/.test(m)) return true;
  return false;
}

// ── Shared chat send logic ────────────────────────────────────────────────────
async function sendChatMessage() {
  // In instructions mode while recording is active — block send, instructions go with the audio
  if (audioInputMode === "instructions" && audioBar?.classList.contains("active")) return;
  const message = titleInput.value.trim();
  if (!message && attachedFiles.length === 0) { captureBtn.click(); return; }

  const hasUserImages = attachedFiles.some(f => f.isImage);
  const hasHistory    = (await Messages.listByConversation(activeConversationId)).length > 0;
  const needsScreen   = !hasUserImages && (
    !hasHistory ||                      // first message → always capture
    !message ||                         // no text → capture
    isScreenReference(message)          // follow-up but references the screen
  );

  // Capture screenshot NOW — must happen before any other await to preserve
  // the user-gesture context that authorises captureVisibleTab.
  let earlyScreenshot = null;
  if (needsScreen) {
    const cacheAge = Date.now() - _cacheTs;
    if (hasHistory && message && isScreenReference(message) && _cachedScreenshot && cacheAge < SCREENSHOT_CACHE_TTL) {
      earlyScreenshot = _cachedScreenshot; // screen likely unchanged — reuse to save tokens
    } else {
      showSpinner("Capturing screen…");
      try { earlyScreenshot = await captureTab(); } catch { /* permission denied or chrome:// page — handled below */ }
    }
  }

  titleInput.disabled = true;
  chatSendBtn.disabled = true;
  const attachBtn = document.getElementById("attachBtn");
  if (attachBtn) attachBtn.disabled = true;

  // Build user bubble (show thumbnails for all attached images)
  const localFiles = [...attachedFiles];
  let userBubbleHtml = "";
  if (localFiles.length > 0) {
    const thumbsHtml = localFiles.map(f =>
      f.isImage
        ? `<img src="data:${f.mimeType};base64,${f.base64}" class="msg-attachment-thumb" alt="" />`
        : `<div class="msg-attachment-file">📎 ${escapeHtml(f.name)}</div>`
    ).join("");
    userBubbleHtml += `<div class="msg-thumbs-row">${thumbsHtml}</div>`;
  }
  if (message) userBubbleHtml += `<div>${escapeHtml(message)}</div>`;
  appendCard(`<div class="msg-user">${userBubbleHtml}</div>`);

  titleInput.value = "";
  clearAttachment();
  showSpinner("Thinking…");

  try {
    const history = await Messages.listByConversation(activeConversationId);
    let reply;

    const imageFiles = localFiles.filter(f => f.isImage);
    const textFiles  = localFiles.filter(f => f.isText);

    // Build the effective message: user text + any text-file contents appended
    let effectiveMessage = message || "";
    if (textFiles.length > 0) {
      const fileBlocks = textFiles.map(f =>
        `\n\n--- File: ${f.name} ---\n${f.text}\n--- End of ${f.name} ---`
      ).join("");
      effectiveMessage = (effectiveMessage ? effectiveMessage + fileBlocks : fileBlocks.trimStart());
    }

    // If the user had text selected on the page and typed a question, inject the
    // selection as context so the AI answers in relation to that specific text.
    const selectionContext = selectedText;
    if (selectionContext && effectiveMessage) {
      effectiveMessage = `[Selected text]\n${selectionContext}\n\n[Question]\n${effectiveMessage}`;
      clearSelection();
    }

    // Build history messages for multi-turn context — cap at last 6 to avoid runaway token growth
    const HISTORY_LIMIT = 6;
    const historyMsgs = history
      .slice(-HISTORY_LIMIT)
      .map(m => ({ role: m.role, content: m.content }));

    if (imageFiles.length > 0) {
      // One or more images — vision model, include prior text history as system context
      const question = effectiveMessage || "Describe and analyze these images.";
      const fullQuestion = historyMsgs.length > 0
        ? `[Prior conversation context]\n${historyMsgs.map(m => `${m.role}: ${m.content}`).join("\n")}\n\n[User]\n${question}`
        : question;
      reply = await streamIntoCard(analyzeWithQuestionStream(
        imageFiles.map(f => ({ base64: f.base64, mimeType: f.mimeType })), null, fullQuestion
      ));
    } else if (effectiveMessage) {
      if (earlyScreenshot) {
        reply = await streamIntoCard(analyzeWithQuestionStream(earlyScreenshot.base64, earlyScreenshot.mimeType, effectiveMessage));
      } else {
        reply = await streamIntoCard(chatStream([...historyMsgs, { role: "user", content: effectiveMessage }]));
      }
    } else {
      // No message and no files — fall back to screenshot
      if (!earlyScreenshot) throw new Error("Could not capture screen. Try navigating to a regular web page first.");
      reply = await streamIntoCard(analyzeWithQuestionStream(earlyScreenshot.base64, earlyScreenshot.mimeType, "Describe and analyze this."));
    }

    // Save effectiveMessage so file contents are preserved in history for follow-ups
    await Messages.append(activeConversationId, "user", effectiveMessage || message);
    await Messages.append(activeConversationId, "assistant", reply);

    if (history.length === 0) {
      // Use typed message for title; fall back to attached filenames
      const title = message.trim() || localFiles.map(f => f.name).join(", ");
      await Conversations.rename(activeConversationId, title.slice(0, 60));
    }

    // If the streamed response is quiz-formatted, re-render it properly
    if (reply.includes("**Answer:**")) {
      const cards = resultArea.querySelectorAll(".result-card");
      const lastCard = cards[cards.length - 1];
      const mdBody = lastCard?.querySelector(".md-body");
      if (mdBody) {
        mdBody.outerHTML = renderQuiz(reply);
        // No listener attachment needed — delegated listener on resultArea handles all quiz btns
      }
    }

    loadConversations();
    refreshUsageDisplay();
  } catch (err) { showError(err.message); }
  titleInput.disabled = false;
  chatSendBtn.disabled = false;
  if (attachBtn) attachBtn.disabled = false;
}

// ── Attachment helpers ────────────────────────────────────────────────────────
function clearAttachment() {
  attachedFiles = [];
  const preview = document.getElementById("attachPreview");
  if (preview) { preview.innerHTML = ""; preview.style.display = "none"; }
}

function removeAttachmentAt(index) {
  attachedFiles.splice(index, 1);
  renderAttachPreview();
}

function renderAttachPreview() {
  const preview = document.getElementById("attachPreview");
  if (!preview) return;
  if (attachedFiles.length === 0) { preview.innerHTML = ""; preview.style.display = "none"; return; }

  preview.innerHTML = attachedFiles.map((f, i) => {
    const thumb = f.isImage
      ? `<img src="data:${f.mimeType};base64,${f.base64}" class="attach-chip-thumb" alt="" />`
      : `<span class="attach-chip-icon">📎</span>`;
    // No filename shown for images; show short name only for non-image files
    const label = f.isImage ? "" : `<span class="attach-chip-name">${escapeHtml(f.name)}</span>`;
    return `<div class="attach-chip" data-idx="${i}">
      ${thumb}${label}
      <button class="attach-chip-remove" data-idx="${i}">✕</button>
    </div>`;
  }).join("");
  preview.style.display = "flex";

  // Remove on ✕ click or middle-click
  preview.querySelectorAll(".attach-chip-remove").forEach(btn => {
    btn.addEventListener("click", () => removeAttachmentAt(+btn.dataset.idx));
  });
  preview.querySelectorAll(".attach-chip").forEach(chip => {
    chip.addEventListener("auxclick", (e) => { if (e.button === 1) removeAttachmentAt(+chip.dataset.idx); });
    chip.addEventListener("contextmenu", (e) => { e.preventDefault(); removeAttachmentAt(+chip.dataset.idx); });
  });
}

async function extractPdfText(arrayBuffer) {
  // pdf.js loaded as global via vendor/pdf.min.js
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.js");
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const parts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(`[Page ${i}]\n` + content.items.map(s => s.str).join(" "));
  }
  return parts.join("\n\n");
}

async function extractPptxText(arrayBuffer) {
  // JSZip loaded as global via vendor/jszip.min.js
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)[0]), nb = parseInt(b.match(/\d+/)[0]);
      return na - nb;
    });
  const parts = [];
  for (const name of slideFiles) {
    const xml = await zip.files[name].async("string");
    // Extract all <a:t> text nodes
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map(m => m[1]).filter(Boolean);
    const slideNum = name.match(/\d+/)[0];
    if (texts.length) parts.push(`[Slide ${slideNum}]\n${texts.join(" ")}`);
  }
  return parts.join("\n\n");
}

function showParsingChip(name) {
  const preview = document.getElementById("attachPreview");
  if (!preview) return;
  preview.style.display = "flex";
  const chip = document.createElement("div");
  chip.className = "attach-chip parsing-chip";
  chip.innerHTML = `<span class="attach-chip-icon">⏳</span><span class="attach-chip-name">${escapeHtml(name)}</span>`;
  preview.appendChild(chip);
}

function removeParsingChip() {
  document.querySelector(".parsing-chip")?.remove();
  const preview = document.getElementById("attachPreview");
  if (preview && !preview.hasChildNodes()) preview.style.display = "none";
}

function handleFileAttach(file) {
  if (!file) return;
  const isImage = file.type.startsWith("image/");
  const isPdf   = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const isPptx  = /\.(pptx|ppt)$/i.test(file.name) ||
                  file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const isText  = !isImage && !isPdf && !isPptx &&
                  (file.type.startsWith("text/") || /\.(txt|md|csv|json|js|ts|py|html|css|xml|yaml|yml)$/i.test(file.name));

  const reader = new FileReader();

  if (isImage) {
    reader.onload = (e) => {
      const base64 = e.target.result.split(",")[1];
      attachedFiles.push({ base64, mimeType: file.type, name: file.name, isImage: true, isText: false });
      renderAttachPreview();
    };
    reader.readAsDataURL(file);

  } else if (isPdf) {
    showParsingChip(file.name);
    reader.onload = async (e) => {
      removeParsingChip();
      try {
        const text = await extractPdfText(e.target.result);
        if (!text.trim()) { showError(`"${file.name}" appears to have no selectable text (scanned PDF).`); return; }
        attachedFiles.push({ text, mimeType: file.type, name: file.name, isImage: false, isText: true });
        renderAttachPreview();
      } catch (err) { showError(`Could not read PDF "${file.name}": ${err.message}`); }
    };
    reader.readAsArrayBuffer(file);

  } else if (isPptx) {
    showParsingChip(file.name);
    reader.onload = async (e) => {
      removeParsingChip();
      try {
        const text = await extractPptxText(e.target.result);
        if (!text.trim()) { showError(`"${file.name}" has no text content.`); return; }
        attachedFiles.push({ text, mimeType: file.type, name: file.name, isImage: false, isText: true });
        renderAttachPreview();
      } catch (err) { showError(`Could not read PowerPoint "${file.name}": ${err.message}`); }
    };
    reader.readAsArrayBuffer(file);

  } else if (isText) {
    reader.onload = (e) => {
      attachedFiles.push({ text: e.target.result, mimeType: file.type, name: file.name, isImage: false, isText: true });
      renderAttachPreview();
    };
    reader.readAsText(file);

  } else {
    showError(`"${file.name}" is not a supported file type.`);
  }
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
  [...(attachFileInput.files ?? [])].forEach(handleFileAttach);
  attachFileInput.value = "";
});

// ── Drag-and-drop anywhere on the sidebar ─────────────────────────────────────
const dragOverlay = document.getElementById("dragOverlay");
let dragCounter = 0; // track nested dragenter/dragleave

document.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types?.includes("Files")) return;
  e.preventDefault();
  dragCounter++;
  dragOverlay.style.display = "flex";
});
document.addEventListener("dragover", (e) => {
  if (!e.dataTransfer?.types?.includes("Files")) return;
  e.preventDefault();
});
document.addEventListener("dragleave", () => {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; dragOverlay.style.display = "none"; }
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragCounter = 0;
  dragOverlay.style.display = "none";
  [...(e.dataTransfer.files ?? [])].forEach(handleFileAttach);
});

// ── Paste image from clipboard ────────────────────────────────────────────────
document.addEventListener("paste", (e) => {
  [...(e.clipboardData?.items ?? [])]
    .filter(i => i.type.startsWith("image/"))
    .forEach(i => { const f = i.getAsFile(); if (f) handleFileAttach(f); });
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

// ── Mode persistence ─────────────────────────────────────────────────────────
function applyModeUI(mode) {
  const item = [...dropdownItems].find(d => d.dataset.mode === mode);
  if (!item) return;
  selectedMode = mode;
  modeTrigger.querySelector(".mode-icon").textContent = item.dataset.icon;
  modeLabel.textContent = item.querySelector(".d-name").textContent;
  modeTrigger.style.setProperty("--mode-color", item.dataset.color);
  dropdownItems.forEach(d => d.classList.remove("active"));
  item.classList.add("active");
  avToggleRow.classList.toggle("active", selectedMode === "audio");
  updateInputPlaceholder();
}

async function initMode() {
  const data = await chrome.storage.local.get(["savedMode", "savedAudioSrc"]).catch(() => ({}));
  if (data.savedMode) applyModeUI(data.savedMode);
  if (data.savedAudioSrc === "mic") {
    avOptMic.classList.add("active");
    avOptAudio.classList.remove("active");
    resetCaptureBtn();
  }
}


// Restore recording UI if a background recording was already running before the panel opened
async function restoreRecordingState() {
  const state = await sendMessageSafe({ type: "getRecordingState" }).catch(() => null);
  if (!state) return;
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  recSeconds = elapsed;
  const m = Math.floor(elapsed / 60);
  const s = String(elapsed % 60).padStart(2, "0");
  recTimer.textContent = `${m}:${s}`;
  const label = state.label || (state.source === "mic" ? "Recording microphone…" : "Recording tab audio…");
  document.getElementById("audioBarLabel").textContent = label;
  audioBar.classList.add("active");
  captureBtn.disabled = true;
  timerInterval = setInterval(() => {
    recSeconds++;
    const mm = Math.floor(recSeconds / 60);
    const ss = String(recSeconds % 60).padStart(2, "0");
    recTimer.textContent = `${mm}:${ss}`;
  }, 1000);
}

// Show overlay if not configured, otherwise boot normally
async function initSetup() {
  await initLang();
  await initMode();
  const configured = await Settings.isConfigured();
  if (configured) {
    setupOverlay.classList.add("hidden");
    await loadActiveConversation();
    await restoreRecordingState();
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
    // Sync headline title to the current conversation title
    const conv = conversations.find(c => c.id === id);
    if (conv?.title) updateResultHeadlines(conv.title);
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
  // Insert input as a sibling of the button (outside it) to avoid
  // invalid <input>-inside-<button> HTML which causes space to fire button click
  const btn = labelEl.parentElement; // the <button>
  btn.style.display = "none";

  const input = document.createElement("input");
  input.className = "tab-rename-input";
  input.type = "text";
  input.value = currentTitle;
  input.maxLength = 60;
  btn.parentElement.insertBefore(input, btn);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    input.remove();
    btn.style.display = "";
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

function updateResultHeadlines(title) {
  resultArea.querySelectorAll(".result-headline").forEach((el) => {
    const colon = el.textContent.indexOf(":");
    if (colon !== -1) {
      el.textContent = el.textContent.slice(0, colon + 1) + " " + title;
    }
  });
}

async function renameConvTab(id, title) {
  try {
    await Conversations.rename(id, title);
    const noteFilename = conversationNoteMap[id];
    if (noteFilename) {
      try { await Notes.updateMeta(noteFilename, { title }); } catch {}
    }
    if (id === activeConversationId) updateResultHeadlines(title);
    await loadConversations();
  } catch (err) { console.error(err); }
}

function reattachResultListeners() {
  // No-op — quiz/flashcard listeners are now delegated on resultArea and never need reattachment
}

// Single delegated listener — survives any innerHTML replacement
resultArea.addEventListener("click", (e) => {
  // Flashcard flip
  const fc = e.target.closest(".flashcard");
  if (fc && resultArea.contains(fc)) fc.classList.toggle("flipped");

  // Quiz show/hide answer
  const btn = e.target.closest(".quiz-reveal-btn");
  if (btn) {
    const el = document.getElementById(btn.dataset.answerId);
    if (!el) return;
    const hidden = el.style.display === "none";
    el.style.display = hidden ? "block" : "none";
    btn.textContent = hidden ? (btn.dataset.hideLabel || "▼ Hide Answer") : (btn.dataset.revealLabel || "▶ Show Answer");
  }
});

function renderAllMessages(messages) {
  resultArea.innerHTML = "";
  for (const msg of messages) {
    if (msg.role === "user") {
      const el = document.createElement("div");
      el.className = "msg-user";
      el.innerHTML = `<div>${escapeHtml(msg.content)}</div>`;
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
        wrap.innerHTML = `<div class="result-card">${isQuiz ? renderQuiz(msg.content) : `<div class="md-body" dir="auto">${renderMarkdown(msg.content)}</div>`}</div>`;
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
    if (messages.length > 0) {
      renderAllMessages(messages);
      resultArea.scrollTop = resultArea.scrollHeight;
    }
  } catch (err) { console.error(err); }

  // Process any screenshot that was captured via the Alt+Shift+C shortcut
  await processPendingCapture();
  // Process any text sent via right-click "Explain with LookUp"
  await processPendingExplain();
}

async function processPendingCapture() {
  const { pendingCapture } = await chrome.storage.local.get("pendingCapture");
  if (!pendingCapture) return;
  await chrome.storage.local.remove("pendingCapture");
  // Stale captures (>2 min) are discarded — user has moved on
  if (Date.now() - pendingCapture.ts > 120_000) return;

  showSpinner("Processing shortcut capture…");
  try {
    // Downscale the shortcut capture (same as captureTab) — background.js stores
    // full-resolution JPEG; resize to max 1280px longest side before sending to API.
    const { base64, mimeType } = await resizeDataUrl(pendingCapture.dataUrl);
    const raw = await analyzeScreenshot(base64, mimeType, selectedMode);
    refreshUsageDisplay();

    let markdown = raw;
    let cards = null;
    if (selectedMode === "flashcard") {
      try {
        const jsonStr = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
        cards = JSON.parse(jsonStr);
      } catch { cards = [{ front: "Parse error", back: raw }]; }
      markdown = cards.map((c, i) => `**Q${i + 1}:** ${c.front}\n**A:** ${c.back}`).join("\n\n");
    }

    const noteTitle = pendingCapture.tabTitle || selectedMode;
    const saved = await saveNote({ title: noteTitle, mode: selectedMode, markdown, cards });
    await Messages.append(activeConversationId, "user", `📸 Screenshot (${selectedMode})`);
    await Messages.append(activeConversationId, "assistant", selectedMode === "flashcard" ? JSON.stringify(cards) : markdown);

    let displayTitle = saved.title;
    const history = await Messages.listByConversation(activeConversationId);
    if (history.length <= 2) {
      const tabTitle = extractTopic(markdown, noteTitle);
      displayTitle = tabTitle.slice(0, 60);
      await Conversations.rename(activeConversationId, displayTitle);
      loadConversations();
    }

    if (cards) showFlashcards(cards, displayTitle, selectedMode);
    else showResult(markdown, displayTitle, selectedMode);
  } catch (err) { showError(err.message); }
}

async function processPendingExplain() {
  const { pendingExplain } = await chrome.storage.local.get("pendingExplain");
  if (!pendingExplain) return;
  await chrome.storage.local.remove("pendingExplain");
  // Stale (>2 min) — discard
  if (Date.now() - pendingExplain.ts > 120_000) return;

  const text = pendingExplain.text;
  showSpinner("Explaining selection…");
  try {
    const raw = await analyzeText(text, "explain");
    refreshUsageDisplay();

    const noteTitle = text.slice(0, 60);
    const saved = await saveNote({ title: noteTitle, mode: "explain", markdown: raw, cards: null });
    await Messages.append(activeConversationId, "user", `📝 Explain: "${text.slice(0, 80)}…"`);
    await Messages.append(activeConversationId, "assistant", raw);

    const history = await Messages.listByConversation(activeConversationId);
    if (history.length <= 2) {
      await Conversations.rename(activeConversationId, noteTitle);
      loadConversations();
    }
    showResult(raw, saved.title, "explain");
  } catch (err) { showError(err.message); }
}

// ── Service worker keep-alive ────────────────────────────────────────────────
// Ping the SW every 25s so it never sleeps and sendMessage calls don't hang.
setInterval(() => { chrome.runtime.sendMessage({ type: "keepAlive" }).catch(() => {}); }, 25_000);

// Wrapper: sendMessage with a 5-second timeout so the UI never hangs forever.
function sendMessageSafe(msg) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Extension background timed out. Please reload the extension.")), 5000);
    chrome.runtime.sendMessage(msg).then((res) => {
      clearTimeout(timer);
      resolve(res);
    }).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Image resize helper ──────────────────────────────────────────────────────
// Downscales a data URL to MAX_CAP px on the longest side, re-encodes as JPEG.
// Used by both captureTab() and processPendingCapture() so all screenshot paths
// go through the same resize before being sent to the Groq vision API.
const MAX_CAP = 1280;

function resizeDataUrl(dataUrl, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.width, img.height);
      const scale = longest > MAX_CAP ? MAX_CAP / longest : 1;
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const resized = canvas.toDataURL("image/jpeg", quality);
      resolve({ base64: resized.replace(/^data:image\/jpeg;base64,/, ""), mimeType: "image/jpeg" });
    };
    img.src = dataUrl;
  });
}

// ── Tab capture helper ──────────────────────────────────────────────────────
// Uses null windowId (= current window) to avoid a tabs.query round-trip,
// which would burn the user-gesture context before captureVisibleTab is called.
async function captureTab() {
  const dataUrl = await chrome.tabs.captureVisibleTab(targetWindowId, { format: "jpeg", quality: 85 });
  // Downscale to max MAX_CAP px longest side — cuts image tokens vs. full HD with no AI quality loss
  const result = await resizeDataUrl(dataUrl);
  _cachedScreenshot = result;
  _cacheTs = Date.now();
  return result;
}

// ── Window picker ────────────────────────────────────────────────────────────
// Shows a pill per Chrome window when 2+ are open; lets the user pick which
// window captureTab() should capture.

let _ownWindowId = null;
chrome.windows.getCurrent({}, w => { _ownWindowId = w.id; targetWindowId = w.id; });

async function refreshWindowPicker() {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  if (windows.length < 2) {
    moreWinItem.classList.add("hidden");
    winSubMenu.classList.remove("open");
    targetWindowId = _ownWindowId;
    return;
  }
  moreWinItem.classList.remove("hidden");

  // Update sub-menu entries
  winSubMenu.innerHTML = "";
  windows.forEach((win, idx) => {
    const activeTab = win.tabs?.find(t => t.active);
    const label = activeTab?.title?.replace(/\s*[-|–]\s*(Google Chrome|Chrome).*$/, "").trim()
      || `Window ${idx + 1}`;
    const isOwn = win.id === _ownWindowId;
    const isSelected = win.id === targetWindowId;

    const entry = document.createElement("div");
    entry.className = "win-entry" + (isSelected ? " selected" : "");
    entry.title = activeTab?.title || label;
    entry.innerHTML = `<span class="win-entry-icon">${isOwn ? "📌" : "🖥️"}</span><span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(label)}</span>${isSelected ? '<span class="win-entry-check">✓</span>' : ""}`;
    entry.addEventListener("click", (e) => {
      e.stopPropagation();
      targetWindowId = win.id;
      winCurrentLabel.textContent = label.length > 22 ? label.slice(0, 20) + "…" : label;
      winSubMenu.querySelectorAll(".win-entry").forEach(el => {
        el.classList.remove("selected");
        el.querySelector(".win-entry-check")?.remove();
      });
      entry.classList.add("selected");
      const check = document.createElement("span");
      check.className = "win-entry-check"; check.textContent = "✓";
      entry.appendChild(check);
      // Close sub-menu after selection
      winSubMenu.classList.remove("open");
      moreWinItem.classList.remove("expanded");
    });
    winSubMenu.appendChild(entry);

    // Sync the header label with current selection
    if (isSelected) {
      winCurrentLabel.textContent = label.length > 22 ? label.slice(0, 20) + "…" : label;
    }
  });
}

// Toggle sub-menu on click
moreWinItem.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = winSubMenu.classList.toggle("open");
  moreWinItem.classList.toggle("expanded", open);
});

// Refresh on open and whenever windows change
refreshWindowPicker();
chrome.windows.onCreated.addListener(refreshWindowPicker);
chrome.windows.onRemoved.addListener(refreshWindowPicker);

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
  if (selectedMode === "audio") {
    const useMic = avOptMic.classList.contains("active");
    if (useMic) { startMicCapture(); return; }
    startAudioCapture(); return;
  }

  // In multi-page session, Capture adds a frame instead of analyzing immediately
  if (inSession) { addPageBtn.click(); return; }

  captureBtn.disabled = true;
  showSpinner("Capturing screen…");

  try {
    const { base64, mimeType } = await captureTab();
    showSpinner();

    const raw = await analyzeScreenshot(base64, mimeType, selectedMode);
    refreshUsageDisplay();
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

    // Auto-rename tab on first capture — use AI topic if found, else mode name
    let displayTitle = saved.title;
    const history = await Messages.listByConversation(activeConversationId);
    if (history.length <= 2) {
      const tabTitle = extractTopic(markdown, noteTitle);
      displayTitle = tabTitle.slice(0, 60);
      await Conversations.rename(activeConversationId, displayTitle);
      loadConversations();
    }

    if (cards) {
      showFlashcards(cards, displayTitle, selectedMode);
    } else {
      showResult(markdown, displayTitle, selectedMode);
    }
  } catch (err) { showError(err.message); }
  captureBtn.disabled = false;
});

// ── Text selection (from content script) ───────────────────────────────────
const DEFAULT_PLACEHOLDER = "Ask about this screen…";

function setSelectionActive(text) {
  selectedText = text;
  selectionPreview.textContent = text.length > 140 ? text.slice(0, 140) + "…" : text;
  selectionBar.classList.add("active");
  titleInput.placeholder = "Ask a question about the selection…";
}

function clearSelection() {
  selectedText = "";
  selectionBar.classList.remove("active");
  titleInput.placeholder = DEFAULT_PLACEHOLDER;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "textSelection") return;
  if (msg.text && msg.text.length >= 3) {
    setSelectionActive(msg.text);
  } else {
    clearSelection();
  }
});

selectionDismiss.addEventListener("click", clearSelection);

askBtn.addEventListener("click", async () => {
  if (!selectedText) return;
  askBtn.disabled = true;
  showSpinner("Analyzing selected text…");

  try {
    const capturedText = selectedText;
    clearSelection();
    const raw = await analyzeText(capturedText, selectedMode);
    refreshUsageDisplay();
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
      showFlashcards(cards, saved.title, selectedMode);
    } else {
      showResult(markdown, saved.title, selectedMode);
    }
  } catch (err) { showError(err.message); }
  askBtn.disabled = false;
});

// ── Session (now triggered from more-dropdown) ───────────────────────────────
moreMultiBtn.addEventListener("click", () => {
  moreDropdown.classList.remove("open");
  moreBtn.classList.remove("open");
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
    refreshUsageDisplay();
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
      showFlashcards(cards, saved.title, selectedMode);
    } else {
      showResult(markdown, saved.title, selectedMode);
    }
  } catch (err) { showError(err.message); }

  inSession = false;
  sessionFrames = [];
  resetCaptureBtn();
  captureBtn.disabled = false;
});

// ── Recording IDB helpers (reads from offscreen.js's lookup-recording DB) ────
const RECORDING_DB = "lookup-recording";
let _rdb = null;

function openRecordingDB() {
  if (_rdb) return Promise.resolve(_rdb);
  return new Promise((res, rej) => {
    const req = indexedDB.open(RECORDING_DB, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { autoIncrement: true });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = (e) => { _rdb = e.target.result; res(_rdb); };
    req.onerror = () => rej(req.error);
  });
}

async function readAllChunks() {
  const db = await openRecordingDB();
  return new Promise((res, rej) => {
    const t = db.transaction(["chunks", "meta"], "readonly");
    const buffers = [];
    t.objectStore("chunks").openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { buffers.push(cursor.value); cursor.continue(); }
    };
    let blobType = "audio/webm";
    const metaReq = t.objectStore("meta").get("blobType");
    metaReq.onsuccess = () => { if (metaReq.result) blobType = metaReq.result; };
    t.oncomplete = () => res({ buffers, blobType });
    t.onerror = () => rej(t.error);
  });
}

// ── Audio capture ───────────────────────────────────────────────────────────
async function startAudioCapture() {
  captureBtn.disabled = true;
  try {
    const resp = await sendMessageSafe({ type: "startRecording", source: "tab", label: "Recording tab audio…" });
    if (!resp?.ok) throw new Error(resp?.error ?? "Could not start recording");
    recSeconds = 0;
    document.getElementById("audioBarLabel").textContent = "Recording tab audio…";
    audioBar.classList.add("active");
    if (audioInputMode === "instructions") aitHint.classList.add("visible");
    timerInterval = setInterval(() => {
      recSeconds++;
      const m = Math.floor(recSeconds / 60);
      const s = String(recSeconds % 60).padStart(2, "0");
      recTimer.textContent = `${m}:${s}`;
    }, 1000);
  } catch (err) {
    const isChromePage = err.message.includes("not been invoked") || err.message.includes("cannot be captured") || err.message.includes("activeTab");
    if (isChromePage) {
      // Tab audio is blocked on this page — auto-fall back to mic
      avOptMic.classList.add("active");
      avOptAudio.classList.remove("active");
      chrome.storage.local.set({ savedAudioSrc: "mic" });
      startMicCapture();
    } else {
      showError(err.message);
      captureBtn.disabled = false;
    }
  }
}

// Reset audio UI without processing (e.g. on navigation to restricted page)
function resetAudioState() {
  clearInterval(timerInterval);
  audioBar.classList.remove("active");
  document.getElementById("audioBarLabel").textContent = "Recording tab audio…";
  recTimer.textContent = "0:00";
  captureBtn.disabled = false;
  sendMessageSafe({ type: "stopRecording" }).catch(() => {});
}

// Stop recording if user navigates to a chrome:// page while recording
chrome.tabs.onActivated.addListener(() => {
  if (!audioBar.classList.contains("active")) return;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
      resetAudioState();
      showError("Recording stopped — can't capture audio on this page.");
    }
  });
});

// ── Inline mic permission banner ─────────────────────────────────────────────
micPermDismiss.addEventListener("click", () => micPermBanner.classList.remove("active"));

// Called from the "Allow" button inside the sidepanel — this IS a user gesture,
// so Chrome will show the permission dialog here without needing a new tab.
micPermGrantBtn.addEventListener("click", () => {
  micPermGrantBtn.disabled = true;
  // getUserMedia is blocked in the sidepanel context; open the dedicated permission page instead
  chrome.tabs.create({ url: chrome.runtime.getURL("mic-permission.html") });
  micPermBanner.classList.remove("active");
});

// Listen for messages from background (recording events) and mic-permission.html
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "micPermissionResult") {
    if (!msg.granted) {
      showError("Microphone blocked. Enable it at: chrome://settings/content/microphone");
    }
    micPermGrantBtn.disabled = false;
    return;
  }
  if (msg.type === "recordingDone") {
    // Offscreen doc finished — process the audio that was stored in IDB
    document.getElementById(SPINNER_ID)?.remove();
    showSpinner("Transcribing audio with Whisper…");
    finishAudio();
    return;
  }
  if (msg.type === "recordingError") {
    clearInterval(timerInterval);
    audioBar.classList.remove("active");
    recTimer.textContent = "0:00";
    captureBtn.disabled = false;
    showError(msg.error ?? "Recording failed.");
    return;
  }
  if (msg.type === "pendingCapture") {
    processPendingCapture();
    return;
  }
  if (msg.type === "pendingExplain") {
    processPendingExplain();
  }
});

// ── Microphone capture ───────────────────────────────────────────────────────
async function startMicCapture() {
  captureBtn.disabled = true;
  // Check permission state first — if not granted, trigger the permission flow
  const permState = await navigator.permissions.query({ name: "microphone" }).catch(() => ({ state: "unknown" }));
  if (permState.state === "denied") {
    captureBtn.disabled = false;
    showError("Microphone blocked. Enable it at: chrome://settings/content/microphone");
    return;
  }
  if (permState.state !== "granted") {
    // Not yet granted — open permission helper page so user can allow it
    captureBtn.disabled = false;
    micPermBanner.classList.add("active");
    micPermGrantBtn.disabled = false;
    return;
  }
  // Permission is granted — delegate recording to the offscreen document
  try {
    const resp = await sendMessageSafe({ type: "startRecording", source: "mic", label: "Recording microphone…" });
    if (!resp?.ok) throw new Error(resp?.error ?? "Could not start recording");
    recSeconds = 0;
    document.getElementById("audioBarLabel").textContent = "Recording microphone…";
    audioBar.classList.add("active");
    if (audioInputMode === "instructions") aitHint.classList.add("visible");
    timerInterval = setInterval(() => {
      recSeconds++;
      const m = Math.floor(recSeconds / 60);
      const s = String(recSeconds % 60).padStart(2, "0");
      recTimer.textContent = `${m}:${s}`;
    }, 1000);
  } catch (err) {
    captureBtn.disabled = false;
    showError(err.message);
  }
}

stopAudio.addEventListener("click", () => {
  // Snapshot instructions NOW before anything can clear the input
  _pendingAudioNote = audioInputMode === "instructions" ? titleInput.value.trim() : "";
  if (_pendingAudioNote) titleInput.value = "";
  clearInterval(timerInterval);
  audioBar.classList.remove("active");
  aitHint.classList.remove("visible");
  document.getElementById("audioBarLabel").textContent = "Recording tab audio…";
  showSpinner("Transcribing audio with Whisper…");
  sendMessageSafe({ type: "stopRecording" }).catch(() => {});
  // finishAudio() is called when background sends back "recordingDone"
});

async function finishAudio() {
  try {
    // Read chunks from the dedicated recording IndexedDB written by offscreen.js
    const { buffers, blobType } = await readAllChunks();
    if (buffers.length === 0) throw new Error("No audio data recorded.");

    const chunks = buffers.map(buf => new Blob([buf], { type: blobType }));
    const blob = new Blob(chunks, { type: blobType });
    const userNote = _pendingAudioNote;
    _pendingAudioNote = "";

    const audioMode = `audio-${selectedMode}`;
    let { markdown } = await transcribeAndSummarize(blob, selectedMode, userNote, chunks);
    refreshUsageDisplay();

    const noteTitle = userNote || "Recording";
    let finalMarkdown = markdown;
    let cards;

    if (selectedMode === "flashcard") {
      try { cards = JSON.parse(markdown); } catch { cards = [{ front: "Parse error", back: markdown }]; }
      finalMarkdown = cards.map((c, i) => `**Q${i + 1}:** ${c.front}\n**A:** ${c.back}`).join("\n\n");
    }

    const saved = await saveNote({ title: noteTitle, mode: audioMode, markdown: finalMarkdown, cards });

    await Messages.append(activeConversationId, "user", `🎙️ Recording (${selectedMode})`);
    await Messages.append(activeConversationId, "assistant", cards ? JSON.stringify(cards) : finalMarkdown);

    if (cards) {
      showFlashcards(cards, saved.title, audioMode);
    } else {
      showResult(finalMarkdown, saved.title, audioMode);
    }
  } catch (err) { showError(err.message); }
  captureBtn.disabled = false;
}

// ── UI helpers ──────────────────────────────────────────────────────────────
// ── Audio source toggle (Tab / Mic) ─────────────────────────────────────────
avOptAudio.addEventListener("click", () => {
  avOptAudio.classList.add("active");
  avOptMic.classList.remove("active");
  chrome.storage.local.set({ savedAudioSrc: "tab" });
  resetCaptureBtn();
});
avOptMic.addEventListener("click", () => {
  avOptMic.classList.add("active");
  avOptAudio.classList.remove("active");
  chrome.storage.local.set({ savedAudioSrc: "mic" });
  resetCaptureBtn();
});

function resetCaptureBtn() {
  if (selectedMode === "audio") {
    captureBtn.textContent = avOptMic.classList.contains("active") ? "🎤 Record" : "🎙️ Record";
  } else captureBtn.textContent = "⚡ Capture";
}

function updateInputPlaceholder() {
  if (selectedMode === "audio") {
    audioInputToggle.classList.add("visible");
    if (audioInputMode === "instructions") {
      titleInput.placeholder = "Write instructions for the audio…";
    } else {
      titleInput.placeholder = "Ask about this screen…";
    }
  } else {
    audioInputToggle.classList.remove("visible");
    aitHint.classList.remove("visible");
    titleInput.placeholder = "Ask about this screen…";
  }
}

aitChat.addEventListener("click", () => {
  audioInputMode = "chat";
  aitChat.classList.add("active");
  aitInstructions.classList.remove("active");
  aitHint.classList.remove("visible");
  updateInputPlaceholder();
});

aitInstructions.addEventListener("click", () => {
  audioInputMode = "instructions";
  aitInstructions.classList.add("active");
  aitChat.classList.remove("active");
  aitHint.classList.toggle("visible", audioBar?.classList.contains("active"));
  updateInputPlaceholder();
});

function appendCard(htmlStr, afterInsert) {
  document.getElementById(SPINNER_ID)?.remove();
  resultArea.querySelector(".placeholder")?.remove();
  const wrap = document.createElement("div");
  wrap.innerHTML = htmlStr;
  // Inject copy button into every result-card (not user bubbles or error cards)
  wrap.querySelectorAll(".result-card").forEach(card => {
    const btn = document.createElement("button");
    btn.className = "card-copy-btn";
    btn.title = "Copy to clipboard";
    btn.textContent = "⎘";
    btn.addEventListener("click", () => {
      const text = card.innerText.replace(/^⎘\s*/m, "").trim();
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = "✓";
        setTimeout(() => { btn.textContent = "⎘"; }, 1500);
      });
    });
    card.appendChild(btn);
  });
  while (wrap.firstChild) resultArea.appendChild(wrap.firstChild);
  if (afterInsert) afterInsert();
  resultArea.scrollTop = resultArea.scrollHeight;
}

// Stream an async generator into a live-updating result card.
// Renders markdown incrementally; returns the full accumulated text.
async function streamIntoCard(generator) {
  document.getElementById(SPINNER_ID)?.remove();
  resultArea.querySelector(".placeholder")?.remove();

  const card = document.createElement("div");
  card.className = "result-card";
  const body = document.createElement("div");
  body.className = "md-body";
  body.setAttribute("dir", "auto");
  const copyBtn = document.createElement("button");
  copyBtn.className = "card-copy-btn";
  copyBtn.title = "Copy to clipboard";
  copyBtn.textContent = "⎘";
  card.appendChild(body);
  card.appendChild(copyBtn);
  resultArea.appendChild(card);
  resultArea.scrollTop = resultArea.scrollHeight;

  let full = "";
  let rafId = null;
  const scheduleRender = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      body.innerHTML = renderMarkdown(full);
      resultArea.scrollTop = resultArea.scrollHeight;
      rafId = null;
    });
  };

  try {
    for await (const delta of generator) {
      full += delta;
      scheduleRender();
    }
  } catch (e) {
    if (rafId) cancelAnimationFrame(rafId);
    card.remove();
    throw e;
  }

  if (rafId) cancelAnimationFrame(rafId);
  body.innerHTML = renderMarkdown(full);
  resultArea.scrollTop = resultArea.scrollHeight;

  copyBtn.addEventListener("click", () => {
    const text = card.innerText.replace(/^⎘\s*/m, "").trim();
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = "✓";
      setTimeout(() => { copyBtn.textContent = "⎘"; }, 1500);
    });
  });

  return full;
}

function showSpinner() {
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

function showResult(markdown, title, mode) {
  const bodyHtml = (mode === "quiz")
    ? renderQuiz(markdown)
    : `<div class="md-body" dir="auto">${renderMarkdown(markdown)}</div>`;
  appendCard(`
    <div class="result-card">
      ${resultHeadline(mode, title)}
      ${bodyHtml}
    </div>`
  );
}

function showFlashcards(cards, title, mode = "flashcard") {
  const prefix = `fc${++_uid}_`;
  const grid = cards.map((card, i) => `
    <div class="flashcard" id="${prefix}${i}">
      <div class="flashcard-front"><span class="fc-label">Q</span>${renderMarkdown(card.front)}</div>
      <div class="flashcard-back"><span class="fc-label">A</span>${renderMarkdown(card.back)}</div>
    </div>
  `).join("");
  appendCard(`
    <div class="result-card" style="background:transparent;border:none;padding:0">
      ${resultHeadline(mode, title)}
      <div class="flashcard-grid">${grid}</div>
    </div>`
  );
}

function showError(msg) {
  document.getElementById(SPINNER_ID)?.remove();
  const existing = resultArea.querySelector(".error-card:last-child");

  const isQuotaError = msg.toLowerCase().includes("daily token limit") || msg.toLowerCase().includes("quota");
  const html = isQuotaError
    ? `<div class="error-card error-card-quota">
        <div class="quota-icon">🚫</div>
        <strong>Daily quota reached</strong>
        <p>Your free Groq quota resets every 24 hours.</p>
        <a class="quota-upgrade-btn" href="https://console.groq.com" target="_blank">↗ Upgrade at console.groq.com</a>
      </div>`
    : `<div class="error-card"><strong>Error:</strong> ${escapeHtml(msg)}</div>`;

  if (existing && !isQuotaError) {
    existing.innerHTML = `<strong>Error:</strong> ${escapeHtml(msg)}`;
    return;
  }
  appendCard(html);
}

// Extract a meaningful topic title from AI markdown output.
// Tries: first heading → first bold term → first content line → fallback.
function extractTopic(markdown, fallback) {
  const heading = markdown.match(/^#{1,4}\s+(.+)$/m);
  if (heading) return heading[1].replace(/\*\*/g, "").trim().slice(0, 60);

  const bold = markdown.match(/\*\*([^*\n]{4,50})\*\*/);
  if (bold) return bold[1].trim();

  const line = markdown.split("\n").find(l => l.replace(/^[*#\-\d.\s>]+/, "").trim().length > 8);
  if (line) return line.replace(/^[*#\-\d.\s>]+/, "").replace(/\*\*/g, "").trim().slice(0, 60);

  return fallback ?? null;
}

// Returns 'rtl' if the text (stripped of HTML tags) contains more Hebrew/Arabic
// characters than Latin ones, otherwise 'auto'. Prevents dir="auto" from
// wrongly choosing LTR just because a bold English term appears first.
function bidiDir(html) {
  const text = html.replace(/<[^>]+>/g, " ");
  const rtlCount = (text.match(/[\u0590-\u05FF\u0600-\u06FF\uFB1D-\uFB4F]/g) ?? []).length;
  const ltrCount = (text.match(/[A-Za-z]/g) ?? []).length;
  return rtlCount > ltrCount ? "rtl" : "auto";
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Quiz renderer — shows questions with hidden answers ──────────────────────
// Matches the answer marker in both English and Hebrew (model may translate despite instructions).
const QUIZ_ANSWER_RE = /\*\*(?:Answer|תשובה)[^*\n]*\*\*\s*:?\s*/i;

function renderQuiz(markdown) {
  const quizPrefix = `qz${++_uid}`;

  // Split at every question start — handles plain "1.", bold "**1.**", and legacy "**Q1.**"/"**ש1.**"
  // The lookahead keeps the delimiter in the following chunk.
  const blocks = markdown
    .split(/\n(?=\s*\*?\*?[Qש]?\d+[.)]\*?\*?\s)/)
    .map(b => b.trim())
    .filter(Boolean);

  let html = "";
  let qNum = 0;

  for (const block of blocks) {
    const answerMatch = QUIZ_ANSWER_RE.exec(block);
    if (!answerMatch) {
      // No answer marker — render as plain markdown (intro text, etc.)
      html += `<div class="md-body" dir="${bidiDir(block)}">${renderMarkdown(block)}</div>`;
      continue;
    }

    qNum++;
    // Strip the leading question-number label (e.g. "1. " / "**Q1.** " / "**ש1.** ")
    const rawQ = block.slice(0, answerMatch.index).replace(/^\s*\*?\*?[Qש]?\d+[.)]\*?\*?\s*/i, "").trim();
    const answerPart = block.slice(answerMatch.index + answerMatch[0].length).trim();
    const id = `${quizPrefix}-ans-${qNum}`;
    const revealLabel = _lang === "he" ? "▶ הצג תשובה" : "▶ Show Answer";
    const hideLabel   = _lang === "he" ? "▼ הסתר תשובה" : "▼ Hide Answer";

    html += `
      <div class="quiz-block">
        <div class="quiz-question md-body" dir="${bidiDir(rawQ)}"><span class="quiz-num">${qNum}.</span> ${renderMarkdown(rawQ)}</div>
        <button class="quiz-reveal-btn" data-answer-id="${id}" data-reveal-label="${revealLabel}" data-hide-label="${hideLabel}">${revealLabel}</button>
        <div class="quiz-answer md-body" id="${id}" dir="${bidiDir(answerPart)}" style="display:none">${renderMarkdown(answerPart)}</div>
      </div>`;
  }

  return html || `<div class="md-body" dir="${bidiDir(markdown)}">${renderMarkdown(markdown)}</div>`;
}

// ── Math renderer (KaTeX) ─────────────────────────────────────────────────────
function renderMath(expr, displayMode = false) {
  if (typeof katex === 'undefined') {
    // KaTeX not loaded yet — return escaped fallback
    return expr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  try {
    return katex.renderToString(expr, { displayMode, throwOnError: false, output: 'html' });
  } catch {
    return expr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
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
    blocks.push(`<div class="math-block">${renderMath(math.trim(), true)}</div>`);
    return `\x00B${i}\x00`;
  });

  text = text.replace(/\$([^$\n]+?)\$/g, (_, math) => {
    const i = blocks.length;
    blocks.push(`<span class="math-inline">${renderMath(math.trim(), false)}</span>`);
    return `\x00B${i}\x00`;
  });

  text = text.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_, body) => {
    const i = blocks.length;
    blocks.push(`<div class="math-block">${renderMath(`\\begin{cases}${body}\\end{cases}`, true)}</div>`);
    return `\x00B${i}\x00`;
  });

  text = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
      const liContent = line.replace(/^[*-] /, '');
      out.push(`<li dir="${bidiDir(liContent)}">${liContent}</li>`);
    } else if (/^\d+\. /.test(line)) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol class="md-ol">'); inOl = true; }
      const liContent = line.replace(/^\d+\. /, '');
      out.push(`<li dir="${bidiDir(liContent)}">${liContent}</li>`);
    } else {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
      const t = line.trim();
      if (!t) {
        out.push('<div class="md-gap"></div>');
      } else if (BLOCK_STARTS.some(b => t.startsWith(b))) {
        out.push(t);
      } else {
        out.push(`<p class="md-p" dir="${bidiDir(t)}">${t}</p>`);
      }
    }
  }
  if (inUl) out.push('</ul>');
  if (inOl) out.push('</ol>');

  return out.join('').replace(/\x00B(\d+)\x00/g, (_, i) => blocks[+i]);
}
