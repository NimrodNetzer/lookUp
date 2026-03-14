/**
 * storage.js — LookUp local data layer
 *
 * Settings (API key, preferences) → chrome.storage.local
 * Everything else (conversations, messages, notes, folders) → IndexedDB
 *
 * All functions are async and return plain objects / arrays.
 */

// ─── IndexedDB bootstrap ────────────────────────────────────────────────────

const DB_NAME = "lookup";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // Conversations
      if (!db.objectStoreNames.contains("conversations")) {
        const conv = db.createObjectStore("conversations", { keyPath: "id" });
        conv.createIndex("createdAt", "createdAt");
        conv.createIndex("order", "order");
      }

      // Messages (chat history)
      if (!db.objectStoreNames.contains("messages")) {
        const msg = db.createObjectStore("messages", {
          keyPath: "id",
          autoIncrement: true,
        });
        msg.createIndex("conversationId", "conversationId");
        msg.createIndex("createdAt", "createdAt");
      }

      // Notes
      if (!db.objectStoreNames.contains("notes")) {
        const notes = db.createObjectStore("notes", { keyPath: "filename" });
        notes.createIndex("createdAt", "createdAt");
        notes.createIndex("folder_id", "folder_id");
        notes.createIndex("type", "type");
      }

      // Note content (kept separate to avoid loading large blobs into list queries)
      if (!db.objectStoreNames.contains("note_content")) {
        db.createObjectStore("note_content", { keyPath: "filename" });
      }

      // Folders
      if (!db.objectStoreNames.contains("folders")) {
        const folders = db.createObjectStore("folders", { keyPath: "id" });
        folders.createIndex("name", "name");
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

// Shorthand helpers
function tx(db, stores, mode = "readonly") {
  const t = db.transaction(stores, mode);
  return {
    store: (name) => t.objectStore(name),
    done: new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }),
  };
}

