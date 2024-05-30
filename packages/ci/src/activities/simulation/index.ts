import { implementGroup } from '@diachronic/activity/activity'
import { activityDefinitions, StartWorkflowSimulationInput } from './types'
import { Effect, pipe } from 'effect'
import { UnsupportedSimulation } from './types'
import { WorkflowSignalerClient } from '@diachronic/signaler/client'
import { Instruction } from '@diachronic/signaler/types'

const getWorkflowSimulationStartInstructions = (args: {
  workflowName: string
  scenarioName: string
  numberOfSimulations: number
  taskQueue: string
}) =>
  Effect.try<Instruction[], UnsupportedSimulation>({
    try: () => {
      throw new UnsupportedSimulation({
        scenarioName: args.scenarioName,
        message: `Simulation for workflow '${args.workflowName}' is not implemented.`,
      })
    },
    catch: (e) => e as UnsupportedSimulation,
  })

const defaultWorkflowSimulationEffect = (
  args: StartWorkflowSimulationInput & { numberOfSimulations: number }
) =>
  pipe(
    getWorkflowSimulationStartInstructions(args),
    Effect.flatMap((instructions: Instruction[]) =>
      Effect.flatMap(WorkflowSignalerClient, (client) =>
        Effect.partition((event) =>
          client.instruction({
            body: event,
          })
        )(instructions)
      )
    ),
    Effect.map(([failures, successes]) => ({
      ...args,
      successes,
      failures,
      timeStarted: new Date().toISOString(),
    }))
  )

const getWorkflowSimulationEffect = (
  args: StartWorkflowSimulationInput & { numberOfSimulations: number }
) =>
  Effect.if(
    args.environment !== 'production' && args.scenarioName === 'default',
    {
      onTrue: () => defaultWorkflowSimulationEffect(args),
      onFalse: () =>
        Effect.fail(
          new UnsupportedSimulation({
            scenarioName: args.scenarioName,
            environment: args.environment,
            message: `Only non-production simulations for the 'default' scenario are implemented.`,
          })
        ),
    }
  )

export const activities = implementGroup(activityDefinitions, {
  startWorkflowSimulation: (args) =>
    pipe(
      getWorkflowSimulationEffect({
        ...args,
        numberOfSimulations: args.numberOfSimulations || 10,
      }),
      Effect.tapErrorCause((cause) =>
        Effect.logError('Simulation failed:', cause)
      )
    ),
})
