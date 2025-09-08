export default {
  preset: null,
  testEnvironment: 'jsdom',
  // extensionsToTreatAsEsm wird nicht mehr benötigt, da Jest dies
  // automatisch aus der package.json ("type": "module") ableitet.
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  transform: {},
  // Korrekter Name ist "moduleNameMapper"
  moduleNameMapper: {
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
