"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

const GATEWAY = "http://127.0.0.1:18789";

type Role = "user" | "assistant";
interface Message { role: Role; content: string; }

function renderMd(raw: string) {
  let html = raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  html = html
    .replace(/^### (.+)$/gm, '<h3 class="chat-h3">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2 class="chat-h2">$1</h2>')
    .replace(/^# (.+)$/gm,   '<h2 class="chat-h2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/`([^`\n]+)`/g,   '<code class="chat-code">$1</code>')
    .replace(/^---+$/gm, '<hr class="chat-hr">')
    .replace(/^[*-] (.+)$/gm,  '<li>$1</li>')
    .replace(/(<li>.*<\/li>(\n|$))+/g, (m) => `<ul class="chat-ul">${m}</ul>`)
    .replace(/\n\n+/g, '</p><p class="chat-p">')
    .replace(/\n/g, "<br>");

  return `<p class="chat-p">${html}</p>`;
}

export default function ChatPage() {
  const [messages,        setMessages]        = useState<Message[]>([]);
  const [input,           setInput]           = useState("");
  const [loading,         setLoading]         = useState(false);
  const [conversationId,  setConversationId]  = useState<number | null>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load persistent conversation from gateway on mount
  useEffect(() => {
    fetch(`${GATEWAY}/conversations/active`)
      .then((r) => r.json())
      .then((data) => {
        if (data.id) setConversationId(data.id);
        if (Array.isArray(data.messages)) setMessages(data.messages);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${GATEWAY}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gateway error");
      if (data.conversationId) setConversationId(data.conversationId);
      if (Array.isArray(data.history)) setMessages(data.history);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: `**Error:** ${msg}` }]);
    }
    setLoading(false);
  }

  async function clearChat() {
    const r = await fetch(`${GATEWAY}/chat/clear`, { method: "POST" }).catch(() => null);
    const data = r ? await r.json().catch(() => null) : null;
    if (data?.conversationId) setConversationId(data.conversationId);
    setMessages([]);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  return (
    <div className="chat-page">
      <header className="chat-header">
        <span className="chat-logo">LookUp</span>
        <span className="chat-model-badge">Llama 4 Scout</span>
        {messages.length > 0 && (
          <button className="chat-new-btn" onClick={clearChat}>+ New Chat</button>
        )}
        <Link href="/" className="chat-back">← Dashboard</Link>
      </header>

      <div className="chat-messages">
        {messages.length === 0 && !loading && (
          <div className="chat-empty">
            <div style={{ fontSize: 40 }}>✨</div>
            <div className="chat-empty-title">Ask anything</div>
            <div className="chat-empty-sub">
              Ask LookUp to explain a concept, quiz you on a topic, or help you understand your lecture material.
              This chat stays in sync with the extension sidebar.
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg-user">
              <div className="msg-user-bubble">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="msg-ai">
              <div className="msg-ai-icon">✦</div>
              <div
                className="msg-ai-body"
                dangerouslySetInnerHTML={{ __html: renderMd(m.content) }}
              />
            </div>
          )
        )}

        {loading && (
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
            placeholder="Ask a question…"
            rows={1}
            value={input}
            onChange={(e) => { setInput(e.target.value); autoResize(); }}
            onKeyDown={handleKey}
          />
          <button
            className="chat-send"
            onClick={send}
            disabled={loading || !input.trim()}
            aria-label="Send"
          >↑</button>
        </div>
        <p className="chat-hint">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
