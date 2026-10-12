module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/**/*.test.ts?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context|@kenshiki/identity-capture)/)',
  ],
};
