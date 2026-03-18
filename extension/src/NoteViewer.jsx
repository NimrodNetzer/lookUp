import { useEffect, useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Notes } from "../storage.js";
import { transcribeOnly } from "../groq-client.js";
import FlashcardViewer from "./FlashcardViewer.jsx";

const modeBadge = {
  summary:         { label: "Summary",    color: "bg-accent/15 text-accent border-accent/30" },
  explain:         { label: "Explain",    color: "bg-teal/15 text-teal border-teal/30" },
  quiz:            { label: "Quiz",       color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  flashcard:       { label: "Flashcards", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  session:         { label: "Session",    color: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
  chat:            { label: "Notes",      color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  "audio-summary": { label: "Audio",      color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
  "audio-explain": { label: "Audio",      color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
  "audio-quiz":    { label: "Audio",      color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
  mixed:           { label: "Mixed",      color: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
};

const sectionBadge = {
  flashcard: { label: "🃏 Flashcards", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  quiz:      { label: "❓ Quiz",       color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  text:      { label: "📄 Notes",      color: "bg-accent/15 text-accent border-accent/30" },
};

function tryParseCards(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed[0]?.front !== undefined) return parsed;
  } catch {}
  return null;
}

function parseQuiz(content) {
  const pairs = [];
  // Covers: **Q1.** / **Q1:** / **Question 1.** / **1.**  +  **Answer:** / **A:** / **A.**
  const regex = /\*\*(?:Q(?:uestion)?\s*\d+[.:]?|\d+\.)\*\*\s*([\s\S]*?)\n\*\*(?:Answer|A)[.:]\*\*\s*([\s\S]*?)(?=\n\*\*(?:Q(?:uestion)?\s*\d+[.:]?|\d+\.)\*\*|$)/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const q = match[1].trim();
    const a = match[2].trim();
    if (q && a) pairs.push({ q, a });
  }
  return pairs.length > 0 ? pairs : null;
}

function detectType(text) {
  if (tryParseCards(text)) return "flashcard";
  if (parseQuiz(text)) return "quiz";
  return "text";
}

function QuizViewer({ pairs }) {
  const [revealed, setRevealed] = useState({});
  return (
    <div className="flex flex-col gap-3">
      {pairs.map((p, i) => (
        <div key={i} className="chat-quiz-block">
          <p style={{ fontSize: 17, lineHeight: 1.6, color: "#e8e8f0", margin: "0 0 10px" }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#7c6af5", marginRight: 8, letterSpacing: "0.05em" }}>Q{i+1}</span>
            {p.q}
          </p>
          <button
            className="chat-quiz-reveal"
            onClick={() => setRevealed((r) => ({ ...r, [i]: !r[i] }))}
          >
            {revealed[i] ? "▼ Hide Answer" : "▶ Show Answer"}
          </button>
          {revealed[i] && (
            <div className="chat-quiz-answer">{p.a}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function SectionBlock({ heading, type, children }) {
  const badge = sectionBadge[type];
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {heading && <span className="text-sm font-semibold text-text">{heading}</span>}
        <span className={`text-xs font-bold px-2 py-0.5 rounded-lg border ${badge.color}`}>{badge.label}</span>
      </div>
      {children}
    </div>
  );
}

function SectionContent({ text, showBadge }) {
  const headingMatch = text.match(/^###\s+(.+)\n\n([\s\S]*)$/);
  const heading = headingMatch?.[1] ?? null;
  const body = headingMatch ? headingMatch[2].trim() : text;

  const cards = tryParseCards(body);
  if (cards) {
    return showBadge ? (
      <SectionBlock heading={heading} type="flashcard"><FlashcardViewer cards={cards} /></SectionBlock>
    ) : <FlashcardViewer cards={cards} />;
  }
  const quiz = parseQuiz(body);
  if (quiz) {
    return showBadge ? (
      <SectionBlock heading={heading} type="quiz"><QuizViewer pairs={quiz} /></SectionBlock>
    ) : <QuizViewer pairs={quiz} />;
  }
  return showBadge ? (
    <SectionBlock heading={heading} type="text">
      <article className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{body}</ReactMarkdown>
      </article>
    </SectionBlock>
  ) : (
    <article className="prose">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{body}</ReactMarkdown>
    </article>
  );
}

function downloadNote(note, filename) {
  const blob = new Blob([note.content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.md$/, "") + ".md";
  a.click();
  URL.revokeObjectURL(url);
}

export default function NoteViewer({ filename, onBack }) {
  const [note,        setNote]        = useState(null);
  const [notFound,    setNotFound]    = useState(false);
  const [editing,     setEditing]     = useState(false);
  const [editTitle,   setEditTitle]   = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving,      setSaving]      = useState(false);
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [recState,    setRecState]    = useState("idle"); // idle | recording | transcribing
  const [recSeconds,  setRecSeconds]  = useState(0);
  const [recToast,    setRecToast]    = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef        = useRef([]);
  const timerRef         = useRef(null);
  const menuRef          = useRef(null);
  const textareaRef      = useRef(null);

  useEffect(() => {
    function handler(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const stopTimer = useCallback(() => { clearInterval(timerRef.current); }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        stopTimer();
        setRecState("transcribing");
        try {
          const blob       = new Blob(chunksRef.current, { type: "audio/webm" });
          const transcript = await transcribeOnly(blob);
          if (transcript?.trim()) {
            const ts      = new Date().toLocaleString();
            const append  = `\n\n---\n\n🎙 *Recorded — ${ts}*\n\n${transcript.trim()}`;
            const current = (await Notes.get(filename))?.content ?? "";
            await Notes.save(filename, {
              title:           note.title,
              mode:            note.mode,
              folder_id:       note.folder_id ?? null,
              tags:            note.tags ?? [],
              createdAt:       note.createdAt,
              conversation_id: note.conversation_id ?? undefined,
            }, current + append);
            const updated = await Notes.get(filename);
            setNote(updated);
            try { new BroadcastChannel("lookup-data").postMessage({ type: "notes-updated" }); } catch {}
            setRecToast("✓ Recording appended to note");
          } else {
            setRecToast("No speech detected.");
          }
        } catch (err) {
          setRecToast("Transcription failed: " + (err.message ?? "unknown error"));
        }
        setRecState("idle");
        setRecSeconds(0);
        setTimeout(() => setRecToast(null), 3500);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecState("recording");
      setRecSeconds(0);
      timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch {
      setRecToast("Microphone access denied.");
      setTimeout(() => setRecToast(null), 3000);
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function fmtTime(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  useEffect(() => {
    if (!filename) { setNotFound(true); return; }
    Notes.get(filename).then((n) => {
      if (!n) setNotFound(true);
      else setNote(n);
    });
  }, [filename]);

  function startEditing() {
    setEditTitle(note.title ?? filename);
    setEditContent(note.content ?? "");
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  async function saveEdit() {
    if (saving) return;
    setSaving(true);
    try {
      await Notes.save(filename, {
        title:           editTitle.trim() || note.title,
        mode:            note.mode,
        folder_id:       note.folder_id ?? null,
        tags:            note.tags ?? [],
        createdAt:       note.createdAt,
        conversation_id: note.conversation_id ?? undefined,
      }, editContent);
      const updated = await Notes.get(filename);
      setNote(updated);
      setEditing(false);
      // Notify other open views (LearningHub, TodayStrip) that this note changed
      try { new BroadcastChannel("lookup-data").postMessage({ type: "notes-updated" }); } catch {}
    } catch {}
    setSaving(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  if (notFound) {
    return (
      <main className="max-w-2xl mx-auto px-5 py-8">
        <button onClick={onBack} className="text-sm text-accent hover:underline mb-6 block">← Back to notes</button>
        <p className="text-muted">Note not found.</p>
      </main>
    );
  }

  if (!note) {
    return (
      <main className="max-w-2xl mx-auto px-5 py-8">
        <p className="text-muted">Loading…</p>
      </main>
    );
  }

  // Split into sections if content was merged from multiple captures
  const sections = note.content.split(/\n\n---\n\n/);
  const isMultiSection = sections.length > 1;

  // Determine badge: "mixed" if multiple section types exist, otherwise use note.mode
  let badgeKey = note.mode ?? "summary";
  if (isMultiSection) {
    const types = new Set(sections.map((s) => {
      const body = s.match(/^###\s+.+\n\n([\s\S]*)$/)?.[1]?.trim() ?? s.trim();
      return detectType(body);
    }));
    if (types.size > 1) badgeKey = "mixed";
  }
  const badge = modeBadge[badgeKey] ?? modeBadge.summary;

  return (
    <main className="max-w-2xl mx-auto px-5 py-8">
      {recToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-surface border border-border rounded-xl px-5 py-2.5 text-sm text-text shadow-lg pointer-events-none">
          {recToast}
        </div>
      )}
      <div className="sticky top-0 z-20 -mx-5 px-5 py-3 mb-6 print:hidden pointer-events-none">
        <div className="flex items-center justify-between max-w-2xl mx-auto pointer-events-auto">
        <button onClick={onBack} className="text-sm text-accent hover:underline drop-shadow-sm">← Back to notes</button>
        <div className="flex items-center gap-2">
          {/* Active recording states — always visible */}
          {recState === "recording" && (
            <button onClick={stopRecording}
              className="flex items-center gap-2 text-xs font-semibold text-pink-400 border border-pink-400/40 bg-pink-500/10 px-3 py-1.5 rounded-lg transition-colors hover:bg-pink-500/20">
              <span className="w-2 h-2 rounded-full bg-pink-400 animate-pulse" />
              {fmtTime(recSeconds)} · Stop
            </button>
          )}
          {recState === "transcribing" && (
            <span className="flex items-center gap-1.5 text-xs text-muted border border-border px-3 py-1.5 rounded-lg">
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              Transcribing…
            </span>
          )}

          {/* Edit mode save/cancel */}
          {editing && (
            <>
              <button onClick={cancelEdit} className="text-xs text-muted hover:text-text border border-border px-3 py-1.5 rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}

          {/* User-created note: single ⋯ dropdown */}
          {note.mode === "chat" && !editing && recState === "idle" && (
            <div ref={menuRef} className="relative">
              <button onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted hover:text-text border border-border hover:border-accent/40 px-3 py-1.5 rounded-lg transition-colors">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>
                Options
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-50 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden min-w-[170px]">
                  <button onClick={() => { startRecording(); setMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-pink-500/10 hover:text-pink-400 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    Record mic
                  </button>
                  <button onClick={() => { startEditing(); setMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-accent/10 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Edit
                  </button>
                  <div className="border-t border-border/60 mx-1" />
                  <button onClick={() => { downloadNote(note, filename); setMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-accent/10 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Export .md
                  </button>
                  <button onClick={() => { window.print(); setMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-accent/10 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    Export PDF
                  </button>
                </div>
              )}
            </div>
          )}

          {/* AI-generated notes: just the two export buttons */}
          {note.mode !== "chat" && !editing && (
            <>
              <button onClick={() => downloadNote(note, filename)}
                className="text-xs text-muted hover:text-text border border-border hover:border-accent/40 px-3 py-1.5 rounded-lg transition-colors">
                ↓ Export .md
              </button>
              <button onClick={() => window.print()}
                className="flex items-center gap-1.5 text-xs text-muted hover:text-text border border-border hover:border-accent/40 px-3 py-1.5 rounded-lg transition-colors">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Export PDF
              </button>
            </>
          )}
        </div>
        </div>
      </div>

      <header className="mb-7">
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-2xl font-extrabold text-text flex-1 leading-snug">
            {note.title ?? filename}
          </h1>
          <span className={`text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-lg border shrink-0 ${badge.color}`}>
            {badge.label}
          </span>
        </div>
        <p className="text-xs text-muted mt-2">
          {new Date(note.createdAt).toLocaleString()}
        </p>
      </header>

      {editing ? (
        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title…"
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted outline-none focus:border-accent transition-colors"
          />
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={(e) => { if (e.key === "s" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(); } }}
            placeholder="Write your note… (markdown supported)"
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted outline-none focus:border-accent transition-colors resize-none font-mono leading-relaxed"
            style={{ minHeight: "60vh" }}
          />
          <p className="text-xs text-muted">Tip: <kbd className="border border-border rounded px-1 py-0.5 font-mono text-[10px]">⌘S</kbd> to save</p>
        </div>
      ) : isMultiSection ? (
        <div className="flex flex-col gap-8">
          {sections.map((section, i) => (
            <div key={i}>
              <SectionContent text={section.trim()} showBadge={true} />
              {i < sections.length - 1 && <hr className="border-border mt-8" />}
            </div>
          ))}
        </div>
      ) : (
        <SectionContent text={note.content} showBadge={false} />
      )}
    </main>
  );
}
