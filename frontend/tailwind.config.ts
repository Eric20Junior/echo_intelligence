import type { Config } from "tailwindcss";

/**
 * Echo Intelligence — Tailwind theme.
 * All colors reference CSS custom properties defined in app/globals.css,
 * so dark/light theming works without config changes.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // surfaces & text
        "bg-0": "var(--bg-0)",
        "bg-1": "var(--bg-1)",
        "bg-2": "var(--bg-2)",
        "bg-3": "var(--bg-3)",
        "border-1": "var(--border-1)",
        "border-2": "var(--border-2)",
        "text-1": "var(--text-1)",
        "text-2": "var(--text-2)",
        "text-3": "var(--text-3)",
        inverse: "var(--text-inverse)",
        // brand
        gold: {
          DEFAULT: "var(--gold)",
          bright: "var(--gold-bright)",
          dim: "var(--gold-dim)",
          wash: "var(--gold-wash)",
        },
        // semantic
        pending: { DEFAULT: "var(--pending)", wash: "var(--pending-wash)" },
        live: { DEFAULT: "var(--live)", wash: "var(--live-wash)" },
        danger: { DEFAULT: "var(--danger)", wash: "var(--danger-wash)" },
        info: { DEFAULT: "var(--info)", wash: "var(--info-wash)" },
        scripture: "var(--text-scripture)",
        reference: "var(--text-reference)",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["var(--font-mono)", "Consolas", "monospace"],
      },
      fontSize: {
        // operator scale (compact)
        xs: ["11px", { lineHeight: "1.5" }],
        sm: ["12px", { lineHeight: "1.5" }],
        base: ["13px", { lineHeight: "1.5" }],
        md: ["15px", { lineHeight: "1.4" }],
        lg: ["18px", { lineHeight: "1.35" }],
        xl: ["22px", { lineHeight: "1.25" }],
        // projector scale (distance-readable, viewport-clamped)
        "display-ref": ["clamp(44px, 5.6vw, 108px)", { lineHeight: "1.1" }],
        "display-verse": ["clamp(30px, 3.4vw, 66px)", { lineHeight: "1.4" }],
        "display-label": ["clamp(16px, 1.3vw, 25px)", { lineHeight: "1.3" }],
      },
      letterSpacing: {
        caps: "0.14em",
        display: "0.01em",
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        pill: "999px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        raised: "var(--shadow-raised)",
      },
      spacing: {
        control: "32px",
        "control-lg": "40px",
        projector: "8vw",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        pulse2: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.55", transform: "scale(0.82)" },
        },
        "verse-in": {
          from: { opacity: "0", transform: "translateY(18px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "card-in": {
          from: { opacity: "0", transform: "translateY(-6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "card-out": {
          from: { opacity: "1", transform: "translateY(0)" },
          to: { opacity: "0", transform: "translateY(6px)" },
        },
      },
      animation: {
        "pulse-dot": "pulse2 2.4s ease-in-out infinite",
        "verse-in": "verse-in 700ms cubic-bezier(0.22,1,0.36,1)",
        "card-in": "card-in 240ms cubic-bezier(0.22,1,0.36,1)",
        "card-out": "card-out 240ms cubic-bezier(0.22,1,0.36,1) forwards",
      },
    },
  },
  plugins: [],
};

export default config;
