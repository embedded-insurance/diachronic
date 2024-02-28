const config = {
  verbose: true,
  testEnvironment: 'node',
  preset: 'ts-jest',
  testPathIgnorePatterns: ['test/lib'],
  openHandlesTimeout: 2000,
  testMatch: ['<rootDir>/test/**/*.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: true,
      },
    ],
  },
  passWithNoTests: true,
}

export default config
