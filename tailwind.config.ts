import type { Config } from 'tailwindcss';

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        steam: {
          100: 'rgb(var(--theme-steam-100) / <alpha-value>)',
          200: 'rgb(var(--theme-steam-200) / <alpha-value>)',
          300: 'rgb(var(--theme-steam-300) / <alpha-value>)',
          400: 'rgb(var(--theme-steam-400) / <alpha-value>)',
          500: 'rgb(var(--theme-steam-500) / <alpha-value>)',
          600: 'rgb(var(--theme-steam-600) / <alpha-value>)',
          700: 'rgb(var(--theme-steam-700) / <alpha-value>)',
          800: 'rgb(var(--theme-steam-800) / <alpha-value>)',
          900: 'rgb(var(--theme-steam-900) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
