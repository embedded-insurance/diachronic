import * as Effect from 'effect/Effect'
import * as S from '@effect/schema/Schema'
import { ActivityDef } from '@diachronic/activity/activity'
import { Trigger } from '@diachronic/util/trigger'

type ActivitiesSchemas = Record<string, ActivityDef>
type WorkflowActivitiesSchemas = Record<string, Record<string, ActivityDef>>
/**
 * Derives a promise interface for the provided schema
 */
export type PromiseInterface<API extends Record<string, ActivityDef>> = {
  [K in keyof API & string]: (
    input: S.Schema.Type<API[K]['input']>
  ) => Promise<S.Schema.Type<API[K]['output']>>
}

export type ActivityFn<A extends any[] = any[], B = unknown> = (
  ...args: A
) => Promise<B>

export type Activities = Record<string, ActivityFn>

export type FakeActivity<A extends Array<any>, B> = {
  activityName?: string
  resolveLatest: (args: Awaited<B>) => never
  rejectLatest: (args: unknown) => never
  getLatestCall: () => A
  getReceivedCalls: () => A
  reset: () => void
  getUnresolved: () => Array<{
    resolve: (...args: unknown[]) => void
    reject: (...args: unknown[]) => void
  }>
  name?: string
  resolveRejectQueue: Array<{
    resolve: (...args: unknown[]) => void
    reject: (...args: unknown[]) => void
  }>
} & ((...x: A) => Promise<B>)

type Logger = {
  debug: (...args: any[]) => void
  info: (...args: any[]) => void
  warn: (...args: any[]) => void
  error: (...args: any[]) => void
}

const noOpLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

export const fakeActivity = <A extends Array<any>, B>(
  name: string,
  activitySchema?: any, // todo. this doesn't really belong here.. decode outside of this
  logger: Logger = noOpLogger
): FakeActivity<A, B> => {
  logger.debug('enter', name)
  let calls: A[]
  let responses: B[]
  let resolveRejectQueue: Array<{
    resolve: (...args: unknown[]) => void
    reject: (...args: unknown[]) => void
  }>
  let blockers: Array<Trigger<void>>
  // index of the last resolved/rejected item in resolveRejectQueue
  let index: number

  const initialize = () => {
    calls = []
    responses = []
    resolveRejectQueue = []
    blockers = []
    index = -1
  }

  initialize()

  // a function that may be invoked multiple times
  const p = (...args: A) => {
    if (activitySchema) {
      const result = S.decodeEither(activitySchema.input)(args[0], {
        errors: 'all',
        onExcessProperty: 'preserve',
      })

      if (result._tag === 'Left') return Promise.reject(result.left)
    }
    let resolve: (...xs: any[]) => void
    let reject: (...xs: any[]) => void
    const next = new Promise((_resolve, _reject) => {
      logger.debug(`fakeActivity invoked: ${name}`)
      calls.push(args)
      resolve = _resolve
      reject = _reject
    })
    resolveRejectQueue.push({
      resolve: (...args: unknown[]) => {
        logger.debug('resolver called with', args)
        return resolve(...args)
      },
      reject: (...args: unknown[]) => {
        logger.debug('rejecter called with', args)
        return reject(...args)
      },
    })
    // blocker is active until the function is called once
    if (blockers.length) {
      logger.debug('releasing blocker')
      blockers[0].resolve(undefined)
      blockers = blockers.slice(1)
    }
    return next
  }

  if (name) {
    p.activityName = name
  }

  p.resolveLatest = async (args: B) => {
    if (calls.length === 0) {
      logger.debug('no calls, awaiting blocker', args)
      const i = blockers.push(new Trigger<void>())
      await blockers[i - 1]
    }
    if (!resolveRejectQueue[index + 1]) {
      logger.debug('no resolvers, awaiting blocker', args)
      const i = blockers.push(new Trigger<void>())
      await blockers[i - 1]
    }
    responses.push(args)
    try {
      logger.debug('calling queued resolver', index + 1)
      resolveRejectQueue[++index].resolve(args)
    } catch (e) {
      console.error(e)
      throw new Error('Attempting to respond when never called')
    }
  }
  p.rejectLatest = async (args: B) => {
    if (calls.length === 0) {
      logger.debug('no calls, awaiting blocker', args)
      const i = blockers.push(new Trigger<void>())
      await blockers[i - 1]
    }
    if (!resolveRejectQueue[index + 1]) {
      logger.debug('no resolvers, awaiting blocker', args)
      const i = blockers.push(new Trigger<void>())
      await blockers[i - 1]
    }
    responses.push(args)
    try {
      logger.debug('calling queued rejecter', index + 1)
      return resolveRejectQueue[++index].reject(args)
    } catch (e) {
      console.error(e)
      throw new Error('Attempting to reject when never called')
    }
  }

  p.resolveRejectQueue = resolveRejectQueue!
  p.getLatestCall = () => calls[calls.length - 1]
  p.getReceivedCalls = () => calls
  p.getUnresolved = () => {
    logger.debug('[getUnresolved] ', {
      activityName: p.activityName,
      calls: calls,
      index,
      resolveRejectQueue,
    })
    return resolveRejectQueue.slice(index + 1)
  }
  p.reset = initialize
  return p as unknown as FakeActivity<A, B>
}

