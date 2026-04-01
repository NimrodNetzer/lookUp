import { useState, useRef, useEffect, useCallback } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import CosmicBg from "./CosmicBg.jsx";
import { Conversations, Messages, Notes, Settings } from "../storage.js";
import { chatStream, chatStreamRich, transcribeOnly } from "../groq-client.js";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import cpp from "highlight.js/lib/languages/cpp";
import java from "highlight.js/lib/languages/java";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import xml from "highlight.js/lib/languages/xml";
import "highlight.js/styles/github-dark.css";
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", javascript);
hljs.registerLanguage("ts", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", cpp);
hljs.registerLanguage("java", java);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function bidiDir(text) {
  const plain = text.replace(/<[^>]+>/g, " ");
  const rtl = (plain.match(/[\u0590-\u05FF\u0600-\u06FF\uFB1D-\uFB4F]/g) ?? []).length;
  const ltr = (plain.match(/[A-Za-z]/g) ?? []).length;
  return rtl > ltr ? "rtl" : "auto";
}

function renderMathExpr(expr, displayMode) {
  try {
    return katex.renderToString(expr.trim(), { displayMode, throwOnError: false, output: "html" });
  } catch {
    return escapeHtml(expr);
  }
}

// ── Markdown renderer (mirrors sidepanel renderMarkdown + hljs code blocks) ───
function renderMd(raw) {
  const blocks = [];

  // 1. Stash fenced code blocks (with hljs highlighting)
  let text = (raw ?? "").replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const l = lang.trim();
    let highlighted;
    try {
      highlighted = l && hljs.getLanguage(l)
        ? hljs.highlight(code.trimEnd(), { language: l }).value
        : hljs.highlightAuto(code.trimEnd()).value;
    } catch {
      highlighted = escapeHtml(code.trimEnd());
    }
    const id = `cb${Date.now()}-${blocks.length}`;
    blocks.push(
      `<div class="chat-code-block">` +
      `<div class="chat-code-header"><span class="chat-code-lang">${l || "code"}</span>` +
      `<button class="chat-code-copy" onclick="(function(b){const pre=b.closest('.chat-code-block').querySelector('code');navigator.clipboard.writeText(pre.innerText).then(()=>{b.textContent='Copied!';setTimeout(()=>b.textContent='Copy',2000)}).catch(()=>{})})(this)">Copy</button></div>` +
      `<pre class="chat-pre"><code id="${id}" class="hljs">${highlighted}</code></pre></div>`
    );
    return `\x00B${blocks.length - 1}\x00`;
  });

  // 2. Stash block math \begin{cases}...\end{cases}
  text = text.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_, body) => {
    blocks.push(`<div class="math-block">${renderMathExpr(`\\begin{cases}${body}\\end{cases}`, true)}</div>`);
    return `\x00B${blocks.length - 1}\x00`;
  });

  // 3. Stash $$...$$ block math
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    blocks.push(`<div class="math-block">${renderMathExpr(math.trim(), true)}</div>`);
    return `\x00B${blocks.length - 1}\x00`;
  });

  // 4. Stash $...$ inline math
  text = text.replace(/\$([^$\n]+?)\$/g, (_, math) => {
    blocks.push(`<span class="math-inline">${renderMathExpr(math.trim(), false)}</span>`);
    return `\x00B${blocks.length - 1}\x00`;
  });

  // 5. HTML-escape the rest
  text = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // 6. Stash inline code
  text = text.replace(/`([^`\n]+)`/g, (_, c) => {
    blocks.push(`<code class="chat-code">${c}</code>`);
    return `\x00B${blocks.length - 1}\x00`;
  });

  // 7. Block-level inline transforms
  text = text.replace(/^#### (.+)$/gm, '<h4 class="chat-h4" dir="auto">$1</h4>');
  text = text.replace(/^### (.+)$/gm,  '<h3 class="chat-h3" dir="auto">$1</h3>');
  text = text.replace(/^## (.+)$/gm,   '<h2 class="chat-h2" dir="auto">$1</h2>');
  text = text.replace(/^# (.+)$/gm,    '<h2 class="chat-h2" dir="auto">$1</h2>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g,     '<em>$1</em>');
  text = text.replace(/__(.+?)__/g,     '<strong>$1</strong>');
  text = text.replace(/_(.+?)_/g,       '<em>$1</em>');
  text = text.replace(/^---+$/gm,       '<hr class="chat-hr">');
  text = text.replace(/^&gt; (.+)$/gm,  '<blockquote class="chat-bq">$1</blockquote>');

  // 8. Line-by-line: build lists and paragraphs
  const BLOCK_STARTS = ['<h2', '<h3', '<h4', '<hr', '<blockquote', '<div', '\x00B'];
  const lines = text.split('\n');
  const out = [];
  let inUl = false, inOl = false;

  for (const line of lines) {
    if (/^[*-] /.test(line)) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul class="chat-ul">'); inUl = true; }
      const li = line.replace(/^[*-] /, '');
      out.push(`<li dir="${bidiDir(li)}">${li}</li>`);
    } else if (/^\d+\. /.test(line)) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol class="chat-ol">'); inOl = true; }
      const li = line.replace(/^\d+\. /, '');
      out.push(`<li dir="${bidiDir(li)}">${li}</li>`);
    } else {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
      const t = line.trim();
      if (!t) {
        out.push('<div class="chat-gap"></div>');
      } else if (BLOCK_STARTS.some(b => t.startsWith(b))) {
        out.push(t);
      } else {
        out.push(`<p class="chat-p" dir="${bidiDir(t)}">${t}</p>`);
      }
    }
  }
  if (inUl) out.push('</ul>');
  if (inOl) out.push('</ol>');

  // 9. Restore stashed blocks
  return out.join('\n').replace(/\x00B(\d+)\x00/g, (_, i) => blocks[+i] ?? "");
}

function parseFlashcards(content) {
  try {
    const parsed = JSON.parse(content);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(c => c && typeof c.front === "string" && typeof c.back === "string")
    ) return parsed;
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

const QUIZ_ANSWER_RE = /\*\*(?:Answer|תשובה)[^*\n]*\*\*[:\s]*/i;

function QuizContent({ content }) {
  const [revealed, setRevealed] = useState({});

  // 3-strategy split (mirrors sidepanel renderQuiz)
  let blocks = content.split(/\n[ \t]*---[ \t]*\n/).map(b => b.trim()).filter(Boolean);
  if (blocks.length <= 1)
    blocks = content.split(/\n+(?=\*\*Q\d)/).map(b => b.trim()).filter(Boolean);
  if (blocks.length <= 1)
    blocks = content.split(/\n\n+(?=\d+\.)/).map(b => b.trim()).filter(Boolean);

  let qNum = 0;
  return (
    <div>
      {blocks.map((block, bi) => {
        if (!block) return null;
        const match = QUIZ_ANSWER_RE.exec(block);
        if (!match) return <div key={bi} dangerouslySetInnerHTML={{ __html: renderMd(block) }} />;
        const q = qNum++;
        const questionPart = block.slice(0, match.index).trim().replace(/^\*?\*?Q?\d+[.)]\*?\*?\s*/i, "");
        const answerPart   = block.slice(match.index + match[0].length).trim();
        return (
          <div key={bi} className="chat-quiz-block">
            <div className="chat-quiz-question">
              <span className="chat-quiz-num">Q{q + 1}.</span>
              <span dangerouslySetInnerHTML={{ __html: renderMd(questionPart) }} />
            </div>
            <button className="chat-quiz-reveal" onClick={() => setRevealed(r => ({ ...r, [q]: !r[q] }))}>
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
  { key: "chat",      label: "Chat",      emoji: "💬" },
  { key: "summary",   label: "Summary",   emoji: "📄" },
  { key: "explain",   label: "Explain",   emoji: "📖" },
  { key: "quiz",      label: "Quiz",      emoji: "❓" },
  { key: "flashcard", label: "Flashcard", emoji: "🃏" },
  { key: "voice",     label: "Voice",     emoji: "🎙" },
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

// ── Note context menu (with expandable Delete sub-options) ───────────────────
function NoteCtxMenu({ menu, onRename, onCloseTab, onDeleteStorage }) {
  const [showDeleteOpts, setShowDeleteOpts] = useState(false);
  return (
    <div className="chat-ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
      <button className="chat-ctx-item" onClick={onRename}>Rename</button>
      {!showDeleteOpts ? (
        <button className="chat-ctx-item chat-ctx-delete" onClick={() => setShowDeleteOpts(true)}>
          Delete ▸
        </button>
      ) : (
        <>
          <button className="chat-ctx-item chat-ctx-delete" onClick={onCloseTab}>
            ✕ Close tab
          </button>
          <button className="chat-ctx-item chat-ctx-delete" onClick={onDeleteStorage}>
            🗑 Delete from storage
          </button>
          <button className="chat-ctx-item" onClick={() => setShowDeleteOpts(false)}>
            ← Back
          </button>
        </>
      )}
    </div>
  );
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
  const [noteResults,    setNoteResults]    = useState([]);
  const [pinnedNotes,    setPinnedNotes]    = useState([]); // notes opened from search, shown as sidebar tabs
  const [noteCtxMenu,    setNoteCtxMenu]    = useState(null); // { x, y, note }
  const searchRef                           = useRef(null);

  // Image lightbox
  const [lightboxSrc,    setLightboxSrc]    = useState(null);

  // Attachment state (manual drag/paste/file)
  const [attachedFiles,  setAttachedFiles]  = useState([]);

  // Drag-and-drop state
  const [dragActive,     setDragActive]     = useState(false);
  const dragCounter                         = useRef(0);

  // Voice recording state
  const [recording,      setRecording]      = useState(false);
  const [transcribing,   setTranscribing]   = useState(false);
  const mediaRecRef                         = useRef(null);
  const audioChunksRef                      = useRef([]);


  // Persistent mode (saved to storage)
  const [activeMode,     setActiveModeState] = useState("chat");
  const [modeDropOpen,   setModeDropOpen]   = useState(false);
  const modeDropRef = useRef(null);

  // Persistent capture source for this conversation
  // null = no capture | { winId, title } = a selected window
  const [captureSource,  setCaptureSource]  = useState(null);

  // Capture card picker state (shown inside the sidebar card)
  const [pickerOpen,     setPickerOpen]     = useState(false);
  const [pickerWindows,  setPickerWindows]  = useState([]);
  const [availableWindows, setAvailableWindows] = useState(0);
  const [panelOpen,        setPanelOpen]        = useState(false);
  const pickerRef = useRef(null);

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
      setMessages(msgs.map((m) => ({ role: m.role, content: m.content, _images: m.images ?? [], hasImage: !!m.hasImage })));
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

  // Close context menus on outside click
  useEffect(() => {
    if (!ctxMenu && !noteCtxMenu) return;
    const close = () => { setCtxMenu(null); setNoteCtxMenu(null); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ctxMenu, noteCtxMenu]);

  // Search notes whenever query changes
  useEffect(() => {
    if (!searchQuery.trim()) { setNoteResults([]); return; }
    Notes.search(searchQuery).then(setNoteResults).catch(() => setNoteResults([]));
  }, [searchQuery]);

  // Close search results on outside click
  useEffect(() => {
    if (!searchQuery.trim()) return;
    function onDocClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchQuery("");
        setNoteResults([]);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [searchQuery]);

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

  // ── Voice recording (active when mode === "voice") ───────────────────────────
  async function startVoiceAndSend() {
    if (recording) {
      mediaRecRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      audioChunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
        setTranscribing(true);
        try {
          const blob = new Blob(audioChunksRef.current, { type: rec.mimeType || "audio/webm" });
          const text = await transcribeOnly(blob);
          if (text) {
            // Auto-send the transcribed text
            setInput(text);
            setTimeout(() => send(text), 0);
          }
        } catch (err) {
          console.error("Transcription failed:", err);
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (err) {
      console.error("Mic access denied:", err);
    }
  }

  // ── Note attach (from sidebar search result) ─────────────────────────────────
  // Pin note as sidebar tab and open it as a conversation
  async function pinNote(note) {
    setSearchQuery("");
    setNoteResults([]);

    let convId = note.conversation_id;

    if (convId) {
      // Verify the conversation still exists
      const existing = await Conversations.get(convId).catch(() => null);
      if (!existing) convId = null;
    }

    if (!convId) {
      // Create a new conversation named after the note
      const conv = await Conversations.create(note.title || note.filename).catch(() => null);
      if (!conv) return;
      convId = conv.id;
      // Link the note to this new conversation so future clicks work
      await Notes.updateMeta(note.filename, { conversation_id: convId }).catch(() => {});
      await loadConversations();
    }

    // Add to pinned list with resolved convId
    setPinnedNotes(prev => {
      const without = prev.filter(n => n.filename !== note.filename);
      return [...without, { ...note, conversation_id: convId }];
    });

    await switchConversation(convId);

    // If the conversation has no messages (note was created before conversation
    // linking worked, or messages were lost), bootstrap from the note's content.
    const existingMsgs = await Messages.listByConversation(convId).catch(() => []);
    if (existingMsgs.length === 0) {
      const fullNote = await Notes.get(note.filename).catch(() => null);
      if (fullNote?.content) {
        await Messages.append(convId, "assistant", fullNote.content).catch(() => {});
        setMessages([{ role: "assistant", content: fullNote.content }]);
      }
    }
  }


  async function renameNote(note) {
    const newTitle = window.prompt("Rename note:", note.title || note.filename);
    if (!newTitle?.trim()) return;
    try {
      await Notes.updateMeta(note.filename, { title: newTitle.trim() });
      // Update pinned tab title in-place so the sidebar reflects it immediately
      setPinnedNotes(prev => prev.map(n => n.filename === note.filename ? { ...n, title: newTitle.trim() } : n));
      // Refresh search results
      if (searchQuery.trim()) setNoteResults(await Notes.search(searchQuery));
    } catch {}
  }

  async function deleteNote(note) {
    if (!window.confirm(`Delete "${note.title || note.filename}"?`)) return;
    try {
      await Notes.delete(note.filename);
      setNoteResults(prev => prev.filter(n => n.filename !== note.filename));
      setPinnedNotes(prev => prev.filter(n => n.filename !== note.filename));
    } catch {}
  }

  function openNoteCtxMenu(e, note) {
    e.preventDefault();
    setNoteCtxMenu({ x: e.clientX, y: e.clientY, note });
  }

  // Close mode dropdown when clicking outside
  useEffect(() => {
    if (!modeDropOpen) return;
    function handleClickOutside(e) {
      if (modeDropRef.current && !modeDropRef.current.contains(e.target)) {
        setModeDropOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modeDropOpen]);

  // Track available Chrome windows to show/hide capture row
  useEffect(() => {
    async function updateWindowCount() {
      try {
        const wins = await chrome.windows.getAll();
        setAvailableWindows(wins.filter(w => w.type === "normal").length);
      } catch { setAvailableWindows(0); }
    }
    updateWindowCount();
    chrome.windows.onCreated.addListener(updateWindowCount);
    chrome.windows.onRemoved.addListener(updateWindowCount);
    return () => {
      chrome.windows.onCreated.removeListener(updateWindowCount);
      chrome.windows.onRemoved.removeListener(updateWindowCount);
    };
  }, []);

  // Close picker when clicking outside
  useEffect(() => {
    if (!pickerOpen) return;
    function handleClickOutside(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pickerOpen]);

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
  async function send(overrideText) {
    const text = (overrideText ?? input).trim();
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
    const modePrefix = buildModePrefix(activeMode);
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
      await Messages.append(activeId, "user", effectiveText || "(image)", imageFiles.length > 0 ? imageFiles : null);

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
        setConversations(prev => prev.map(c => c.id === activeId ? { ...c, title } : c));
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
      setConversations(remaining); // immediate sidebar update — no ghost tab
      if (id === activeId) {
        if (remaining.length > 0) {
          await switchConversation(remaining[0].id);
        } else {
          const c = await Conversations.create("New Conversation");
          setActiveId(c.id); setMessages([]);
          await Conversations.setActive(c.id);
          await loadConversations();
        }
      }
    } catch {}
  }

  async function confirmRename() {
    if (!renamingId) { setRenamingId(null); return; }
    const trimmed = renameVal.trim();
    if (trimmed) {
      try {
        await Conversations.rename(renamingId, trimmed);
        await Notes.updateByConversationId(renamingId, { title: trimmed });
        setConversations(prev => prev.map(c => c.id === renamingId ? { ...c, title: trimmed } : c));
        setPinnedNotes(prev => prev.map(n => n.conversation_id === renamingId ? { ...n, title: trimmed } : n));
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

  async function openCaptureWindow() {
    try {
      if (panelOpen) {
        await chrome.runtime.sendMessage({ type: "closeSidePanel" });
        setPanelOpen(false);
      } else {
        const win = await chrome.windows.getCurrent();
        await chrome.sidePanel.open({ windowId: win.id });
        setPanelOpen(true);
      }
    } catch {
      window.open(chrome.runtime.getURL("sidepanel.html"), "lookupCapture", "width=420,height=680,resizable=yes,scrollbars=yes");
    }
  }


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

          {/* Search notes */}
          <div className="chat-search-wrap" ref={searchRef}>
            <input
              className="chat-search"
              placeholder="Search notes…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />

            {/* Note search results — dropdown inside search wrapper */}
            {searchQuery.trim() && (
              <div className="chat-note-results">
                {noteResults.length === 0
                  ? <div className="chat-note-results-empty">No notes found</div>
                  : noteResults.map(n => (
                      <button
                        key={n.filename}
                        className="chat-note-result-item"
                        onClick={() => pinNote(n)}
                        onContextMenu={e => openNoteCtxMenu(e, n)}
                        title="Click to open · Right-click for more"
                      >
                        <span className="chat-note-result-title">{n.title || n.filename}</span>
                      </button>
                    ))
                }
              </div>
            )}
          </div>

          <div className="chat-conv-list">
            {/* Pinned notes — identical appearance to conversation tabs */}
            {pinnedNotes.map(note => (
              <button
                key={note.filename}
                className={`chat-conv-item${note.conversation_id === activeId ? " active" : ""}`}
                onClick={() => note.conversation_id && switchConversation(note.conversation_id)}
                onContextMenu={e => openNoteCtxMenu(e, note)}
                title={note.title || note.filename}
              >
                <span className="chat-conv-label">{note.title || note.filename}</span>
              </button>
            ))}
            {/* Regular conversations — exclude those already shown as pinned note tabs */}
            {conversations.filter(conv => !pinnedNotes.some(n => n.conversation_id === conv.id)).map((conv) =>
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
            {/* Mode dropdown — only shown when a capture source is selected */}
            <div className="chat-mode-select" ref={modeDropRef} style={!captureSource ? { display: "none" } : {}}>
              <button
                className="chat-mode-trigger"
                onClick={() => setModeDropOpen(o => !o)}
                title="Select mode"
              >
                <span>{(() => { const m = MODES.find(m => m.key === activeMode); return m ? `${m.emoji} ${m.label}` : "💬 Chat"; })()}</span>
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
                      <span className="chat-mode-opt-emoji">{m.emoji}</span>
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Compact capture source button — hidden when only one window and nothing selected */}
            <div className="chat-cap-row" style={!captureSource && availableWindows <= 1 ? { display: "none" } : {}}>
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
              <div className="chat-capture-picker" ref={pickerRef}>
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
                          <img key={ii} src={`data:${img.mimeType};base64,${img.base64}`} alt={img.name || ""} className="msg-user-thumb" style={{cursor:"zoom-in"}} onClick={() => setLightboxSrc(`data:${img.mimeType};base64,${img.base64}`)} />
                        ))}
                      </div>
                    )}
                    {m._images?.length === 0 && m.hasImage && (
                      <div className="msg-img-placeholder">📷 Screenshot</div>
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
              {/* 📎 attach file — hidden in voice mode */}
              {activeMode !== "voice" && (
                <button
                  className="chat-attach-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach file"
                >📎</button>
              )}

              {activeMode === "voice" ? (
                /* Voice mode: full-width mic button */
                <button
                  className={`chat-voice-main${recording ? " recording" : ""}${transcribing ? " transcribing" : ""}`}
                  onClick={startVoiceAndSend}
                  disabled={transcribing || loading}
                  title={recording ? "Stop & send" : transcribing ? "Transcribing…" : "Tap to record"}
                >
                  {transcribing ? "✦ Transcribing…" : recording ? "⏹ Stop & send" : "🎙 Tap to record"}
                </button>
              ) : (
                <>
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
                    onClick={() => send()}
                    disabled={loading || (!input.trim() && attachedFiles.length === 0 && !captureSource)}
                    aria-label="Send"
                  >↑</button>
                </>
              )}
            </div>
            <p className="chat-hint">Enter to send · Shift+Enter for new line</p>
          </div>
        </div>

        {/* ── Conversation context menu ──────────────────────────────── */}
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

        {/* ── Note context menu ──────────────────────────────────────── */}
        {noteCtxMenu && (
          <NoteCtxMenu
            menu={noteCtxMenu}
            onRename={() => { renameNote(noteCtxMenu.note); setNoteCtxMenu(null); }}
            onCloseTab={() => { setPinnedNotes(prev => prev.filter(n => n.filename !== noteCtxMenu.note.filename)); setNoteCtxMenu(null); }}
            onDeleteStorage={() => { deleteNote(noteCtxMenu.note); setNoteCtxMenu(null); }}
          />
        )}
      </div>

      {/* ── Image lightbox ─────────────────────────────────────────────── */}
      {lightboxSrc && (
        <div
          className="img-lightbox-overlay"
          onClick={() => setLightboxSrc(null)}
          onKeyDown={(e) => e.key === "Escape" && setLightboxSrc(null)}
          role="dialog"
          aria-modal="true"
        >
          <img src={lightboxSrc} alt="" className="img-lightbox-img" onClick={(e) => e.stopPropagation()} />
          <button className="img-lightbox-close" onClick={() => setLightboxSrc(null)} aria-label="Close">✕</button>
        </div>
      )}
    </>
  );
}
