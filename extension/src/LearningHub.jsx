import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Plus, Pencil, Trash2, Check, X, ChevronRight, MessageSquare } from "lucide-react";
import clsx from "clsx";
import { Notes, Folders } from "../storage.js";
import NotesList from "./NotesList.jsx";
import CommandChat from "./CommandChat.jsx";

const TYPE_GROUPS = [
  { key: "summary",   label: "Summary",    icon: "📄" },
  { key: "explain",   label: "Explain",    icon: "📖" },
  { key: "quiz",      label: "Quiz",       icon: "❓" },
  { key: "flashcard", label: "Flashcards", icon: "🃏" },
  { key: "session",   label: "Session",    icon: "📚" },
  { key: "audio",     label: "Audio",      icon: "🎙️" },
  { key: "chat",      label: "General Notes", icon: "💬" },
];

function getTypeKey(mode) {
  if (!mode) return "summary";
  if (mode.startsWith("audio")) return "audio";
  const keys = TYPE_GROUPS.map((g) => g.key);
  return keys.includes(mode) ? mode : "summary";
}

function findFolder(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findFolder(n.children ?? [], id);
    if (found) return found;
  }
  return null;
}

function getFolderPath(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return [n];
    const sub = getFolderPath(n.children ?? [], id);
    if (sub.length > 0) return [n, ...sub];
  }
  return [];
}

function countNotesRecursive(node, counts) {
  return (counts[node.id] ?? 0) + (node.children ?? []).reduce((s, c) => s + countNotesRecursive(c, counts), 0);
}

function flattenFolders(nodes, depth = 0) {
  return nodes.flatMap((n) => [{ folder: n, depth }, ...flattenFolders(n.children ?? [], depth + 1)]);
}

// ── Inline input ──────────────────────────────────────────────────────────────
function InlineInput({ initial = "", placeholder, onConfirm, onCancel }) {
  const [val, setVal] = useState(initial);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input ref={ref} type="text" value={val} onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) onConfirm(val.trim()); if (e.key === "Escape") onCancel(); }}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-bg border border-accent/50 rounded px-2 py-1 text-sm text-text outline-none" />
      <button onClick={() => val.trim() && onConfirm(val.trim())} className="text-teal hover:text-teal/70 shrink-0">
        <Check className="w-3.5 h-3.5" />
      </button>
      <button onClick={onCancel} className="text-muted hover:text-text shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Folder card ───────────────────────────────────────────────────────────────
function FolderCard({ folder, noteCount, subfolderCount, onSelect, onDropNote, onRefresh, isSubfolder }) {
  const [dragOver,   setDragOver]   = useState(false);
  const [renaming,   setRenaming]   = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleRename(name) {
    await Folders.rename(folder.id, name);
    setRenaming(false); onRefresh();
  }

  async function handleDelete() {
    await Folders.delete(folder.id); onRefresh();
  }

  return (
    <div
      onClick={() => !renaming && !confirming && onSelect(folder.id)}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.getData("text/plain"); if (f) onDropNote(f, folder.id); }}
      className={clsx(
        "relative group border-2 rounded-xl cursor-pointer transition-all select-none",
        isSubfolder ? "bg-surface/50 p-3" : "bg-surface p-5",
        dragOver ? "border-teal/60 bg-teal/10 scale-[1.02]"
          : isSubfolder ? "border-border/50 hover:border-accent/30 hover:bg-surface/80"
          : "border-border hover:border-accent/50 hover:shadow-md"
      )}
    >
      <div className={clsx("mb-2", isSubfolder ? "text-2xl" : "text-4xl mb-3")}>
        {dragOver ? "📂" : isSubfolder ? "🗂️" : "📁"}
      </div>

      {renaming ? (
        <InlineInput initial={folder.name} placeholder="Folder name…" onConfirm={handleRename} onCancel={() => setRenaming(false)} />
      ) : (
        <p className={clsx("truncate pr-6", isSubfolder ? "text-xs font-medium text-muted" : "font-semibold text-sm text-text")}>
          {folder.name}
        </p>
      )}

      {!renaming && (
        <p className="text-[10px] text-muted/70 mt-1">
          {noteCount} note{noteCount !== 1 ? "s" : ""}{subfolderCount > 0 && ` · ${subfolderCount} sub`}
        </p>
      )}

      {!renaming && !confirming && (
        <ChevronRight className="absolute right-3 bottom-5 w-4 h-4 text-muted/30 group-hover:text-muted/70 transition-colors" />
      )}

      {!renaming && !confirming && (
        <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button title="Rename" onClick={() => setRenaming(true)}
            className="p-1 rounded hover:bg-accent/15 text-muted hover:text-accent transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button title="Delete" onClick={() => setConfirming(true)}
            className="p-1 rounded hover:bg-red-500/15 text-muted hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {confirming && (
        <div className="absolute inset-0 bg-surface/95 rounded-xl flex flex-col items-center justify-center gap-3 p-4" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs text-text font-semibold text-center">Delete "{folder.name}"?</p>
          <div className="flex gap-2">
            <button onClick={handleDelete} className="px-3 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 font-semibold transition-colors">Delete</button>
            <button onClick={() => setConfirming(false)} className="px-3 py-1 text-xs text-muted hover:text-text border border-border rounded-lg transition-colors">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sidebar drop targets ──────────────────────────────────────────────────────
function SidebarDropTarget({ label, count, active, onClick, onDrop }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <button onClick={onClick}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.getData("text/plain"); if (f) onDrop(f); }}
      className={clsx("text-left px-4 py-2 text-xs transition-colors flex items-center justify-between",
        dragOver ? "bg-teal/15 text-teal border-l-2 border-teal/60"
          : active ? "bg-accent/15 text-accent font-semibold"
          : "text-muted hover:text-text hover:bg-surface/60")}>
      <span>{label}</span>
      <span className="text-[10px]">{count}</span>
    </button>
  );
}

