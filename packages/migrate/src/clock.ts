import { SimulatedClock } from 'xstate'
import * as Clock from 'effect/Clock'
import { ClockTypeId } from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Duration from 'effect/Duration'

export interface XStateClockInterface {
  setTimeout(fn: (...args: any[]) => void, timeout: number): any

  clearTimeout(id: any): void
}

/**
 * A clock that gets its current time value from Date.now.
 * Uses native Javascript timer implementations.
 * Can be used as a single source of truth for time in an XState program.
 */
export class CustomClock implements XStateClockInterface, Clock.Clock {
  readonly [ClockTypeId]: ClockTypeId
  public timeouts: Map<NodeJS.Timeout, any> = new Map()

  public getNowMs: () => number

  constructor() {
    this[ClockTypeId] = ClockTypeId
    this.getNowMs = () => Date.now()
  }

  getAllTimers(): Record<string, unknown> {
    return Object.fromEntries(this['timeouts'] as Map<NodeJS.Timeout, any>)
  }

  clearAllTimers() {
    ;[...(this['timeouts'] as Map<NodeJS.Timeout, any>).keys()].forEach(
      (key) => {
        this.clearTimeout(key)
      }
    )
  }

  public setTimeout(fn: (...args: any[]) => void, ms: number) {
    const id = setTimeout(fn, ms)
    this.timeouts.set(id, {
      start: this.now(),
      timeout: ms,
      fn,
    })
    return id
  }

  private _id: number = 0

  private getId() {
    return this._id++
  }

  public now(): number {
    return this.getNowMs()
  }

  public clearTimeout(id: NodeJS.Timeout) {
    clearTimeout(id)
    this.timeouts.delete(id)
  }

  get currentTimeMillis(): Effect.Effect<number> {
    return Effect.succeed(this.now())
  }

  sleep(duration: Duration.Duration): Effect.Effect<void> {
    const simulatedClockTimeout = this.setTimeout.bind(this)
    return Effect.async((resume) => {
      simulatedClockTimeout(() => {
        resume(Effect.succeed(void 0))
      }, Duration.toMillis(duration))
    })
  }

  get currentTimeNanos(): Effect.Effect<bigint> {
    return Effect.succeed(this.unsafeCurrentTimeNanos())
  }

  unsafeCurrentTimeNanos(): bigint {
    return BigInt(this.now() * 1e6)
  }

  unsafeCurrentTimeMillis(): number {
    return this.now()
  }
}

/**
 * A clock that gets its current time value from a variable.
 * Timers are eligible to fire only on calls to `set` or `increment`.
 */
export class TestClock extends SimulatedClock implements Clock.Clock {
  readonly [ClockTypeId]: ClockTypeId

  constructor() {
    super()
    this[ClockTypeId] = ClockTypeId
  }

  getAllTimers(): Record<string, unknown> {
    return Object.fromEntries(this['timeouts'] as Map<number, any>)
  }

  clearAllTimers() {
    ;[...(this['timeouts'] as Map<number, any>).keys()].forEach((key) => {
      this.clearTimeout(key)
    })
  }

  setTimeout(fn: (...args: any[]) => void, timeout: number): any {
    // console.log('doing a set timeout', fn, timeout)
    return super.setTimeout(fn, timeout)
  }

  clearTimeout(id: any) {
    // console.log('doing a clear timeout', id)
    return super.clearTimeout(id)
  }

  get currentTimeMillis(): Effect.Effect<number> {
    return Effect.succeed(this.now())
  }

  sleep(duration: Duration.Duration): Effect.Effect<void> {
    const simulatedClockTimeout = this.setTimeout.bind(this)
    return Effect.async((resume) => {
      simulatedClockTimeout(() => {
        resume(Effect.succeed(void 0))
      }, Duration.toMillis(duration))
    })
  }

  get currentTimeNanos(): Effect.Effect<bigint> {
    return Effect.succeed(this.unsafeCurrentTimeNanos())
  }

  unsafeCurrentTimeNanos(): bigint {
    return BigInt(this.now() * 1e6)
  }

  unsafeCurrentTimeMillis(): number {
    return this.now()
  }
}
