/**
 * SESSION 2 — Gateway API route tests
 * Tech: Vitest + supertest + vi.mock (db, groq, fs mocked)
 *
 * We mock the DB module and Groq module entirely so tests run offline,
 * then import the real Express app and hit every route with supertest.
 * Focus: input validation, error handling, response shape correctness.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Mock db.js — replace all exports with controllable spies ─────────────────
vi.mock("../db.js", () => ({
  logActivity:          vi.fn(),
  getActivity:          vi.fn(() => []),
  getStreak:            vi.fn(() => 0),
  getSetting:           vi.fn((key, fallback = null) => fallback),
  setSetting:           vi.fn(),
  getFolderTree:        vi.fn(() => []),
  getFoldersFlat:       vi.fn(() => []),
  getFolderById:        vi.fn(() => null),
  createFolder:         vi.fn((name) => ({ id: 1, name, parent_id: null })),
  renameFolder:         vi.fn(),
  deleteFolder:         vi.fn(),
  listConversations:    vi.fn(() => []),
  getConversation:      vi.fn(() => null),
  getActiveConversation: vi.fn(() => ({ id: 1, title: "Test", messages: [] })),
  createConversation:   vi.fn(() => ({ id: 2, title: "New conversation", messages: "[]" })),
  touchConversation:    vi.fn(),
  saveConversation:     vi.fn(),
  deleteConversation:   vi.fn(),
  renameConversation:   vi.fn(),
  reorderConversations: vi.fn(),
  mergeConversations:   vi.fn(),
  appendCommandLog:     vi.fn(),
  getCommandLog:        vi.fn(() => []),
  default:              {},
}));

// ── Mock groq.js — all AI functions return controllable values ───────────────
vi.mock("../groq.js", () => ({
  analyzeScreenshot:      vi.fn(async () => "## Summary\nMocked."),
  analyzeMulti:           vi.fn(async () => "## Session\nMocked."),
  analyzeText:            vi.fn(async () => "## Text\nMocked."),
  analyzeWithQuestion:    vi.fn(async () => "## Answer\nMocked."),
  transcribeAndSummarize: vi.fn(async () => ({ transcript: "hello", markdown: "## Audio\nMocked." })),
  chat:                   vi.fn(async () => "Mocked reply"),
  chatStream:             vi.fn(async () => {
    async function* gen() { yield { choices: [{ delta: { content: "Hi" } }] }; }
    return gen();
  }),
  processCommand: vi.fn(async () => '[{"action":"message","text":"done"}]'),
  resetGroqClient: vi.fn(),
}));

// ── Mock fs (only the async promises API used in index.js) ───────────────────
vi.mock("fs/promises", () => ({
  default: {
    readdir:   vi.fn(async () => []),
    readFile:  vi.fn(async () => '---\ntitle: "Test Note"\ndate: "2024-01-01"\nmode: "summary"\n---\n\nBody.'),
    writeFile: vi.fn(async () => {}),
    unlink:    vi.fn(async () => {}),
    stat:      vi.fn(async () => ({ size: 100, mtime: new Date("2024-01-01") })),
    mkdirSync: vi.fn(),
  },
  readdir:   vi.fn(async () => []),
  readFile:  vi.fn(async () => '---\ntitle: "Test Note"\ndate: "2024-01-01"\nmode: "summary"\n---\n\nBody.'),
  writeFile: vi.fn(async () => {}),
  unlink:    vi.fn(async () => {}),
  stat:      vi.fn(async () => ({ size: 100, mtime: new Date("2024-01-01") })),
}));

// ── Mock child_process to prevent browser auto-open ──────────────────────────
vi.mock("child_process", () => ({ exec: vi.fn() }));

// ── Import the real app (after mocks are registered) ─────────────────────────
process.env.NODE_ENV = "test";
const { app } = await import("../index.js");

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks());

// ── /health ───────────────────────────────────────────────────────────────────
describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

// ── /setup ────────────────────────────────────────────────────────────────────
describe("GET /setup/status", () => {
  it("returns configured: false when GROQ_API_KEY is unset", async () => {
    const saved = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    const res = await request(app).get("/setup/status");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    if (saved) process.env.GROQ_API_KEY = saved;
  });

  it("returns configured: true when GROQ_API_KEY is set", async () => {
    process.env.GROQ_API_KEY = "test-key";
    const res = await request(app).get("/setup/status");
    expect(res.body.configured).toBe(true);
  });
});

describe("POST /setup/apikey", () => {
  it("returns 400 when key is missing", async () => {
    const res = await request(app).post("/setup/apikey").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/API key/i);
  });

  it("returns 400 when key is empty string", async () => {
    const res = await request(app).post("/setup/apikey").send({ key: "   " });
    expect(res.status).toBe(400);
  });

  it("accepts a valid key and returns success", async () => {
    const res = await request(app).post("/setup/apikey").send({ key: "gsk_test123" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── /settings/preferences ────────────────────────────────────────────────────
describe("GET /settings/preferences", () => {
  it("returns preferences string from getSetting", async () => {
    const { getSetting } = await import("../db.js");
    getSetting.mockReturnValue("Always prefix with date");
    const res = await request(app).get("/settings/preferences");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("preferences");
  });
});

describe("POST /settings/preferences", () => {
  it("stores preferences and returns success", async () => {
    const res = await request(app)
      .post("/settings/preferences")
      .send({ preferences: "Always use date prefix" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("stores empty string when preferences not sent", async () => {
    const { setSetting } = await import("../db.js");
    const res = await request(app).post("/settings/preferences").send({});
    expect(res.status).toBe(200);
    expect(setSetting).toHaveBeenCalledWith("preferences", "");
  });
});

// ── /activity ─────────────────────────────────────────────────────────────────
describe("GET /activity", () => {
  it("returns activity array", async () => {
    const { getActivity } = await import("../db.js");
    getActivity.mockReturnValue([{ date: "2024-01-01", count: 3 }]);
    const res = await request(app).get("/activity");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── /folders ──────────────────────────────────────────────────────────────────
describe("GET /folders", () => {
  it("returns folder tree array", async () => {
    const res = await request(app).get("/folders");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("POST /folders", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(app).post("/folders").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it("returns 400 when name is blank", async () => {
    const res = await request(app).post("/folders").send({ name: "   " });
    expect(res.status).toBe(400);
  });

  it("creates folder and returns it", async () => {
    const res = await request(app).post("/folders").send({ name: "CS" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.folder.name).toBe("CS");
  });

  it("trims whitespace from folder name", async () => {
    const { createFolder } = await import("../db.js");
    await request(app).post("/folders").send({ name: "  Math  " });
    expect(createFolder).toHaveBeenCalledWith("Math", null);
  });
});

describe("PATCH /folders/:id", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(app).patch("/folders/1").send({});
    expect(res.status).toBe(400);
  });

  it("renames and returns success", async () => {
    const res = await request(app).patch("/folders/1").send({ name: "Physics" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("DELETE /folders/:id", () => {
  it("deletes and returns success", async () => {
    const res = await request(app).delete("/folders/1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── /conversations ────────────────────────────────────────────────────────────
describe("GET /conversations/list", () => {
  it("returns array of conversations", async () => {
    const { listConversations } = await import("../db.js");
    listConversations.mockReturnValue([{ id: 1, title: "Chat 1" }]);
    const res = await request(app).get("/conversations/list");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("GET /conversations/active", () => {
  it("returns active conversation with messages array", async () => {
    const res = await request(app).get("/conversations/active");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("messages");
  });
});

describe("GET /conversations/:id", () => {
  it("returns 404 for missing conversation", async () => {
    const res = await request(app).get("/conversations/9999");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });

  it("returns conversation when found", async () => {
    const { getConversation } = await import("../db.js");
    getConversation.mockReturnValue({ id: 5, title: "Found", messages: [] });
    const res = await request(app).get("/conversations/5");
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Found");
  });
});

describe("POST /conversations/new", () => {
  it("creates and returns new conversation id and title", async () => {
    const res = await request(app).post("/conversations/new");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("title");
  });
});

describe("POST /conversations/switch/:id", () => {
  it("touches conversation and returns success", async () => {
    const res = await request(app).post("/conversations/switch/3");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("PATCH /conversations/:id", () => {
  it("returns 400 when title is missing", async () => {
    const res = await request(app).patch("/conversations/1").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it("returns 400 when title is blank", async () => {
    const res = await request(app).patch("/conversations/1").send({ title: "  " });
    expect(res.status).toBe(400);
  });

  it("renames and returns success", async () => {
    const res = await request(app).patch("/conversations/1").send({ title: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("DELETE /conversations/:id", () => {
  it("deletes and returns success", async () => {
    const res = await request(app).delete("/conversations/1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /conversations/reorder", () => {
  it("returns 400 when ids is not an array", async () => {
    const res = await request(app).post("/conversations/reorder").send({ ids: "bad" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ids/i);
  });

  it("returns 400 when ids is missing", async () => {
    const res = await request(app).post("/conversations/reorder").send({});
    expect(res.status).toBe(400);
  });

  it("reorders and returns success", async () => {
    const res = await request(app).post("/conversations/reorder").send({ ids: [3, 1, 2] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /conversations/:id/merge", () => {
  it("returns 400 when sourceId is missing", async () => {
    const res = await request(app).post("/conversations/1/merge").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sourceId/i);
  });

  it("merges and returns success", async () => {
    const res = await request(app).post("/conversations/1/merge").send({ sourceId: 2 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── /chat ─────────────────────────────────────────────────────────────────────
describe("POST /chat", () => {
  it("returns 400 when message is missing", async () => {
    const res = await request(app).post("/chat").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/i);
  });

  it("returns reply and conversationId on success", async () => {
    const res = await request(app).post("/chat").send({ message: "Explain recursion" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reply).toBe("Mocked reply");
    expect(res.body).toHaveProperty("conversationId");
  });

  it("auto-titles from first message (empty history)", async () => {
    const { saveConversation } = await import("../db.js");
    await request(app).post("/chat").send({ message: "What is entropy?" });
    // title arg (3rd param) should be first 60 chars of the message
    const [, , title] = saveConversation.mock.calls[0];
    expect(title).toBe("What is entropy?");
  });
});

describe("POST /chat/clear", () => {
  it("creates a new conversation and returns its id", async () => {
    const res = await request(app).post("/chat/clear");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty("conversationId");
  });
});

describe("GET /chat/history", () => {
  it("returns messages array for active conversation", async () => {
    const res = await request(app).get("/chat/history");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── /notes ────────────────────────────────────────────────────────────────────
describe("GET /notes", () => {
  it("returns an array (empty when no files)", async () => {
    const res = await request(app).get("/notes");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("GET /notes/:filename", () => {
  it("returns 400 for path traversal attempt", async () => {
    const res = await request(app).get("/notes/..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-.md and non-.json extension", async () => {
    const res = await request(app).get("/notes/note.exe");
    expect(res.status).toBe(400);
  });
});

describe("DELETE /notes/:filename", () => {
  it("returns 400 for URL-encoded path traversal", async () => {
    // Express normalizes /notes/../secret.md to /notes/secret.md before routing,
    // so we must test with URL-encoded dots to verify the ..  check in the handler.
    const res = await request(app).delete("/notes/..%2Fsecret.md");
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-.md extension", async () => {
    const res = await request(app).delete("/notes/note.txt");
    expect(res.status).toBe(400);
  });

  it("deletes note and returns success", async () => {
    const res = await request(app).delete("/notes/2024-01-01_test.md");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("PATCH /notes/:filename", () => {
  it("returns 400 for URL-encoded path traversal", async () => {
    const res = await request(app).patch("/notes/..%2Fsecret.md").send({ course: "CS" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when no valid fields provided", async () => {
    const res = await request(app).patch("/notes/note.md").send({ hack: "bad" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No valid fields/i);
  });

  it("accepts course update", async () => {
    const res = await request(app).patch("/notes/note.md").send({ course: "Operating Systems" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("accepts title update", async () => {
    const res = await request(app).patch("/notes/note.md").send({ title: "New Title" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("ignores fields that are not in the allowed list", async () => {
    // 'mode' is not in allowed list — combined with valid 'course', still succeeds
    const res = await request(app).patch("/notes/note.md").send({ course: "CS", mode: "hack" });
    expect(res.status).toBe(200);
  });
});

describe("GET /notes/search", () => {
  it("returns empty array for empty query", async () => {
    const res = await request(app).get("/notes/search?q=");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns empty array for missing q param", async () => {
    const res = await request(app).get("/notes/search");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("POST /notes/merge", () => {
  it("returns 400 when filenames is not an array", async () => {
    const res = await request(app).post("/notes/merge").send({ filenames: "bad" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when fewer than 2 filenames", async () => {
    const res = await request(app).post("/notes/merge").send({ filenames: ["one.md"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2/);
  });
});

// ── /action, /session, /transcribe, /ask, /ask-screen — validation only ──────
describe("POST /action", () => {
  it("returns 400 when screenshot is missing", async () => {
    const res = await request(app).post("/action").send({ mode: "summary" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/screenshot/i);
  });

  it("processes summary mode and returns markdown + filename", async () => {
    const res = await request(app).post("/action").send({ screenshot: "base64data", mode: "summary" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.markdown).toBeTruthy();
    expect(res.body.filename).toBeTruthy();
  });

  it("processes flashcard mode and returns cards array", async () => {
    const { analyzeScreenshot } = await import("../groq.js");
    analyzeScreenshot.mockResolvedValueOnce('[{"front":"Q1","back":"A1"}]');
    const res = await request(app).post("/action").send({ screenshot: "base64data", mode: "flashcard" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.cards)).toBe(true);
  });
});

describe("POST /session", () => {
  it("returns 400 when frames is missing", async () => {
    const res = await request(app).post("/session").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/frames/i);
  });

  it("returns 400 when frames is empty array", async () => {
    const res = await request(app).post("/session").send({ frames: [] });
    expect(res.status).toBe(400);
  });

  it("processes session and returns markdown", async () => {
    const res = await request(app).post("/session").send({
      frames: [{ base64: "abc", mimeType: "image/png" }],
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.markdown).toBeTruthy();
  });
});

describe("POST /transcribe", () => {
  it("returns 400 when audio is missing", async () => {
    const res = await request(app).post("/transcribe").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/audio/i);
  });
});

describe("POST /ask", () => {
  it("returns 400 when selectedText is missing", async () => {
    const res = await request(app).post("/ask").send({ mode: "summary" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/selectedText/i);
  });

  it("returns markdown on success", async () => {
    const res = await request(app).post("/ask").send({ selectedText: "Newton's laws of motion" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.markdown).toBeTruthy();
  });
});

describe("POST /ask-screen", () => {
  it("returns 400 when screenshot is missing", async () => {
    const res = await request(app).post("/ask-screen").send({ question: "What is this?" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when question is missing", async () => {
    const res = await request(app).post("/ask-screen").send({ screenshot: "base64" });
    expect(res.status).toBe(400);
  });
});

// ── /command ──────────────────────────────────────────────────────────────────
describe("POST /command", () => {
  it("returns 400 when command is missing", async () => {
    const res = await request(app).post("/command").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/command/i);
  });

  it("returns actions array on success", async () => {
    const res = await request(app).post("/command").send({ command: "rename last note to Test" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.actions)).toBe(true);
  });

  it("returns preview without executing when preview:true", async () => {
    const res = await request(app).post("/command").send({
      command: "merge last 2 notes",
      preview: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.preview).toBe(true);
  });
});

describe("GET /command/log", () => {
  it("returns command log array", async () => {
    const res = await request(app).get("/command/log");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
