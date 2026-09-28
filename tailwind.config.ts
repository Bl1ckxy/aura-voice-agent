import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        accent: '#0D9488',
        'accent-hover': '#0F766E',
        border: '#E5E7EB',
        'panel-bg': '#F9FAFB',
      },
    },
  },
  plugins: [],
};

export default config;