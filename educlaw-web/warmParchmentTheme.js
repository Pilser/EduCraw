// ============================================================
//  Warm Parchment Theme — Student AI Chatbot
//  Modern tech edge-border style
//  Usage: import theme from './warmParchmentTheme'
// ============================================================

const warmParchment = {
  name: "warm-parchment",

  // ── Core palette ──────────────────────────────────────────
  colors: {
    // Backgrounds
    bgPage:        "#FFFDF6",   // warm off-white canvas
    bgSurface:     "#FFF8EE",   // cards, panels
    bgSurfaceAlt:  "#FFF3E0",   // slightly deeper surface (sidebars, headers)
    bgInset:       "#FDEBD0",   // inset areas, code blocks

    // Accent — amber/orange
    accent:        "#D97C2A",   // primary CTA, user bubble, highlights
    accentHover:   "#C06A1A",   // hover state
    accentSubtle:  "#FDE8C8",   // AI bubble bg, tag fills
    accentMuted:   "#F0C88A",   // borders on accent elements

    // Text
    textPrimary:   "#3D1F00",   // headings, strong body
    textSecondary: "#7A4A18",   // subtext, labels, placeholders
    textTertiary:  "#B07840",   // hints, timestamps, muted captions
    textOnAccent:  "#FFF8EE",   // text sitting on accent bg

    // Borders — the "tech edge" system
    borderHard:    "#D97C2A",   // glowing accent border (active/focus)
    borderMid:     "#E8B87A",   // default card border
    borderSoft:    "#F0D4A8",   // subtle dividers
    borderGhost:   "#FAF0DC",   // hairline separators

    // Semantic
    success:       "#4A7C59",
    successBg:     "#EAF4EE",
    warning:       "#C47A00",
    warningBg:     "#FEF6DC",
    error:         "#B94040",
    errorBg:       "#FCEAEA",
    info:          "#3A6FA8",
    infoBg:        "#EAF1FB",
  },

  // ── Typography ────────────────────────────────────────────
  typography: {
    fontFamily:     "'Inter', 'Geist', system-ui, sans-serif",
    fontFamilyMono: "'JetBrains Mono', 'Fira Code', monospace",
    fontSizeXs:     "11px",
    fontSizeSm:     "13px",
    fontSizeBase:   "15px",
    fontSizeLg:     "17px",
    fontSizeXl:     "20px",
    fontSize2xl:    "24px",
    fontWeightNormal: 400,
    fontWeightMedium: 500,
    lineHeightBase:   1.65,
    lineHeightTight:  1.3,
    letterSpacingWide: "0.04em",
  },

  // ── Spacing ───────────────────────────────────────────────
  spacing: {
    xs:   "4px",
    sm:   "8px",
    md:   "12px",
    lg:   "16px",
    xl:   "24px",
    "2xl":"32px",
    "3xl":"48px",
  },

  // ── Border radius ─────────────────────────────────────────
  radius: {
    sm:   "6px",
    md:   "10px",
    lg:   "14px",
    xl:   "20px",
    full: "9999px",
  },

  // ── Edge border system (the "tech highlight" look) ────────
  //    Apply these as box-shadow to avoid disrupting layout.
  //    Each variant lights up a different combination of edges.
  edgeBorders: {
    // All 4 edges — full tech border
    all: `
      inset 1px 0 0 0 #E8B87A,
      inset -1px 0 0 0 #E8B87A,
      inset 0 1px 0 0 #E8B87A,
      inset 0 -1px 0 0 #E8B87A
    `,
    // Top + left (corner highlight — common on cards)
    topLeft: `
      inset 1px 0 0 0 #D97C2A,
      inset 0 1px 0 0 #D97C2A
    `,
    // Bottom + right (shadow corner)
    bottomRight: `
      inset -1px 0 0 0 #E8B87A,
      inset 0 -1px 0 0 #E8B87A
    `,
    // Accent glow: top edge only (hero sections)
    topAccent: "inset 0 1px 0 0 #D97C2A",
    // Full accent — active/focused state
    focus: `
      inset 1px 0 0 0 #D97C2A,
      inset -1px 0 0 0 #D97C2A,
      inset 0 1px 0 0 #D97C2A,
      inset 0 -1px 0 0 #D97C2A,
      0 0 0 3px rgba(217, 124, 42, 0.18)
    `,
  },

  // ── Component tokens ──────────────────────────────────────
  components: {

    // -- Page shell --
    page: {
      background: "#FFFDF6",
      color:      "#3D1F00",
    },

    // -- Sidebar --
    sidebar: {
      background:  "#FFF3E0",
      borderRight: "1px solid #E8B87A",
      // Tech line on right edge
      boxShadow:   "inset -1px 0 0 0 #D97C2A",
      color:       "#3D1F00",
    },

    // -- Top navbar --
    navbar: {
      background:   "#FFF8EE",
      borderBottom: "1px solid #E8B87A",
      // Top + bottom accent lines
      boxShadow:    "inset 0 -1px 0 0 #D97C2A, inset 0 1px 0 0 #F0C88A",
      color:        "#3D1F00",
      height:       "56px",
      padding:      "0 24px",
    },

    // -- Card --
    card: {
      background:   "#FFF8EE",
      borderRadius: "14px",
      border:       "1px solid #E8B87A",
      // All-edge highlight
      boxShadow: `
        inset 1px 0 0 0 #F0C88A,
        inset -1px 0 0 0 #F0C88A,
        inset 0 1px 0 0 #D97C2A,
        inset 0 -1px 0 0 #E8B87A
      `,
      padding:    "20px",
    },

    // -- Card: hover state --
    cardHover: {
      border:    "1px solid #D97C2A",
      boxShadow: `
        inset 1px 0 0 0 #D97C2A,
        inset -1px 0 0 0 #D97C2A,
        inset 0 1px 0 0 #D97C2A,
        inset 0 -1px 0 0 #D97C2A
      `,
    },

    // -- Chat: AI bubble --
    aiBubble: {
      background:   "#FDE8C8",
      color:        "#3D1F00",
      borderRadius: "14px 14px 14px 4px",
      border:       "1px solid #E8B87A",
      boxShadow:    "inset 0 1px 0 0 #D97C2A, inset 1px 0 0 0 #F0C88A",
      padding:      "10px 14px",
      fontSize:     "14px",
      lineHeight:   1.6,
    },

    // -- Chat: user bubble --
    userBubble: {
      background:   "#D97C2A",
      color:        "#FFF8EE",
      borderRadius: "14px 14px 4px 14px",
      border:       "1px solid #C06A1A",
      boxShadow:    "inset 0 1px 0 0 rgba(255,255,255,0.18), inset 0 -1px 0 0 rgba(0,0,0,0.12)",
      padding:      "10px 14px",
      fontSize:     "14px",
      lineHeight:   1.6,
    },

    // -- Input field --
    input: {
      background:   "#FFFDF6",
      color:        "#3D1F00",
      border:       "1px solid #E8B87A",
      borderRadius: "10px",
      padding:      "10px 14px",
      fontSize:     "14px",
      outline:      "none",
      // Focus (applied via :focus pseudo-class)
      focusBoxShadow: `
        inset 1px 0 0 0 #D97C2A,
        inset -1px 0 0 0 #D97C2A,
        inset 0 1px 0 0 #D97C2A,
        inset 0 -1px 0 0 #D97C2A,
        0 0 0 3px rgba(217, 124, 42, 0.18)
      `,
    },

    // -- Chat input bar --
    chatInputBar: {
      background:  "#FFF8EE",
      borderTop:   "1px solid #E8B87A",
      boxShadow:   "inset 0 1px 0 0 #D97C2A",
      padding:     "12px 16px",
    },

    // -- Button: primary --
    buttonPrimary: {
      background:   "#D97C2A",
      color:        "#FFF8EE",
      border:       "1px solid #C06A1A",
      borderRadius: "10px",
      padding:      "9px 18px",
      fontSize:     "14px",
      fontWeight:   500,
      cursor:       "pointer",
      boxShadow:    "inset 0 1px 0 0 rgba(255,255,255,0.15), inset 0 -1px 0 0 rgba(0,0,0,0.15)",
      // Hover
      hoverBackground: "#C06A1A",
    },

    // -- Button: ghost --
    buttonGhost: {
      background:   "transparent",
      color:        "#7A4A18",
      border:       "1px solid #E8B87A",
      borderRadius: "10px",
      padding:      "9px 18px",
      fontSize:     "14px",
      fontWeight:   400,
      cursor:       "pointer",
      boxShadow:    "inset 0 1px 0 0 #F0C88A",
      hoverBackground: "#FDE8C8",
    },

    // -- Badge / pill --
    badge: {
      background:   "#FDE8C8",
      color:        "#7A4A18",
      border:       "1px solid #E8B87A",
      borderRadius: "9999px",
      padding:      "2px 10px",
      fontSize:     "12px",
      fontWeight:   500,
    },

    // -- Code block --
    codeBlock: {
      background:   "#FDEBD0",
      color:        "#3D1F00",
      border:       "1px solid #E8B87A",
      borderRadius: "10px",
      boxShadow:    "inset 1px 0 0 0 #D97C2A, inset 0 1px 0 0 #F0C88A",
      padding:      "14px 16px",
      fontFamily:   "'JetBrains Mono', monospace",
      fontSize:     "13px",
    },

    // -- Divider --
    divider: {
      border:     "none",
      borderTop:  "1px solid #F0D4A8",
      boxShadow:  "0 1px 0 0 #FAF0DC",
    },

    // -- Tooltip --
    tooltip: {
      background:   "#3D1F00",
      color:        "#FFF8EE",
      border:       "1px solid #7A4A18",
      borderRadius: "8px",
      padding:      "6px 10px",
      fontSize:     "12px",
    },

    // -- Avatar --
    avatar: {
      background:   "#FDE8C8",
      color:        "#7A4A18",
      border:       "2px solid #D97C2A",
      boxShadow:    "inset 0 1px 0 0 rgba(255,255,255,0.3)",
      borderRadius: "9999px",
    },

    // -- Scrollbar (webkit) --
    scrollbar: {
      track:  "#FFF3E0",
      thumb:  "#E8B87A",
      thumbHover: "#D97C2A",
      width:  "6px",
      borderRadius: "9999px",
    },
  },

  // ── CSS custom properties (paste into :root) ──────────────
  cssVariables: `
    --wp-bg-page:         #FFFDF6;
    --wp-bg-surface:      #FFF8EE;
    --wp-bg-surface-alt:  #FFF3E0;
    --wp-bg-inset:        #FDEBD0;

    --wp-accent:          #D97C2A;
    --wp-accent-hover:    #C06A1A;
    --wp-accent-subtle:   #FDE8C8;
    --wp-accent-muted:    #F0C88A;

    --wp-text-primary:    #3D1F00;
    --wp-text-secondary:  #7A4A18;
    --wp-text-tertiary:   #B07840;
    --wp-text-on-accent:  #FFF8EE;

    --wp-border-hard:     #D97C2A;
    --wp-border-mid:      #E8B87A;
    --wp-border-soft:     #F0D4A8;
    --wp-border-ghost:    #FAF0DC;

    --wp-radius-sm:       6px;
    --wp-radius-md:       10px;
    --wp-radius-lg:       14px;
    --wp-radius-xl:       20px;

    --wp-edge-all:
      inset 1px 0 0 0 #E8B87A,
      inset -1px 0 0 0 #E8B87A,
      inset 0 1px 0 0 #D97C2A,
      inset 0 -1px 0 0 #E8B87A;

    --wp-edge-focus:
      inset 1px 0 0 0 #D97C2A,
      inset -1px 0 0 0 #D97C2A,
      inset 0 1px 0 0 #D97C2A,
      inset 0 -1px 0 0 #D97C2A,
      0 0 0 3px rgba(217, 124, 42, 0.18);

    --wp-edge-top:  inset 0 1px 0 0 #D97C2A;
    --wp-edge-left: inset 1px 0 0 0 #D97C2A;
  `,

  // ── Tailwind config extension (tailwind.config.js colors) ─
  tailwind: {
    extend: {
      colors: {
        wp: {
          bgPage:       "#FFFDF6",
          bgSurface:    "#FFF8EE",
          bgSurfaceAlt: "#FFF3E0",
          bgInset:      "#FDEBD0",
          accent:       "#D97C2A",
          accentHover:  "#C06A1A",
          accentSubtle: "#FDE8C8",
          accentMuted:  "#F0C88A",
          textPrimary:  "#3D1F00",
          textSec:      "#7A4A18",
          textTert:     "#B07840",
          borderHard:   "#D97C2A",
          borderMid:    "#E8B87A",
          borderSoft:   "#F0D4A8",
        },
      },
      boxShadow: {
        "wp-edge":       "inset 1px 0 0 0 #E8B87A, inset -1px 0 0 0 #E8B87A, inset 0 1px 0 0 #D97C2A, inset 0 -1px 0 0 #E8B87A",
        "wp-edge-focus": "inset 1px 0 0 0 #D97C2A, inset -1px 0 0 0 #D97C2A, inset 0 1px 0 0 #D97C2A, inset 0 -1px 0 0 #D97C2A, 0 0 0 3px rgba(217,124,42,0.18)",
        "wp-edge-top":   "inset 0 1px 0 0 #D97C2A",
      },
      fontFamily: {
        sans: ["Inter", "Geist", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
};

export default warmParchment;
