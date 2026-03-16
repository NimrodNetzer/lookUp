/**
 * SESSION 5b — React component tests
 * Tech: Vitest + @testing-library/react + jsdom
 *
 * Tests the critical user-facing flows:
 *   - App: loading → setup screen → configured main app
 *   - SetupScreen: valid key saves, invalid key shows error, empty key blocked
 *   - NoteViewer: loading state, not-found state, renders title + mode badge,
 *                 multi-section split, quiz and flashcard content detection
 *   - HomePage: stats display, search modal open/close, Ctrl+K shortcut
 *   - ChatPage: empty state, send message, streaming render, new conversation,
 *               delete active conversation, auto-title, error display
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Mock heavy/browser-only dependencies ─────────────────────────────────────
vi.mock("../src/CosmicBg.jsx",        () => ({ default: () => null }));
vi.mock("../src/LearningHub.jsx",     () => ({ default: () => <div data-testid="learning-hub" /> }));
vi.mock("../src/GlobalSearch.jsx",    () => ({ default: ({ onClose }) => (
  <div data-testid="global-search"><button onClick={onClose}>Close</button></div>
)}));
vi.mock("../src/FlashcardViewer.jsx", () => ({ default: ({ cards }) => (
  <div data-testid="flashcard-viewer">{cards.length} cards</div>
)}));

// ── Mock storage.js ───────────────────────────────────────────────────────────
vi.mock("../storage.js", () => ({
  Settings: {
    isConfigured:  vi.fn(async () => false),
    getApiKey:     vi.fn(async () => null),
    setApiKey:     vi.fn(async () => {}),
    getPreferences: vi.fn(async () => ({})),
  },
  Notes: {
    get:   vi.fn(async () => null),
    stats: vi.fn(async () => ({ totalNotes: 0, streak: 0, thisWeek: 0 })),
    updateByConversationId: vi.fn(async () => {}),
  },
  Conversations: {
    list:         vi.fn(async () => []),
    get:          vi.fn(async () => null),
    getActive:    vi.fn(async () => null),
    setActive:    vi.fn(async () => {}),
    create:       vi.fn(async () => ({ id: "conv-1", title: "New Conversation", order: 0 })),
    rename:       vi.fn(async () => {}),
    delete:       vi.fn(async () => {}),
  },
  Messages: {
    listByConversation: vi.fn(async () => []),
    append:             vi.fn(async () => ({ id: 1 })),
  },
  TokenUsage: { add: vi.fn() },
}));

// ── Mock groq-client.js ───────────────────────────────────────────────────────
vi.mock("../groq-client.js", () => ({
  verifyApiKey: vi.fn(async () => ({ ok: true })),
  chatStream:   vi.fn(async function* () { yield "Hello "; yield "world!"; }),
}));

// react-markdown needs real ESM — stub with a simple passthrough
vi.mock("react-markdown", () => ({
  default: ({ children }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm",   () => ({ default: () => {} }));
vi.mock("remark-math",  () => ({ default: () => {} }));
vi.mock("rehype-katex", () => ({ default: () => {} }));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import App from "../src/App.jsx";
import NoteViewer from "../src/NoteViewer.jsx";
import HomePage from "../src/HomePage.jsx";
import ChatPage from "../src/ChatPage.jsx";

import { Settings, Notes, Conversations, Messages } from "../storage.js";
import { verifyApiKey, chatStream } from "../groq-client.js";

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults for every test
  Settings.isConfigured.mockResolvedValue(false);
  Notes.stats.mockResolvedValue({ totalNotes: 5, streak: 3, thisWeek: 2 });
  Notes.get.mockResolvedValue(null);
  Conversations.list.mockResolvedValue([]);
  Conversations.getActive.mockResolvedValue(null);
  Conversations.create.mockResolvedValue({ id: "conv-1", title: "New Conversation", order: 0 });
  Messages.listByConversation.mockResolvedValue([]);
  chatStream.mockImplementation(async function* () { yield "Hello world"; });
});

// ── App — loading / setup / configured ───────────────────────────────────────
describe("App", () => {
  it("shows a spinner while checking configuration", async () => {
    // Never resolves → stays in loading state
    Settings.isConfigured.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows SetupScreen when not configured", async () => {
    Settings.isConfigured.mockResolvedValue(false);
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText("gsk_...")).toBeInTheDocument());
  });

  it("shows main app when already configured", async () => {
    Settings.isConfigured.mockResolvedValue(true);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("learning-hub")).toBeInTheDocument());
  });

  it("SetupScreen: save button is disabled when input is empty", async () => {
    Settings.isConfigured.mockResolvedValue(false);
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText("gsk_..."));
    const btn = screen.getByRole("button", { name: /save/i });
    expect(btn).toBeDisabled();
  });

  it("SetupScreen: valid key verifies, saves, and transitions to main app", async () => {
    Settings.isConfigured.mockResolvedValue(false);
    verifyApiKey.mockResolvedValue({ ok: true });
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText("gsk_..."));

    await userEvent.type(screen.getByPlaceholderText("gsk_..."), "gsk_valid_key");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(Settings.setApiKey).toHaveBeenCalledWith("gsk_valid_key"));
    await waitFor(() => expect(screen.getByTestId("learning-hub")).toBeInTheDocument());
  });

  it("SetupScreen: invalid key shows error message", async () => {
    Settings.isConfigured.mockResolvedValue(false);
    verifyApiKey.mockResolvedValue({ ok: false, error: "Unauthorized" });
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText("gsk_..."));

    await userEvent.type(screen.getByPlaceholderText("gsk_..."), "gsk_bad_key");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/invalid api key/i)).toBeInTheDocument());
    expect(Settings.setApiKey).not.toHaveBeenCalled();
  });

  it("SetupScreen: Enter key on input triggers save", async () => {
    Settings.isConfigured.mockResolvedValue(false);
    verifyApiKey.mockResolvedValue({ ok: true });
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText("gsk_..."));

    const input = screen.getByPlaceholderText("gsk_...");
    await userEvent.type(input, "gsk_key{Enter}");

    await waitFor(() => expect(verifyApiKey).toHaveBeenCalledWith("gsk_key"));
  });

  it("SetupScreen: shows 'Verifying…' while loading", async () => {
    Settings.isConfigured.mockResolvedValue(false);
    verifyApiKey.mockReturnValue(new Promise(() => {})); // never resolves
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText("gsk_..."));

    await userEvent.type(screen.getByPlaceholderText("gsk_..."), "gsk_key");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/verifying/i)).toBeInTheDocument());
  });
});

// ── NoteViewer ────────────────────────────────────────────────────────────────
describe("NoteViewer", () => {
  it("shows loading state while fetching note", async () => {
    Notes.get.mockReturnValue(new Promise(() => {}));
    render(<NoteViewer filename="test.md" onBack={vi.fn()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows not-found when note doesn't exist", async () => {
    Notes.get.mockResolvedValue(null);
    render(<NoteViewer filename="missing.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument());
  });

  it("shows not-found when no filename provided", async () => {
    render(<NoteViewer filename={null} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument());
  });

  it("renders note title when found", async () => {
    Notes.get.mockResolvedValue({
      title: "Quantum Mechanics", mode: "summary",
      content: "## Overview\nWave-particle duality.", createdAt: Date.now(),
    });
    render(<NoteViewer filename="quantum.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Quantum Mechanics")).toBeInTheDocument());
  });

  it("renders mode badge for summary notes", async () => {
    Notes.get.mockResolvedValue({
      title: "Test", mode: "summary",
      content: "Content here.", createdAt: Date.now(),
    });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Summary")).toBeInTheDocument());
  });

  it("renders 'Flashcards' badge for flashcard notes", async () => {
    Notes.get.mockResolvedValue({
      title: "Flash", mode: "flashcard",
      content: '[{"front":"Q","back":"A"}]', createdAt: Date.now(),
    });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Flashcards")).toBeInTheDocument());
  });

  it("renders FlashcardViewer for flashcard content", async () => {
    Notes.get.mockResolvedValue({
      title: "Flash", mode: "flashcard",
      content: '[{"front":"Q","back":"A"},{"front":"Q2","back":"A2"}]',
      createdAt: Date.now(),
    });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("flashcard-viewer")).toBeInTheDocument());
    expect(screen.getByTestId("flashcard-viewer").textContent).toContain("2 cards");
  });

  it("renders 'Quiz' badge for quiz notes", async () => {
    Notes.get.mockResolvedValue({
      title: "Quiz Note", mode: "quiz",
      content: "**Q1.** What is X?\n**Answer:** It is Y.",
      createdAt: Date.now(),
    });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Quiz")).toBeInTheDocument());
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    Notes.get.mockResolvedValue({
      title: "T", mode: "summary", content: "Body", createdAt: Date.now(),
    });
    render(<NoteViewer filename="n.md" onBack={onBack} />);
    await waitFor(() => screen.getByText("T"));
    await userEvent.click(screen.getByText(/← Back/i));
    expect(onBack).toHaveBeenCalled();
  });

  it("shows 'Mixed' badge when note has multiple section types", async () => {
    // Two sections separated by \n\n---\n\n: one text, one flashcard
    const content = "## Summary text here.\n\n---\n\n" +
      '[{"front":"Q","back":"A"}]';
    Notes.get.mockResolvedValue({
      title: "Multi-section note", mode: "summary", content, createdAt: Date.now(),
    });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    // The badge text "Mixed" appears in a <span> — use getAllByText and check one is a span
    await waitFor(() => {
      const matches = screen.getAllByText("Mixed");
      expect(matches.some((el) => el.tagName === "SPAN")).toBe(true);
    });
  });
});

// ── HomePage ──────────────────────────────────────────────────────────────────
describe("HomePage", () => {
  it("renders stats from Notes.stats()", async () => {
    Notes.stats.mockResolvedValue({ totalNotes: 12, streak: 5, thisWeek: 3 });
    render(<HomePage onOpenNote={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(screen.getByText("5d")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows 0 stats when Notes.stats() fails", async () => {
    Notes.stats.mockRejectedValue(new Error("DB error"));
    render(<HomePage onOpenNote={vi.fn()} />);
    // Stats stay at initial 0 values
    await waitFor(() => expect(screen.getByText("0d")).toBeInTheDocument());
  });

  it("opens GlobalSearch when search button is clicked", async () => {
    render(<HomePage onOpenNote={vi.fn()} />);
    await userEvent.click(screen.getByText(/search notes/i));
    expect(screen.getByTestId("global-search")).toBeInTheDocument();
  });

  it("closes GlobalSearch when close is called", async () => {
    render(<HomePage onOpenNote={vi.fn()} />);
    await userEvent.click(screen.getByText(/search notes/i));
    await userEvent.click(screen.getByText("Close"));
    expect(screen.queryByTestId("global-search")).not.toBeInTheDocument();
  });

  it("opens GlobalSearch on Ctrl+K", async () => {
    render(<HomePage onOpenNote={vi.fn()} />);
    await waitFor(() => screen.getByText(/search notes/i));
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("global-search")).toBeInTheDocument();
  });

  it("opens GlobalSearch on Cmd+K (Mac)", async () => {
    render(<HomePage onOpenNote={vi.fn()} />);
    await waitFor(() => screen.getByText(/search notes/i));
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByTestId("global-search")).toBeInTheDocument();
  });
});

// ── ChatPage ──────────────────────────────────────────────────────────────────
describe("ChatPage", () => {
  it("shows empty state when no messages", async () => {
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByText(/ask anything/i)).toBeInTheDocument());
  });

  it("send button is disabled when input is empty", async () => {
    render(<ChatPage />);
    await waitFor(() => screen.getByPlaceholderText(/ask a question/i));
    expect(screen.getByLabelText("Send")).toBeDisabled();
  });

  it("send button enables when input has text", async () => {
    render(<ChatPage />);
    await waitFor(() => screen.getByPlaceholderText(/ask a question/i));
    await userEvent.type(screen.getByPlaceholderText(/ask a question/i), "Hello");
    expect(screen.getByLabelText("Send")).not.toBeDisabled();
  });

  it("renders user message after sending", async () => {
    render(<ChatPage />);
    await waitFor(() => screen.getByPlaceholderText(/ask a question/i));

    await userEvent.type(screen.getByPlaceholderText(/ask a question/i), "What is entropy?");
    await userEvent.click(screen.getByLabelText("Send"));

    await waitFor(() => expect(screen.getByText("What is entropy?")).toBeInTheDocument());
  });

  it("renders streamed assistant response", async () => {
    chatStream.mockImplementation(async function* () {
      yield "Entropy ";
      yield "is disorder.";
    });
    render(<ChatPage />);
    await waitFor(() => screen.getByPlaceholderText(/ask a question/i));

    await userEvent.type(screen.getByPlaceholderText(/ask a question/i), "What is entropy?");
    await userEvent.click(screen.getByLabelText("Send"));

    await waitFor(() => expect(screen.getByText(/entropy is disorder/i)).toBeInTheDocument());
  });

  it("clears input after sending", async () => {
    render(<ChatPage />);
    await waitFor(() => screen.getByPlaceholderText(/ask a question/i));

    const input = screen.getByPlaceholderText(/ask a question/i);
    await userEvent.type(input, "Hello");
    await userEvent.click(screen.getByLabelText("Send"));

    await waitFor(() => expect(input.value).toBe(""));
  });

  it("shows error message when chatStream throws", async () => {
    chatStream.mockImplementation(async function* () {
      throw new Error("Daily token limit reached.");
    });
    render(<ChatPage />);
    await waitFor(() => screen.getByPlaceholderText(/ask a question/i));

    await userEvent.type(screen.getByPlaceholderText(/ask a question/i), "Hi");
    await userEvent.click(screen.getByLabelText("Send"));

    await waitFor(() =>
      expect(screen.getByText(/Daily token limit reached/i)).toBeInTheDocument()
    );
  });

  it("Enter key sends the message", async () => {
    render(<ChatPage />);
    await waitFor(() => screen.getByPlaceholderText(/ask a question/i));

    const input = screen.getByPlaceholderText(/ask a question/i);
    await userEvent.type(input, "Hello{Enter}");

    await waitFor(() => expect(Messages.append).toHaveBeenCalled());
  });

  it("Shift+Enter does not send (adds newline)", async () => {
    render(<ChatPage />);
    await waitFor(() => screen.getByPlaceholderText(/ask a question/i));

    const input = screen.getByPlaceholderText(/ask a question/i);
    await userEvent.type(input, "Hello{Shift>}{Enter}{/Shift}");

    expect(Messages.append).not.toHaveBeenCalled();
  });

  it("new conversation button creates a conversation", async () => {
    render(<ChatPage />);
    await waitFor(() => screen.getByTitle("New conversation"));
    await userEvent.click(screen.getByTitle("New conversation"));
    await waitFor(() => expect(Conversations.create).toHaveBeenCalled());
  });

  it("auto-titles conversation from first message (≤48 chars)", async () => {
    Conversations.list
      .mockResolvedValueOnce([]) // initial load
      .mockResolvedValue([{ id: "conv-1", title: "New Conversation", order: 0 }]);

    render(<ChatPage />);
    await waitFor(() => screen.getByPlaceholderText(/ask a question/i));

    await userEvent.type(screen.getByPlaceholderText(/ask a question/i), "Explain recursion");
    await userEvent.click(screen.getByLabelText("Send"));

    await waitFor(() =>
      expect(Conversations.rename).toHaveBeenCalledWith("conv-1", "Explain recursion")
    );
  });

  it("auto-title truncates to 48 chars with ellipsis", async () => {
    Conversations.list
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: "conv-1", title: "New Conversation", order: 0 }]);

    render(<ChatPage />);
    await waitFor(() => screen.getByPlaceholderText(/ask a question/i));

    const longMsg = "A".repeat(60);
    await userEvent.type(screen.getByPlaceholderText(/ask a question/i), longMsg);
    await userEvent.click(screen.getByLabelText("Send"));

    await waitFor(() => {
      const [, title] = Conversations.rename.mock.calls[0];
      expect(title).toHaveLength(49); // 48 chars + "…"
      expect(title.endsWith("…")).toBe(true);
    });
  });

  it("sidebar toggle collapses and re-expands", async () => {
    render(<ChatPage />);
    await waitFor(() => screen.getByTitle("Close sidebar"));

    const toggle = screen.getByTitle("Close sidebar");
    await userEvent.click(toggle);
    expect(screen.getByTitle("Open sidebar")).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("Open sidebar"));
    expect(screen.getByTitle("Close sidebar")).toBeInTheDocument();
  });
});
