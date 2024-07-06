import * as S from '@effect/schema/Schema'
import type { ParseOptions } from '@effect/schema/AST'

/**
 * Schema.decode with default options
 * @param schema
 * @param opts
 */
export const decode = (schema: S.Schema<any>, opts?: ParseOptions) =>
  S.decode(schema, {
    onExcessProperty: 'preserve',
    errors: 'all',
    ...opts,
  })
