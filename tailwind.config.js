/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
    "!./app/web/**/*.{js,ts,jsx,tsx}", // exclude inner Next app if you’re not using it
  ],
  theme: { extend: {} },
  plugins: [],
};
