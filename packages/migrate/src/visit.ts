import { AnyStateNode, StateNode, StateValue } from 'xstate'
import { pipe } from 'effect/Function'
import * as R from 'ramda'
import { cartesianWith } from 'effect/ReadonlyArray'
// @ts-expect-error
import type { AnyStateMachine } from 'xstate/dist/declarations/src/types'

import { canMigrate } from './can-migrate'

/**
 * JSON encoded string that represents a state value
 * Used in the migration function for exhaustiveness checking
 * and map previous states to next states
 */
export type StateId = string

// todo. not adding much right now!
export const visit = (
  ctx: Record<string, any>,
  state: AnyStateNode,
  f: (ctx: Record<string, any>, state: AnyStateNode) => any
) => {
  if (state.type === 'atomic') {
    f(ctx, state)
    return
  }
  if (state.type === 'compound') {
    f(ctx, state)
    return
  }
  if (state.type === 'parallel') {
    f(ctx, state)
    return
  }
  if (state.type === 'final') {
    f(ctx, state)
    return
  }
  if (state.type === 'history') {
    f(ctx, state)
    return
  }
  // assume it's a state machine
  f(ctx, state)
  Object.values(state.states).forEach((x) => visit(ctx, x, f))
}

export type XStateVisitor = <Context>(ctx: Context, state: StateNode) => void

const visitor: XStateVisitor = (ctx: any, state) => {
  if (state.type === 'atomic') {
    ctx.paths.push(state.path)
  }
  if (state.type === 'compound') {
    // enters potentially unintended state if used with resolveStateValue
    // ctx.paths.push(state.path)

    Object.values(state.states).forEach((x) => visit(ctx, x, visitor))
  }
  if (state.type === 'parallel') {
    // get descendent paths for each state that must be occupied simultaneously
    let stuff = []
    for (const [_, s] of Object.entries(state.states)) {
      let otherCtx = { paths: [] }
      // todo. actually need to call this fn again here,
      // so it needs to return values
      // collectPaths(otherCtx, s)
      visit(otherCtx, s, visitor)
      stuff.push(
        ...otherCtx.paths
          // drop the parent path from each
          .map((xs: Array<any>) => pipe(xs, R.drop(state.path.length)))
          // drop if we got a single segment path...
          // TODO. can atomic state can occur as a direct descendant of
          // type "parallel"? If so..may just append `null` to those ones
          // so it can be expressed as a key-value alongside other parallel states
          .filter((x) => x.length > 1)
      )
    }

    // group by the first key
    const partitioned = R.groupWith((a, b) => a[0] === b[0], stuff)

    if (partitioned.length !== 2) {
      throw new Error('not implemented')
    }
    // fixme. need n-ary version
    const product = cartesianWith(partitioned[0], partitioned[1], (a, b) =>
      [a, b].reduce(
        (acc, xs) => R.assocPath(R.dropLast(1, xs), R.last(xs), acc),
        {}
      )
    )

    const full = product.map((m) => R.assocPath(state.path || [], m, {}))
    ctx.paths.push(...full)
  }
  if (state.type === 'final') {
    ctx.paths.push(state.path)
  }
}

/**
 * Returns all StateValue types for a machine in an array
 * StateValue is used as input to start an XState machine
 * @param machine
 */
export const getAllStateValues = (machine: AnyStateMachine) => {
  let ctx = {
    paths: [] as Array<string[]>,
  }

  visit(ctx, machine, visitor)

  return ctx.paths.map((x) => (Array.isArray(x) ? x.join('.') : x))
}

/**
 * Returns the set of StateValues for machine that are valid migration sources
 * @param machine
 */
export const getMigrationStateValues = (
  machine: AnyStateMachine
): Array<StateValue> =>
  getAllStateValues(machine)
    .map((id) => machine.resolveStateValue(id, {}))
    .filter((x) => canMigrate(x))
    .map((x) => x.value)

export const genMigrationStatesType = (machine: AnyStateMachine) =>
  pipe(machine, getMigrationStateValues, stateValuesToTypeScript)

/**
 * Converts a StateValue to a StateId
 * @param stateValue
 */
export const stateValueToStateId = (stateValue: StateValue): StateId =>
  JSON.stringify(stateValue)

/**
 * Returns the set of StateIds for machine that are valid migration sources
 * according to the machine's definition
 * @param machine
 */
export const getMigrationStateIds = (machine: AnyStateMachine) =>
  pipe(machine, getMigrationStateValues, R.map(stateValueToStateId))

export const genStateValueType = (machine: AnyStateMachine) =>
  pipe(machine, getAllStateValues, stateValuesToTypeScript)

const printIdToValueMap = (xs: Array<StateValue>) =>
  `{${xs.map((x) => {
    if (typeof x === 'string') {
      return "\n  '" + stateValueToStateId(x) + "'" + ':' + JSON.stringify(x)
    }
    return (
      '\n  [' +
      "'" +
      stateValueToStateId(x) +
      "'" +
      ']' +
      ': ' +
      JSON.stringify(x, null, 2)
    )
  })}\n} as const`

/**
 * Returns TypeScript type definition as a string
 * Includes a map of StateId -> StateValue for migration sources and targets
 * @param xs
 */
export const stateValuesToTypeScript = (xs: Array<StateValue>): string =>
  `
export const stateIdToStateValue = ${printIdToValueMap(xs)}
  
  
`.trimStart()