function req2p(r) {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function getAll(store) {
  return req2p(store.getAll());
}

// ─── Settings (chrome.storage.local) ────────────────────────────────────────

export const Settings = {
  async getApiKey() {
    const result = await chrome.storage.local.get("groqApiKey");
    return result.groqApiKey ?? null;
  },

  async setApiKey(key) {
    await chrome.storage.local.set({ groqApiKey: key });
  },

  async getPreferences() {
    const result = await chrome.storage.local.get("preferences");
    return result.preferences ?? {};
  },

  async setPreferences(prefs) {
    const existing = await Settings.getPreferences();
    await chrome.storage.local.set({ preferences: { ...existing, ...prefs } });
  },

  async isConfigured() {
    const key = await Settings.getApiKey();
    return key != null && key.trim().length > 0;
  },

  async getCommandLog() {
    const result = await chrome.storage.local.get("commandLog");
    return result.commandLog ?? [];
  },

  async appendCommandLog(entry) {
    const log = await Settings.getCommandLog();
    log.push({ ...entry, ts: Date.now() });
    // Keep last 200 entries
    const trimmed = log.slice(-200);
    await chrome.storage.local.set({ commandLog: trimmed });
  },
};

// ─── Conversations ───────────────────────────────────────────────────────────

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const Conversations = {
  async list() {
    const db = await openDB();
    const { store } = tx(db, ["conversations"]);
    const all = await getAll(store("conversations"));
    return all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },

  async get(id) {
    const db = await openDB();
    const { store } = tx(db, ["conversations"]);
    return req2p(store("conversations").get(id));
  },

  async create(title = "New Conversation") {
    const db = await openDB();
    const all = await Conversations.list();
    const conv = {
      id: newId(),
      title,
      createdAt: Date.now(),
      order: all.length,
    };
    const t = tx(db, ["conversations"], "readwrite");
    await req2p(t.store("conversations").add(conv));
    await t.done;
    return conv;
  },

  async rename(id, title) {
    const db = await openDB();
    const t = tx(db, ["conversations"], "readwrite");
    const s = t.store("conversations");
    const conv = await req2p(s.get(id));
    if (!conv) throw new Error("Conversation not found");
    conv.title = title;
    await req2p(s.put(conv));
    await t.done;
    return conv;
  },

  async delete(id) {
    const db = await openDB();
    // Delete conversation + all its messages
    const t = tx(db, ["conversations", "messages"], "readwrite");
    await req2p(t.store("conversations").delete(id));
    // Delete messages by conversationId index
    const msgStore = t.store("messages");
    const idx = msgStore.index("conversationId");
    const msgs = await req2p(idx.getAll(id));
    for (const m of msgs) await req2p(msgStore.delete(m.id));
    await t.done;
  },

  async reorder(orderedIds) {
    const db = await openDB();
    const t = tx(db, ["conversations"], "readwrite");
    const s = t.store("conversations");
    for (let i = 0; i < orderedIds.length; i++) {
      const conv = await req2p(s.get(orderedIds[i]));
      if (conv) {
        conv.order = i;
        await req2p(s.put(conv));
      }
    }
    await t.done;
  },

  // Merge srcId into destId — moves all messages, deletes src
  async merge(destId, srcId) {
    const db = await openDB();
    const t = tx(db, ["conversations", "messages"], "readwrite");
    const msgStore = t.store("messages");
    const idx = msgStore.index("conversationId");
    const msgs = await req2p(idx.getAll(srcId));
    for (const m of msgs) {
      m.conversationId = destId;
      await req2p(msgStore.put(m));
    }
    await req2p(t.store("conversations").delete(srcId));
    await t.done;
  },

  // Active conversation: stored in chrome.storage for simplicity
  async getActive() {
    const result = await chrome.storage.local.get("activeConversationId");
    const id = result.activeConversationId;
    if (!id) return null;
    return Conversations.get(id);
  },

  async setActive(id) {
    await chrome.storage.local.set({ activeConversationId: id });
  },
};

// ─── Messages ────────────────────────────────────────────────────────────────

export const Messages = {
  async listByConversation(conversationId) {
    const db = await openDB();
    const { store } = tx(db, ["messages"]);
    const idx = store("messages").index("conversationId");
    const msgs = await req2p(idx.getAll(conversationId));
    return msgs.sort((a, b) => a.createdAt - b.createdAt);
  },

  // role: "user" | "assistant" | "system"
  async append(conversationId, role, content) {
    const db = await openDB();
    const msg = { conversationId, role, content, createdAt: Date.now() };
    const t = tx(db, ["messages"], "readwrite");
    const id = await req2p(t.store("messages").add(msg));
    await t.done;
    return { ...msg, id };
  },

  async deleteByConversation(conversationId) {
    const db = await openDB();
    const t = tx(db, ["messages"], "readwrite");
    const store = t.store("messages");
    const msgs = await req2p(store.index("conversationId").getAll(conversationId));
    for (const m of msgs) await req2p(store.delete(m.id));
    await t.done;
  },
};

// ─── Notes ───────────────────────────────────────────────────────────────────

export const Notes = {
  // Returns metadata array (no content)
  async list() {
    const db = await openDB();
    const { store } = tx(db, ["notes"]);
    const all = await getAll(store("notes"));
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },

  async get(filename) {
    const db = await openDB();
    const { store } = tx(db, ["notes", "note_content"]);
    const meta = await req2p(store("notes").get(filename));
    const body = await req2p(store("note_content").get(filename));
    if (!meta) return null;
    return { ...meta, content: body?.content ?? "" };
  },

  // content = markdown string, cards = array (optional)
  async save(filename, meta, content, cards = null) {
    const db = await openDB();
    const t = tx(db, ["notes", "note_content"], "readwrite");
    const now = Date.now();
    const record = {
      filename,
      title: meta.title ?? filename,
      mode: meta.mode ?? meta.type ?? "note",
      folder_id: meta.folder_id ?? null,
      tags: meta.tags ?? [],
      createdAt: meta.createdAt ?? now,
      updatedAt: now,
      modified: now,
      ...(cards !== null && { cards }),
    };
    await req2p(t.store("notes").put(record));
    await req2p(t.store("note_content").put({ filename, content }));
    await t.done;
    return record;
  },

  async updateMeta(filename, patch) {
    const db = await openDB();
    const t = tx(db, ["notes"], "readwrite");
    const s = t.store("notes");
    const note = await req2p(s.get(filename));
    if (!note) throw new Error("Note not found");
    const now = Date.now();
    Object.assign(note, patch, { updatedAt: now, modified: now });
    await req2p(s.put(note));
    await t.done;
    return note;
  },

  async delete(filename) {
    const db = await openDB();
    const t = tx(db, ["notes", "note_content"], "readwrite");
    await req2p(t.store("notes").delete(filename));
    await req2p(t.store("note_content").delete(filename));
    await t.done;
  },

  // Simple full-text search across title + content
  async search(query) {
    const q = query.toLowerCase();
    const db = await openDB();
    const { store } = tx(db, ["notes", "note_content"]);
    const allMeta = await getAll(store("notes"));
    const allContent = await getAll(store("note_content"));
    const contentMap = Object.fromEntries(allContent.map((c) => [c.filename, c.content]));
    return allMeta.filter((n) => {
      const haystack = `${n.title} ${contentMap[n.filename] ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  },

  // Merge multiple notes into one
  async merge(filenames, newFilename, newTitle) {
    const parts = await Promise.all(filenames.map((f) => Notes.get(f)));
    const combined = parts
      .filter(Boolean)
      .map((n) => `## ${n.title}\n\n${n.content}`)
      .join("\n\n---\n\n");
    const merged = await Notes.save(
      newFilename,
      { title: newTitle, type: "note", createdAt: Date.now() },
      combined
    );
    await Promise.all(filenames.map((f) => Notes.delete(f)));
    return merged;
  },

  // Stats: totalNotes, streak (days), thisWeek
  async stats() {
    const all = await Notes.list();
    const total = all.length;
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thisWeek = all.filter((n) => n.createdAt >= weekAgo).length;

    // Streak: consecutive days with at least one note saved (going back from today)
    const days = new Set(
      all.map((n) => new Date(n.createdAt).toDateString())
    );
    let streak = 0;
    const d = new Date();
    while (days.has(d.toDateString())) {
      streak++;
      d.setDate(d.getDate() - 1);
    }

    return { totalNotes: total, streak, thisWeek };
  },
};

// ─── Folders ─────────────────────────────────────────────────────────────────

export const Folders = {
  async list() {
    const db = await openDB();
    const { store } = tx(db, ["folders"]);
    return getAll(store("folders"));
  },

  async create(name) {
    const db = await openDB();
    const folder = { id: newId(), name, createdAt: Date.now() };
    const t = tx(db, ["folders"], "readwrite");
    await req2p(t.store("folders").add(folder));
    await t.done;
    return folder;
  },

  async rename(id, name) {
    const db = await openDB();
    const t = tx(db, ["folders"], "readwrite");
    const s = t.store("folders");
    const folder = await req2p(s.get(id));
    if (!folder) throw new Error("Folder not found");
    folder.name = name;
    await req2p(s.put(folder));
    await t.done;
    return folder;
  },

  async delete(id) {
    const db = await openDB();
    // Unset folder_id on notes that were in this folder
    const t = tx(db, ["folders", "notes"], "readwrite");
    const noteStore = t.store("notes");
    const notesInFolder = await req2p(noteStore.index("folder_id").getAll(id));
    for (const n of notesInFolder) {
      n.folder_id = null;
      await req2p(noteStore.put(n));
    }
    await req2p(t.store("folders").delete(id));
    await t.done;
  },
};
