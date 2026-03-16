/**
 * groq-client.js — Direct Groq API calls from the extension.
 *
 * No Node.js SDK, no temp files — pure fetch() to api.groq.com.
 * API key is loaded from chrome.storage via Settings.getApiKey().
 *
 * Public API mirrors the functions the gateway used to expose:
 *   analyzeScreenshot(base64, mimeType, mode) → string (markdown)
 *   analyzeMulti(frames, mode)                → string (markdown)
 *   analyzeWithQuestion(base64, mimeType, q)  → string (markdown)
 *   analyzeText(text, mode)                   → string (markdown)
 *   transcribeAndSummarize(audioBlob, mode)   → { transcript, markdown }
 *   chat(messages)                            → string
 *   chatStream(messages)                      → AsyncGenerator<string>
 *   processCommand(command, notes, prefs)      → string (JSON)
 *   verifyApiKey(key)                         → { ok, error? }
 */

import { Settings, TokenUsage } from "./storage.js";

const GROQ_API = "https://api.groq.com/openai/v1";
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const AUDIO_MODEL = "whisper-large-v3-turbo";

// ─── Language setting ─────────────────────────────────────────────────────────
let _responseLanguage = "en";
export function setResponseLanguage(lang) { _responseLanguage = lang; }

function buildSystemPrompt() {
  if (_responseLanguage === "he") {
    return SYSTEM_PROMPT + "\n\nIMPORTANT: Respond entirely in Hebrew (עברית). All explanations, headings, bullet points, and text must be in Hebrew only.";
  }
  return SYSTEM_PROMPT;
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function getKey() {
  const key = await Settings.getApiKey();
  if (!key) throw new Error("Groq API key not configured. Open LookUp settings to add your key.");
  return key;
}

function authHeaders(key) {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

// ─── Prompts (identical to gateway/groq.js) ──────────────────────────────────

const SYSTEM_PROMPT = `You are LookUp, a study assistant for students.

Privacy: If you detect passwords, credit cards, bank details, SSNs, or credentials, respond ONLY with: "I noticed sensitive information on screen. Please hide it before using LookUp." Never reference such data.

Format: GitHub-flavored Markdown. Math: $...$ inline, $$...$$ block. Diagrams: \`\`\`mermaid. Bold key terms: **term**.`;

const modePrompts = {
  summary: `Produce a structured study summary:

## Overview
One paragraph: what this is and why it matters.

## Key Concepts
- **Term**: explanation (4–8 bullets)`,

  explain: `Explain this as a patient tutor:
1. Start with **why this topic exists** (1 short paragraph)
2. Walk concepts in logical order — plain language first, technical terms second
3. For formulas/algorithms — explain each part in plain English before math
4. Give a real-world analogy for the most abstract concept
5. End with: **The key insight:** [one sentence]

Write conversationally, not like a textbook.`,

  session: `These are multiple slides from the same lecture. Produce one unified study summary.

## Session Overview
What this session covers (1 paragraph).

## Core Topics Covered
For each major topic:
### [Topic Name]
- Key points and formulas (LaTeX)

## How the Concepts Connect
How ideas build on each other across the session.

## Study Questions
3–5 questions spanning the full session.`,
};

function flashcardCount(text) {
  const len = text.trim().length;
  if (len < 250)  return 2;
  if (len < 600)  return 3;
  if (len < 1100) return 4;
  if (len < 1700) return 5;
  if (len < 2800) return 6;
  if (len < 4000) return 7;
  return 8;
}

function quizQuestionCount(text) {
  const len = text.trim().length;
  if (len < 250)  return 2;
  if (len < 600)  return 3;
  if (len < 1100) return 4;
  if (len < 1700) return 5;
  if (len < 2800) return 6;
  if (len < 4000) return 7;
  return 8;
}

// ─── Core fetch helpers ───────────────────────────────────────────────────────

async function chatCompletion(key, messages, temperature = 0.4) {
  const res = await fetch(`${GROQ_API}/chat/completions`, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify({ model: VISION_MODEL, messages, temperature }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error("Daily token limit reached. Your quota resets every 24 hours — try again tomorrow, or upgrade at console.groq.com.");
    throw new Error(err.error?.message ?? `Groq API error ${res.status}`);
  }
  const data = await res.json();
  if (data.usage?.total_tokens) TokenUsage.add(data.usage.total_tokens);
  return data.choices[0].message.content;
}

async function* chatCompletionStream(key, messages, temperature = 0.6) {
  const res = await fetch(`${GROQ_API}/chat/completions`, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify({ model: VISION_MODEL, messages, temperature, stream: true, stream_options: { include_usage: true } }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error("Daily token limit reached. Your quota resets every 24 hours — try again tomorrow, or upgrade at console.groq.com.");
    throw new Error(err.error?.message ?? `Groq API error ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      try {
        const chunk = JSON.parse(data);
        // Final chunk from stream_options.include_usage carries real token counts
        if (chunk.usage?.total_tokens) TokenUsage.add(chunk.usage.total_tokens);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {}
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Verify an API key by making a cheap test call.
 * Returns { ok: true } or { ok: false, error: string }
 */
export async function verifyApiKey(key) {
  try {
    const res = await fetch(`${GROQ_API}/chat/completions`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
    });
    if (res.ok) return { ok: true };
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error?.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Analyze a single screenshot.
 * base64Image: base64-encoded image string (no data: prefix)
 * mimeType: "image/png" | "image/jpeg" | "image/webp"
 * mode: "summary" | "explain" | "quiz" | "flashcard"
 */
export async function analyzeScreenshot(base64Image, mimeType = "image/png", mode = "summary") {
  const key = await getKey();
  const imageUrl = `data:${mimeType};base64,${base64Image}`;

  let prompt = modePrompts[mode] ?? modePrompts.summary;

  // Reinforce language in the user-facing prompt for non-quiz modes.
  // The system prompt alone is not always sufficient when the mode prompt
  // starts with a strong English persona directive ("You are a tutor…").
  if (mode !== "quiz" && mode !== "flashcard" && _responseLanguage === "he") {
    prompt += "\n\nכתוב את כל התשובה בעברית בלבד.";
  }

  // For quiz/flashcard: use a fixed count and send image directly — avoids a double API call
  if (mode === "quiz") {
    const langNote = _responseLanguage === "he" ? "\n\nכתוב את כל השאלות והתשובות בעברית." : "";
    prompt = `Create a 5-question quiz based on this screenshot to test real understanding — not just memorization.\n\nFormat each question exactly like this:\n\n**Q1.** [Question]\n**Answer:** [Answer in 5–60 words — concise but complete]\n\nInclude these question types:\n- At least one "explain why…" question\n- At least one application question (how/when would you use this?)\n- One comparison question (what's the difference between X and Y?)\n- Remaining questions can test definitions or recall\n\nIMPORTANT: Keep every answer between 5 and 60 words. No lengthy paragraphs.${langNote}`;
  } else if (mode === "flashcard") {
    prompt = `Generate 5 flashcards from this screenshot.\nReturn ONLY a valid JSON array — no markdown fences, no explanation, just raw JSON:\n[{"front": "Question or term", "back": "Answer or definition"}]`;
  }

  return chatCompletion(key, [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: prompt },
      ],
    },
  ]);
}

/**
 * Analyze multiple screenshots together (session / multi-page mode).
 * frames: [{ base64: string, mimeType?: string }]
 */
export async function analyzeMulti(frames, mode = "session") {
  const key = await getKey();
  const imageContent = frames.map(({ base64, mimeType = "image/png" }) => ({
    type: "image_url",
    image_url: { url: `data:${mimeType};base64,${base64}` },
  }));
  let prompt = modePrompts[mode] ?? modePrompts.session;
  if (_responseLanguage === "he") prompt += "\n\nכתוב את כל התשובה בעברית בלבד.";

  return chatCompletion(key, [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: [...imageContent, { type: "text", text: prompt }] },
  ]);
}

/**
 * Answer a specific user question about one or more screenshots/images.
 * Accepts a single image (legacy) or an array of { base64, mimeType } objects.
 */
export async function analyzeWithQuestion(base64Image, mimeType = "image/png", question) {
  const key = await getKey();
  const images = Array.isArray(base64Image)
    ? base64Image
    : [{ base64: base64Image, mimeType }];
  const imageContent = images.map(img => ({
    type: "image_url",
    image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
  }));
  const langSuffix = _responseLanguage === "he" ? "\n\nכתוב את כל התשובה בעברית בלבד." : "";
  return chatCompletion(key, [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: [...imageContent, { type: "text", text: question + langSuffix }],
    },
  ]);
}

/** Streaming variant of analyzeWithQuestion — yields string deltas. */
export async function* analyzeWithQuestionStream(base64Image, mimeType = "image/png", question) {
  const key = await getKey();
  const images = Array.isArray(base64Image)
    ? base64Image
    : [{ base64: base64Image, mimeType }];
  const imageContent = images.map(img => ({
    type: "image_url",
    image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
  }));
  const langSuffix = _responseLanguage === "he" ? "\n\nכתוב את כל התשובה בעברית בלבד." : "";
  yield* chatCompletionStream(key, [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: [...imageContent, { type: "text", text: question + langSuffix }],
    },
  ]);
}

