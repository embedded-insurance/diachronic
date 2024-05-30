import * as S from '@effect/schema/Schema'
import { pipe } from 'effect/Function'
import {
  AnyStateMachine,
  AnyStateNode,
  AnyStateNodeConfig,
  createMachine,
  MachineConfig,
  StateValue,
} from 'xstate'
import * as R from 'ramda'

// todo. i think this is in xstate/core now
const stateHierarchyDelimiter = '.'

// Normalizing is expected to be equivalent
// https://github.com/statelyai/xstate/issues/569
export const normalizeTransitionTarget = (target: string | string[]) =>
  Array.isArray(target) ? target : [target]

export type StateId = `#${string}`
export const StateId = pipe(
  S.String,
  S.startsWith('#'),
  S.identifier('StateId'),
  S.brand('StateId'),
  S.description('Reference to a state.')
)
// S.decode(StateId)(`#demo.not-quoting`)

export type ChildStateReference = `${typeof stateHierarchyDelimiter}${string}`
export const ChildStateReference = pipe(
  S.String,
  S.startsWith(stateHierarchyDelimiter),
  S.identifier('ChildStateReference'),
  S.description('Reference to a state below another.'),
  S.brand('ChildStateReference')
)
export type PeerStateReference = string
export const PeerStateReference = pipe(
  S.String,
  S.identifier('PeerStateReference'),
  S.description('Reference to a state in the same level as another.'),
  S.brand('PeerStateReference')
)
export const isStateId = (stateId: unknown): stateId is StateId =>
  typeof stateId === 'string' && stateId.startsWith('#')

export const isStateIdTarget = (target: string) => isStateId(target)
export const isChildStateTarget = (target: string) =>
  target.startsWith(stateHierarchyDelimiter)
export const isPeerTarget = (target: string) =>
  !isStateIdTarget(target) && !isChildStateTarget(target)

export const makeStateId = (parentId: StateId, key: string): StateId => {
  if (key.startsWith('#')) {
    throw new Error(
      `State keys cannot start with '#'. Maybe you used a state id instead?: ${key}`
    )
  }
  return `${parentId}${stateHierarchyDelimiter}${key}`
}

/**
 * A string that identifies a delay used by XState that includes the state in which it occurs
 * @example
 * 'xstate.after(quote/expiration-duration)#get-insurance.quoted'
 */
// export const XStateTimerId = pipe(S.string, S.pattern(/xstate\.after\(.+\)#.+/))
export const XStateTimerId = S.TemplateLiteral(
  S.Literal('xstate.after('),
  S.String,
  S.Literal(')'),
  S.Literal('#'),
  S.String
)
export type XStateTimerId = S.Schema.Type<typeof XStateTimerId>

// TODO. test this. it's expected to return a string for all XStateTimerId
export const getDelayFunctionName = (s: XStateTimerId): string => {
  const match = /xstate\.after\((:?.+)\)#.+/.exec(s)
  if (!match) {
    throw new Error(`Could not parse delay function name from ${s}`)
  }
  return match[1] as string
}

export const XStateTimerData = S.Struct({
  type: S.Literal('xstate.after'),
  name: S.String,
  stateId: S.String,
  delayId: pipe(
    XStateTimerId,
    S.description(
      'The identifier of a delay used by XState that includes the state in which it occurs'
    ),
    S.examples(['xstate.after(quote/expiration-duration)#get-insurance.quoted'])
  ),
})
export type XStateTimerData = S.Schema.Type<typeof XStateTimerData>

export const XStateAfterIdDataConverter = S.transform(
  XStateTimerId,
  XStateTimerData,
  {
    decode: (s) => {
      const [delayName, statePath] = s
        .replace('xstate.after(', '')
        .replace(')', '')
        .split('#')
      return {
        type: 'xstate.after' as const,
        name: delayName,
        stateId: '#' + statePath,
        delayId: s,
      }
    },

    encode: (m) => m.delayId,
  }
)

export const XStateStateValue = S.Union(S.String, S.Record(S.String, S.Unknown))
export type XStateStateValue = S.Schema.Type<typeof XStateStateValue>

export const datafyXStateAfterId = (s: string) =>
  S.decodeUnknownSync(XStateAfterIdDataConverter)(s)

export const isDelayEventId = (s: string) => S.is(XStateTimerId)(s)
export const isXStateAfterId = isDelayEventId

/**
 * Returns the delays the machine references and requires to run
 * @param m
 */
export const getMachineDelayReferences = (m: AnyStateMachine) =>
  m.events.filter(isDelayEventId).map(datafyXStateAfterId)

/**
 * Returns the delay implementations provided to the machine
 * @param m
 */
export const getProvidedDelayNames = (m: AnyStateMachine) =>
  Object.keys(m.implementations.delays)

