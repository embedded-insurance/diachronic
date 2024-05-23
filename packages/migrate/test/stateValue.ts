import {
  genStateValueType,
  getAllStateValues,
  getMigrationStateValues,
} from '../src/visit'
import * as R from 'ramda'
import { getStateToInboundEvents, objectifyStateId } from '../src/analysis'
import { createMachine, not } from 'xstate'
import { canInterruptTag } from '../src/can-migrate'

const createTestMachine = (args: { context: any }) =>
  createMachine({
    id: 'test',
    context: args.context || {},
    types: {} as { delays: any },
    initial: 'state-a',
    on: { 'signal-a': {} },
    states: {
      'state-a': {
        on: {
          'signal-b': {
            target: 'state-b',
          },
        },
      },
      'state-b': {
        tags: [canInterruptTag],
        invoke: {
          src: 'invoke-a',
          onError: {
            actions: ['log-error'],
          },
          onDone: {
            target: 'state-c',
          },
        },
      },
      'state-c': {
        invoke: {
          src: 'invoke-b',
          onError: {},
          onDone: {
            target: 'state-d',
          },
        },
      },
      'state-d': {
        initial: 'state-d-a',
        on: {
          'signal-c': [
            {
              // guard: 'guard-a',
              // target: 'state-d-a',
            },
            {
              guard: not('guard-a'),
              target: 'state-d',
            },
          ],
          'signal-d': [
            {
              guard: 'guard-b',
              target: '.state-d-a.state-d-a+a',
            },
            {
              guard: not('guard-b'),
              target: '.state-d-a',
            },
          ],
          'signal-e': {},
          'signal-f': [
            {
              guard: 'guard-c',
              target: '.state-d-a',
            },
            {
              guard: not('guard-c'),
              target: '.state-d-a',
            },
          ],
          'signal-g': [
            {
              guard: 'guard-d',
              target: '.state-d-a',
            },
            {
              guard: not('guard-d'),
              target: '.state-d-a',
            },
          ],
        },
        states: {
          'state-d-a': {
            type: 'parallel',
            states: {
              'state-d-a+a': {
                initial: '1',
                states: {
                  '1': {
                    after: {
                      'delay-a': '2',
                    },
                  },
                  '2': {
                    invoke: {
                      src: 'invoke-b',
                      onDone: [
                        {
                          target: '3',
                        },
                      ],
                      onError: [],
                    },
                  },
                  '3': {
                    invoke: {
                      src: 'invoke-c',
                      onDone: [{ target: '4' }],
                    },
                  },
                  '4': {
                    after: { 'delay-d': '#test.done' },
                    on: {
                      'signal-f': {
                        target: '#test.state-e',
                      },
                    },
                  },
                },
              },
              'state-d-a+b': {
                initial: '1',
                states: {
                  '1': {
                    after: {
                      'delay-f': '#test.state-e',
                    },
                  },
                  '2': {
                    invoke: {
                      src: 'invoke-c',
                      onDone: {},
                    },
                  },
                  '3': {
                    invoke: {
                      src: 'invoke-d',
                    },
                  },
                },
              },
              // FIXME. generate a valid state value for this case
              //   fails since cartesian not implemented for cardinality > 2
              // 'state-d-b': {
              //   initial: 'state-d-b+a',
              //   states: {
              //     'state-d-b+a': {
              //       invoke: {
              //         src: 'invoke-g',
              //         onError: {},
              //         onDone: [],
              //       },
              //     },
              //   },
              // },
            },
          },
        },
      },
      'state-e': {
        initial: 'a',
        on: {
          'signal-f': [
            {
              guard: 'guard-c',
              target: '#test.done',
            },
            {
              guard: not('guard-c'),
              target: '#test.done',
            },
          ],
          'signal-g': [
            {
              guard: 'guard-d',
            },
            {
              guard: not('guard-d'),
              target: '#test.done',
            },
          ],
        },
        states: {
          a: {
            invoke: {
              src: 'invoke-a',
              onError: [],
            },
            after: {
              'delay-a': '#test.done',
            },
          },
          b: {
            invoke: {
              src: 'invoke-b',
              onDone: [{ target: 'c' }],
              onError: [{ target: 'd' }],
            },
          },
          c: {
            invoke: {
              src: 'invoke-c',
              onDone: [{ target: 'd' }],
              onError: [{ target: 'd' }],
            },
          },
          d: {
            invoke: {
              src: 'invoke-d',
              onDone: [{ target: '#test.done' }],
              onError: [],
            },
          },
        },
      },

      done: { type: 'final' },
    },
  })

test('getAllStateValues - should return all state values a machine can occupy', () => {
  const machine = createTestMachine({ context: {} })

  const ids = getAllStateValues(machine)

  expect(R.uniq(ids).length).toEqual(ids.length)
  ids.forEach((id) => {
    // `value` returned is in object form,
    // input is allowed to be dot-separated strings when possible
    const { value } = machine.resolveStateValue(id, {})
    expect(value).toEqual(objectifyStateId(id))
  })
})

test('getMigrationStates', () => {
  const machine = createTestMachine({ context: {} })
  const ids = getAllStateValues(machine)
  const migrationStates = getMigrationStateValues(machine)
  expect(migrationStates.length && migrationStates.length < ids.length).toEqual(
    true
  )
})

test('getStateToInboundEvents', () => {
  const machine = createTestMachine({ context: {} })
  expect(getStateToInboundEvents(machine)).toEqual({
    'test.done': [],
    'test.state-a': ['signal-b'],
    'test.state-b': [],
    'test.state-c': [],
    'test.state-d': ['signal-c', 'signal-d', 'signal-f', 'signal-g'],
    'test.state-d.state-d-a': ['signal-c', 'signal-d', 'signal-f', 'signal-g'],
    'test.state-d.state-d-a.state-d-a+a': [
      'signal-c',
      'signal-d',
      'signal-f',
      'signal-g',
    ],
    'test.state-d.state-d-a.state-d-a+a.1': [
      'signal-c',
      'signal-d',
      'signal-f',
      'signal-g',
    ],
    'test.state-d.state-d-a.state-d-a+a.2': [
      'signal-c',
      'signal-d',
      'signal-f',
      'signal-g',
    ],
    'test.state-d.state-d-a.state-d-a+a.3': [
      'signal-c',
      'signal-d',
      'signal-f',
      'signal-g',
    ],
    'test.state-d.state-d-a.state-d-a+a.4': [
      'signal-c',
      'signal-d',
      'signal-f',
      'signal-g',
    ],
    'test.state-d.state-d-a.state-d-a+b': [
      'signal-c',
      'signal-d',
      'signal-f',
      'signal-g',
    ],
    'test.state-d.state-d-a.state-d-a+b.1': [
      'signal-c',
      'signal-d',
      'signal-f',
      'signal-g',
    ],
    'test.state-d.state-d-a.state-d-a+b.2': [
      'signal-c',
      'signal-d',
      'signal-f',
      'signal-g',
    ],
    'test.state-d.state-d-a.state-d-a+b.3': [
      'signal-c',
      'signal-d',
      'signal-f',
      'signal-g',
    ],
    'test.state-e': ['signal-f', 'signal-g'],
    'test.state-e.a': ['signal-f', 'signal-g'],
    'test.state-e.b': ['signal-f', 'signal-g'],
    'test.state-e.c': ['signal-f', 'signal-g'],
    'test.state-e.d': ['signal-f', 'signal-g'],
  })
})
