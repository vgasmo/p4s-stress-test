import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      keyframes: {
        'sheet-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'sheet-out': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(100%)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'sheet-in': 'sheet-in 180ms cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-out': 'sheet-out 140ms ease-in',
        'fade-in': 'fade-in 140ms ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
