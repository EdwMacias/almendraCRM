export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts}"],
  theme: {
    extend: {
      colors: {
        ink: "#08121f",
        accent: "#f97316",
        mint: "#10b981",
        sand: "#f3e8d0"
      },
      boxShadow: {
        panel: "0 24px 80px rgba(8, 18, 31, 0.28)"
      }
    }
  },
  plugins: []
};
