import { UUID } from '@diachronic/util/uuid'
import { TestClock } from '@diachronic/migrate/clock'
import { Trigger } from '@diachronic/util/trigger'
import { makeDelays, makeToasterMachine } from '../src'
import { interpret } from '@diachronic/migrate/interpreter'
import { waitFor } from 'xstate'

export const makeTestMachine = (args?: { workflowId?: string }) => {
  const workflowId = args?.workflowId || UUID()
  const clock = new TestClock()
  const blocker = new Trigger() as any
  const machine = makeToasterMachine({
    delays: makeDelays(),
  })

  const interpreter = interpret(machine, { clock })
  interpreter.subscribe((x) => {
    console.log('State transitioned to:', x.value)
  })

  return {
    machine,
    interpreter,
    clock,
    workflowId,
    blocker,
  }
}

test('toaster machine', async () => {
  const { interpreter, clock } = makeTestMachine()
  interpreter.start()

  await waitFor(interpreter, (a) => a.value === 'OFF')
  interpreter.send({ type: 'set-toast-time', payload: { duration: 1000 } })
  await waitFor(interpreter, (a) => a.value === 'OFF')
  interpreter.send({ type: 'plug-it-in', payload: undefined })
  await waitFor(interpreter, (a) => a.value === 'ON')

  clock.increment(1000)

  await waitFor(interpreter, (a) => a.value === 'OFF')
  expect(interpreter.getSnapshot().context).toEqual({
    pluggedIn: true,
    toastTimeDuration: undefined,
    numberOfToasts: 0,
  })
})
