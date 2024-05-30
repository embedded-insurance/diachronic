import * as S from '@effect/schema/Schema'
import * as Arbitrary from '@effect/schema/Arbitrary'
import * as fc from 'fast-check'

// This is convenient but requires fast-check as a dependency

/**
 * Returns the fast-check arbitrary for a type
 *
 * @example
 * ```
 * pipe(S.string, getArbitrary, sample1)
 * ```
 *
 * @param type
 */
export const getArbitrary = <A, I>(type: S.Schema<A, I>): fc.Arbitrary<A> =>
  Arbitrary.makeLazy(type)(fc)

/**
 * Returns a sample value for a type
 * @param arb
 */
export const sample1 = <T>(arb: fc.Arbitrary<T>): T => fc.sample(arb, 1)[0]
