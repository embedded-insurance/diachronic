import {
  startChild,
  defineSignal,
  setHandler,
  ChildWorkflowHandle,
} from '@temporalio/workflow'
import { Trigger } from '@diachronic/util/trigger'

const debounce = (fn: (args: any) => Promise<any>, ms: number) => {
  // let times = -1
  let timeout: NodeJS.Timeout
  return (args: any) => {
    if (timeout) {
      // console.log('clearing timeout', times)
      clearTimeout(timeout)
    }
    // console.log('setting timeout', ++times)
    timeout = setTimeout(() => fn(args), ms)
  }
}

/**
 * Creates a workflow that debounces calls to `fn` by `delay` milliseconds.
 * @param name
 * @param workflowId
 * @param fn
 * @param delay
 */
export const makeDebouncedFnCallWorkflow = <Args>(
  name: string,
  workflowId: string,
  fn: (args: Args) => Promise<any>,
  delay: number
) => {
  const wf = async () => {
    const blocker = new Trigger()
    const writeToDatabaseSignal = defineSignal<[Args]>('invoke')
    const debounced = debounce(fn, delay)
    setHandler(writeToDatabaseSignal, (args) => {
      try {
        debounced(args)
      } catch (e) {
        console.error(e)
      }
    })
    await blocker
  }
  Object.defineProperty(wf, 'name', { value: name })
  let handle: ChildWorkflowHandle<typeof wf>
  const call = async (args: Args) => {
    handle =
      handle ||
      (await startChild(name, {
        workflowId,
        args: [],
      }))
    await handle.signal('invoke', args)
  }
  return { wf, call }
}
