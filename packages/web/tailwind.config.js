/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Segoe UI", "system-ui", "-apple-system", "sans-serif"],
        display: ["Bricolage Grotesque", "Arial Black", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        none: "0px",
        sm: "6px",
        DEFAULT: "6px",
        md: "6px",
        lg: "12px",
        xl: "12px",
        "2xl": "12px",
        "3xl": "12px",
        full: "9999px",
      },
      colors: {
        brand: {
          50: "#E4F9EA",
          100: "#C8F9DA",
          300: "#6DF09F",
          500: "#01BC48",
          600: "#01BC48",
          DEFAULT: "#01BC48",
          800: "#008832",
        },
        danger: {
          50: "#FBEAEA",
          500: "#DC3F3F",
          DEFAULT: "#DC3F3F",
        },
        ink: "#0A0A0A",
        paper: "#FFFFFF",
        "paper-2": "#F7F7F7",
        line: "#E3E3E3",
        muted: "#767676",
      },
      boxShadow: {
        md: "0 4px 8px -2px rgba(20,20,20,.10), 0 1px 2px rgba(20,20,20,.06)",
        xl: "0 16px 24px -4px rgba(20,20,20,.12), 0 4px 8px -4px rgba(20,20,20,.08)",
      },
    },
  },
  plugins: [],
};