export type EventlessTransition = {
  in: string
  target: StateId
}

export type EventBasedTransition = {
  in: string
  event: string
  target: StateId
}

/**
 * Returns state -> the events that do something when the machine is in that state
 * @param machine
 */
export const getStateToInboundEvents = (machine: AnyStateMachine) => {
  const allEventTypes: string[] = machine.events
  const wildcardEvent = '*'
  const signals = allEventTypes.filter(
    (x) =>
      !(
        x === wildcardEvent ||
        x.startsWith('xstate.after') ||
        x.startsWith('done.invoke') ||
        x.startsWith('error.platform')
      )
  )

  let result: Record<string, any> = {}
  const proc = (n: AnyStateNode) => {
    if (n.transitions && n.transitions.keys()) {
      const ks = [...n.transitions.keys()]
      result[n.id] = result[n.id] = R.uniq([
        ...ks,
        ...(result[n.parent?.id as string] || []),
      ])
    }
    Object.entries(n.states).forEach((x) => {
      const [s, v] = x as [string, AnyStateNode]
      proc(v)
    })
  }

  proc(machine as any)

  return Object.fromEntries(
    Object.entries(result).map(([k, v]) => [k, R.intersection(v, signals)])
  )
}

export const analyze = (config: MachineConfig<any, any, any>) => {
  const id = config.id || 'root'
  const stateHierarchyDelimiter = '.'
  const version = config.version

  let stateIds: Array<StateId> = []
  let stateTree: Record<string, any> = {}
  let stateHierarchy: string[] = []
  let inboundEvents = new Set<string>()
  let eventBasedTransitions: Array<EventBasedTransition> = []
  let eventlessTransitions: Array<EventlessTransition> = []

  ////////
  const addEvents = (
    inboundEvents: Set<string>,
    stateNode: AnyStateNodeConfig
  ) => {
    if (!stateNode.on) return

    if (Array.isArray(stateNode.on)) {
      stateNode.on.forEach((transitionsConfig) => {
        inboundEvents.add(transitionsConfig.event)
      })
    }

    Object.entries(stateNode.on).forEach(([eventKey, event]) => {
      inboundEvents.add(eventKey)
    })
  }

  const addEventBasedTransitions = (
    stateId: StateId,
    eventBasedTransitions: Array<EventBasedTransition>,
    stateNode: AnyStateNodeConfig
  ) => {
    if (!stateNode.on) return

    if (Array.isArray(stateNode.on)) {
      stateNode.on.forEach((transitionsConfig) => {
        if (!transitionsConfig.target) return

        normalizeTransitionTarget(transitionsConfig.target).forEach((target) =>
          eventBasedTransitions.push({
            in: stateId,
            event: transitionsConfig.event,
            target: makeStateId(stateId, target),
          })
        )
      })
    }

    Object.entries(stateNode.on).forEach(([eventKey, event]) => {
      if (!event) return

      if (typeof event === 'string') {
        eventBasedTransitions.push({
          in: stateId,
          event: eventKey,
          target: makeStateId(stateId, event),
        })
        return
      }

      if (Array.isArray(event)) {
        event.forEach((transitionsConfigOrString) => {
          if (typeof transitionsConfigOrString === 'string') {
            eventBasedTransitions.push({
              in: stateId,
              event: eventKey,
              target: makeStateId(stateId, transitionsConfigOrString),
            })
            return
          }

          if (!transitionsConfigOrString) return
          if (!transitionsConfigOrString.target) return

          normalizeTransitionTarget(transitionsConfigOrString.target).forEach(
            (target) =>
              eventBasedTransitions.push({
                in: stateId,
                event: eventKey,
                target: makeStateId(stateId, target),
              })
          )
        })
        return
      }

      // @ts-expect-error
      if (!event.target) return

      // @ts-expect-error
      normalizeTransitionTarget(event.target).forEach((target) =>
        eventBasedTransitions.push({
          in: stateId,
          event: eventKey,
          target: makeStateId(stateId, target),
        })
      )
      return
    })
  }

  const addEventlessTransitions = (
    stateId: StateId,
    eventlessTransitions: EventlessTransition[],
    stateNode: AnyStateNodeConfig
  ) => {
    if (!stateNode.always) return

    const alwaysNormalized = Array.isArray(stateNode.always)
      ? stateNode.always
      : [stateNode.always]

    alwaysNormalized.forEach((transitionsConfigOrTarget) => {
      if (!transitionsConfigOrTarget) return

      if (typeof transitionsConfigOrTarget === 'string') {
        eventlessTransitions.push({
          in: stateId,
          target: makeStateId(stateId, transitionsConfigOrTarget),
        })
        return
      }

      if (!transitionsConfigOrTarget.target) return

      normalizeTransitionTarget(transitionsConfigOrTarget.target).forEach(
        (target) =>
          eventlessTransitions.push({
            in: stateId,
            target: makeStateId(stateId, target),
          })
      )
    })
  }

  const go = (
    parentPath: StateId | null,
    key: string,
    stateNode: MachineConfig<any, any, any> | AnyStateNodeConfig
  ) => {
    const stateId = isStateId(parentPath)
      ? makeStateId(parentPath, key)
      : (`#${key}` as StateId)

    stateIds.push(stateId)

    if (parentPath !== null) {
      stateHierarchy.push(`${parentPath} -> ${key}`)
      stateTree = R.assocPath(
        [...parentPath.split(stateHierarchyDelimiter), key],
        {},
        stateTree
      )
    }

    addEvents(inboundEvents, stateNode)
    addEventBasedTransitions(stateId, eventBasedTransitions, stateNode)
    addEventlessTransitions(stateId, eventlessTransitions, stateNode)

    if (stateNode.states) {
      Object.entries(stateNode.states).forEach(([stateKey, stateNode]) => {
        go(stateId, stateKey, stateNode)
      })
    }
  }

  ///////
  go(null, id, config)

  return {
    stateIds,
    stateHierarchy,
    inboundEvents: Array.from(inboundEvents),
    eventBasedTransitions,
    eventlessTransitions,
    stateTree,
  }
}

