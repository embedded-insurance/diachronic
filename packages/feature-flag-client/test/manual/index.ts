import * as R from 'ramda'
import { Effect, pipe } from 'effect'
import { makeFeatureFlagClient } from '../../src'

const users = R.range(0, 1)

let client: any
afterAll(async () => {
  await client.sdk.destroyWithFlush()
})
test.skip('get workflow flags', async () => {
  client = await makeFeatureFlagClient({
    serverURL: 'http://localhost:4242',
    // MUST BE AN "ENVIRONMENT-SPECIFIC" TOKEN OR NOTHING AT ALL WORKS
    apiKey: ``,
    // THIS MEANS ABSOLUTELY NOTHING, SEE COMMIT WHERE "environment is not environment" here: https://github.com/Unleash/unleash-client-node/pull/431
    // environment: 'development',
  })
  const result = await pipe(
    Effect.all(
      users.map((userId) =>
        client.getWorkflowTaskQueue({
          workflowName: 'example',
          context: {},
          defaultValue: 'default',
        })
      ) as any,
      { mode: 'either' }
    ),
    // @ts-ignore
    Effect.runPromise
  )
  expect(result).toEqual(true)
})
