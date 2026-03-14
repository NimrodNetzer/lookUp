"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import CosmicBg from "../components/CosmicBg";

const GATEWAY = "http://127.0.0.1:18789";

type Role = "user" | "assistant";
interface Message     { role: Role; content: string; }
interface Conversation { id: number; title: string | null; }
interface CtxMenu      { x: number; y: number; id: number; title: string; }

function parseFlashcards(content: string): { front: string; back: string }[] | null {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.front !== undefined) return parsed;
  } catch {}
  return null;
}

function isQuiz(content: string) { return content.includes("**Answer:**"); }

function renderMd(raw: string): string {
  let h = raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^#### (.+)$/gm, '<h4 class="chat-h4">$1</h4>')
    .replace(/^### (.+)$/gm,  '<h3 class="chat-h3">$1</h3>')
    .replace(/^## (.+)$/gm,   '<h2 class="chat-h2">$1</h2>')
    .replace(/^# (.+)$/gm,    '<h2 class="chat-h2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/`([^`\n]+)`/g,   '<code class="chat-code">$1</code>')
    .replace(/^---+$/gm,       '<hr class="chat-hr">')
    .replace(/^[*-] (.+)$/gm,  '<li>$1</li>');
  h = h.replace(/(<li>[\s\S]*?<\/li>)(\n<li>[\s\S]*?<\/li>)*/g,
    (m) => `<ul class="chat-ul">${m}</ul>`);
  h = h.replace(/\n\n+/g, '</p><p class="chat-p">').replace(/\n/g, "<br>");
  return `<p class="chat-p">${h}</p>`;
}

function FlashcardGrid({ cards }: { cards: { front: string; back: string }[] }) {
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  return (
    <div className="chat-fc-grid">
      {cards.map((card, i) => (
        <div key={i} className={`chat-fc${flipped[i] ? " flipped" : ""}`}
          onClick={() => setFlipped(f => ({ ...f, [i]: !f[i] }))}>
          <div className="chat-fc-inner">
            <div className="chat-fc-front" dangerouslySetInnerHTML={{ __html: renderMd(card.front) }} />
            <div className="chat-fc-back"  dangerouslySetInnerHTML={{ __html: renderMd(card.back) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function QuizContent({ content }: { content: string }) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
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

function AiContent({ content }: { content: string }) {
  const cards = parseFlashcards(content);
  if (cards) return <FlashcardGrid cards={cards} />;
  if (isQuiz(content)) return <QuizContent content={content} />;
  return <div className="msg-ai-body" dangerouslySetInnerHTML={{ __html: renderMd(content) }} />;
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId,      setActiveId]      = useState<number | null>(null);
  const [messages,      setMessages]      = useState<Message[]>([]);
  const [input,         setInput]         = useState("");
  const [loading,       setLoading]       = useState(false);
  const [renamingId,    setRenamingId]    = useState<number | null>(null);
  const [renameVal,     setRenameVal]     = useState("");
  const [ctxMenu,       setCtxMenu]       = useState<CtxMenu | null>(null);
  const [copiedIdx,     setCopiedIdx]     = useState<number | null>(null);
  const [sidebarOpen,   setSidebarOpen]   = useState(true);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const renameRef   = useRef<HTMLInputElement>(null);
  const activeIdRef = useRef<number | null>(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const loadConversations = useCallback(async () => {
    try {
      const r = await fetch(`${GATEWAY}/conversations/list`);
      if (r.ok) setConversations(await r.json());
    } catch {}
  }, []);

  const switchConversation = useCallback(async (id: number) => {
    setActiveId(id);
    try {
      const r = await fetch(`${GATEWAY}/chat/history?conversationId=${id}`);
      if (r.ok) setMessages(await r.json());
      fetch(`${GATEWAY}/conversations/switch/${id}`, { method: "POST" }).catch(() => {});
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${GATEWAY}/conversations/active`);
        if (!r.ok) return;
        const data = await r.json();
        await loadConversations();
        if (data.id) { setActiveId(data.id); if (Array.isArray(data.messages)) setMessages(data.messages); }
      } catch {}
    })();
  }, [loadConversations]);

  useEffect(() => { const iv = setInterval(loadConversations, 3000); return () => clearInterval(iv); }, [loadConversations]);

  useEffect(() => {
    const iv = setInterval(async () => {
      const id = activeIdRef.current;
      if (!id) return;
      try {
        const r = await fetch(`${GATEWAY}/chat/history?conversationId=${id}`);
        if (r.ok) {
          const msgs: Message[] = await r.json();
          setMessages(prev => JSON.stringify(prev) !== JSON.stringify(msgs) ? msgs : prev);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => { if (renamingId !== null) renameRef.current?.focus(); }, [renamingId]);
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ctxMenu]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setLoading(true);
    setMessages(prev => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    try {
      const res = await fetch(`${GATEWAY}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId: activeId }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Gateway error");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean; conversationId?: number; error?: string };
          if (data.delta) {
            setMessages(prev => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + data.delta };
              return copy;
            });
          }
          if (data.done) { if (data.conversationId) setActiveId(data.conversationId); loadConversations(); }
          if (data.error) throw new Error(data.error);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages(prev => { const copy = [...prev]; copy[copy.length - 1] = { role: "assistant", content: `**Error:** ${msg}` }; return copy; });
    }
    setLoading(false);
  }

  function copyMessage(content: string, idx: number) {
    navigator.clipboard.writeText(content).then(() => { setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 2000); }).catch(() => {});
  }

  async function newConversation() {
    try {
      const r = await fetch(`${GATEWAY}/conversations/new`, { method: "POST" });
      if (!r.ok) return;
      const { id } = await r.json();
      setActiveId(id); setMessages([]); await loadConversations();
    } catch {}
  }

  async function deleteConversation(id: number) {
    try {
      const r = await fetch(`${GATEWAY}/conversations/${id}`, { method: "DELETE" });
      if (!r.ok) return;
      const remaining = conversations.filter(c => c.id !== id);
      if (id === activeId) {
        if (remaining.length > 0) { await switchConversation(remaining[0].id); }
        else {
          const nr = await fetch(`${GATEWAY}/conversations/new`, { method: "POST" });
          if (nr.ok) { const { id: newId } = await nr.json(); setActiveId(newId); setMessages([]); }
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
        await fetch(`${GATEWAY}/conversations/${renamingId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
        await loadConversations();
      } catch {}
    }
    setRenamingId(null);
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  function openCtxMenu(e: React.MouseEvent, id: number, title: string) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, id, title });
  }

  const lastMsg = messages[messages.length - 1];
  const showTyping = loading && (lastMsg?.role !== "assistant" || lastMsg?.content === "");

  return (
    <>
    <CosmicBg variant="dark" />
    <div className="chat-page">

      <aside className={`chat-sidebar${sidebarOpen ? "" : " collapsed"}`}>
        <div className="chat-sidebar-top">
          <span className="chat-sidebar-logo">LookUp</span>
          <button className="chat-new-btn" onClick={newConversation} title="New conversation">+</button>
        </div>

        <div className="chat-conv-list">
          {conversations.map(conv =>
            renamingId === conv.id ? (
              <div key={conv.id} className="chat-conv-item active">
                <input
                  ref={renameRef}
                  className="chat-conv-rename"
                  value={renameVal}
                  maxLength={60}
                  onChange={e => setRenameVal(e.target.value)}
                  onKeyDown={e => {
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
                onAuxClick={e => { if (e.button === 1) { e.preventDefault(); deleteConversation(conv.id); } }}
                onContextMenu={e => openCtxMenu(e, conv.id, conv.title ?? "New conversation")}
                title={conv.title ?? "New conversation"}
              >
                <span className="chat-conv-label">{conv.title ?? "New conversation"}</span>
              </button>
            )
          )}
        </div>

        <div className="chat-sidebar-back">
          <Link href="/">← Dashboard</Link>
        </div>
      </aside>

      <div className="chat-main">
        <button
          className="chat-toggle-btn"
          onClick={() => setSidebarOpen(o => !o)}
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
                This chat stays in sync with the extension sidebar.
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
              onChange={e => { setInput(e.target.value); autoResize(); }}
              onKeyDown={handleKey}
            />
            <button className="chat-send" onClick={send} disabled={loading || !input.trim()} aria-label="Send">
              &#x2191;
            </button>
          </div>
          <p className="chat-hint">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>

      {ctxMenu && (
        <div className="chat-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={e => e.stopPropagation()}>
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
