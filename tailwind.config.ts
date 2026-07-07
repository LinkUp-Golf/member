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
        // Status accent — badges/errors only, not part of the core brand palette
        danger: '#E5484D',
      },
      fontFamily: {
        sans:    ['var(--font-lexend)', 'system-ui', 'sans-serif'],
        serif:   ['var(--font-caveat)', 'Georgia', 'serif'],
        display: ['var(--font-caveat)', 'Georgia', 'serif'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        // Member-app elevation scale — resting card / raised (hover, active row) / floating (sheet, CTA)
        card:   '0 1px 3px rgba(0,38,105,0.06), 0 1px 2px rgba(0,0,0,0.03)',
        raised: '0 8px 24px rgba(0,38,105,0.10), 0 2px 6px rgba(0,38,105,0.05)',
        float:  '0 20px 48px rgba(0,16,64,0.22), 0 6px 16px rgba(0,16,64,0.12)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        smooth: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.8s ease-in-out infinite',
        'fade-up': 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) forwards',
      },
    },
  },
  plugins: [],
}

export default config
