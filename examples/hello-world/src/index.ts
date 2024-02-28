// import { createMachine, fromPromise } from 'xstate'
// import { Clock, Context, Duration, Effect, Layer, pipe, Runtime } from 'effect'
// import * as S from '@effect/schema/Schema'
// import { createEffectDelays } from '@diachronic/workflow/actors'
// import { assignEffect, createEffectActions } from '@diachronic/workflow/actions'
// import { PromiseActorLogic } from 'xstate/actors'
//
// const WorkflowContext = S.partial(
//   S.struct({
//     name: S.string,
//   })
// )
// type WorkflowContext = S.Schema.To<typeof WorkflowContext>
//
// type WorkflowActivities = {
//   greet: (args: { name: string }) => Effect.Effect<never, unknown, unknown>
// }
// const WorkflowActivities = Context.Tag<WorkflowActivities>()
// export type WorkflowRuntime = Runtime.Runtime<WorkflowActivities | Clock.Clock>
//
// export const makeWorkflowRuntime = (args: {
//   clock: Clock.Clock
//   activities: WorkflowActivities
// }): WorkflowRuntime =>
//   pipe(
//     Layer.mergeAll(
//       Layer.succeed(WorkflowActivities, args.activities),
//       Layer.succeed(Clock.Clock, args.clock)
//     ),
//     Layer.toRuntime,
//     Effect.scoped,
//     Effect.runSync
//   )
//
// const activities = WorkflowActivities.of({})
//
// const actorActivities = {
//   greet: fromPromise(({ input }: { input: { name: string } }) =>
//     Effect.runPromise(activities.greet({ name: input.name }))
//   ),
// }
// const runtime = makeWorkflowRuntime({ activities, clock: Clock.make() })
//
// const actions = createEffectActions(
//   {
//     'set-name': assignEffect(() => Effect.succeed({ name: 'foobar' })),
//     'log-error': ({ event }) =>
//       pipe(Effect.logError('error'), Effect.annotateLogs({ event })),
//   },
//   runtime
// )
//
// const delays = createEffectDelays(
//   {
//     'pause-before-greet': () =>
//       pipe(Duration.minutes(1), Duration.toMillis, Effect.succeed),
//   },
//   runtime
// )
//
// const machine = createMachine(
//   {
//     id: 'greet',
//     initial: 'initial',
//     types: {} as {
//       actions: {
//         [K in keyof typeof actions]: { type: K }
//       }[keyof typeof actions]
//       actors: {
//         src: 'greet'
//         logic: PromiseActorLogic<unknown, { name: string }>
//       }
//       delays: keyof typeof delays
//     },
//     states: {
//       'deciding-who-to-greet': {
//         entry: ['set-name'],
//       },
//       'waiting-to-greet': {
//         after: 'pause-before-greet',
//         target: 'greeting',
//       },
//       greeting: {
//         invoke: {
//           input: ({ context }) => ({ nme: context.name }),
//           src: 'greet',
//         },
//       },
//       error: {
//         type: 'final',
//         tags: ['diachronic.workflow.error'],
//       },
//       done: { type: 'final' },
//     },
//   },
//   {
//     actors: actorActivities,
//     actions,
//     delays,
//   }
// )
