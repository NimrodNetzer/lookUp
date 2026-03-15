import { useState, useRef, useEffect, useCallback } from "react";
import CosmicBg from "./CosmicBg.jsx";
import { Conversations, Messages, Notes } from "../storage.js";
import { chatStream } from "../groq-client.js";

// ── Lightweight markdown renderer (same as original chat page) ────────────────
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

// ── Main chat page ────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [conversations, setConversations] = useState([]);
  const [activeId,      setActiveId]      = useState(null);
  const [messages,      setMessages]      = useState([]);
  const [input,         setInput]         = useState("");
  const [loading,       setLoading]       = useState(false);
  const [renamingId,    setRenamingId]    = useState(null);
  const [renameVal,     setRenameVal]     = useState("");
  const [ctxMenu,       setCtxMenu]       = useState(null);
  const [copiedIdx,     setCopiedIdx]     = useState(null);
  const [sidebarOpen,   setSidebarOpen]   = useState(true);

  const bottomRef   = useRef(null);
  const textareaRef = useRef(null);
  const renameRef   = useRef(null);

  // ── Load conversations ──────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    try { setConversations(await Conversations.list()); } catch {}
  }, []);

  // ── Switch to a conversation ────────────────────────────────────────────────
  const switchConversation = useCallback(async (id) => {
    setActiveId(id);
    try {
      const msgs = await Messages.listByConversation(id);
      setMessages(msgs.map((m) => ({ role: m.role, content: m.content })));
      await Conversations.setActive(id);
    } catch {}
  }, []);

  // ── Init: load active conversation ─────────────────────────────────────────
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
            // Create first conversation
            const c = await Conversations.create("New Conversation");
            setActiveId(c.id);
            setMessages([]);
            await Conversations.setActive(c.id);
            await loadConversations();
          }
        }
      } catch {}
    })();
  }, [loadConversations, switchConversation]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => { if (renamingId !== null) renameRef.current?.focus(); }, [renamingId]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ctxMenu]);

  // ── Send message ────────────────────────────────────────────────────────────
  async function send() {
    const text = input.trim();
    if (!text || loading || !activeId) return;
    setInput("");
    setLoading(true);

    // Optimistically append user message
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);

    try {
      // Persist user message
      await Messages.append(activeId, "user", text);

      // Build history for the API (exclude the empty assistant placeholder)
      const history = await Messages.listByConversation(activeId);
      const apiMessages = history.map((m) => ({ role: m.role, content: m.content }));

      // Stream the response
      let fullResponse = "";
      for await (const delta of chatStream(apiMessages)) {
        fullResponse += delta;
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: fullResponse };
          return copy;
        });
      }

      // Persist the complete assistant message
      await Messages.append(activeId, "assistant", fullResponse);

      // Auto-title the conversation after first exchange
      const convs = await Conversations.list();
      const conv  = convs.find((c) => c.id === activeId);
      if (conv && conv.title === "New Conversation") {
        const title = text.slice(0, 48) + (text.length > 48 ? "…" : "");
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
      setActiveId(c.id);
      setMessages([]);
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

  const lastMsg = messages[messages.length - 1];
  const showTyping = loading && (lastMsg?.role !== "assistant" || lastMsg?.content === "");

  return (
    <>
      <CosmicBg variant="dark" />
      <div className="chat-page">

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside className={`chat-sidebar${sidebarOpen ? "" : " collapsed"}`}>
          <div className="chat-sidebar-top">
            <span className="chat-sidebar-logo">LookUp</span>
            <button className="chat-new-btn" onClick={newConversation} title="New conversation">+</button>
          </div>

          <div className="chat-conv-list">
            {conversations.map((conv) =>
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

        {/* ── Main panel ──────────────────────────────────────────────── */}
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
                  <div className="msg-user-bubble">{m.content}</div>
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

          <div className="chat-input-bar">
            <div className="chat-input-wrap">
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                placeholder="Ask a question..."
                rows={1}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(); }}
                onKeyDown={handleKey}
              />
              <button className="chat-send" onClick={send} disabled={loading || !input.trim()} aria-label="Send">
                ↑
              </button>
            </div>
            <p className="chat-hint">Enter to send · Shift+Enter for new line</p>
          </div>
        </div>

        {/* ── Context menu ────────────────────────────────────────────── */}
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
