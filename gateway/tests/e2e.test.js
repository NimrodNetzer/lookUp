/**
 * SESSION 7 — Full-Stack E2E Integration Tests
 * Tech: Vitest + supertest + real SQLite (:memory:) + real fs (tmpdir) + mocked groq.js
 *
 * These tests exercise the FULL request-response stack:
 *   HTTP → Express middleware → real DB (SQLite in-memory) → real file I/O → real response
 *
 * Only external services (Groq API, child_process) are mocked.
 * This catches bugs that unit tests miss: SQL constraints, file path construction,
 * route middleware ordering, real JSON serialisation round-trips.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { mkdirSync } from "fs";

// ── Point DB to in-memory SQLite and notes to a temp dir ─────────────────────
const TEST_NOTES_DIR = path.join(os.tmpdir(), `lookup-e2e-${Date.now()}`);
process.env.TEST_DB_PATH   = ":memory:";
process.env.TEST_NOTES_DIR = TEST_NOTES_DIR;
process.env.NODE_ENV       = "test";
// Clear GROQ_API_KEY so setup/status starts unconfigured
delete process.env.GROQ_API_KEY;

mkdirSync(TEST_NOTES_DIR, { recursive: true });

// ── Mock only external services ───────────────────────────────────────────────

vi.mock("../groq.js", () => ({
  analyzeScreenshot:      vi.fn(async (_, __, mode) =>
    mode === "flashcard"
      ? JSON.stringify([{ front: "What is gravity?", back: "A fundamental force." }])
      : `## ${mode} Summary\nThis is a test note body.`
  ),
  analyzeMulti:           vi.fn(async () => "## Session\nMulti-frame summary."),
  analyzeText:            vi.fn(async (_, mode) => `## ${mode}\nText analysis result.`),
  analyzeWithQuestion:    vi.fn(async () => "The answer is 42."),
  transcribeAndSummarize: vi.fn(async () => ({ transcript: "Hello world", markdown: "## Transcript\nHello world" })),
  chat:                   vi.fn(async () => "This is a chat response."),
  chatStream:             vi.fn(async function* () { yield "Streamed "; yield "response."; }),
  processCommand:         vi.fn(async () => JSON.stringify({ title: "CMD", notes: [] })),
  resetGroqClient:        vi.fn(),
}));

vi.mock("child_process", () => ({ exec: vi.fn() }));

// ── Import app AFTER env vars and mocks are set ───────────────────────────────

let app;
beforeAll(async () => {
  const mod = await import("../index.js");
  app = mod.app;
});

afterAll(async () => {
  await fs.rm(TEST_NOTES_DIR, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("E2E: Health check", () => {
  it("GET /health → 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

// ── Setup flow ────────────────────────────────────────────────────────────────

describe("E2E: Setup flow", () => {
  it("GET /setup/status → returns 200 with boolean configured field", async () => {
    const res = await request(app).get("/setup/status");
    expect(res.status).toBe(200);
    expect(typeof res.body.configured).toBe("boolean");
  });

  it("POST /setup/apikey → requires non-empty 'key' field (400 on missing)", async () => {
    const res = await request(app)
      .post("/setup/apikey")
      .send({}); // missing key
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("POST /setup/apikey → sets GROQ_API_KEY and marks configured", async () => {
    const res = await request(app)
      .post("/setup/apikey")
      .send({ key: "gsk_e2etestkey" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const status = await request(app).get("/setup/status");
    expect(status.body.configured).toBe(true);
  });
});

// ── Notes CRUD ────────────────────────────────────────────────────────────────

describe("E2E: Notes — full create / read / delete lifecycle", () => {
  let savedFilename;

  it("POST /action → creates a note file on disk", async () => {
    const res = await request(app)
      .post("/action")
      .send({ screenshot: "data:image/png;base64,abc==", mode: "summary", title: "E2E Test Note" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.filename).toMatch(/\.md$/);
    savedFilename = res.body.filename;
  });

  it("File actually exists on disk with correct frontmatter", async () => {
    const content = await fs.readFile(path.join(TEST_NOTES_DIR, savedFilename), "utf-8");
    expect(content).toContain('title: "E2E Test Note"');
    expect(content).toContain('mode: "summary"');
  });

  it("GET /notes → lists the created note with parsed title", async () => {
    const res = await request(app).get("/notes");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((n) => n.filename === savedFilename);
    expect(found).toBeDefined();
    expect(found.title).toBe("E2E Test Note");
  });

  it("GET /notes/:filename → returns raw markdown content with frontmatter", async () => {
    const res = await request(app).get(`/notes/${savedFilename}`);
    expect(res.status).toBe(200);
    // Returns raw text/markdown
    expect(res.text).toContain('title: "E2E Test Note"');
    expect(res.text).toContain("Summary");
  });

  it("PATCH /notes/:filename → updates metadata", async () => {
    const res = await request(app)
      .patch(`/notes/${savedFilename}`)
      .send({ title: "E2E Updated Note" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Verify the file was updated
    const content = await fs.readFile(path.join(TEST_NOTES_DIR, savedFilename), "utf-8");
    expect(content).toContain("E2E Updated Note");
  });

  it("DELETE /notes/:filename → removes the file from disk", async () => {
    const res = await request(app).delete(`/notes/${savedFilename}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    await expect(fs.access(path.join(TEST_NOTES_DIR, savedFilename))).rejects.toThrow();
  });

  it("GET /notes after delete → file no longer listed", async () => {
    const res = await request(app).get("/notes");
    expect(res.status).toBe(200);
    const found = res.body.find((n) => n.filename === savedFilename);
    expect(found).toBeUndefined();
  });
});

// ── Flashcard sidecar ─────────────────────────────────────────────────────────

describe("E2E: Flashcard mode creates .cards.json sidecar", () => {
  let noteFilename, cardsFilename;

  it("POST /action with mode=flashcard → returns cards array + sidecar filename", async () => {
    const res = await request(app)
      .post("/action")
      .send({ screenshot: "data:image/png;base64,abc==", mode: "flashcard", title: "E2E Cards" });
    expect(res.status).toBe(200);
    expect(res.body.cards).toBeInstanceOf(Array);
    expect(res.body.cards[0]).toHaveProperty("front");
    noteFilename  = res.body.filename;
    cardsFilename = res.body.cardsFile;
    expect(cardsFilename).toMatch(/\.cards\.json$/);
  });

  it(".cards.json sidecar is valid JSON on disk", async () => {
    const raw = await fs.readFile(path.join(TEST_NOTES_DIR, cardsFilename), "utf-8");
    const cards = JSON.parse(raw);
    expect(Array.isArray(cards)).toBe(true);
    expect(cards[0]).toHaveProperty("front");
    expect(cards[0]).toHaveProperty("back");
  });

  afterAll(async () => {
    for (const f of [noteFilename, cardsFilename].filter(Boolean)) {
      await fs.rm(path.join(TEST_NOTES_DIR, f), { force: true });
    }
  });
});

// ── Note search ───────────────────────────────────────────────────────────────

describe("E2E: Note search", () => {
  const files = [];

  beforeAll(async () => {
    for (const title of ["Algebra Basics", "Calculus Review"]) {
      const res = await request(app)
        .post("/action")
        .send({ screenshot: "data:image/png;base64,abc==", mode: "summary", title });
      if (res.body.filename) files.push(res.body.filename);
    }
  });

  afterAll(async () => {
    for (const f of files) {
      await fs.rm(path.join(TEST_NOTES_DIR, f), { force: true });
    }
  });

  it("GET /notes/search?q=algebra → finds Algebra note", async () => {
    const res = await request(app).get("/notes/search?q=algebra");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((n) => n.title === "Algebra Basics");
    expect(found).toBeDefined();
  });

  it("GET /notes/search?q=calculus → finds Calculus note", async () => {
    const res = await request(app).get("/notes/search?q=calculus");
    expect(res.status).toBe(200);
    const found = res.body.find((n) => n.title === "Calculus Review");
    expect(found).toBeDefined();
  });

  it("GET /notes/search?q=zzznomatch → returns empty array", async () => {
    const res = await request(app).get("/notes/search?q=zzznomatch");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── Conversations ─────────────────────────────────────────────────────────────

describe("E2E: Conversations CRUD", () => {
  let convId;

  it("POST /conversations/new → creates a conversation with an ID", async () => {
    const res = await request(app).post("/conversations/new");
    expect(res.status).toBe(200);
    expect(typeof res.body.id).toBe("number");
    convId = res.body.id;
  });

  it("GET /conversations/list → includes the new conversation", async () => {
    const res = await request(app).get("/conversations/list");
    expect(res.status).toBe(200);
    const found = res.body.find((c) => c.id === convId);
    expect(found).toBeDefined();
  });

  it("GET /conversations/:id → returns conversation with messages array", async () => {
    const res = await request(app).get(`/conversations/${convId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(convId);
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it("PATCH /conversations/:id → renames and verifies via GET", async () => {
    const res = await request(app)
      .patch(`/conversations/${convId}`)
      .send({ title: "E2E Renamed Conv" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const check = await request(app).get(`/conversations/${convId}`);
    expect(check.body.title).toBe("E2E Renamed Conv");
  });

  it("DELETE /conversations/:id → removes conversation, GET returns 404", async () => {
    const res = await request(app).delete(`/conversations/${convId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const check = await request(app).get(`/conversations/${convId}`);
    expect(check.status).toBe(404);
  });
});

// ── Chat endpoint ─────────────────────────────────────────────────────────────

describe("E2E: Chat endpoint", () => {
  it("POST /chat → returns AI reply string", async () => {
    const res = await request(app)
      .post("/chat")
      .send({ message: "Hello, what is 2+2?", history: [] });
    expect(res.status).toBe(200);
    expect(typeof res.body.reply).toBe("string");
    expect(res.body.reply.length).toBeGreaterThan(0);
  });

  it("POST /chat → message is stored in active conversation", async () => {
    const activeRes = await request(app).get("/conversations/active");
    expect(activeRes.status).toBe(200);
    const convId = activeRes.body.id;

    await request(app)
      .post("/chat")
      .send({ message: "Explain photosynthesis", history: [] });

    const convRes = await request(app).get(`/conversations/${convId}`);
    const userMsg = convRes.body.messages.find(
      (m) => m.role === "user" && m.content === "Explain photosynthesis"
    );
    expect(userMsg).toBeDefined();
  });
});

// ── Folders ───────────────────────────────────────────────────────────────────

describe("E2E: Folders CRUD", () => {
  let folderId;

  it("POST /folders → creates a folder (response: { success, folder })", async () => {
    const res = await request(app)
      .post("/folders")
      .send({ name: "E2E Physics", parentId: null });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.folder).toBeDefined();
    expect(res.body.folder.name).toBe("E2E Physics");
    folderId = res.body.folder.id;
  });

  it("GET /folders → tree includes the new folder", async () => {
    const res = await request(app).get("/folders");
    expect(res.status).toBe(200);
    const found = res.body.find((f) => f.id === folderId);
    expect(found).toBeDefined();
    expect(found.name).toBe("E2E Physics");
  });

  it("PATCH /folders/:id → renames the folder", async () => {
    const res = await request(app)
      .patch(`/folders/${folderId}`)
      .send({ name: "E2E Biology" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const check = await request(app).get("/folders");
    const found = check.body.find((f) => f.id === folderId);
    expect(found.name).toBe("E2E Biology");
  });

  it("DELETE /folders/:id → removes the folder from tree", async () => {
    const res = await request(app).delete(`/folders/${folderId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const check = await request(app).get("/folders");
    const found = check.body.find((f) => f.id === folderId);
    expect(found).toBeUndefined();
  });
});

// ── Activity & stats ──────────────────────────────────────────────────────────

describe("E2E: Activity and stats", () => {
  it("POST /action increments activity — GET /activity returns array", async () => {
    await request(app)
      .post("/action")
      .send({ screenshot: "data:image/png;base64,abc==", mode: "summary", title: "Activity Test" });

    const res = await request(app).get("/activity");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /stats → returns numeric totalNotes, streak, thisWeek", async () => {
    const res = await request(app).get("/stats");
    expect(res.status).toBe(200);
    expect(typeof res.body.totalNotes).toBe("number");
    expect(typeof res.body.streak).toBe("number");
    expect(typeof res.body.thisWeek).toBe("number");
  });
});

// ── Settings persistence ───────────────────────────────────────────────────────

describe("E2E: Settings persistence", () => {
  it("POST /settings/preferences → stores prefs as JSON string in DB", async () => {
    const prefs = { language: "he", theme: "dark" };
    const res = await request(app)
      .post("/settings/preferences")
      .send({ preferences: JSON.stringify(prefs) });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("GET /settings/preferences → retrieves the stored preferences string", async () => {
    const res = await request(app).get("/settings/preferences");
    expect(res.status).toBe(200);
    // preferences field is the raw stored string
    expect(res.body.preferences).toContain("he");
    expect(res.body.preferences).toContain("dark");
  });
});
