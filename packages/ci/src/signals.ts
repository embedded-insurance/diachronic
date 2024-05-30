import * as S from '@effect/schema/Schema'

export const StartRolloutSignal = S.Struct({
  type: S.Literal('diachronic.ci.workflow.rollout.start'),
  payload: S.Struct({
    workflowName: S.String,
    environment: S.Literal('development', 'production'),
  }),
})

export const StartMigrationSignal = S.Struct({
  type: S.Literal('diachronic.ci.workflow.migration.start'),
  payload: S.Struct({
    workflowName: S.String,
    environment: S.Literal('development', 'production'),
  }),
})

export const CancelRolloutSignal = S.Struct({
  type: S.Literal('diachronic.ci.cancel-rollout'),
  payload: S.Struct({
    workflowName: S.String,
    environment: S.Literal('development', 'production'),
  }),
})