export type FakeActivities<A extends Record<string, ActivityFn>> = {
  [K in keyof A]: FakeActivity<Parameters<A[K]>, Awaited<ReturnType<A[K]>>>
}
export const createFakeActivities = <A extends Activities>(
  activities: {
    [K in keyof A]: undefined | unknown
  },
  options?: { logger?: Logger }
): FakeActivities<A> =>
  Object.fromEntries(
    Object.entries(activities).map(([activityName, activitySchema]) => [
      activityName,
      fakeActivity(activityName, activitySchema, options?.logger),
    ])
  ) as FakeActivities<A>

export const getInFlightActivities = <A extends FakeActivities<any>>(
  activities: A
): Array<{
  activityName: keyof A
  unresolved: FakeActivity<any, any>['resolveRejectQueue'][number]
}> =>
  Object.entries(activities).reduce(
    (a, [k, v]) => {
      const unresolved = v.getUnresolved()
      if (unresolved.length) {
        return [
          ...a,
          ...unresolved.map((x) => ({
            activityName: k as keyof A,
            unresolved: x,
          })),
        ]
      }
      return a
    },
    [] as Array<{
      activityName: keyof A
      unresolved: FakeActivity<any, any>['resolveRejectQueue'][number]
    }>
  )

/**
 * Returns true if `x` is a fake activity responder function
 * @param x
 */
export const isResponder = (x: unknown) =>
  typeof x === 'function' && 'resolveLatest' in x

/**
 * Converts a group workflow activities responders from a Promise interface to an Effect interface
 * @param responders
 */
export const responderEffects = (responders: Record<string, any>): any =>
  Object.entries(responders).reduce(
    (a, [k, v]) =>
      !isResponder(v)
        ? {
            ...a,
            [k]: responderEffects(v),
          }
        : {
            ...a,
            [k]: (...args: any[]) => Effect.tryPromise(() => v(...args)),
          },
    {}
  )

/**
 * Creates a group of fake workflow activities responders
 *
 * @example
 * ```typescript
 * const WorkflowActivitiesSchemas = {
 *   carrierPayout: CarrierPayoutActivitiesSchema,
 *   accounting: AccountingActivitiesSchema,
 *   common: CommonActivitiesSchema,
 * }
 * ```
 * @param schemas
 * @returns
 * responders - Functions used from tests to respond to activities when invoked
 * activities - Activities to use in the workflow under test
 * getInFlightActivities - Function that returns activities that have been invoked but not resolved
 */
export const createFakeWorkflowActivities = <
  Schemas extends WorkflowActivitiesSchemas
>(
  schemas: Schemas
) => {
  const responders = Object.entries(schemas).reduce(
    (a, [k, v]) => ({ ...a, [k]: createFakeActivities(v) }),
    {} as { [K in keyof Schemas]: FakeActivities<PromiseInterface<Schemas[K]>> }
  )
  const getInFlight = () =>
    Object.values(responders).reduce((a, b) => {
      const inFlight = getInFlightActivities(b)
      return [...a, ...inFlight]
    }, [])
  const activities = responderEffects(responders)

  return { activities, responders, getInFlightActivities: getInFlight }
}
