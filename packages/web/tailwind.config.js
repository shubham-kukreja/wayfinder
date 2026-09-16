/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Segoe UI", "system-ui", "-apple-system", "sans-serif"],
        display: ["Inter Tight", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      // A single 4px corner across every surface — controls, cards, panels and
      // modals alike — so nothing reads as softer or sharper than its
      // neighbours. Only `full` (pills, dots, progress tracks) opts out.
      borderRadius: {
        none: "0px",
        sm: "4px",
        DEFAULT: "4px",
        md: "4px",
        lg: "4px",
        xl: "4px",
        "2xl": "4px",
        "3xl": "4px",
        full: "9999px",
      },
      colors: {
        // Extended brand green ramp. Note: the design system's ramp labels
        // #29DA6C as 500 and #01BC48 as 600, but the app treats #01BC48 as its
        // single primary accent, so the base keeps the `brand-500` name and
        // #29DA6C lands at 400.
        // Green ramp. The base is measured from the live UI, which runs a
        // lighter, friendlier green than the #01BC48 the design doc records;
        // #01BC48 survives as the 700 step for hover/pressed and link ink.
        brand: {
          50: "#E9FAEE",
          100: "#C8F9DA",
          // Muted stop for chart fills, paired with danger-200.
          200: "#8BD4A0",
          300: "#6DF09F",
          400: "#4ADE68",
          500: "#3ECF5F",
          600: "#22B84A",
          700: "#01BC48",
          DEFAULT: "#3ECF5F",
          800: "#008832",
        },
        danger: {
          50: "#FBEAEA",
          // Muted pair for chart fills, where the full-strength signal colours
          // read as too loud across a wide area.
          200: "#E89A96",
          500: "#DC3F3F",
          DEFAULT: "#DC3F3F",
        },
        // Warning / attention / stale. The system has no amber, so this is
        // built from the documented orange family: cream-orange tint, peach
        // border, and a darkened orange for text that clears contrast on the
        // tint. Distinct from `danger`, which stays reserved for errors.
        warn: {
          50: "#FFE8DE",
          200: "#FF8C5A",
          600: "#C2410C",
          800: "#9A3412",
          DEFAULT: "#FF6624",
        },
        ink: "#0A0A0A",
        "ink-2": "#3A3A3A",
        paper: "#FFFFFF",
        "paper-2": "#F7F7F7",
        "paper-3": "#ECEEEE",
        line: "#E3E3E3",
        "line-strong": "#000000",
        muted: "#767676",
        // Accent family — gradients and illustration only, never flat UI fills.
        periwinkle: "#5667FF",
        indigo: "#394AE7",
        lilac: "#E4E7FF",
        orange: "#FF6624",
        peach: "#FF8C5A",
        "cream-orange": "#FFE8DE",
        violet: "#9B51E0",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(20,20,20,.06)",
        md: "0 4px 8px -2px rgba(20,20,20,.10), 0 1px 2px rgba(20,20,20,.06)",
        xl: "0 16px 24px -4px rgba(20,20,20,.12), 0 4px 8px -4px rgba(20,20,20,.08)",
      },
      letterSpacing: {
        display: "-0.02em",
        eyebrow: "0.08em",
      },
      lineHeight: {
        display: "0.95",
        hero: "0.88",
      },
      transitionTimingFunction: {
        cta: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      maxWidth: {
        measure: "65ch",
      },
    },
  },
  plugins: [],
};
