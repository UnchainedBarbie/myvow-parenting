import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#7B9E87",
          light: "#E8F0EB",
          dark: "#5A7D66",
        },
        background: {
          DEFAULT: "#FAF8F5",
          secondary: "#F0EDE8",
        },
        foreground: {
          DEFAULT: "#2D3436",
          secondary: "#636E72",
        },
        alert: "#C97B7B",
        info: "#7BA3C9",
        success: "#4ECB71",
      },
      fontFamily: {
        heading: ["var(--font-playfair)", "serif"],
        body: ["var(--font-dm-sans)", "sans-serif"],
      },
      borderRadius: {
        card: "12px",
        button: "9999px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.04)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
