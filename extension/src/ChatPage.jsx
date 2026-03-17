import { useState, useRef, useEffect, useCallback } from "react";
import CosmicBg from "./CosmicBg.jsx";
import { Conversations, Messages, Notes, Settings } from "../storage.js";
import { chatStream, chatStreamRich } from "../groq-client.js";

// ── Lightweight markdown renderer ─────────────────────────────────────────────
function renderMd(raw) {
  let h = raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^#### (.+)$/gm, '<h4 class="chat-h4" dir="auto">$1</h4>')
    .replace(/^### (.+)$/gm,  '<h3 class="chat-h3" dir="auto">$1</h3>')
    .replace(/^## (.+)$/gm,   '<h2 class="chat-h2" dir="auto">$1</h2>')
    .replace(/^# (.+)$/gm,    '<h2 class="chat-h2" dir="auto">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/`([^`\n]+)`/g,   '<code class="chat-code">$1</code>')
    .replace(/^---+$/gm,       '<hr class="chat-hr">')
    .replace(/^[*-] (.+)$/gm,  '<li dir="auto">$1</li>');
  h = h.replace(/(<li[\s\S]*?<\/li>)(\n<li[\s\S]*?<\/li>)*/g,
    (m) => `<ul class="chat-ul">${m}</ul>`);
  h = h.replace(/\n\n+/g, '</p><p class="chat-p" dir="auto">').replace(/\n/g, "<br>");
  return `<p class="chat-p" dir="auto">${h}</p>`;
}

function parseFlashcards(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.front !== undefined) return parsed;
  } catch {}
  return null;
}

function isQuiz(content) { return content.includes("**Answer:**"); }

function FlashcardGrid({ cards }) {
  const [flipped, setFlipped] = useState({});
  return (
    <div className="chat-fc-grid">
      {cards.map((card, i) => (
        <div key={i} className={`chat-fc${flipped[i] ? " flipped" : ""}`}
          onClick={() => setFlipped((f) => ({ ...f, [i]: !f[i] }))}>
          <div className="chat-fc-inner">
            <div className="chat-fc-front" dangerouslySetInnerHTML={{ __html: renderMd(card.front) }} />
            <div className="chat-fc-back"  dangerouslySetInnerHTML={{ __html: renderMd(card.back) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function QuizContent({ content }) {
  const [revealed, setRevealed] = useState({});
  let blocks = content.split(/\n[ \t]*---[ \t]*\n/);
  if (blocks.length <= 1 && (content.match(/\*\*Answer:\*\*/g) ?? []).length > 1)
    blocks = content.split(/\n\n(?=\*\*Q\d)/);
  let qIdx = 0;
  return (
    <div>
      {blocks.map((block, bi) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        const answerAt = trimmed.indexOf("**Answer:**");
        if (answerAt === -1) return <div key={bi} dangerouslySetInnerHTML={{ __html: renderMd(trimmed) }} />;
        const q = qIdx++;
        const questionPart = trimmed.slice(0, answerAt).trim();
        const answerPart   = trimmed.slice(answerAt + "**Answer:**".length).trim();
        return (
          <div key={bi} className="chat-quiz-block">
            <div dangerouslySetInnerHTML={{ __html: renderMd(questionPart) }} />
            <button className="chat-quiz-reveal" onClick={() => setRevealed((r) => ({ ...r, [q]: !r[q] }))}>
              {revealed[q] ? "▼ Hide Answer" : "▶ Show Answer"}
            </button>
            {revealed[q] && <div className="chat-quiz-answer" dangerouslySetInnerHTML={{ __html: renderMd(answerPart) }} />}
          </div>
        );
      })}
    </div>
  );
}

function AiContent({ content }) {
  const cards = parseFlashcards(content);
  if (cards) return <FlashcardGrid cards={cards} />;
  if (isQuiz(content)) return <QuizContent content={content} />;
  return <div className="msg-ai-body" dangerouslySetInnerHTML={{ __html: renderMd(content) }} />;
}

// ── File helpers ──────────────────────────────────────────────────────────────
const IMAGE_EXTS = /\.(png|jpe?g|webp|gif)$/i;
const TEXT_EXTS  = /\.(txt|md|csv|json|js|ts|jsx|tsx|html|css|py|java|c|cpp|h|rs|go|rb|php|sh|yaml|yml|xml|toml)$/i;
const IMAGE_TYPES = ["image/png","image/jpeg","image/webp","image/gif"];

function readAsBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function readAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsText(file);
  });
}

async function processFile(file) {
  const isImage = IMAGE_TYPES.includes(file.type) || IMAGE_EXTS.test(file.name);
  const isText  = !isImage && (file.type.startsWith("text/") || TEXT_EXTS.test(file.name));
  if (isImage) {
    const base64 = await readAsBase64(file);
    return { id: `${Date.now()}-${Math.random()}`, name: file.name, mimeType: file.type || "image/png", base64, isImage: true };
  }
  if (isText) {
    const textContent = await readAsText(file);
    return { id: `${Date.now()}-${Math.random()}`, name: file.name, isText: true, textContent };
  }
  return null; // unsupported
}

// ── Mode prompts (for first-message structured output) ────────────────────────
const MODES = [
  { key: "chat",      label: "Chat" },
  { key: "summary",   label: "Summary" },
  { key: "explain",   label: "Explain" },
  { key: "quiz",      label: "Quiz" },
  { key: "flashcard", label: "Flashcard" },
];

function buildModePrefix(mode) {
  if (mode === "chat") return "";
  const map = {
    summary:   "Produce a structured study summary with an Overview paragraph and Key Concepts bullet list:\n\n",
    explain:   "Explain this as a patient tutor — start with why the topic exists, walk concepts in order, give a real-world analogy, end with 'The key insight:':\n\n",
    quiz:      "Generate a quiz to test real understanding. Format each question as:\n**Q1.** [Question]\n**Answer:** [5–60 words]\n\n",
    flashcard: "Generate flashcards. Return ONLY a valid JSON array, no markdown fences:\n[{\"front\":\"Question\",\"back\":\"Answer\"}]\n\n",
  };
  return map[mode] ?? "";
}

// ── Main chat page ────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [conversations,  setConversations]  = useState([]);
  const [activeId,       setActiveId]       = useState(null);
  const [messages,       setMessages]       = useState([]);
  const [input,          setInput]          = useState("");
  const [loading,        setLoading]        = useState(false);
  const [renamingId,     setRenamingId]     = useState(null);
  const [renameVal,      setRenameVal]      = useState("");
  const [ctxMenu,        setCtxMenu]        = useState(null);
  const [copiedIdx,      setCopiedIdx]      = useState(null);
  const [sidebarOpen,    setSidebarOpen]    = useState(true);
  const [searchQuery,    setSearchQuery]    = useState("");

  // Attachment state (manual drag/paste/file)
  const [attachedFiles,  setAttachedFiles]  = useState([]);

  // Drag-and-drop state
  const [dragActive,     setDragActive]     = useState(false);
  const dragCounter                         = useRef(0);

  // Persistent mode (saved to storage)
  const [activeMode,     setActiveModeState] = useState("chat");
  const [modeDropOpen,   setModeDropOpen]   = useState(false);

  // Persistent capture source for this conversation
  // null = no capture | { winId, title } = a selected window
  const [captureSource,  setCaptureSource]  = useState(null);

  // Capture card picker state (shown inside the sidebar card)
  const [pickerOpen,     setPickerOpen]     = useState(false);
  const [pickerWindows,  setPickerWindows]  = useState([]);

  const bottomRef   = useRef(null);
  const textareaRef = useRef(null);
  const renameRef   = useRef(null);
  const fileInputRef = useRef(null);

  // Load persisted mode on mount
  useEffect(() => {
    Settings.getChatMode().then(m => setActiveModeState(m)).catch(() => {});
  }, []);

  async function setActiveMode(mode) {
    setActiveModeState(mode);
    await Settings.setChatMode(mode).catch(() => {});
  }

  // ── Load conversations ──────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    try { setConversations(await Conversations.list()); } catch {}
  }, []);

  // ── Switch to a conversation ────────────────────────────────────────────────
  const switchConversation = useCallback(async (id) => {
    setActiveId(id);
    setCaptureSource(null);
    setPickerOpen(false);
    try {
      const msgs = await Messages.listByConversation(id);
      setMessages(msgs.map((m) => ({ role: m.role, content: m.content })));
      await Conversations.setActive(id);
    } catch {}
  }, []);

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      await loadConversations();
      try {
        const active = await Conversations.getActive();
        if (active) {
          await switchConversation(active.id);
        } else {
          const convs = await Conversations.list();
          if (convs.length > 0) {
            await switchConversation(convs[0].id);
          } else {
            const c = await Conversations.create("New Conversation");
            setActiveId(c.id); setMessages([]);
            await Conversations.setActive(c.id);
            await loadConversations();
          }
        }
      } catch {}
    })();
  }, [loadConversations, switchConversation]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => { if (renamingId !== null) renameRef.current?.focus(); }, [renamingId]);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ctxMenu]);

  // Paste images anywhere on the page
  useEffect(() => {
    async function onPaste(e) {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find(i => i.kind === "file" && i.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      const processed = await processFile(file);
      if (processed) setAttachedFiles(prev => [...prev, processed]);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // ── File handling ────────────────────────────────────────────────────────────
  async function handleFiles(fileList) {
    const results = await Promise.all(Array.from(fileList).map(processFile));
    const valid = results.filter(Boolean);
    if (valid.length) setAttachedFiles(prev => [...prev, ...valid]);
  }

  function removeAttachment(id) {
    setAttachedFiles(prev => prev.filter(f => f.id !== id));
  }

  // ── Drag-and-drop on whole page ─────────────────────────────────────────────
  function onDragEnter(e) {
    e.preventDefault();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setDragActive(true);
  }
  function onDragLeave(e) {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setDragActive(false);
  }
  function onDragOver(e) { e.preventDefault(); }
  function onDrop(e) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  }

  // ── Capture source card ──────────────────────────────────────────────────────
  async function openPicker() {
    try {
      const wins = await chrome.windows.getAll({ populate: true });
      const normal = wins
        .filter(w => w.type === "normal")
        .map(w => ({
          id: w.id,
          title: w.tabs?.find(t => t.active)?.title ?? `Window ${w.id}`,
        }));
      setPickerWindows(normal);
      setPickerOpen(true);
    } catch (err) {
      console.error("Could not list windows:", err);
    }
  }

  function selectCaptureWindow(win) {
    setCaptureSource(win);   // { id, title }
    setPickerOpen(false);
  }

  function clearCapture() {
    setCaptureSource(null);
    setPickerOpen(false);
  }

  // ── Send message ─────────────────────────────────────────────────────────────
  async function send() {
    const text = input.trim();
    if ((!text && attachedFiles.length === 0 && !captureSource) || loading || !activeId) return;
    setInput("");
    setLoading(true);

    // Auto-capture from selected source before building the message
    let autoCapture = null;
    if (captureSource) {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(captureSource.id, { format: "jpeg", quality: 85 });
        autoCapture = {
          id: `${Date.now()}-cap`, name: "screenshot.jpg",
          mimeType: "image/jpeg", base64: dataUrl.split(",")[1], isImage: true,
        };
      } catch (err) {
        console.error("Auto-capture failed:", err);
      }
    }

    const imageFiles = [...attachedFiles.filter(f => f.isImage), ...(autoCapture ? [autoCapture] : [])];
    const textFiles  = attachedFiles.filter(f => f.isText);
    setAttachedFiles([]);

    // Build the effective text: user typed text + text file contents
    const fileContext = textFiles.map(f =>
      `\n\n[File: ${f.name}]\n${f.textContent}`
    ).join("");
    const modePrefix = messages.length === 0 ? buildModePrefix(activeMode) : "";
    const effectiveText = modePrefix + (text || "") + fileContext;

    // In-memory message for display (includes attachment metadata)
    const userDisplayMsg = {
      role: "user",
      content: text || (imageFiles.length ? "" : textFiles.map(f => f.name).join(", ")),
      _images: imageFiles,
      _fileNames: textFiles.map(f => f.name),
    };

    // Snapshot current history BEFORE state update (used for API call below)
    const prevMessages = messages;
    setMessages((prev) => [...prev, userDisplayMsg, { role: "assistant", content: "" }]);

    try {
      await Messages.append(activeId, "user", effectiveText || "(image)");

      let fullResponse = "";

      // Trim history to last 20 messages (10 turns) to keep requests under ~10k tokens
      const recentHistory = prevMessages.slice(-20);

      if (imageFiles.length > 0) {
        // Use in-memory history (no DB re-fetch) — strip display-only fields
        const historyMsgs = recentHistory.map(m => ({ role: m.role, content: m.content }));
        const imageContent = imageFiles.map(f => ({
          type: "image_url",
          image_url: { url: `data:${f.mimeType};base64,${f.base64}` },
        }));
        const richUserMsg = {
          role: "user",
          content: [...imageContent, { type: "text", text: effectiveText || "What is in this image?" }],
        };
        for await (const delta of chatStreamRich([...historyMsgs, richUserMsg])) {
          fullResponse += delta;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: fullResponse };
            return copy;
          });
        }
      } else {
        // Use in-memory history + new user message (no DB re-fetch)
        const apiMessages = [
          ...recentHistory.map(m => ({ role: m.role, content: m.content })),
          { role: "user", content: effectiveText },
        ];
        for await (const delta of chatStream(apiMessages)) {
          fullResponse += delta;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: fullResponse };
            return copy;
          });
        }
      }

      await Messages.append(activeId, "assistant", fullResponse);

      // Auto-title
      const convs = await Conversations.list();
      const conv  = convs.find((c) => c.id === activeId);
      if (conv && conv.title === "New Conversation") {
        const title = (text || "Image").slice(0, 48) + ((text?.length ?? 0) > 48 ? "…" : "");
        await Conversations.rename(activeId, title);
        await loadConversations();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: `**Error:** ${msg}` };
        return copy;
      });
    }
    setLoading(false);
  }

  function copyMessage(content, idx) {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }).catch(() => {});
  }

  async function newConversation() {
    try {
      const c = await Conversations.create("New Conversation");
      setActiveId(c.id); setMessages([]); setAttachedFiles([]);
      setCaptureSource(null); setPickerOpen(false);
      await Conversations.setActive(c.id);
      await loadConversations();
    } catch {}
  }

  async function deleteConversation(id) {
    try {
      await Conversations.delete(id);
      const remaining = conversations.filter((c) => c.id !== id);
      if (id === activeId) {
        if (remaining.length > 0) {
          await switchConversation(remaining[0].id);
        } else {
          const c = await Conversations.create("New Conversation");
          setActiveId(c.id); setMessages([]);
          await Conversations.setActive(c.id);
        }
      }
      await loadConversations();
    } catch {}
  }

  async function confirmRename() {
    if (!renamingId) { setRenamingId(null); return; }
    const trimmed = renameVal.trim();
    if (trimmed) {
      try {
        await Conversations.rename(renamingId, trimmed);
        await Notes.updateByConversationId(renamingId, { title: trimmed });
        await loadConversations();
      } catch {}
    }
    setRenamingId(null);
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  function openCtxMenu(e, id, title) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, id, title });
  }

  function openCaptureWindow() {
    window.open(
      chrome.runtime.getURL("sidepanel.html"),
      "lookupCapture",
      "width=420,height=680,resizable=yes,scrollbars=yes"
    );
  }

  const filteredConversations = searchQuery.trim()
    ? conversations.filter(c => (c.title ?? "").toLowerCase().includes(searchQuery.toLowerCase()))
    : conversations;

  const lastMsg   = messages[messages.length - 1];
  const showTyping = loading && (lastMsg?.role !== "assistant" || lastMsg?.content === "");

  return (
    <>
      <CosmicBg variant="dark" />
      <div
        className="chat-page"
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >

        {/* ── Drag overlay ──────────────────────────────────────────── */}
        {dragActive && (
          <div className="chat-drag-overlay">
            <div className="chat-drag-hint">Drop files or images here</div>
          </div>
        )}

        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <aside className={`chat-sidebar${sidebarOpen ? "" : " collapsed"}`}>
          <div className="chat-sidebar-top">
            <span className="chat-sidebar-logo">LookUp</span>
            <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              <button className="chat-new-btn" onClick={openCaptureWindow} title="Open capture window">⊞</button>
              <button className="chat-new-btn" onClick={newConversation}   title="New conversation">+</button>
            </div>
          </div>

          {/* Search */}
          <div className="chat-search-wrap">
            <input
              className="chat-search"
              placeholder="Search conversations…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="chat-conv-list">
            {filteredConversations.map((conv) =>
              renamingId === conv.id ? (
                <div key={conv.id} className="chat-conv-item active">
                  <input
                    ref={renameRef}
                    className="chat-conv-rename"
                    value={renameVal}
                    maxLength={60}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")  { e.preventDefault(); confirmRename(); }
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={confirmRename}
                  />
                </div>
              ) : (
                <button
                  key={conv.id}
                  className={`chat-conv-item${conv.id === activeId ? " active" : ""}`}
                  onClick={() => switchConversation(conv.id)}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); deleteConversation(conv.id); } }}
                  onContextMenu={(e) => openCtxMenu(e, conv.id, conv.title ?? "New conversation")}
                  title={conv.title ?? "New conversation"}
                >
                  <span className="chat-conv-label">{conv.title ?? "New conversation"}</span>
                </button>
              )
            )}
          </div>

          {/* ── Bottom: capture + mode ──────────────────────────────── */}
          <div className="chat-sidebar-bottom">
            {/* Mode dropdown — only visible when capture is active */}
            {captureSource && (
              <div className="chat-mode-select">
                <button
                  className="chat-mode-trigger"
                  onClick={() => setModeDropOpen(o => !o)}
                  title="Select output mode"
                >
                  <span>{MODES.find(m => m.key === activeMode)?.label ?? "Chat"}</span>
                  <span className="chat-mode-trigger-arrow">{modeDropOpen ? "▴" : "▾"}</span>
                </button>
                {modeDropOpen && (
                  <div className="chat-mode-dropdown">
                    {MODES.map(m => (
                      <button
                        key={m.key}
                        className={`chat-mode-opt${activeMode === m.key ? " active" : ""}`}
                        onClick={() => { setActiveMode(m.key); setModeDropOpen(false); }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Compact capture source button */}
            <div className="chat-cap-row">
              {captureSource ? (
                <>
                  <button className="chat-cap-btn active" onClick={openPicker} title="Change capture window">
                    <span className="chat-capture-dot active" />
                    <span className="chat-cap-label">{captureSource.title}</span>
                  </button>
                  <button className="chat-cap-clear" onClick={clearCapture} title="Stop capturing">✕</button>
                </>
              ) : (
                <button className="chat-cap-btn" onClick={openPicker} title="Capture a window on each message">
                  <span className="chat-capture-dot" />
                  <span className="chat-cap-none">📷 Capture screen</span>
                </button>
              )}
            </div>

            {/* Window picker */}
            {pickerOpen && (
              <div className="chat-capture-picker">
                <div className="chat-capture-picker-hint">Captures the active tab</div>
                <button className="chat-capture-picker-item none" onClick={clearCapture}>⊘ No capture</button>
                {pickerWindows.map(w => (
                  <button
                    key={w.id}
                    className={`chat-capture-picker-item${captureSource?.id === w.id ? " selected" : ""}`}
                    onClick={() => selectCaptureWindow(w)}
                  >
                    <span className="chat-capture-dot active" />
                    <span className="chat-capture-title">{w.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="chat-sidebar-back">
            <button
              onClick={() => window.open(chrome.runtime.getURL("built/dashboard.html"), "_self")}
              style={{ display:"block",width:"100%",padding:"7px 12px",borderRadius:"8px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",color:"#555",fontSize:"12px",cursor:"pointer",textAlign:"center",transition:"border-color 0.15s, color 0.15s" }}
              onMouseEnter={(e) => { e.target.style.borderColor="rgba(124,106,245,0.4)"; e.target.style.color="#9d8cff"; }}
              onMouseLeave={(e) => { e.target.style.borderColor="rgba(255,255,255,0.06)"; e.target.style.color="#555"; }}
            >
              ← Dashboard
            </button>
          </div>
        </aside>

        {/* ── Main panel ────────────────────────────────────────────── */}
        <div className="chat-main">
          <button
            className="chat-toggle-btn"
            onClick={() => setSidebarOpen((o) => !o)}
            title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            {sidebarOpen ? "◀" : "▶"}
          </button>

          <div className="chat-messages">
            {messages.length === 0 && !loading && (
              <div className="chat-empty">
                <div className="chat-empty-icon">✦</div>
                <div className="chat-empty-title">Ask anything</div>
                <div className="chat-empty-sub">
                  Ask LookUp to explain a concept, quiz you on a topic, or summarise your lecture material.
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="msg-user">
                  <div className="msg-user-bubble">
                    {m._images?.length > 0 && (
                      <div className="msg-user-imgs">
                        {m._images.map((img, ii) => (
                          <img key={ii} src={`data:${img.mimeType};base64,${img.base64}`} alt={img.name} className="msg-user-thumb" />
                        ))}
                      </div>
                    )}
                    {m._fileNames?.length > 0 && (
                      <div className="msg-user-chips">
                        {m._fileNames.map((name, fi) => (
                          <span key={fi} className="msg-user-chip">📄 {name}</span>
                        ))}
                      </div>
                    )}
                    {m.content && <span>{m.content}</span>}
                  </div>
                </div>
              ) : m.content === "" ? null : (
                <div key={i} className="msg-ai">
                  <div className="msg-ai-icon">✦</div>
                  <div className="msg-ai-wrap">
                    <AiContent content={m.content} />
                    <button className="msg-ai-copy" onClick={() => copyMessage(m.content, i)} title="Copy response">
                      {copiedIdx === i ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              )
            )}

            {showTyping && (
              <div className="msg-ai">
                <div className="msg-ai-icon">✦</div>
                <div className="typing"><span /><span /><span /></div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* ── Input bar ───────────────────────────────────────────── */}
          <div className="chat-input-bar">

            {/* Manual attachment preview strip */}
            {attachedFiles.length > 0 && (
              <div className="chat-attach-preview">
                {attachedFiles.map(f => (
                  <div key={f.id} className="chat-attach-item">
                    {f.isImage
                      ? <img src={`data:${f.mimeType};base64,${f.base64}`} alt={f.name} className="chat-attach-thumb" />
                      : <span className="chat-attach-icon">📄</span>
                    }
                    <span className="chat-attach-name">{f.name}</span>
                    <button className="chat-attach-remove" onClick={() => removeAttachment(f.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}

            <div className="chat-input-wrap">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,text/*,.json,.md,.csv,.js,.ts,.jsx,.tsx,.py,.java,.c,.cpp,.h,.rs,.go"
                style={{ display: "none" }}
                onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
              />
              {/* 📎 attach button */}
              <button
                className="chat-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Attach file"
              >📎</button>

              <textarea
                ref={textareaRef}
                className="chat-textarea"
                placeholder="Ask a question…"
                rows={1}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(); }}
                onKeyDown={handleKey}
              />
              <button
                className="chat-send"
                onClick={send}
                disabled={loading || (!input.trim() && attachedFiles.length === 0 && !captureSource)}
                aria-label="Send"
              >↑</button>
            </div>
            <p className="chat-hint">Enter to send · Shift+Enter for new line</p>
          </div>
        </div>

        {/* ── Context menu ──────────────────────────────────────────── */}
        {ctxMenu && (
          <div className="chat-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
            <button className="chat-ctx-item" onClick={() => { setRenamingId(ctxMenu.id); setRenameVal(ctxMenu.title); setCtxMenu(null); }}>
              Rename
            </button>
            <button className="chat-ctx-item chat-ctx-delete" onClick={() => { deleteConversation(ctxMenu.id); setCtxMenu(null); }}>
              Delete
            </button>
          </div>
        )}
      </div>
    </>
  );
}
