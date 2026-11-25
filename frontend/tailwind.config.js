const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: c("bg"), surface: c("surface"), soft: c("soft"), line: c("line"),
        fg: c("fg"), muted: c("muted"), brand: c("brand"), "brand-fg": c("brand-fg"),
        ok: c("ok"), warn: c("warn"), bad: c("bad"), info: c("info"),
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      boxShadow: { card: "0 1px 2px rgb(0 0 0 / 0.04), 0 6px 20px rgb(0 0 0 / 0.04)" },
    },
  },
  plugins: [],
};