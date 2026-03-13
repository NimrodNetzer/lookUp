"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles } from "lucide-react";
import clsx from "clsx";

const GATEWAY = "http://127.0.0.1:18789";

interface LogEntry {
  type: "command" | "result" | "error";
  text: string;
}

export default function CommandChat({ onRefresh }: { onRefresh: () => void }) {
  const [input,   setInput]   = useState("");
  const [log,     setLog]     = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${GATEWAY}/command/log`)
      .then(r => r.ok ? r.json() : [])
      .then((entries: { type: string; text: string }[]) => {
        setLog(entries.map(e => ({ type: e.type as LogEntry["type"], text: e.text })));
      })
      .catch(() => {});
  }, []);

  async function send() {
    const cmd = input.trim();
    if (!cmd || loading) return;
    setInput("");
    setLoading(true);
    setLog((prev) => [...prev, { type: "command", text: cmd }]);

    try {
      const res = await fetch(`${GATEWAY}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gateway error");

      const lines: string[] = data.results?.length
        ? data.results
        : [data.message ?? "Done."];

      setLog((prev) => [...prev, { type: "result", text: lines.join("\n") }]);

      if (data.actions?.some((a: { action: string }) => a.action !== "message")) {
        onRefresh();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLog((prev) => [...prev, { type: "error", text: msg }]);
    }
    setLoading(false);
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span className="text-xs font-semibold text-muted uppercase tracking-widest">AI Organiser</span>
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div className="max-h-48 overflow-y-auto px-3 py-2 flex flex-col gap-2 border-b border-border">
          {log.slice(-6).map((entry, i) => (
            <div key={i} className={clsx("text-xs rounded-lg px-3 py-2 whitespace-pre-wrap break-words", {
              "bg-accent/10 text-accent/90 font-medium": entry.type === "command",
              "bg-teal/5 text-teal/80 border border-teal/20": entry.type === "result",
              "bg-red-500/10 text-red-400": entry.type === "error",
            })}>
              {entry.type === "command" && <span className="opacity-60 mr-1">›</span>}
              {entry.text}
            </div>
          ))}
          {loading && (
            <div className="flex gap-1 px-3 py-2">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 bg-bg border border-border rounded-lg px-3 py-1.5 focus-within:border-accent transition-colors">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder='e.g. "merge last 3 notes into Lecture 5"'
            disabled={loading}
            className="flex-1 bg-transparent text-xs text-text placeholder:text-muted/50 outline-none min-w-0"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="text-accent hover:text-accent/70 disabled:opacity-30 transition-opacity"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

    </div>
  );
}
