import { assign, createMachine } from 'xstate'

export const machine = createMachine({
  id: 'test',
  initial: 'initial',
  context: {},
  states: {
    initial: {
      on: {
        hey: {
          target: 'completely-different-state',
        },
      },
    },
    'completely-different-state': {
      entry: [() => console.log('I am a completely different state')],
      on: {
        'some-event': {
          actions: [assign({ some: 'value' })],
          target: 'done',
        },
      },
    },
    done: { type: 'final' },
  },
})
