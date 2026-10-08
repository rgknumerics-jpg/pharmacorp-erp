/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Charte PHARMACORP (identique aux autres applications de l'ecosysteme)
      colors: {
        brand: { DEFAULT: '#047234', dark: '#035a29', soft: '#E3F1E8', orange: '#FD7502' },
        ink: { DEFAULT: '#0F2A1A', muted: '#58705F', line: '#DAE7DE', bg: '#F4F8F5' },
      },
    },
  },
  plugins: [],
};