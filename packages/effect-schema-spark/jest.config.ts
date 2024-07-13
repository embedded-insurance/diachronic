const config = {
  verbose: true,
  testEnvironment: 'node',
  preset: 'ts-jest',
  testMatch: ['<rootDir>/test/**/*.ts'],
  testPathIgnorePatterns: ['test/lib', 'test/manual'],
  passWithNoTests: true,
}

export default config
