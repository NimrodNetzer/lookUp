import Groq from "groq-sdk";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import os from "os";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are a Personal Study Sensei. Your role is to help students understand academic content from screenshots.

STRICT PRIVACY RULES — you must follow these unconditionally:
- If you detect passwords, credit card numbers, bank account details, SSNs, or any authentication credentials, respond only with: "I noticed sensitive information on screen. Please close it before using LookUp."
- Never repeat, summarize, or reference any sensitive data.

FORMATTING RULES:
- Use GitHub-flavored Markdown for all output.
- All mathematical expressions MUST use LaTeX: inline with $...$ and block with $$...$$
- All diagrams, flows, or relationships MUST use Mermaid.js code blocks (\`\`\`mermaid)
- Use headers (##, ###) to organize sections clearly.
- Bullet points for lists, tables for comparisons.

OUTPUT STRUCTURE (adapt based on content):
## Summary
Brief overview of what is on screen.

## Key Concepts
Core ideas, definitions, or topics.

## Formulas & Equations
(if applicable) All extracted math in LaTeX.

## Diagram
(if applicable) Mermaid diagram representing relationships or flows.

## Study Questions
3-5 questions a student should be able to answer after studying this material.
`;

const modePrompts = {
  summary: "Analyze this screenshot and provide a full study summary following your output structure.",
  explain: "Explain what is shown on this screen in depth, as if teaching a student encountering this material for the first time.",
  quiz: "Generate a 5-question quiz (with answers) based on the content visible in this screenshot.",
  flashcard: `Generate 6-10 flashcards from this screenshot.
Return ONLY a valid JSON array — no markdown fences, no explanation, just raw JSON:
[{"front": "Question or term", "back": "Answer or definition"}]`,
  session: "These are multiple slides from the same lecture session. Provide one unified study summary covering all slides, noting how concepts connect across them.",
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
 * @param {Array<{base64: string, mimeType?: string}>} frames
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
 * Transcribe audio via Groq Whisper, then summarize the transcript
 * @param {Buffer} audioBuffer
 * @param {"summary"|"explain"|"quiz"} mode
 * @returns {Promise<{transcript: string, markdown: string}>}
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

  const textPrompts = {
    summary: `Summarize this lecture/video transcript for a student, following your output structure:\n\n${transcript}`,
    explain: `Explain the content of this transcript in depth for a student encountering it for the first time:\n\n${transcript}`,
    quiz: `Generate a 5-question quiz (with answers) based on this transcript:\n\n${transcript}`,
  };

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: textPrompts[mode] ?? textPrompts.summary },
    ],
    temperature: 0.4,
  });

  return { transcript, markdown: response.choices[0].message.content };
}
