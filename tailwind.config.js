/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./popup.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        brand: {
          'dark-red': 'var(--color-brand-dark-red)',
          'red': 'var(--color-brand-red)',
          'cream': 'var(--color-brand-cream)',
          'sage': 'var(--color-brand-sage)',
          'forest': 'var(--color-brand-forest)',
        }
      },
    },
  },
  plugins: [],
}