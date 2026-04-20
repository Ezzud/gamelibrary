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
          900: 'rgb(5, 30, 52)',
          600: 'rgb(27, 77, 124)',
          400: 'rgb(45, 120, 180)',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