export const compare = (
  a: MachineConfig<any, any>,
  b: MachineConfig<any, any>
) => {
  const aa = analyze(a)
  const ba = analyze(b)
  const aNotInB = R.difference(aa.stateIds, ba.stateIds)
  const bNotInA = R.difference(ba.stateIds, aa.stateIds)
  const deletedEventTransitions = R.difference(
    aa.eventBasedTransitions,
    ba.eventBasedTransitions
  )
  const newEventTransitions = R.difference(
    ba.eventBasedTransitions,
    aa.eventBasedTransitions
  )

  return {
    missingStates: aNotInB,
    newStates: bNotInA,
    newEventTransitions: newEventTransitions,
    deletedEventTransitions: deletedEventTransitions,
  }
}

type Reason =
  | {
      type: 'missing_state'
      data: { stateId: string }
      message: string
      suggestion: string
    }
  | {
      type: 'missing_delay'
      data: XStateTimerData
      message: string
      suggestion: string
    }

type Reasons = Array<Reason>

// todo. change input to AnyStateMachine
export const getBreakingChanges = (
  a: MachineConfig<any, any>,
  b: MachineConfig<any, any>,
  f: (args: { context: any; stateValue: string }) => {
    context: any
    stateValue: any
  }
): Reasons => {
  let reasons: Reasons = []
  const diff = compare(a, b)
  const aAna = analyze(a)
  const bAna = analyze(b)

  if (diff.missingStates.length) {
    // fixme. state values and state ids are not the same
    // a state value is an object capable of representing
    // multiple states
    diff.missingStates.forEach((stateId) => {
      const next = f({ context: a.context, stateValue: stateId })
      if (!R.intersection(bAna.stateIds, [next.stateValue]).length) {
        console.error(`Machine A state ${stateId} is missing from machine B.`)
        reasons.push({
          type: 'missing_state',
          data: { stateId },
          message: `Machine A state ${stateId} is missing from machine B.`,
          suggestion: `Include ${stateId} in the new state machine, or map it to a state in B using a migration function.`,
        })
      }
    })
  }

  const aMachine = createMachine(a)
  const bMachine = createMachine(b)
  const aDelays = getMachineDelayReferences(aMachine)
  const bDelays = getMachineDelayReferences(bMachine)
  const missingDelays = R.difference(aDelays, bDelays)
  if (missingDelays.length) {
    missingDelays.forEach((delay) => {
      reasons.push({
        // there may be outstanding timers that cannot be migrated to the new machine.
        // they will be cancelled by default
        type: 'missing_delay',
        data: delay,
        message: `Machine A has delay ${delay.name} which is missing from machine B. Running timers will be cancelled and not restarted.`,
        suggestion: `If the timer should resume as a new timer upon migration, include ${delay.name} in the new state machine under ${delay.stateId}, 
        or ensure you are starting a new timer that takes place of the old one.
        If you would like to carry forward the time left on this timer, your migration function will receive the bag of timers at migration time, allowing you
        to set your new delays as a function of the old ones. To test this behavior, for running and nonrunning timer cases:
        
        
        `,
      })
    })
  }

  return reasons
}

/**
 * Returns the object representation of a state value when it is a string separated by "."
 * @param x
 */
export const objectifyStateId = (x: StateValue): StateValue => {
  if (typeof x === 'string') {
    const path = x.split('.')
    if (path.length === 1) {
      return path[0]
    }
    return R.assocPath(R.dropLast(1, path), R.last(path), {})
  }
  return x
}
