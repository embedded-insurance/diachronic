/**
 * There are many type-level assertions going on in this file
 * If they are confusing, that's ok. There's a lot going on.
 *
 * We should work on automating the manual checking that needs to be performed
 * at the time of writing.
 *
 */
import { makeWorkflow, MigrationFnV1 } from '../../src'
import { machine as prevMachine, signals } from './workflow1info'
import { assign, ContextFrom, createMachine } from 'xstate'
import * as Effect from 'effect/Effect'

const prevContext: ContextFrom<typeof prevMachine> = { hey: { hey: 'hey' } }

// Not assignable to the previous context type (breaking change)
type NewContextTypeThatBreaksPrevious = { yo?: string }

// Assignable to the previous context type (compatible change)
type NewContextTypeCompatible = ContextFrom<typeof prevMachine> & {
  yo?: string
}

// Test: should get a type error when breaking Context type
// We can ignore this if we want to have a new context type + migration function
// This at least lets us know that the prev context type is incompatible
const machineWithBreakingContextTypeErrorExample = createMachine(
  {
    id: 'test',
    initial: 'initial',
    types: {} as { context: NewContextTypeThatBreaksPrevious },
    context: {},
    states: {
      initial: {
        on: {
          hey: {
            target: 'heyed',
          },
        },
      },
      heyed: {
        // A previous machine action expected to violate the new context type
        // @ts-expect-error
        entry: [assign({ hey: () => ({ hey: 'hey' } as const) })],
        after: {
          time: 'done',
        },
      },
      done: { type: 'final' },
    },
  },

  // Note. Referencing the previous implementations is a type error,
  // copying the code it refers to is not.
  // This may be a bug in XState

  // @ts-expect-error
  prevMachine.implementations

  // {
  //   delays: {
  //     time: ({ context }) => {
  //       console.log('getting delay 1')
  //       return 100_000
  //     },
  //   },
  // }
)

// This is no different from the above...trying to show we intentionally ignore it
export const nextMachineBreakingContextIntentional = createMachine(
  // @ts-expect-error Acknowledged / dealt with via migration
  {
    ...prevMachine.config,
    types: {} as { context: NewContextTypeThatBreaksPrevious },
  },
  prevMachine.implementations
)

export const nextMachineCompatibleContext = createMachine(
  {
    ...prevMachine.config,
    types: {} as { context: NewContextTypeCompatible },
  },

  // Produces a 2200+ character typescript error
  // I think we can ignore it.
  //
  // Fixed if TAction defaults to ParameterizedObject | undefined
  // @ts-expect-error https://github.com/statelyai/xstate/blob/4ede0f9fe00e571d168d4d0bb4fc3403b7a979f9/packages/core/src/types.ts#L1047
  prevMachine.implementations
)

// Test: a type error when returning the wrong context type for the machine we're entering
// TODO. retrofit with stateids
// @ts-expect-error
makeWorkflow<typeof prevMachine, typeof nextMachineCompatibleContext>(
  'theWorkflow',
  nextMachineCompatibleContext,
  signals,
  ({ state, context, timers }) => {
    return Effect.succeed({
      state,
      context: { yo: 42 }, // expected a string
      timers,
    })
  }
)

const mfn: MigrationFnV1<
  // TODO. retrofit with stateids
  // @ts-expect-error
  typeof prevMachine,
  typeof nextMachineCompatibleContext
> = ({ state, context, timers }) =>
  Effect.succeed({
    state,
    // TODO. retrofit with stateids
    // @ts-expect-error
    context: { yo: context.hey?.hey || 'hello' },
    timers: timers,
  })

// Test: type of previous workflow context is inferred
// TODO. retrofit with stateids
// @ts-expect-error
makeWorkflow<typeof prevMachine, typeof nextMachineCompatibleContext>(
  'theWorkflow',
  nextMachineCompatibleContext,
  signals,
  ({ state, context, timers }) => {
    return Effect.succeed({
      state,
      context: {
        // TODO. retrofit with stateids
        // @ts-expect-error
        hey: { hey: context.hey?.hey || 'hey' },
        // @ts-expect-error
        yo: context.hey?.hey || 'a string',
      },
      timers,
    })
  }
)

// Test: type of previous workflow context is inferred
makeWorkflow<
  // TODO. retrofit with stateids
  // @ts-expect-error
  typeof prevMachine,
  typeof nextMachineBreakingContextIntentional
>(
  'theWorkflow',
  nextMachineBreakingContextIntentional,
  signals,
  ({ state, context, timers }) =>
    Effect.succeed({
      state,
      // TODO. retrofit with stateids
      // @ts-expect-error
      context: { yo: context.hey?.hey || 'a string' },
      timers,
    })
)
