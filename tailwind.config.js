/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        phase: {
          0: { bg: "#e8eaed", border: "#5f6368" },
          1: { bg: "#fde0e0", border: "#d93025" },
          2: { bg: "#fef3c7", border: "#f59e0b" },
          3: { bg: "#d4edda", border: "#28a745" },
          4: { bg: "#d6ecff", border: "#5dade2" },
          5: { bg: "#b8d8f0", border: "#1f618d" },
          6: { bg: "#e8d5f0", border: "#7d3c98" },
        },
      },
    },
  },
  plugins: [],
};
