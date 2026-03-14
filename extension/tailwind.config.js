/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx}", "./dashboard.html", "./chat.html"],
  theme: {
    extend: {
      colors: {
        bg: "#0f0f13",
        surface: "#1a1a2e",
        border: "#2a2a3e",
        accent: "#7c6af5",
        teal: "#5eead4",
        text: "#e8e8f0",
        muted: "#888888",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};
