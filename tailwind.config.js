/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'charcoal': '#2D3436',
        'cream': '#FDF5E6',
        'golden': '#F5B800',
        'ferry-blue': '#0066CC',
        'ferry-light-blue': '#E6F2FF',
        'ferry-orange': '#FF6B35',
        'ferry-orange-light': '#FFE5D9',
        'ferry-orange-dark': '#E55A2B',
        'ferry-sunset': '#FF8C42'
      },
      fontFamily: {
        'sans': ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'float': 'float 3s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite',
        'squish': 'squish 0.2s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'gradient': 'gradient 8s ease infinite',
        'bounce-soft': 'bounceSoft 2s ease-in-out infinite'
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' }
        },
        glow: {
          '0%, 100%': { boxShadow: '0 0 15px rgba(255, 107, 53, 0.5)' },
          '50%': { boxShadow: '0 0 30px rgba(255, 107, 53, 0.8)' }
        },
        squish: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(0.95)' }
        },
        slideIn: {
          '0%': { transform: 'translateX(-10px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' }
        },
        gradient: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' }
        },
        bounceSoft: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' }
        }
      }
    },
  },
  plugins: [],
}

