/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx,js,jsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:       "#0f0f13",
        surface:  "#1a1a2e",
        border:   "#2a2a3e",
        accent:   "#7c6af5",
        teal:     "#5eead4",
        text:     "#e8e8f0",
        muted:    "#888888",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};
