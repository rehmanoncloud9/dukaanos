const path = require("node:path");

module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.js"],
  testMatch: ["<rootDir>/test/**/*.test.(ts|tsx)"],
  moduleDirectories: ["node_modules", path.resolve(__dirname, "node_modules")],
  moduleNameMapper: {
    "^@domain/(.*)$": path.resolve(__dirname, "../src/lib/domain/$1"),
    "^@/lib/domain/(.*)$": path.resolve(__dirname, "../src/lib/domain/$1"),
    "^@contracts$": path.resolve(__dirname, "../src/lib/api/contracts.ts"),
    "^@passport$": path.resolve(__dirname, "../src/lib/crypto/passport.ts"),
    "^@babel/runtime/(.*)$": path.resolve(__dirname, "node_modules/@babel/runtime/$1"),
    "^@/assets/(.*)$": "<rootDir>/assets/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@gorhom/bottom-sheet|@shopify/flash-list|@tanstack/react-query|lucide-react-native|@noble/.*|@supabase/.*))",
  ],
};
