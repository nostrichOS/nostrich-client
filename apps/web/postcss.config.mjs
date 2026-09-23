// Tailwind v4 is a PostCSS plugin and nothing else: no tailwind.config.js.
// lives in app/globals.css via @theme) and no autoprefixer, which v4 folds in itself.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