/**
 * Analyze selected text (no image).
 */
export async function analyzeText(selectedText, mode = "summary") {
  const key = await getKey();
  const langNote = _responseLanguage === "he" ? " כתוב את כל השאלות והתשובות בעברית." : "";
  const instructions = {
    summary:   "Summarize and organize this text for a student, using your structured summary format:",
    explain:   "Explain this text in depth as a patient tutor — motivate the topic, walk through concepts, use analogies, close with the key insight:",
    quiz:      `Generate a ${quizQuestionCount(selectedText)}-question quiz based on this text, testing real understanding. Format: **Q1.** [Question]\\n**Answer:** [5–60 words — concise but complete]. No lengthy paragraphs.${langNote}`,
    flashcard: `Generate exactly ${flashcardCount(selectedText)} flashcards from this text.\nReturn ONLY a valid JSON array — no markdown fences, no explanation, just raw JSON:\n[{"front": "Question or term", "back": "Answer or definition"}]`,
  };
  const instruction = instructions[mode] ?? instructions.summary;

  return chatCompletion(key, [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: `${instruction}\n\n---\n\n${selectedText}` },
  ]);
}

/**
 * Transcribe audio then summarize/analyze the transcript.
 * audioBlob: a Blob (webm/ogg/mp4 — whatever MediaRecorder produces)
 * mode: "summary" | "explain" | "quiz" | "flashcard"
 * Returns { transcript: string, markdown: string }
 */
