import * as S from '@effect/schema/Schema'
import { ISODateString } from '@diachronic/util/isoDate'
import { activityDef } from '@diachronic/activity/activity'

export class UnsupportedSimulation extends S.TaggedError<UnsupportedSimulation>()(
  'UnsupportedSimulation',
  {
    scenarioName: S.optional(S.string),
    environment: S.optional(S.string),
    message: S.string,
  }
) {
  public nonRetryable = true as true
}

const SimulationEnvironment = S.literal('development', 'production')

export const StartWorkflowSimulationInput = S.extend(
  S.struct({
    workflowName: S.string,
    versionId: S.string,
    environment: SimulationEnvironment,
    taskQueue: S.string,
    scenarioName: S.string,
  }),
  S.partial(S.struct({ numberOfSimulations: S.number }))
)
export type StartWorkflowSimulationInput = S.Schema.To<
  typeof StartWorkflowSimulationInput
>
export const StartWorkflowSimulationOutput = S.struct({
  workflowName: S.string,
  versionId: S.string,
  environment: SimulationEnvironment,
  scenarioName: S.string,
  successes: S.array(S.unknown),
  failures: S.array(S.unknown),
  timeStarted: ISODateString,
})

export const activityDefinitions = {
  startWorkflowSimulation: activityDef({
    name: 'startWorkflowSimulation',
    input: StartWorkflowSimulationInput,
    output: StartWorkflowSimulationOutput,
    error: UnsupportedSimulation.struct,
  }),
}
