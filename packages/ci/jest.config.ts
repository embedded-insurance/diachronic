const config = {
  verbose: true,
  testEnvironment: 'node',
  preset: 'ts-jest',
  testMatch: ['<rootDir>/test/**/*.ts'],
  testPathIgnorePatterns: ['test/lib', 'test/fixtures'],
  passWithNoTests: true,
}

export default config
