import { run } from '../src'

let serverHandle: any
afterEach(async () => {
  await serverHandle.close()
})

test('health check server', async () => {
  let requestCount = 0
  const server = await run(
    {
      port: 0,
      livenessProbe: { path: '/liveness' },
      readinessProbe: { path: '/readiness' },
      startupProbe: { path: '/startup' },
    },
    {
      isLive: async () => ({ ok: false }),
      isReady: async () => ({ ok: false }),
      isStarted: async () => ({ ok: requestCount > 0 }),
    }
  )
  serverHandle = server.server
  const port = serverHandle.server.address().port
  const a = serverHandle.server.address().address
  const address = `http://${a}:${port}`
  console.log(address)

  expect(await fetch(`${address}/startup`).then((x) => x.status)).toEqual(500)

  requestCount += 1

  expect(await fetch(`${address}/startup`).then((x) => x.status)).toEqual(200)

  await server.stop()
})
