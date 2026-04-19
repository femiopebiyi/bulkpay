import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bp: {
          bg: "#FAFAF9",
          dark: "#0F1117",
          accent: "#C8FF00",
          "accent-hover": "#D4FF33",
          "dark-btn": "#1F2937",
          "dark-btn-hover": "#374151",
          border: "#E5E7EB",
          "border-light": "#F3F4F6",
          muted: "#6B7280",
          hint: "#9CA3AF",
          danger: "#7F1D1D",
          "danger-text": "#FCA5A5",
        },
      },
      fontFamily: {
        display: ["Playfair Display", "serif"],
        body: ["DM Sans", "sans-serif"],
        mono: ["DM Mono", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.2s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
