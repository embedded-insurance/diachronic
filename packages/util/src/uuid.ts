import * as Context from 'effect/Context'
import * as Layer from 'effect/Layer'
import { v4 as uuid } from 'uuid'
import { uuid as fcUUID } from 'fast-check'
import { sample1 } from './arbitrary'

export type UUIDGenerator = () => string

/**
 * @example
 * Effect.flatMap(UUIDGenerator, (uuid) => Effect.log('hey ' + uuid()))
 */
export const UUIDGenerator = Context.GenericTag<UUIDGenerator>('@diachronic.util/uuid')

/**
 * Default UUID generator using node-uuid v4
 */
export const UUID = UUIDGenerator.of(uuid)

/**
 * Provides a layer with a UUID generator that uses the default uuid package
 */
export const UUIDLive = Layer.succeed(UUIDGenerator, UUID)

/**
 * Provides a layer with a UUID generator that uses fast-check, may be seeded
 */
export const UUIDFastCheckLive = Layer.succeed(
  UUIDGenerator,
  UUIDGenerator.of(() => sample1(fcUUID()))
)
