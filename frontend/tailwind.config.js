const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: c("bg"), surface: c("surface"), soft: c("soft"), line: c("line"),
        fg: c("fg"), muted: c("muted"), "brand-fg": c("brand-fg"),
        ok: c("ok"), warn: c("warn"), bad: c("bad"), info: c("info"),
        brand: { DEFAULT: c("brand"), 300: "#a3a8fd", 400: "#8184f9", 600: "#4f46e5" },
        // barre de navigation sombre (identique en clair et en sombre)
        ink: {
          950: "#0c0e14", 900: "#151821", 800: "#232733", 700: "#363b4a",
          500: "#6b7385", 400: "#9aa2b1", 300: "#c9ced8",
        },
      },
      fontFamily: {
        sans: ["Geist", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: { md: "0.375rem", lg: "0.5rem", xl: "0.5rem", "2xl": "0.5rem" },
      boxShadow: {
        card: "0 1px 2px rgb(16 24 40 / 0.05)",
        pop: "0 8px 24px rgb(16 24 40 / 0.14)",
      },
      keyframes: {
        fade: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        pop: { from: { opacity: "0", transform: "translateX(14px)" }, to: { opacity: "1", transform: "none" } },
        drop: { from: { opacity: "0", transform: "translateY(-6px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        fade: "fade .28s ease-out",
        pop: "pop .25s ease-out",
        drop: "drop .18s ease-out",
      },
    },
  },
  plugins: [],
};