function SidebarFolderDropTarget({ folder, depth, onDrop, onSelect }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <button onClick={() => onSelect(folder.id)}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.getData("text/plain"); if (f) onDrop(f); }}
      style={{ paddingLeft: `${16 + depth * 12}px` }}
      className={clsx("w-full text-left flex items-center gap-1.5 py-1.5 pr-3 text-xs transition-colors rounded-sm",
        dragOver ? "bg-teal/15 text-teal" : "text-muted hover:text-text hover:bg-surface/60")}>
      <span className="text-sm">{dragOver ? "📂" : "📁"}</span>
      <span className="truncate">{folder.name}</span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LearningHub({ onOpenNote, onOpenChat }) {
  const [activeFolderId,  setActiveFolderId]  = useState(null);
  const [activeType,      setActiveType]      = useState(null);
  const [folders,         setFolders]         = useState([]);
  const [localNotes,      setLocalNotes]      = useState([]);
  const [addingFolder,    setAddingFolder]    = useState(false);
  const [showUnattached,  setShowUnattached]  = useState(false);
  const [toast,           setToast]           = useState(null);
  const toastTimer = useRef(null);

  const fetchFolders = useCallback(async () => {
    try { setFolders(await Folders.list()); } catch {}
  }, []);

  const fetchNotes = useCallback(async () => {
    try { setLocalNotes(await Notes.list()); } catch {}
  }, []);

  useEffect(() => { fetchFolders(); fetchNotes(); }, [fetchFolders, fetchNotes]);

  const refresh = useCallback(() => { fetchNotes(); fetchFolders(); }, [fetchNotes, fetchFolders]);

  // Live sync: refresh when sidepanel saves a note
  useEffect(() => {
    const ch = new BroadcastChannel("lookup-data");
    ch.onmessage = (e) => { if (e.data?.type === "notes-updated") refresh(); };
    return () => ch.close();
  }, [refresh]);

  useEffect(() => {
    if (activeFolderId !== null && folders.length > 0) {
      if (!findFolder(folders, activeFolderId)) setActiveFolderId(null);
    }
  }, [folders, activeFolderId]);

  useEffect(() => { setShowUnattached(false); setActiveType(null); }, [activeFolderId]);

  const unattachedNotes  = useMemo(() => localNotes.filter((n) => !n.folder_id), [localNotes]);
  const contextNotes     = useMemo(() => activeFolderId !== null ? localNotes.filter((n) => n.folder_id === activeFolderId) : unattachedNotes, [localNotes, unattachedNotes, activeFolderId]);
  const showingNotes     = useMemo(() => activeFolderId !== null && showUnattached ? unattachedNotes : contextNotes, [activeFolderId, showUnattached, unattachedNotes, contextNotes]);

  const contextTypeCounts = useMemo(() => {
    const counts = {};
    for (const n of showingNotes) { const k = getTypeKey(n.mode); counts[k] = (counts[k] ?? 0) + 1; }
    return counts;
  }, [showingNotes]);

  const notesPerFolder = useMemo(() => {
    const counts = {};
    for (const n of localNotes) { if (n.folder_id) counts[n.folder_id] = (counts[n.folder_id] ?? 0) + 1; }
    return counts;
  }, [localNotes]);

  const totalNotesPerFolder = useMemo(() => {
    const result = {};
    function fill(nodes) { for (const node of nodes) { fill(node.children ?? []); result[node.id] = countNotesRecursive(node, notesPerFolder); } }
    fill(folders);
    return result;
  }, [folders, notesPerFolder]);

  const activeFolder   = useMemo(() => activeFolderId !== null ? findFolder(folders, activeFolderId) : null, [folders, activeFolderId]);
  const displayFolders = activeFolderId === null ? folders : (activeFolder?.children ?? []);
  const folderPath     = useMemo(() => activeFolderId !== null ? getFolderPath(folders, activeFolderId) : [], [folders, activeFolderId]);
  const parentFolderId = folderPath.length >= 2 ? folderPath[folderPath.length - 2].id : null;
  const visibleNotes   = useMemo(() => activeType !== null ? showingNotes.filter((n) => getTypeKey(n.mode) === activeType) : showingNotes, [showingNotes, activeType]);

  function showToast(msg) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  async function handleDropNote(filename, folderId) {
    try {
      await Notes.updateMeta(filename, { folder_id: folderId === -1 ? null : folderId });
      const targetName = folderId === -1 ? "Unsorted" : (findFolder(folders, folderId)?.name ?? "folder");
      showToast(`Moved to "${targetName}"`);
      refresh();
    } catch {}
  }

  async function handleCreateFolder(name) {
    await Folders.create(name, activeFolderId);
    setAddingFolder(false); fetchFolders();
  }

  const typeLabel  = TYPE_GROUPS.find((g) => g.key === activeType)?.label;
  const notesLabel = activeFolderId !== null && showUnattached
    ? (activeType ? `Unsorted — ${typeLabel}` : "Unsorted Notes")
    : activeFolderId !== null
      ? (activeType ? `${activeFolder?.name ?? "Folder"} — ${typeLabel}` : (activeFolder?.name ?? "Folder"))
      : (activeType ? `Unsorted — ${typeLabel}` : "Unsorted Notes");

  return (
    <div className="flex gap-6 items-start relative">
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-surface border border-border rounded-xl px-5 py-2.5 text-sm text-text shadow-lg pointer-events-none animate-fadeIn">
          {toast}
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 sticky top-8 flex flex-col gap-3">
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-xs font-semibold text-muted uppercase tracking-widest">
              {activeFolderId !== null ? "Filter" : "Unsorted"}
            </span>
          </div>
          <div className="flex flex-col py-1">
            <button
              onClick={() => { setActiveType(null); setShowUnattached(false); }}
              className={clsx("text-left px-4 py-2 text-xs transition-colors flex items-center justify-between",
                activeType === null && !showUnattached ? "bg-accent/15 text-accent font-semibold" : "text-muted hover:text-text hover:bg-surface/60")}>
              <span>{activeFolderId !== null ? "All notes" : "All unsorted"}</span>
              <span className="text-[10px]">{contextNotes.length}</span>
            </button>
            {TYPE_GROUPS.map(({ key, label, icon }) => {
              const count = contextTypeCounts[key] ?? 0;
              if (count === 0) return null;
              return (
                <button key={key} onClick={() => { setActiveType(activeType === key ? null : key); setShowUnattached(false); }}
                  className={clsx("text-left px-4 py-2 text-xs transition-colors flex items-center gap-2",
                    activeType === key && !showUnattached ? "bg-accent/15 text-accent font-semibold" : "text-muted hover:text-text hover:bg-surface/60")}>
                  <span>{icon}</span>
                  <span className="flex-1 truncate">{label}</span>
                  <span className="text-[10px]">{count}</span>
                </button>
              );
            })}
            {activeFolderId !== null && (
              <>
                <div className="mx-3 my-1 border-t border-border/50" />
                <SidebarDropTarget label="Unsorted" count={unattachedNotes.length} active={showUnattached}
                  onClick={() => { setShowUnattached((v) => !v); setActiveType(null); }}
                  onDrop={(filename) => handleDropNote(filename, -1)} />
              </>
            )}
          </div>
        </div>

        {folders.length > 0 && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border">
              <span className="text-xs font-semibold text-muted uppercase tracking-widest">Drop to folder</span>
            </div>
            <div className="flex flex-col py-1 max-h-48 overflow-y-auto">
              {flattenFolders(folders).map(({ folder, depth }) => (
                <SidebarFolderDropTarget key={folder.id} folder={folder} depth={depth}
                  onDrop={(filename) => handleDropNote(filename, folder.id)}
                  onSelect={setActiveFolderId} />
              ))}
            </div>
          </div>
        )}

        <CommandChat onRefresh={refresh} />
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col gap-5">
        <div className="flex items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            {activeFolderId !== null && (
              <button onClick={() => setActiveFolderId(parentFolderId)}
                className="flex items-center gap-1.5 text-xs text-muted hover:text-text transition-colors px-2.5 py-1.5 rounded-lg border border-border hover:border-accent/40 bg-surface">
                ← Back
              </button>
            )}
            <nav className="flex items-center gap-1.5 text-xs flex-wrap">
              <button onClick={() => { setActiveFolderId(null); setActiveType(null); }}
                className={clsx("font-semibold transition-colors", activeFolderId === null ? "text-text" : "text-muted hover:text-text")}>
                Folders
              </button>
              {folderPath.map((f, i) => (
                <span key={f.id} className="flex items-center gap-1.5">
                  <ChevronRight className="w-3 h-3 text-muted/50" />
                  <button onClick={() => setActiveFolderId(f.id)}
                    className={clsx("font-semibold transition-colors",
                      i === folderPath.length - 1 ? "text-text" : "text-muted hover:text-text")}>
                    {f.name}
                  </button>
                </span>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setAddingFolder((v) => !v)}
              className={clsx("flex items-center gap-1.5 px-3 py-1.5 bg-surface border rounded-lg transition-colors text-xs font-semibold",
                addingFolder ? "border-accent/50 text-accent" : "border-border text-muted hover:border-accent/50 hover:text-accent")}>
              <Plus className="w-3.5 h-3.5" /> New folder
            </button>
            <button onClick={onOpenChat}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted hover:text-accent border border-border hover:border-accent/40 bg-surface rounded-lg transition-colors">
              <MessageSquare className="w-3.5 h-3.5" /> Chat
            </button>
          </div>
        </div>

        {addingFolder && (
          <div className="flex items-center gap-2 bg-surface border border-accent/40 rounded-lg px-3 py-2 self-start">
            <span className="text-base">📁</span>
            <InlineInput placeholder="Folder name…" onConfirm={handleCreateFolder} onCancel={() => setAddingFolder(false)} />
          </div>
        )}

        {displayFolders.length > 0 && (
          <div>
            {activeFolderId !== null && <p className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">Subfolders</p>}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 items-start">
              {displayFolders.map((folder) => (
                <FolderCard key={folder.id} folder={folder}
                  noteCount={totalNotesPerFolder[folder.id] ?? 0}
                  subfolderCount={(folder.children ?? []).length}
                  onSelect={setActiveFolderId}
                  onDropNote={handleDropNote}
                  onRefresh={refresh}
                  isSubfolder={activeFolderId !== null} />
              ))}
            </div>
          </div>
        )}

        <div>
          {activeFolderId !== null && !showUnattached ? (
            <div className="flex items-center gap-3 mb-5 pb-3 border-b-2 border-accent/30">
              <span className="text-2xl leading-none">📁</span>
              <h2 className="text-lg font-extrabold text-accent tracking-tight flex-1">
                {activeFolder?.name ?? "Folder"}
                {activeType !== null && (
                  <span className="ml-2 text-sm font-semibold text-accent/60">— {TYPE_GROUPS.find((g) => g.key === activeType)?.label}</span>
                )}
              </h2>
              <span className="text-xs text-muted">{visibleNotes.length} note{visibleNotes.length !== 1 ? "s" : ""}</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 mb-4 pb-2 border-b border-border">
              <h2 className="text-sm font-bold text-text">{notesLabel}</h2>
              {activeType !== null && (
                <span className="text-xs bg-accent/10 text-accent/80 px-2 py-0.5 rounded-full border border-accent/20">
                  {TYPE_GROUPS.find((g) => g.key === activeType)?.label}
                </span>
              )}
              <span className="text-xs text-muted ml-auto">{visibleNotes.length} note{visibleNotes.length !== 1 ? "s" : ""}</span>
            </div>
          )}
          {visibleNotes.length === 0 && activeFolderId !== null && !showUnattached ? (
            <div className="text-center py-12 text-muted text-sm border border-dashed border-border/50 rounded-xl">
              <p className="text-2xl mb-2">📭</p>
              <p className="font-medium">This folder is empty</p>
              <p className="text-xs mt-1 text-muted/70">Drag notes here, or capture something from the extension</p>
            </div>
          ) : (
            <NotesList notes={visibleNotes} folders={folders} onRefresh={refresh} onOpenNote={onOpenNote} />
          )}
        </div>
      </main>
    </div>
  );
}
