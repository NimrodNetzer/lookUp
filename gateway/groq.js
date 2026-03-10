import Groq from "groq-sdk";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import os from "os";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are LookUp — a personal Study Sensei helping students understand academic content.

STRICT PRIVACY RULES — follow unconditionally:
- If you detect passwords, credit card numbers, bank details, SSNs, or any credentials, respond ONLY with: "I noticed sensitive information on screen. Please hide it before using LookUp."
- Never repeat, summarize, or reference any sensitive data.

FORMATTING RULES:
- Use GitHub-flavored Markdown.
- Mathematical expressions: inline $...$ and block $$...$$
- Diagrams/flows/relationships: Mermaid.js code blocks (\`\`\`mermaid)
- Bold key terms with **term**.`;

const modePrompts = {
  summary: `Analyze this screenshot and produce a concise structured study summary.

Output exactly this structure (omit any section that isn't applicable):

## Overview
One paragraph stating what this is about and why it matters.

## Key Concepts
- **Term or concept**: Clear, brief explanation
(Include 4–8 bullet points covering the most important ideas)

## Formulas & Equations
(Only if math is present — use LaTeX: inline $...$ or block $$...$$)

## Connections
1–2 sentences on how this topic connects to broader ideas or other concepts.`,

  explain: `You are a patient, engaging tutor. A student shared this screenshot and asked "Can you explain this to me?"

Your explanation must:
1. Open with **why this topic exists** — the real-world motivation or problem it solves (1 short paragraph)
2. Walk through each concept in logical order — plain language first, technical terms second
3. For any formula or algorithm — describe what each part *does* in plain English before showing math
4. Give a concrete real-world analogy for the most abstract concept
5. Close with: **The key insight:** [one sentence capturing the essence]

Write conversationally, like a knowledgeable friend explaining over coffee. Use headers only for major topic shifts — this should read like a spoken explanation, not a textbook.`,

  quiz: `Create a 5-question quiz based on this screenshot to test real understanding — not just memorization.

Format each question exactly like this:

**Q1.** [Question]
**Answer:** [Complete answer]

---

Include these question types:
- At least one "explain why…" question
- At least one application question (how/when would you use this?)
- At least one comparison question (what's the difference between X and Y?)
- Remaining questions can test definitions or recall`,

  flashcard: `Generate 6–10 flashcards from this screenshot.
Return ONLY a valid JSON array — no markdown fences, no explanation, just raw JSON:
[{"front": "Question or term", "back": "Answer or definition"}]`,

  session: `These are multiple slides from the same lecture. Produce one unified study summary.

## Session Overview
What this lecture session covers (1 paragraph).

## Core Topics Covered
For each major topic across the slides:
### [Topic Name]
- Key points
- Formulas if present (LaTeX)

## How the Concepts Connect
Explain the narrative arc — how ideas build on each other across the session.

## Study Questions
3–5 questions spanning the full session.`,
};

/**
 * Analyze one screenshot
 */
export async function analyzeScreenshot(base64Image, mimeType = "image/png", mode = "summary") {
  const prompt = modePrompts[mode] ?? modePrompts.summary;

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          { type: "text", text: prompt },
        ],
      },
    ],
    temperature: 0.4,
  });

  return response.choices[0].message.content;
}

/**
 * Analyze multiple screenshots in one message (session mode)
 */
export async function analyzeSession(frames) {
  const imageContent = frames.map(({ base64, mimeType = "image/png" }) => ({
    type: "image_url",
    image_url: { url: `data:${mimeType};base64,${base64}` },
  }));

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [...imageContent, { type: "text", text: modePrompts.session }],
      },
    ],
    temperature: 0.4,
  });

  return response.choices[0].message.content;
}

/**
 * Analyze selected text (no image) — for the "Ask about selection" feature
 */
export async function analyzeText(selectedText, mode = "summary") {
  const instructions = {
    summary: "Summarize and organize this text for a student, using your structured summary format:",
    explain: "Explain this text in depth as a patient tutor — motivate the topic, walk through concepts, use analogies, close with the key insight:",
    quiz: "Generate a 5-question quiz (with answers) based on this text, testing real understanding:",
  };
  const instruction = instructions[mode] ?? instructions.summary;

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${instruction}\n\n---\n\n${selectedText}` },
    ],
    temperature: 0.4,
  });

  return response.choices[0].message.content;
}

/**
 * Transcribe audio via Groq Whisper, then summarize the transcript
 */
export async function transcribeAndSummarize(audioBuffer, mode = "summary") {
  const tmpPath = path.join(os.tmpdir(), `lookup_${Date.now()}.webm`);
  await fs.writeFile(tmpPath, audioBuffer);

  let transcript = "";
  try {
    const result = await groq.audio.transcriptions.create({
      file: createReadStream(tmpPath),
      model: "whisper-large-v3-turbo",
      response_format: "text",
    });
    transcript = typeof result === "string" ? result : (result.text ?? "");
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }

  if (!transcript.trim()) {
    return { transcript: "", markdown: "No speech detected in the recording." };
  }

  const audioPrompts = {
    summary: `${modePrompts.summary}\n\nTranscript to analyze:\n${transcript}`,
    explain: `${modePrompts.explain}\n\nTranscript to analyze:\n${transcript}`,
    quiz: `${modePrompts.quiz}\n\nTranscript to analyze:\n${transcript}`,
  };

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: audioPrompts[mode] ?? audioPrompts.summary },
    ],
    temperature: 0.4,
  });

  return { transcript, markdown: response.choices[0].message.content };
}
