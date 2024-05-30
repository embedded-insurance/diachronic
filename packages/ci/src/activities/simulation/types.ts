import * as S from '@effect/schema/Schema'
import { ISODateString } from '@diachronic/util/isoDate'
import { activityDef } from '@diachronic/activity/activity'

export class UnsupportedSimulation extends S.TaggedError<UnsupportedSimulation>()(
  'UnsupportedSimulation',
  {
    scenarioName: S.optional(S.String),
    environment: S.optional(S.String),
    message: S.String,
  }
) {
  public nonRetryable = true as true
}

const SimulationEnvironment = S.Literal('development', 'production')

export const StartWorkflowSimulationInput = S.extend(
  S.Struct({
    workflowName: S.String,
    versionId: S.String,
    environment: SimulationEnvironment,
    taskQueue: S.String,
    scenarioName: S.String,
  }),
  S.partial(S.Struct({ numberOfSimulations: S.Number }))
)
export type StartWorkflowSimulationInput = S.Schema.Type<
  typeof StartWorkflowSimulationInput
>
export const StartWorkflowSimulationOutput = S.Struct({
  workflowName: S.String,
  versionId: S.String,
  environment: SimulationEnvironment,
  scenarioName: S.String,
  successes: S.Array(S.Unknown),
  failures: S.Array(S.Unknown),
  timeStarted: ISODateString,
})

export const activityDefinitions = {
  startWorkflowSimulation: activityDef({
    name: 'startWorkflowSimulation',
    input: StartWorkflowSimulationInput,
    output: StartWorkflowSimulationOutput,
    error: S.Struct(UnsupportedSimulation.fields),
  }),
}
