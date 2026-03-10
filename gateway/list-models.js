import "dotenv/config";

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
);
const { models } = await res.json();

const vision = models.filter((m) =>
  m.supportedGenerationMethods?.includes("generateContent")
);

console.log("Models that support generateContent:\n");
vision.forEach((m) => console.log(" ", m.name));
