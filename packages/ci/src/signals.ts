import * as S from '@effect/schema/Schema'

export const StartRolloutSignal = S.struct({
  type: S.literal('diachronic.ci.workflow.rollout.start'),
  payload: S.struct({
    workflowName: S.string,
    environment: S.literal('development', 'production'),
  }),
})

export const StartMigrationSignal = S.struct({
  type: S.literal('diachronic.ci.workflow.migration.start'),
  payload: S.struct({
    workflowName: S.string,
    environment: S.literal('development', 'production'),
  }),
})

export const CancelRolloutSignal = S.struct({
  type: S.literal('diachronic.ci.cancel-rollout'),
  payload: S.struct({
    workflowName: S.string,
    environment: S.literal('development', 'production'),
  }),
})
