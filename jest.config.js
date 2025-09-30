export default {
  preset: null,
  testEnvironment: 'jsdom',
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  collectCoverageFrom: [
    'core/**/*.js',
    'background/**/*.js',
  ],
  testMatch: [
    '<rootDir>/test/**/*.test.js',
  ],
};
