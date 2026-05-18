import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // LinkUp Golf brand — primary navy blue
        green: {
          950: '#001040',
          900: '#002669',  // brand blue (primary)
          800: '#003385',
          700: '#004099',
          600: '#1A55AD',
          500: '#3370C0',
          400: '#5588CC',
          300: '#88AADE',
          200: '#BBCCEE',
          100: '#DDE5F5',
          50:  '#EEF2FA',
        },
        // LinkUp Golf brand — accent grass green
        gold: {
          DEFAULT: '#85bb65',  // brand green (accent)
          light:   '#A0CC85',
          dark:    '#639948',
        },
        // Charcoal for text
        charcoal: {
          DEFAULT: '#333132',
          light:   '#555355',
        },
        cream: {
          DEFAULT: '#F8F8FC',
          dark:    '#EEEEf5',
        },
      },
      fontFamily: {
        sans:    ['var(--font-lexend)', 'system-ui', 'sans-serif'],
        serif:   ['var(--font-caveat)', 'Georgia', 'serif'],
        display: ['var(--font-caveat)', 'Georgia', 'serif'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
}

export default config
