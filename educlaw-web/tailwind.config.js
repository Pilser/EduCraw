import warmParchment from './warmParchmentTheme.ts'

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        wp: warmParchment.colors,
      },
      backgroundColor: {
        'wp-page': warmParchment.colors.bgPage,
        'wp-surface': warmParchment.colors.bgSurface,
        'wp-surface-alt': warmParchment.colors.bgSurfaceAlt,
        'wp-inset': warmParchment.colors.bgInset,
        'wp-accent': warmParchment.colors.accent,
        'wp-accent-hover': warmParchment.colors.accentHover,
        'wp-accent-subtle': warmParchment.colors.accentSubtle,
        'wp-error-bg': warmParchment.colors.errorBg,
        'wp-success-bg': warmParchment.colors.successBg,
        'wp-warning-bg': warmParchment.colors.warningBg,
        'wp-info-bg': warmParchment.colors.infoBg,
      },
      borderColor: {
        'wp-hard': warmParchment.colors.borderHard,
        'wp-mid': warmParchment.colors.borderMid,
        'wp-soft': warmParchment.colors.borderSoft,
        'wp-ghost': warmParchment.colors.borderGhost,
      },
      textColor: {
        'wp-primary': warmParchment.colors.textPrimary,
        'wp-secondary': warmParchment.colors.textSecondary,
        'wp-tertiary': warmParchment.colors.textTertiary,
        'wp-on-accent': warmParchment.colors.textOnAccent,
        'wp-error': warmParchment.colors.error,
        'wp-success': warmParchment.colors.success,
        'wp-warning': warmParchment.colors.warning,
        'wp-info': warmParchment.colors.info,
      },
      boxShadow: {
        'wp-edge': warmParchment.edgeBorders.all,
        'wp-edge-focus': warmParchment.edgeBorders.focus,
        'wp-edge-top': warmParchment.edgeBorders.topAccent,
        'wp-card': warmParchment.edgeBorders.all,
      },
      fontFamily: {
        sans: warmParchment.typography.fontFamily.split("'").filter((_, i) => i % 2 === 1),
        mono: warmParchment.typography.fontFamilyMono.split("'").filter((_, i) => i % 2 === 1),
      },
      borderRadius: {
        'wp-sm': warmParchment.radius.sm,
        'wp-md': warmParchment.radius.md,
        'wp-lg': warmParchment.radius.lg,
        'wp-xl': warmParchment.radius.xl,
      },
      spacing: {
        'wp-xs': warmParchment.spacing.xs,
        'wp-sm': warmParchment.spacing.sm,
        'wp-md': warmParchment.spacing.md,
        'wp-lg': warmParchment.spacing.lg,
        'wp-xl': warmParchment.spacing.xl,
        'wp-2xl': warmParchment.spacing['2xl'],
        'wp-3xl': warmParchment.spacing['3xl'],
      },
    },
  },
  plugins: [],
}
