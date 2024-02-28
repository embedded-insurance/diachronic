/**
 * Sets global variables typically present in Node.js
 * @module
 */
import { inWorkflowContext } from '@temporalio/workflow'

if (inWorkflowContext()) {
  // These don't appear to be defined in the workflow context
  // (The logs don't print)
  // TODO. if console.* actually prints in temporal we shouldn't need these
  // console.error = console.log
  // console.info = console.log
  // console.warn = console.log
  // console.debug = console.log
  // console.trace = console.log

  // @effect/data references these as of ~0.40.0
  if (!globalThis.TextEncoder) {
    class TextEncoder {
      constructor() {}

      encode() {
        throw new Error('Not implemented')
      }
    }

    Object.defineProperty(global, 'TextEncoder', {
      value: TextEncoder,
    })
  }
  if (!globalThis.TextDecoder) {
    class TextDecoder {
      constructor() {}

      decode() {
        throw new Error('Not implemented')
      }
    }

    Object.defineProperty(globalThis, 'TextDecoder', {
      value: TextDecoder,
    })
  }
  if (!globalThis.performance) {
    // required by Effect
    Object.assign(globalThis, {
      performance: {
        timeOrigin: Date.now(),
        now() {
          return Date.now() - this.timeOrigin
        },
      },
    })
  }
}
