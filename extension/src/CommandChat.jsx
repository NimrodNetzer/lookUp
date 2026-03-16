import { useState, useRef, useEffect } from "react";
import { Sparkles } from "lucide-react";
import clsx from "clsx";
import { Settings, Notes } from "../storage.js";
import { processCommand } from "../groq-client.js";

export default function CommandChat({ onRefresh }) {
  const [input,        setInput]        = useState("");
  const [log,          setLog]          = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [pendingMerge, setPendingMerge] = useState(null); // { command, actions, summary, history }
  const [history,      setHistory]      = useState([]);   // clarification thread
  const inputRef = useRef(null);

  useEffect(() => {
    Settings.getCommandLog().then((entries) => {
      setLog(entries.map((e) => ({ type: e.type, text: e.text })));
    }).catch(() => {});
  }, []);

  async function send() {
    const cmd = input.trim();
    if (!cmd || loading) return;
    setInput("");
    setLoading(true);
    setLog((prev) => [...prev, { type: "command", text: cmd }]);

    const nextHistory = [...history, { role: "user", content: cmd }];

    try {
      const allNotes = await Notes.list();
      const prefs    = await Settings.getPreferences();
      const raw      = await processCommand(cmd, allNotes, prefs?.aiOrganiserPreferences ?? "", history);

      let actions;
      try {
        const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
        actions = JSON.parse(jsonStr);
      } catch {
        const msg = "AI returned an unreadable response. Try rephrasing your command.";
        setLog((prev) => [...prev, { type: "error", text: msg }]);
        await Settings.appendCommandLog({ type: "error", text: msg });
        setLoading(false);
        return;
      }

      // AI needs clarification — keep history alive for follow-up
      const clarify = actions.find(a => a.action === "clarify");
      if (clarify) {
        const question = `? ${clarify.question}`;
        setLog((prev) => [...prev, { type: "result", text: question }]);
        await Settings.appendCommandLog({ type: "command", text: cmd });
        await Settings.appendCommandLog({ type: "result", text: question });
        setHistory([...nextHistory, { role: "assistant", content: raw }]);
        setLoading(false);
        return;
      }

      // Got actionable response — clear clarification thread
      setHistory([]);

      const merges = actions.filter(a => a.action === "merge");

      if (merges.length > 0) {
        const lines = merges.map(m =>
          `Merge [${(m.filenames ?? []).join(", ")}] → "${m.title}"`
        );
        const nonDestructive = actions.filter(a => a.action !== "merge");
        if (nonDestructive.length > 0) {
          lines.push(`Also: ${nonDestructive.length} rename/course update(s)`);
        }
        setPendingMerge({ command: cmd, actions, summary: lines.join("\n") });
        setLoading(false);
        return;
      }

      await executeActions(cmd, actions);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLog((prev) => [...prev, { type: "error", text: msg }]);
      await Settings.appendCommandLog({ type: "error", text: msg });
      setLoading(false);
    }
  }

  async function executeActions(cmd, actions) {
    const results = [];
    for (const action of actions) {
      try {
        if (action.action === "message") {
          results.push(action.text);
        } else if (action.action === "rename") {
          await Notes.updateMeta(action.filename, { title: action.title });
          results.push(`Renamed "${action.filename}" → "${action.title}"`);
        } else if (action.action === "set_course") {
          await Notes.updateMeta(action.filename, { course: action.course });
          results.push(`Set course "${action.course}" on "${action.filename}"`);
        } else if (action.action === "merge") {
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const slug = (action.title || "merged").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
          const newFilename = `${ts}_${slug}.md`;
          await Notes.merge(action.filenames, newFilename, action.title ?? "Merged Note");
          results.push(`Merged ${action.filenames.length} notes → "${action.title}"`);
        }
      } catch (e) {
        results.push(`✗ Failed: ${e.message}`);
      }
    }

    const resultText = results.join("\n") || "Done.";
    setLog((prev) => [...prev, { type: "result", text: resultText }]);
    await Settings.appendCommandLog({ type: "command", text: cmd });
    await Settings.appendCommandLog({ type: "result", text: resultText });

    if (actions.some((a) => a.action !== "message")) onRefresh();
    setLoading(false);
  }

  function confirmMerge() {
    if (!pendingMerge) return;
    const { command, actions } = pendingMerge;
    setPendingMerge(null);
    setLoading(true);
    executeActions(command, actions);
  }

  function cancelMerge() {
    setPendingMerge(null);
    setHistory([]);
    setLog((prev) => [...prev, { type: "error", text: "Cancelled." }]);
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span className="text-xs font-semibold text-muted uppercase tracking-widest">AI Organiser</span>
      </div>

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
              {[0,1,2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Merge confirmation */}
      {pendingMerge && (
        <div className="mx-3 my-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs">
          <p className="text-yellow-400 font-semibold mb-1">Confirm merge (cannot be undone)</p>
          <p className="text-muted/80 whitespace-pre-wrap mb-2">{pendingMerge.summary}</p>
          <div className="flex gap-2">
            <button onClick={confirmMerge}
              className="px-3 py-1 rounded bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 transition-colors">
              Confirm
            </button>
            <button onClick={cancelMerge}
              className="px-3 py-1 rounded bg-border/40 text-muted hover:bg-border/60 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 bg-bg border border-border rounded-lg px-3 py-1.5 focus-within:border-accent transition-colors">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder={history.length > 0 ? "Type your answer…" : 'e.g. "merge last 3 notes into Lecture 5"'}
            disabled={loading || !!pendingMerge}
            className="flex-1 bg-transparent text-xs text-text placeholder:text-muted/50 outline-none min-w-0"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim() || !!pendingMerge}
            className="text-accent hover:text-accent/70 disabled:opacity-30 transition-opacity"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