// Groq Whisper hard limit is 25 MB — stay safely under it.
const MAX_WHISPER_BYTES = 20 * 1024 * 1024; // 20 MB

async function transcribeBlob(key, blob, filename = "audio.webm") {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", AUDIO_MODEL);
  form.append("response_format", "text");
  const res = await fetch(`${GROQ_API}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Transcription error ${res.status}`);
  }
  return (await res.text()).trim();
}

// Build valid WebM segment blobs from raw MediaRecorder chunks.
// The first chunk always contains the WebM init header (EBML + Tracks).
// Every segment must start with it so ffmpeg/Whisper can decode it.
function buildSegmentBlobs(chunks, blobType) {
  if (!chunks || chunks.length === 0) return [];
  const totalSize = chunks.reduce((s, c) => s + c.size, 0);
  const numSegments = Math.ceil(totalSize / MAX_WHISPER_BYTES);
  if (numSegments <= 1) return [new Blob(chunks, { type: blobType })];

  const initChunk = chunks[0];
  const dataChunks = chunks.slice(1);
  const perSegment = Math.ceil(dataChunks.length / numSegments);
  const blobs = [];
  for (let i = 0; i < dataChunks.length; i += perSegment) {
    blobs.push(new Blob([initChunk, ...dataChunks.slice(i, i + perSegment)], { type: blobType }));
  }
  return blobs;
}

