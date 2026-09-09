/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every color choice should carry meaning — see usage notes in README.
        'legacy-blue-light': '#18385f', // secondary UI: borders, subtle backgrounds, inactive states
        'legacy-blue-dark': '#003058', // primary nav / header elements
        'legacy-red': '#ee3428', // accent only: active states, key CTAs, alerts
      },
    },
  },
  plugins: [],
}
