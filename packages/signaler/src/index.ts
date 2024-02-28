import * as S from '@effect/schema/Schema'
import { createServer } from './server'
import { SignalerConfig } from './types'

const main = async () => {
  const config = S.decodeUnknownSync(SignalerConfig)(process.env)
  const server = await createServer(config)
  server.listen({ port: config.PORT })
  return server
}

main()
