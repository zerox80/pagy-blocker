export default {
  preset: null,
  testEnvironment: 'jsdom',
  extensionsToTreatAsEsm: ['.js'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  transform: {},
  moduleNameMapping: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  collectCoverageFrom: [
    'core/**/*.js',
    '!core/logger.js', // Logger könnte schwierig zu testen sein
  ],
  testMatch: [
    '<rootDir>/test/**/*.test.js',
  ],
};
