// jest.config.js
export default {
  testEnvironment: 'node',
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/tests/**/*.test.js', '**/__tests__/**/*.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'api/**/*.js',
    'services/**/*.js',
    'core/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 30000,
  verbose: true,
  forceExit: true,
  clearMocks: true,

  // Performance testing specific config
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
    },
    {
      displayName: 'performance',
      testMatch: ['<rootDir>/tests/performance/**/*.test.js'],
      testEnvironmentOptions: {
        // Run performance tests serially
        maxWorkers: 1,
      },
    },
    {
      displayName: 'integration',
      testMatch: [
        '<rootDir>/tests/middleware/**/*.test.js',
        '<rootDir>/tests/services/**/*.test.js',
        '<rootDir>/tests/controllers/**/*.test.js',
      ],
    },
  ],
};
