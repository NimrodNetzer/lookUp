/**
 * SESSION 3 — Extension storage.js tests
 * Tech: Vitest + fake-indexeddb + in-memory chrome.storage mock
 *
 * storage.js uses two browser globals:
 *   - indexedDB  → replaced with a fresh IDBFactory before each test
 *   - chrome.storage.local → in-memory Map mock, also reset each test
 *
 * openDB() reads global.indexedDB at call time, so swapping it in beforeEach
 * gives each test a completely fresh, empty database — zero state leakage.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";

// ── Set globals BEFORE importing storage.js ──────────────────────────────────
// We need indexedDB and chrome available at module evaluation time.
global.indexedDB = new IDBFactory();

function makeChromeStorageMock() {
  const store = new Map();
  return {
    async get(keys) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const k of keyList) if (store.has(k)) result[k] = store.get(k);
      return result;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) store.set(k, v);
    },
    async remove(keys) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) store.delete(k);
    },
    _store: store,
  };
}

global.chrome = { storage: { local: makeChromeStorageMock() } };

// ── Import storage AFTER globals are set ─────────────────────────────────────
import { Settings, TokenUsage, Conversations, Messages, Notes, Folders } from "../storage.js";

// ── Reset both stores before every test ─────────────────────────────────────
beforeEach(() => {
  // Fresh IndexedDB — openDB() calls indexedDB.open() each time, so a new
  // IDBFactory gives an empty database with no prior data.
  global.indexedDB = new IDBFactory();
  // Fresh chrome.storage.local
  global.chrome = { storage: { local: makeChromeStorageMock() } };
});

// ─────────────────────────────────────────────────────────────────────────────

// ── Settings ──────────────────────────────────────────────────────────────────
describe("Settings", () => {
  it("getApiKey returns null when not set", async () => {
    expect(await Settings.getApiKey()).toBeNull();
  });

  it("setApiKey + getApiKey round-trips correctly", async () => {
    await Settings.setApiKey("gsk_abc123");
    expect(await Settings.getApiKey()).toBe("gsk_abc123");
  });

  it("isConfigured returns false when key is null", async () => {
    expect(await Settings.isConfigured()).toBe(false);
  });

  it("isConfigured returns false when key is whitespace only", async () => {
    await Settings.setApiKey("   ");
    expect(await Settings.isConfigured()).toBe(false);
  });

  it("isConfigured returns true when key is set", async () => {
    await Settings.setApiKey("gsk_valid");
    expect(await Settings.isConfigured()).toBe(true);
  });

  it("getPreferences returns empty object by default", async () => {
    expect(await Settings.getPreferences()).toEqual({});
  });

  it("setPreferences merges with existing — does not wipe other keys", async () => {
    await Settings.setPreferences({ language: "he" });
    await Settings.setPreferences({ theme: "dark" });
    const prefs = await Settings.getPreferences();
    expect(prefs.language).toBe("he");
    expect(prefs.theme).toBe("dark");
  });

  it("setPreferences overwrites a specific key", async () => {
    await Settings.setPreferences({ language: "en" });
    await Settings.setPreferences({ language: "he" });
    expect((await Settings.getPreferences()).language).toBe("he");
  });

  it("getCommandLog returns empty array by default", async () => {
    expect(await Settings.getCommandLog()).toEqual([]);
  });

  it("appendCommandLog stores entries retrievable via getCommandLog", async () => {
    await Settings.appendCommandLog({ type: "rename", text: "rename last note" });
    await Settings.appendCommandLog({ type: "result", text: "done" });
    const log = await Settings.getCommandLog();
    expect(log).toHaveLength(2);
    expect(log[0].type).toBe("rename");
    expect(log[1].type).toBe("result");
  });

  it("appendCommandLog adds ts timestamp to each entry", async () => {
    await Settings.appendCommandLog({ type: "x", text: "y" });
    const [entry] = await Settings.getCommandLog();
    expect(typeof entry.ts).toBe("number");
    expect(entry.ts).toBeGreaterThan(0);
  });

  it("commandLog is trimmed to 200 entries max", async () => {
    for (let i = 0; i < 205; i++) {
      await Settings.appendCommandLog({ type: "t", text: `entry ${i}` });
    }
    const log = await Settings.getCommandLog();
    expect(log.length).toBe(200);
    expect(log[log.length - 1].text).toBe("entry 204"); // keeps newest 200
  });
});

// ── TokenUsage ────────────────────────────────────────────────────────────────
describe("TokenUsage", () => {
  it("get returns zero tokens and today's date on first call", async () => {
    const usage = await TokenUsage.get();
    expect(usage.tokens).toBe(0);
    expect(usage.date).toBe(new Date().toDateString());
  });

  it("add accumulates tokens across multiple calls", async () => {
    await TokenUsage.add(100);
    await TokenUsage.add(250);
    expect((await TokenUsage.get()).tokens).toBe(350);
  });

  it("add rounds fractional counts to nearest integer", async () => {
    await TokenUsage.add(10.7);
    const usage = await TokenUsage.get();
    expect(Number.isInteger(usage.tokens)).toBe(true);
    expect(usage.tokens).toBe(11);
  });

  it("reset sets tokens back to zero", async () => {
    await TokenUsage.add(500);
    await TokenUsage.reset();
    expect((await TokenUsage.get()).tokens).toBe(0);
  });

  it("get returns zero when stored date is from a previous day", async () => {
    // Plant a stale entry directly in chrome.storage
    await global.chrome.storage.local.set({
      tokenUsage: { date: "Mon Jan 01 2024", tokens: 999 },
    });
    const usage = await TokenUsage.get();
    expect(usage.tokens).toBe(0);
    expect(usage.date).toBe(new Date().toDateString());
  });
});

// ── Conversations ─────────────────────────────────────────────────────────────
describe("Conversations", () => {
  it("list returns empty array on fresh DB", async () => {
    expect(await Conversations.list()).toEqual([]);
  });

  it("create returns conversation with id, title, createdAt, order", async () => {
    const conv = await Conversations.create("Study session");
    expect(conv.id).toBeTruthy();
    expect(conv.title).toBe("Study session");
    expect(typeof conv.createdAt).toBe("number");
    expect(conv.order).toBe(0);
  });

  it("create defaults title to 'New Conversation'", async () => {
    expect((await Conversations.create()).title).toBe("New Conversation");
  });

  it("order increments for each new conversation", async () => {
    const a = await Conversations.create("A");
    const b = await Conversations.create("B");
    const c = await Conversations.create("C");
    expect(a.order).toBe(0);
    expect(b.order).toBe(1);
    expect(c.order).toBe(2);
  });

  it("get returns undefined for missing id", async () => {
    expect(await Conversations.get("nonexistent")).toBeUndefined();
  });

  it("get returns the created conversation by id", async () => {
    const conv = await Conversations.create("Test");
    expect((await Conversations.get(conv.id)).title).toBe("Test");
  });

  it("list returns all conversations sorted by order ascending", async () => {
    await Conversations.create("A");
    await Conversations.create("B");
    const list = await Conversations.list();
    expect(list).toHaveLength(2);
    expect(list[0].order).toBeLessThanOrEqual(list[1].order);
  });

  it("rename updates the title in the DB", async () => {
    const conv = await Conversations.create("Old");
    await Conversations.rename(conv.id, "New Name");
    expect((await Conversations.get(conv.id)).title).toBe("New Name");
  });

  it("rename throws when conversation doesn't exist", async () => {
    await expect(Conversations.rename("ghost-id", "X")).rejects.toThrow("Conversation not found");
  });

  it("delete removes the conversation", async () => {
    const conv = await Conversations.create("Delete Me");
    await Conversations.delete(conv.id);
    expect(await Conversations.get(conv.id)).toBeUndefined();
  });

  it("delete also removes all messages in that conversation", async () => {
    const conv = await Conversations.create("Chat");
    await Messages.append(conv.id, "user", "Hello");
    await Messages.append(conv.id, "assistant", "Hi");
    await Conversations.delete(conv.id);
    expect(await Messages.listByConversation(conv.id)).toHaveLength(0);
  });

  it("reorder sets correct order field for each conversation", async () => {
    const a = await Conversations.create("A");
    const b = await Conversations.create("B");
    const c = await Conversations.create("C");
    await Conversations.reorder([c.id, a.id, b.id]);
    const list = await Conversations.list();
    expect(list[0].id).toBe(c.id);
    expect(list[1].id).toBe(a.id);
    expect(list[2].id).toBe(b.id);
  });

  it("merge moves all messages from src to dest and deletes src", async () => {
    const dest = await Conversations.create("Dest");
    const src  = await Conversations.create("Src");
    await Messages.append(src.id, "user", "from src");
    await Conversations.merge(dest.id, src.id);
    const destMsgs = await Messages.listByConversation(dest.id);
    expect(destMsgs).toHaveLength(1);
    expect(destMsgs[0].content).toBe("from src");
    expect(await Conversations.get(src.id)).toBeUndefined();
  });

  it("setActive + getActive stores and retrieves active conversation", async () => {
    const conv = await Conversations.create("Active");
    await Conversations.setActive(conv.id);
    expect((await Conversations.getActive())?.id).toBe(conv.id);
  });

  it("getActive returns null when no active id is stored", async () => {
    expect(await Conversations.getActive()).toBeNull();
  });
});

// ── Messages ──────────────────────────────────────────────────────────────────
describe("Messages", () => {
  it("listByConversation returns empty array for unknown id", async () => {
    expect(await Messages.listByConversation("nobody")).toEqual([]);
  });

  it("append stores message and returns it with id", async () => {
    const msg = await Messages.append("conv-1", "user", "Hello world");
    expect(msg.id).toBeDefined();
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello world");
    expect(msg.conversationId).toBe("conv-1");
  });

  it("listByConversation returns messages sorted by createdAt ascending", async () => {
    await Messages.append("conv-1", "user", "first");
    await Messages.append("conv-1", "assistant", "second");
    const msgs = await Messages.listByConversation("conv-1");
    expect(msgs[0].content).toBe("first");
    expect(msgs[1].content).toBe("second");
  });

  it("listByConversation only returns messages for that conversation", async () => {
    await Messages.append("conv-A", "user", "for A");
    await Messages.append("conv-B", "user", "for B");
    const msgs = await Messages.listByConversation("conv-A");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("for A");
  });

  it("deleteByConversation removes all messages for that conversation", async () => {
    await Messages.append("conv-1", "user", "msg1");
    await Messages.append("conv-1", "assistant", "msg2");
    await Messages.deleteByConversation("conv-1");
    expect(await Messages.listByConversation("conv-1")).toHaveLength(0);
  });
});

// ── Notes ─────────────────────────────────────────────────────────────────────
describe("Notes", () => {
  it("list returns empty array on fresh DB", async () => {
    expect(await Notes.list()).toEqual([]);
  });

  it("save stores note and get retrieves both metadata and content", async () => {
    await Notes.save("test.md", { title: "My Note", mode: "summary" }, "## Summary\nContent");
    const note = await Notes.get("test.md");
    expect(note.title).toBe("My Note");
    expect(note.mode).toBe("summary");
    expect(note.content).toBe("## Summary\nContent");
  });

  it("get returns null for missing filename", async () => {
    expect(await Notes.get("missing.md")).toBeNull();
  });

  it("save uses mode field — critical convention (not type)", async () => {
    await Notes.save("n.md", { title: "T", mode: "explain" }, "body");
    expect((await Notes.get("n.md")).mode).toBe("explain");
  });

  it("save falls back to type when mode is absent (legacy path)", async () => {
    await Notes.save("n.md", { title: "T", type: "note" }, "body");
    expect((await Notes.get("n.md")).mode).toBe("note");
  });

  it("save sets updatedAt and modified timestamps on every write", async () => {
    const before = Date.now();
    const record = await Notes.save("n.md", { title: "X" }, "body");
    expect(record.updatedAt).toBeGreaterThanOrEqual(before);
    expect(record.modified).toBe(record.updatedAt);
  });

  it("save stores cards when provided", async () => {
    const cards = [{ front: "Q1", back: "A1" }, { front: "Q2", back: "A2" }];
    const record = await Notes.save("n.md", { title: "Flash" }, "body", cards);
    expect(record.cards).toEqual(cards);
  });

  it("save with no cards does not add a cards field", async () => {
    const record = await Notes.save("n.md", { title: "X" }, "body");
    expect(record.cards).toBeUndefined();
  });

  it("list returns notes sorted newest createdAt first", async () => {
    await Notes.save("old.md", { title: "Old", createdAt: 1000 }, "body");
    await Notes.save("new.md", { title: "New", createdAt: 9000 }, "body");
    const list = await Notes.list();
    expect(list[0].filename).toBe("new.md");
    expect(list[1].filename).toBe("old.md");
  });

  it("delete removes both note metadata and content", async () => {
    await Notes.save("del.md", { title: "Del" }, "gone");
    await Notes.delete("del.md");
    expect(await Notes.get("del.md")).toBeNull();
    expect(await Notes.list()).toHaveLength(0);
  });

  it("updateMeta patches specified fields without losing others", async () => {
    await Notes.save("n.md", { title: "Original", mode: "summary", folder_id: null }, "body");
    await Notes.updateMeta("n.md", { title: "Updated", folder_id: 42 });
    const note = await Notes.get("n.md");
    expect(note.title).toBe("Updated");
    expect(note.folder_id).toBe(42);
    expect(note.mode).toBe("summary"); // unchanged
  });

  it("updateMeta throws when note doesn't exist", async () => {
    await expect(Notes.updateMeta("ghost.md", { title: "X" })).rejects.toThrow("Note not found");
  });

  it("search finds notes by title (case-insensitive)", async () => {
    await Notes.save("a.md", { title: "Quantum Mechanics" }, "body");
    await Notes.save("b.md", { title: "Thermodynamics" }, "body");
    expect((await Notes.search("quantum"))).toHaveLength(1);
    expect((await Notes.search("QUANTUM"))).toHaveLength(1);
  });

  it("search finds notes by content", async () => {
    await Notes.save("a.md", { title: "Note" }, "This covers entropy and heat transfer");
    expect((await Notes.search("entropy"))).toHaveLength(1);
  });

  it("search returns empty array when no matches", async () => {
    await Notes.save("a.md", { title: "Physics" }, "waves and particles");
    expect(await Notes.search("chemistry")).toHaveLength(0);
  });

  it("merge combines content from both notes and deletes originals", async () => {
    await Notes.save("a.md", { title: "Part A" }, "Content A");
    await Notes.save("b.md", { title: "Part B" }, "Content B");
    await Notes.merge(["a.md", "b.md"], "merged.md", "Combined");
    expect(await Notes.get("a.md")).toBeNull();
    expect(await Notes.get("b.md")).toBeNull();
    const merged = await Notes.get("merged.md");
    expect(merged.title).toBe("Combined");
    expect(merged.content).toContain("Content A");
    expect(merged.content).toContain("Content B");
  });

  it("stats: totalNotes counts all notes", async () => {
    await Notes.save("a.md", { title: "A" }, "x");
    await Notes.save("b.md", { title: "B" }, "x");
    expect((await Notes.stats()).totalNotes).toBe(2);
  });

  it("stats: thisWeek counts only notes saved in the last 7 days", async () => {
    const now = Date.now();
    await Notes.save("recent.md", { title: "R", createdAt: now - 1000 }, "x");
    await Notes.save("old.md",    { title: "O", createdAt: now - 10 * 86400_000 }, "x");
    expect((await Notes.stats()).thisWeek).toBe(1);
  });

  it("stats: streak is 1 when at least one note was saved today", async () => {
    await Notes.save("today.md", { title: "T", createdAt: Date.now() }, "x");
    expect((await Notes.stats()).streak).toBe(1);
  });

  it("stats: streak is 0 when no notes exist", async () => {
    expect((await Notes.stats()).streak).toBe(0);
  });
});

// ── Folders ───────────────────────────────────────────────────────────────────
describe("Folders", () => {
  it("list returns empty array on fresh DB", async () => {
    expect(await Folders.list()).toEqual([]);
  });

  it("create returns folder with id, name, and null parent_id", async () => {
    const f = await Folders.create("CS");
    expect(f.id).toBeTruthy();
    expect(f.name).toBe("CS");
    expect(f.parent_id).toBeNull();
  });

  it("list builds tree — children nested under parent", async () => {
    const parent = await Folders.create("CS");
    await Folders.create("Algorithms", parent.id);
    await Folders.create("OS", parent.id);
    const tree = await Folders.list();
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(2);
  });

  it("rename updates folder name", async () => {
    const f = await Folders.create("Old");
    await Folders.rename(f.id, "New");
    expect((await Folders.list())[0].name).toBe("New");
  });

  it("rename throws when folder doesn't exist", async () => {
    await expect(Folders.rename("ghost", "X")).rejects.toThrow("Folder not found");
  });

  it("delete removes the folder from the list", async () => {
    const f = await Folders.create("Temp");
    await Folders.delete(f.id);
    expect(await Folders.list()).toHaveLength(0);
  });

  it("delete removes child folders recursively", async () => {
    const parent = await Folders.create("Parent");
    const child  = await Folders.create("Child", parent.id);
    await Folders.create("Grandchild", child.id);
    await Folders.delete(parent.id);
    expect(await Folders.list()).toHaveLength(0);
  });

  it("delete sets folder_id to null on notes in the deleted folder", async () => {
    const f = await Folders.create("Folder");
    await Notes.save("n.md", { title: "Note", mode: "summary", folder_id: f.id }, "body");
    await Folders.delete(f.id);
    expect((await Notes.get("n.md")).folder_id).toBeNull();
  });
});
