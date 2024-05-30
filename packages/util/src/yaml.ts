import * as yaml from 'js-yaml'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import { YAMLException } from 'js-yaml'
import * as Data from 'effect/Data'

/**
 * Represents an error in YAML serialization
 */
export interface YAMLSerializationError extends Data.Case.Constructor<any> {
  readonly _tag: '@diachronic.util/YAMLSerializationError'
  name: string
  reason: string
  message: string
  mark: yaml.Mark
}
export const YAMLError = Data.tagged<YAMLSerializationError>(
  '@diachronic.util/YAMLSerializationError'
)

const mapException = (e: YAMLException): YAMLSerializationError =>
  YAMLError({
    name: e.name,
    reason: e.reason,
    message: e.toString(),
    mark: e.mark,
  })

/**
 * Prints the provided object as YAML
 * @param x
 */
export const yamlPrint = (
  x: any
): Effect.Effect<string, YAMLSerializationError> =>
  Effect.try({
    try: () => yaml.dump(x, { noRefs: true }),
    catch: (e) => mapException(e as YAMLException),
  })

/**
 * Prints the provided objects as YAML, separated by `---`
 * @param xs
 */
export const yamlCat = (
  xs: any[]
): Effect.Effect<string, YAMLSerializationError> =>
  pipe(
    xs.map((x) => yamlPrint(x)),
    Effect.all,
    Effect.map((xs) => xs.join('---\n'))
  )
