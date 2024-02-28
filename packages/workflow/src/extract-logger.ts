import { Effect, Runtime } from 'effect'
import { pipe } from 'effect/Function'

/**
 * Extracts a logger from the runtime into an object of functions
 * @param runtime
 * @param rootSpan
 */
export const extractLogger = (
  runtime: Runtime.Runtime<any>,
  rootSpan?: string
) => {
  const runSync = Runtime.runSync(runtime)
  const composeLogEffect = (
    methodName: 'logInfo' | 'logError' | 'logDebug' | 'logWarning',
    msg: string,
    args?: Record<string, any>,
    rootSpan?: string,
    span?: string
  ) => {
    let effects = [Effect[methodName](msg)]
    if (args) {
      // @ts-ignore
      effects.push(Effect.annotateLogs(args))
    }
    if (span) {
      // @ts-ignore
      effects.push(Effect.withLogSpan(span))
    }
    if (rootSpan) {
      // @ts-ignore
      effects.push(Effect.withLogSpan(rootSpan))
    }
    // @ts-ignore
    return pipe(...effects)
  }
  return {
    info: (msg: string, args?: Record<string, any>, span?: string) => {
      const info = composeLogEffect('logInfo', msg, args, rootSpan, span)
      return runSync(info)
    },
    debug: (msg: string, args?: Record<string, any>, span?: string) => {
      const info = composeLogEffect('logDebug', msg, args, rootSpan, span)
      return runSync(info)
    },
    error: (msg: string, args?: Record<string, any>, span?: string) => {
      const info = composeLogEffect('logError', msg, args, rootSpan, span)
      return runSync(info)
    },
    warn: (msg: string, args?: Record<string, any>, span?: string) => {
      const info = composeLogEffect('logWarning', msg, args, rootSpan, span)
      return runSync(info)
    },
  }
}
