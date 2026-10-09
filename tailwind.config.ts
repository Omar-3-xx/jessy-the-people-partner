import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1B2A4A',
        paper: '#F7F5F2',
        gold: '#C9A227',
      },
      fontFamily: {
        sans: ['var(--font-ar)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
