import { AnyState } from 'xstate'

/**
 * Indicates a state is not ok to migrate in when added as a tag to a state node
 */
export const noMigrateTag = 'diachronic.v1.no-migrate'
/**
 * Indicates activities in this state node are ok to interrupt when added as a tag to a state node
 */
export const canInterruptTag = 'diachronic.v1.can-interrupt'
/**
 * ID of the signal that triggers a migration
 */
export const migrateSignalName = 'diachronic.v1.migrate'
/**
 * Returns true if state the workflow can be migrated
 * @param snapshot
 */
export const canMigrate = (snapshot: AnyState) => {
  // If explicitly tagged as no-migrate, don't migrate
  if (snapshot.tags.has(noMigrateTag)) {
    return false
  }

  // Ok to migrate when either:
  // 1. No active state nodes invoke an actor
  // 2. Active state nodes that invoke something and tell us they can be interrupted

  const activeStateNodes = snapshot.configuration

  const stateNodesThatInvokeSomething = activeStateNodes.filter(
    (stateNode) => stateNode.invoke.length
  )

  const stateNodesThatInvokeActorsAndAreInterruptable =
    stateNodesThatInvokeSomething.filter((stateNode) =>
      // why is this an array but the other a set...?
      stateNode.tags.includes(canInterruptTag)
    )

  // If there are no active state nodes that invoke actors, ok to migrate
  if (!stateNodesThatInvokeSomething.length) {
    return true
  }

  // If there are active state nodes that invoke actors, but all of them can be interrupted, ok to migrate
  if (
    stateNodesThatInvokeSomething.length ===
    stateNodesThatInvokeActorsAndAreInterruptable.length
  ) {
    return true
  }

  // Otherwise, not ok to migrate
  return false
}
