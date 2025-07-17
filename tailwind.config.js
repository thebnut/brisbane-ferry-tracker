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
        'ferry-light-blue': '#E6F2FF'
      },
      fontFamily: {
        'sans': ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}

