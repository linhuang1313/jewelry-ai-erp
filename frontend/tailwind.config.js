/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        jewelry: {
          gold: '#C9A86C',
          'gold-light': '#D4AF37',
          'gold-dark': '#B8860B',
          'gold-50': '#FFFBF5',
          'gold-100': '#FEF3E2',
          navy: '#1E3A5F',
          'navy-light': '#2D4A6F',
          'navy-dark': '#152C47',
        }
      },
      backgroundImage: {
        'jewelry-gradient': 'linear-gradient(135deg, #C9A86C 0%, #D4AF37 100%)',
        'navy-gradient': 'linear-gradient(135deg, #1E3A5F 0%, #152C47 100%)',
      },
    },
  },
  plugins: [],
}


