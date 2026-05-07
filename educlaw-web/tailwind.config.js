const colors = {
  // Backgrounds
  'wp-page':         "#FFFDF6",
  'wp-surface':      "#FFF8EE",
  'wp-surface-alt':  "#FFF3E0",
  'wp-inset':        "#FDEBD0",

  // Accent
  'wp-accent':        "#D97C2A",
  'wp-accent-hover':   "#C06A1A",
  'wp-accent-subtle':  "#FDE8C8",
  'wp-accent-muted':   "#F0C88A",

  // Text
  'wp-text-primary':   "#3D1F00",
  'wp-text-secondary': "#7A4A18",
  'wp-text-tertiary':  "#B07840",
  'wp-text-on-accent': "#FFF8EE",

  // Borders
  'wp-border-hard':    "#D97C2A",
  'wp-border-mid':     "#E8B87A",
  'wp-border-soft':    "#F0D4A8",
  'wp-border-ghost':   "#FAF0DC",

  // Semantic
  'wp-success':    "#4A7C59",
  'wp-success-bg': "#EAF4EE",
  'wp-warning':    "#C47A00",
  'wp-warning-bg': "#FEF6DC",
  'wp-error':      "#B94040",
  'wp-error-bg':    "#FCEAEA",
  'wp-info':       "#3A6FA8",
  'wp-info-bg':     "#EAF1FB",
}

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        wp: colors,
        ...colors,
      },
      backgroundColor: { ...colors },
      borderColor: { ...colors },
      textColor: { ...colors },
      boxShadow: {
        'wp-edge':       "inset 1px 0 0 0 #E8B87A, inset -1px 0 0 0 #E8B87A, inset 0 1px 0 0 #D97C2A, inset 0 -1px 0 0 #E8B87A",
        'wp-edge-focus': "inset 1px 0 0 0 #D97C2A, inset -1px 0 0 0 #D97C2A, inset 0 1px 0 0 #D97C2A, inset 0 -1px 0 0 #D97C2A, 0 0 0 3px rgba(217,124,42,0.18)",
        'wp-edge-top':   "inset 0 1px 0 0 #D97C2A",
        'wp-card':       "inset 1px 0 0 0 #E8B87A, inset -1px 0 0 0 #E8B87A, inset 0 1px 0 0 #D97C2A, inset 0 -1px 0 0 #E8B87A",
      },
      fontFamily: {
        sans: ["Inter", "Geist", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      borderRadius: {
        'wp-sm': "6px",
        'wp-md': "10px",
        'wp-lg': "14px",
        'wp-xl': "20px",
      },
      spacing: {
        'wp-xs': "4px",
        'wp-sm': "8px",
        'wp-md': "12px",
        'wp-lg': "16px",
        'wp-xl': "24px",
        'wp-2xl': "32px",
        'wp-3xl': "48px",
      },
    },
  },
  plugins: [],
}