export async function transcribeAndSummarize(audioBlob, mode = "summary", userNote = "", chunks = null) {
  const key = await getKey();

  // If the recording is large, split into valid WebM segments and transcribe each.
  // Otherwise fall back to a single transcription call.
  let transcript;
  if (chunks && audioBlob.size > MAX_WHISPER_BYTES) {
    const blobType = audioBlob.type || "audio/webm";
    const segments = buildSegmentBlobs(chunks, blobType);
    const parts = [];
    for (const seg of segments) {
      parts.push(await transcribeBlob(key, seg));
    }
    transcript = parts.filter(Boolean).join(" ");
  } else {
    transcript = await transcribeBlob(key, audioBlob);
  }

  if (!transcript) {
    return { transcript: "", markdown: "No speech detected in the recording." };
  }

  const n = quizQuestionCount(transcript);
  const noteCtx = userNote ? `\n\nUser's instruction: "${userNote}"` : "";
  const langNote = _responseLanguage === "he" ? "\n\nכתוב את כל השאלות והתשובות בעברית." : "";
  const audioPrompts = {
    summary:   `${modePrompts.summary}${noteCtx}\n\nTranscript to analyze:\n${transcript}`,
    explain:   `${modePrompts.explain}${noteCtx}\n\nTranscript to analyze:\n${transcript}`,
    quiz:      `Generate a ${n}-question quiz based on this transcript, testing real understanding.\n\nFormat each question exactly like this:\n\n**Q1.** [Question]\n**Answer:** [5–60 words — concise but complete]\n\nIMPORTANT: Keep every answer between 5 and 60 words.${langNote}${noteCtx}\n\nTranscript to analyze:\n${transcript}`,
    flashcard: `Generate exactly ${flashcardCount(transcript)} flashcards from this transcript.\nReturn ONLY a valid JSON array — no markdown fences, no explanation, just raw JSON:\n[{"front": "Question or term", "back": "Answer or definition"}]${noteCtx}\n\nTranscript to analyze:\n${transcript}`,
  };

  const markdown = await chatCompletion(key, [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: audioPrompts[mode] ?? audioPrompts.summary },
  ]);

  return { transcript, markdown };
}

/**
 * Multi-turn chat (non-streaming).
 * messages: [{ role: "user"|"assistant", content: string }]
 */
export async function chat(messages) {
  const key = await getKey();
  return chatCompletion(key, [
    { role: "system", content: buildSystemPrompt() },
    ...messages,
  ], 0.6);
}

/**
 * Multi-turn chat with streaming.
 * Returns an AsyncGenerator that yields string deltas.
 *
 * Usage:
 *   for await (const delta of chatStream(messages)) {
 *     ui.append(delta);
 *   }
 */
export async function* chatStream(messages) {
  const key = await getKey();
  yield* chatCompletionStream(key, [
    { role: "system", content: buildSystemPrompt() },
    ...messages,
  ]);
}

/**
 * Process a natural-language organisation command.
 * Returns a JSON string (array of action objects) — same format as gateway.
 */
export async function processCommand(command, notes, preferences, history = []) {
  const key = await getKey();

  const list = notes
    .slice(0, 60)
    .map(n => `{"f":"${n.filename}","t":"${n.title}","m":"${n.type ?? n.mode}","c":"${n.course || ""}","d":"${new Date(n.createdAt).toISOString().slice(0, 10)}"}`)
    .join("\n");

  const systemPrompt = `You manage a student's LookUp study notes. Execute commands by returning a JSON array of actions.

NOTES (newest first):
${list}

USER PREFERENCES:
${preferences || "none"}

ACTION TYPES (return as JSON array, pick what applies):
{"action":"set_course","filename":"exact_filename.md","course":"Course Name"}
{"action":"rename","filename":"exact_filename.md","title":"New Title"}
{"action":"merge","filenames":["file1.md","file2.md"],"title":"Combined Note Title"}
{"action":"clarify","question":"Ask the user a specific question to resolve ambiguity"}
{"action":"message","text":"plain-English explanation if nothing to do"}

RULES:
- Use ONLY exact filenames from the list above
- Course names should be title-cased clean strings, e.g. "Operating Systems"
- For "last N captures" use the N most recent filenames
- Apply user preferences (e.g. prefix rules) when renaming
- For merge: include at least 2 filenames; pick a meaningful combined title
- If the command is ambiguous (e.g. "merge 2 files" with no names, or a title that matches multiple notes), return a single clarify action with a focused question — do NOT guess
- Return ONLY a valid JSON array, no markdown fences, no extra text`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: command },
  ];

  return chatCompletion(key, messages, 0.1);
}
