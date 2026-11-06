/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      boxShadow: {
        soft: '0 18px 40px -18px rgba(15, 23, 42, 0.35)',
      },
      colors: {
        brand: {
          50: '#eef9ff',
          100: '#d8f2ff',
          500: '#1d9bf0',
          600: '#0d7fd6',
          900: '#11263d',
        },
      },
    },
  },
  plugins: [],
}

