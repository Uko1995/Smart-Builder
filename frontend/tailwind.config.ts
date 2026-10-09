import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1a232b",
        mist: "#f3f5f4",
        line: "#e1e7e4",
        tide: "#0f766e",
        lime: "#6b8f3c",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(26, 35, 43, 0.04), 0 8px 24px rgba(26, 35, 43, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
