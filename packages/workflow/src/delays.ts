import { Effect, Runtime } from 'effect'

export type CreateEffectDelays = <
  API extends {
    [k: string]: <
      Args extends {
        context: any
        event: any
      }
    >(
      args: Args
    ) => Effect.Effect<any, any, any>
  }
>(
  api: API,
  runtime: Runtime.Runtime<
    Effect.Effect.Context<{ [K in keyof API]: ReturnType<API[K]> }[keyof API]>
  >
) => {
  [K in keyof API]: <Args extends { context: any; event: any }>(
    args: Args
  ) => number
}

export const createEffectDelays: CreateEffectDelays = (api, runtime) => {
  const result = {} as {
    [K in keyof typeof api]: <Args extends { context: any; event: any }>(
      args: Args
    ) => number
  }
  const runSync = Runtime.runSync(runtime)
  for (const key in api) {
    result[key] = (args) => runSync(api[key](args))
  }
  return result
}
