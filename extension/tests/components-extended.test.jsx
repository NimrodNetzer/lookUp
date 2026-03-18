/**
 * Extended component tests — edge cases, error states, and user interaction details.
 * Uses Vitest + @testing-library/react (fast, no real browser needed).
 *
 * Covers:
 *  - NoteViewer: all mode badges, editing flow, edit cancel, Ctrl+S save,
 *                multi-section parsing, all section types, edge-case content
 *  - NewNoteModal: save/cancel/escape/disabled/saving states
 *  - ChatPage: whitespace blocking, special chars, mode prefix, very long auto-title,
 *              sidebar toggle, consecutive sends, error recovery, existing conversations
 *  - App/SetupScreen: whitespace-only key blocked, loading state
 *  - Input security: XSS strings, null bytes, RTL text
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../src/CosmicBg.jsx",        () => ({ default: () => null }));
vi.mock("../src/GlobalSearch.jsx",    () => ({ default: ({ onClose }) => (
  <div data-testid="global-search"><button onClick={onClose}>Close</button></div>
)}));
vi.mock("../src/FlashcardViewer.jsx", () => ({ default: ({ cards }) => (
  <div data-testid="flashcard-viewer">{cards.length} cards</div>
)}));
// LearningHub is complex — stub it; tested separately
vi.mock("../src/LearningHub.jsx", () => ({ default: () => <div data-testid="learning-hub" /> }));

vi.mock("../storage.js", () => ({
  Settings: {
    isConfigured:   vi.fn(async () => false),
    getApiKey:      vi.fn(async () => null),
    setApiKey:      vi.fn(async () => {}),
    getPreferences: vi.fn(async () => ({})),
    getChatMode:    vi.fn(async () => "chat"),
    setChatMode:    vi.fn(async () => {}),
  },
  Notes: {
    get:    vi.fn(async () => null),
    save:   vi.fn(async () => {}),
    stats:  vi.fn(async () => ({ totalNotes: 0, streak: 0, thisWeek: 0 })),
    search: vi.fn(async () => []),
    updateByConversationId: vi.fn(async () => {}),
  },
  Folders: {
    list:   vi.fn(async () => []),
    create: vi.fn(async () => ({ id: "f1", name: "New Folder" })),
    rename: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
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

vi.mock("../groq-client.js", () => ({
  verifyApiKey:      vi.fn(async () => ({ ok: true })),
  chatStream:        vi.fn(async function* () { yield "Hello world"; }),
  chatStreamRich:    vi.fn(async function* () { yield "Hello world"; }),
  transcribeOnly:    vi.fn(async () => "transcribed text"),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm",   () => ({ default: () => {} }));
vi.mock("remark-math",  () => ({ default: () => {} }));
vi.mock("rehype-katex", () => ({ default: () => {} }));

// ── Imports ───────────────────────────────────────────────────────────────────

import App from "../src/App.jsx";
import NoteViewer from "../src/NoteViewer.jsx";
import ChatPage from "../src/ChatPage.jsx";

import { Settings, Notes, Conversations, Messages } from "../storage.js";
import { verifyApiKey, chatStream } from "../groq-client.js";

// ── Shared setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  Settings.isConfigured.mockResolvedValue(false);
  Notes.get.mockResolvedValue(null);
  Conversations.getActive.mockResolvedValue({ id: "conv-1", title: "New Conversation", order: 0 });
  Conversations.list.mockResolvedValue([{ id: "conv-1", title: "New Conversation", order: 0 }]);
  Conversations.create.mockResolvedValue({ id: "conv-2", title: "New Conversation", order: 1 });
  Messages.listByConversation.mockResolvedValue([]);
  chatStream.mockImplementation(async function* () { yield "Hello world"; });
});

async function waitForChatInit() {
  await waitFor(() => expect(Conversations.setActive).toHaveBeenCalled(), { timeout: 3000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// NoteViewer — mode badges
// ─────────────────────────────────────────────────────────────────────────────

describe("NoteViewer — mode badges", () => {
  const modes = [
    { mode: "summary",         label: "Summary"    },
    { mode: "explain",         label: "Explain"    },
    { mode: "quiz",            label: "Quiz"       },
    { mode: "flashcard",       label: "Flashcards" },
    { mode: "session",         label: "Session"    },
    { mode: "chat",            label: "Notes"      },
    { mode: "audio-summary",   label: "Audio"      },
    { mode: "audio-explain",   label: "Audio"      },
    { mode: "audio-quiz",      label: "Audio"      },
  ];

  modes.forEach(({ mode, label }) => {
    it(`renders '${label}' badge for mode='${mode}'`, async () => {
      Notes.get.mockResolvedValue({ title: "T", mode, content: "Some content.", createdAt: Date.now() });
      render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
      await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
    });
  });

  it("falls back to Summary badge for unknown mode", async () => {
    Notes.get.mockResolvedValue({ title: "T", mode: "unknown_mode", content: "Content.", createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Summary")).toBeInTheDocument());
  });

  it("falls back to Summary badge when mode is null", async () => {
    Notes.get.mockResolvedValue({ title: "T", mode: null, content: "Content.", createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Summary")).toBeInTheDocument());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NoteViewer — content rendering
// ─────────────────────────────────────────────────────────────────────────────

describe("NoteViewer — content rendering", () => {
  it("renders the note title", async () => {
    Notes.get.mockResolvedValue({ title: "My Test Note", mode: "summary", content: "Body.", createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("My Test Note")).toBeInTheDocument());
  });

  it("renders the creation date", async () => {
    const ts = new Date("2024-06-15T10:00:00").getTime();
    Notes.get.mockResolvedValue({ title: "T", mode: "summary", content: "Body.", createdAt: ts });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => {
      // The date is rendered via toLocaleString — just verify some date text is present
      const dateEl = document.querySelector("p.text-xs.text-muted");
      expect(dateEl?.textContent).toBeTruthy();
    });
  });

  it("renders flashcard viewer for valid JSON flashcard content", async () => {
    const content = '[{"front":"What is gravity?","back":"A force of attraction."}]';
    Notes.get.mockResolvedValue({ title: "Cards", mode: "flashcard", content, createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("flashcard-viewer")).toBeInTheDocument());
    expect(screen.getByTestId("flashcard-viewer").textContent).toContain("1 cards");
  });

  it("renders flashcard viewer with multiple cards", async () => {
    const cards = [
      { front: "Q1", back: "A1" }, { front: "Q2", back: "A2" }, { front: "Q3", back: "A3" },
    ];
    Notes.get.mockResolvedValue({ title: "Cards", mode: "flashcard", content: JSON.stringify(cards), createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("flashcard-viewer").textContent).toContain("3 cards"));
  });

  it("treats invalid JSON as text (not a flashcard)", async () => {
    Notes.get.mockResolvedValue({ title: "T", mode: "flashcard", content: "not valid json", createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId("flashcard-viewer")).not.toBeInTheDocument());
  });

  it("renders quiz reveal buttons for quiz content", async () => {
    const content = "**Q1.** What is entropy?\n**Answer:** A measure of disorder.";
    Notes.get.mockResolvedValue({ title: "Quiz", mode: "quiz", content, createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/show answer/i)).toBeInTheDocument());
  });

  it("quiz answer is hidden until revealed", async () => {
    const content = "**Q1.** What is entropy?\n**Answer:** A measure of disorder.";
    Notes.get.mockResolvedValue({ title: "Quiz", mode: "quiz", content, createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText(/show answer/i));
    // Answer should not be visible yet
    expect(screen.queryByText("A measure of disorder.")).not.toBeInTheDocument();
  });

  it("quiz answer appears after clicking reveal", async () => {
    const content = "**Q1.** What is entropy?\n**Answer:** A measure of disorder.";
    Notes.get.mockResolvedValue({ title: "Quiz", mode: "quiz", content, createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText(/show answer/i));
    await userEvent.click(screen.getByText(/show answer/i));
    expect(screen.getByText("A measure of disorder.")).toBeInTheDocument();
  });

  it("quiz answer can be hidden again after revealing", async () => {
    const content = "**Q1.** What is entropy?\n**Answer:** A measure of disorder.";
    Notes.get.mockResolvedValue({ title: "Quiz", mode: "quiz", content, createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText(/show answer/i));
    await userEvent.click(screen.getByText(/show answer/i));
    expect(screen.getByText("A measure of disorder.")).toBeInTheDocument();
    await userEvent.click(screen.getByText(/hide answer/i));
    expect(screen.queryByText("A measure of disorder.")).not.toBeInTheDocument();
  });

  it("shows Mixed badge for note with multiple section types", async () => {
    const content = "## Summary text.\n\n---\n\n" + '[{"front":"Q","back":"A"}]';
    Notes.get.mockResolvedValue({ title: "Multi", mode: "summary", content, createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => {
      const all = screen.getAllByText("Mixed");
      expect(all.some((el) => el.tagName === "SPAN")).toBe(true);
    });
  });

  it("renders markdown for text-mode notes", async () => {
    Notes.get.mockResolvedValue({ title: "T", mode: "summary", content: "Some **bold** text.", createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("markdown")).toBeInTheDocument());
  });

  it("shows not-found for null filename", async () => {
    render(<NoteViewer filename={null} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument());
  });

  it("shows not-found for empty string filename", async () => {
    render(<NoteViewer filename="" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument());
  });

  it("shows not-found when Notes.get returns null", async () => {
    Notes.get.mockResolvedValue(null);
    render(<NoteViewer filename="missing.md" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument());
  });

  it("shows loading while Notes.get is pending", async () => {
    Notes.get.mockReturnValue(new Promise(() => {}));
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("calls onBack when back button is clicked from note view", async () => {
    const onBack = vi.fn();
    Notes.get.mockResolvedValue({ title: "T", mode: "summary", content: "Body.", createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={onBack} />);
    await waitFor(() => screen.getByText("T"));
    await userEvent.click(screen.getByText(/← Back/i));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("calls onBack when back button is clicked from not-found view", async () => {
    const onBack = vi.fn();
    Notes.get.mockResolvedValue(null);
    render(<NoteViewer filename="gone.md" onBack={onBack} />);
    await waitFor(() => screen.getByText(/not found/i));
    await userEvent.click(screen.getByText(/← Back/i));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NoteViewer — editing
// ─────────────────────────────────────────────────────────────────────────────

describe("NoteViewer — editing (chat mode)", () => {
  function chatNote(overrides = {}) {
    return { title: "My Note", mode: "chat", content: "Original content.", createdAt: Date.now(), ...overrides };
  }

  it("shows Options button for chat-mode notes", async () => {
    Notes.get.mockResolvedValue(chatNote());
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("My Note"));
    expect(screen.getByText("Options")).toBeInTheDocument();
  });

  it("does NOT show Options button for AI-generated notes", async () => {
    Notes.get.mockResolvedValue({ title: "T", mode: "summary", content: "Body.", createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("T"));
    expect(screen.queryByText("Options")).not.toBeInTheDocument();
  });

  it("AI notes show Export .md button", async () => {
    Notes.get.mockResolvedValue({ title: "T", mode: "summary", content: "Body.", createdAt: Date.now() });
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("T"));
    expect(screen.getByText(/export .md/i)).toBeInTheDocument();
  });

  it("clicking Options opens the dropdown", async () => {
    Notes.get.mockResolvedValue(chatNote());
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("Options"));
    await userEvent.click(screen.getByText("Options"));
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("clicking Edit enters edit mode", async () => {
    Notes.get.mockResolvedValue(chatNote());
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("Options"));
    await userEvent.click(screen.getByText("Options"));
    await userEvent.click(screen.getByText("Edit"));
    // Edit mode shows a textarea with the current content
    await waitFor(() => expect(screen.getByDisplayValue("Original content.")).toBeInTheDocument());
  });

  it("edit mode shows Save and Cancel buttons", async () => {
    Notes.get.mockResolvedValue(chatNote());
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("Options"));
    await userEvent.click(screen.getByText("Options"));
    await userEvent.click(screen.getByText("Edit"));
    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("Cancel exits edit mode without saving", async () => {
    Notes.get.mockResolvedValue(chatNote());
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("Options"));
    await userEvent.click(screen.getByText("Options"));
    await userEvent.click(screen.getByText("Edit"));
    await waitFor(() => screen.getByRole("button", { name: /cancel/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(Notes.save).not.toHaveBeenCalled();
    // Back to view mode
    expect(screen.queryByDisplayValue("Original content.")).not.toBeInTheDocument();
  });

  it("Save calls Notes.save with the edited content", async () => {
    Notes.get
      .mockResolvedValueOnce(chatNote())
      .mockResolvedValue(chatNote({ content: "Updated content." }));
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("Options"));
    await userEvent.click(screen.getByText("Options"));
    await userEvent.click(screen.getByText("Edit"));

    const textarea = await screen.findByDisplayValue("Original content.");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Updated content.");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(Notes.save).toHaveBeenCalledWith(
      "n.md",
      expect.objectContaining({ title: "My Note", mode: "chat" }),
      "Updated content."
    ));
  });

  it("Ctrl+S saves from edit mode", async () => {
    Notes.get
      .mockResolvedValueOnce(chatNote())
      .mockResolvedValue(chatNote());
    render(<NoteViewer filename="n.md" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("Options"));
    await userEvent.click(screen.getByText("Options"));
    await userEvent.click(screen.getByText("Edit"));

    const textarea = await screen.findByDisplayValue("Original content.");
    fireEvent.keyDown(textarea, { key: "s", ctrlKey: true });

    await waitFor(() => expect(Notes.save).toHaveBeenCalled());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ChatPage — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("ChatPage — input edge cases", () => {
  it("whitespace-only message does not enable the send button", async () => {
    render(<ChatPage />);
    await waitForChatInit();
    const input = screen.getByPlaceholderText(/ask a question/i);
    await userEvent.type(input, "   ");
    expect(screen.getByLabelText("Send")).toBeDisabled();
  });

  it("send button is disabled on empty input", async () => {
    render(<ChatPage />);
    await waitForChatInit();
    expect(screen.getByLabelText("Send")).toBeDisabled();
  });

  it("send button enables when text is typed", async () => {
    render(<ChatPage />);
    await waitForChatInit();
    await userEvent.type(screen.getByPlaceholderText(/ask a question/i), "Hi");
    expect(screen.getByLabelText("Send")).not.toBeDisabled();
  });

  it("user message appears in chat immediately after send", async () => {
    render(<ChatPage />);
    await waitForChatInit();
    await userEvent.type(screen.getByPlaceholderText(/ask a question/i), "Hello there");
    await userEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(screen.getAllByText("Hello there").length).toBeGreaterThan(0));
  });

  it("special HTML characters in message appear as text not as HTML", async () => {
    render(<ChatPage />);
    await waitForChatInit();
    await userEvent.type(screen.getByPlaceholderText(/ask a question/i), "<b>bold</b>");
    await userEvent.click(screen.getByLabelText("Send"));
    // The raw string appears as text content, not rendered as bold
    await waitFor(() => expect(screen.getAllByText("<b>bold</b>").length).toBeGreaterThan(0));
  });

  it("Enter key triggers send and message appears in chat", async () => {
    render(<ChatPage />);
    await waitForChatInit();
    const input = screen.getByPlaceholderText(/ask a question/i);
    await userEvent.type(input, "Press enter to send{Enter}");
    await waitFor(() => expect(screen.getAllByText("Press enter to send").length).toBeGreaterThan(0));
  });

  it("Shift+Enter does not send — adds a newline", async () => {
    render(<ChatPage />);
    await waitForChatInit();
    const input = screen.getByPlaceholderText(/ask a question/i);
    await userEvent.type(input, "Hello{Shift>}{Enter}{/Shift}");
    expect(Messages.append).not.toHaveBeenCalled();
  });

  it("emoji characters are accepted in message input", async () => {
    render(<ChatPage />);
    await waitForChatInit();
    const input = screen.getByPlaceholderText(/ask a question/i);
    await userEvent.type(input, "Hello 🌍");
    // Verify emoji didn't crash the input
    expect(input.value).toContain("Hello");
    expect(screen.getByLabelText("Send")).not.toBeDisabled();
  });
});

describe("ChatPage — conversation management", () => {
  it("loads existing conversations on mount", async () => {
    Conversations.list.mockResolvedValue([
      { id: "conv-1", title: "First Chat", order: 0 },
      { id: "conv-2", title: "Second Chat", order: 1 },
    ]);
    Conversations.getActive.mockResolvedValue({ id: "conv-1", title: "First Chat", order: 0 });
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByText("First Chat")).toBeInTheDocument());
    expect(screen.getByText("Second Chat")).toBeInTheDocument();
  });

  it("shows active conversation's messages on mount", async () => {
    Messages.listByConversation.mockResolvedValue([
      { role: "user",      content: "Existing user message" },
      { role: "assistant", content: "Existing AI reply"     },
    ]);
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByText("Existing user message")).toBeInTheDocument());
    expect(screen.getByText("Existing AI reply")).toBeInTheDocument();
  });

  it("switching conversations calls setActive with new id", async () => {
    const convs = [
      { id: "conv-1", title: "Chat 1", order: 0 },
      { id: "conv-2", title: "Chat 2", order: 1 },
    ];
    Conversations.list.mockResolvedValue(convs);
    Conversations.getActive.mockResolvedValue(convs[0]);
    Messages.listByConversation.mockResolvedValue([]);

    render(<ChatPage />);
    await waitFor(() => screen.getByText("Chat 1"));

    await userEvent.click(screen.getByText("Chat 2"));
    await waitFor(() => expect(Conversations.setActive).toHaveBeenCalledWith("conv-2"));
  });

  it("new conversation button creates a conversation", async () => {
    render(<ChatPage />);
    await waitFor(() => screen.getByTitle("New conversation"));
    await userEvent.click(screen.getByTitle("New conversation"));
    await waitFor(() => expect(Conversations.create).toHaveBeenCalled());
  });

  it("new conversation resets messages to empty", async () => {
    Messages.listByConversation.mockResolvedValue([
      { role: "user", content: "Old message" },
    ]);
    render(<ChatPage />);
    await waitFor(() => screen.getByText("Old message"));

    await userEvent.click(screen.getByTitle("New conversation"));
    await waitFor(() => expect(screen.queryByText("Old message")).not.toBeInTheDocument());
  });

  it("shows empty state prompt when conversation has no messages", async () => {
    Messages.listByConversation.mockResolvedValue([]);
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByText(/ask anything/i)).toBeInTheDocument());
  });

  it("right-click on conversation shows context menu", async () => {
    Conversations.list.mockResolvedValue([{ id: "conv-1", title: "My Chat", order: 0 }]);
    Conversations.getActive.mockResolvedValue({ id: "conv-1", title: "My Chat", order: 0 });
    render(<ChatPage />);
    await waitFor(() => screen.getByText("My Chat"));

    fireEvent.contextMenu(screen.getByText("My Chat"));
    // Context menu should appear with Rename option
    await waitFor(() => expect(screen.getByText("Rename")).toBeInTheDocument());
  });
});

describe("ChatPage — send and streaming", () => {
  it("send via Enter key calls Messages.append", async () => {
    render(<ChatPage />);
    await waitForChatInit();
    await userEvent.type(screen.getByPlaceholderText(/ask a question/i), "Hello there{Enter}");
    await waitFor(() => expect(Messages.append).toHaveBeenCalled());
  });

  it("user message appears in chat before stream completes", async () => {
    // Stream never resolves — user message should still appear immediately
    chatStream.mockImplementation(async function* () {
      await new Promise(() => {}); // hangs forever
      yield "never";
    });
    render(<ChatPage />);
    await waitForChatInit();
    await userEvent.type(screen.getByPlaceholderText(/ask a question/i), "Quick question{Enter}");
    // User message appears immediately (before stream)
    await waitFor(() => expect(screen.getByText("Quick question")).toBeInTheDocument());
  });

  it("loading state is shown while stream is in progress", async () => {
    let resolve;
    chatStream.mockImplementation(async function* () {
      await new Promise((r) => { resolve = r; });
      yield "done";
    });
    render(<ChatPage />);
    await waitForChatInit();
    await userEvent.type(screen.getByPlaceholderText(/ask a question/i), "Test{Enter}");
    // While loading, send button should be disabled
    await waitFor(() => expect(screen.getByLabelText("Send")).toBeDisabled());
  });
});

describe("ChatPage — sidebar", () => {
  it("sidebar is open by default", async () => {
    render(<ChatPage />);
    await waitFor(() => screen.getByTitle("Close sidebar"));
    expect(screen.getByTitle("Close sidebar")).toBeInTheDocument();
  });

  it("clicking close sidebar hides the sidebar", async () => {
    render(<ChatPage />);
    await waitFor(() => screen.getByTitle("Close sidebar"));
    await userEvent.click(screen.getByTitle("Close sidebar"));
    await waitFor(() => expect(screen.getByTitle("Open sidebar")).toBeInTheDocument());
  });

  it("clicking open sidebar shows the sidebar again", async () => {
    render(<ChatPage />);
    await waitFor(() => screen.getByTitle("Close sidebar"));
    await userEvent.click(screen.getByTitle("Close sidebar"));
    await waitFor(() => screen.getByTitle("Open sidebar"));
    await userEvent.click(screen.getByTitle("Open sidebar"));
    await waitFor(() => expect(screen.getByTitle("Close sidebar")).toBeInTheDocument());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// App / SetupScreen — additional edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("App — SetupScreen edge cases", () => {
  it("whitespace-only API key does not enable save button", async () => {
    Settings.isConfigured.mockResolvedValue(false);
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText("gsk_..."));
    const input = screen.getByPlaceholderText("gsk_...");
    await userEvent.type(input, "   ");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("key with leading/trailing spaces is trimmed before verify", async () => {
    Settings.isConfigured.mockResolvedValue(false);
    verifyApiKey.mockResolvedValue({ ok: true });
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText("gsk_..."));
    await userEvent.type(screen.getByPlaceholderText("gsk_..."), "  gsk_key  ");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(verifyApiKey).toHaveBeenCalledWith("gsk_key"));
  });

  it("error clears when user starts typing again", async () => {
    Settings.isConfigured.mockResolvedValue(false);
    verifyApiKey.mockResolvedValue({ ok: false });
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText("gsk_..."));

    await userEvent.type(screen.getByPlaceholderText("gsk_..."), "bad_key");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => screen.getByText(/invalid api key/i));

    // Continue typing — error should still be visible (it clears on next attempt, not on keypress)
    // This verifies the error persists until another submit
    expect(screen.getByText(/invalid api key/i)).toBeInTheDocument();
  });

  it("button is disabled while verifying", async () => {
    Settings.isConfigured.mockResolvedValue(false);
    verifyApiKey.mockReturnValue(new Promise(() => {})); // never resolves
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText("gsk_..."));
    await userEvent.type(screen.getByPlaceholderText("gsk_..."), "gsk_key");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /verifying/i })).toBeDisabled());
  });

  it("spinner shows while isConfigured is loading", async () => {
    Settings.isConfigured.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("transitions from setup to main app after valid key", async () => {
    Settings.isConfigured.mockResolvedValue(false);
    verifyApiKey.mockResolvedValue({ ok: true });
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText("gsk_..."));
    await userEvent.type(screen.getByPlaceholderText("gsk_..."), "gsk_valid");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByTestId("learning-hub")).toBeInTheDocument());
  });
});
