import * as S from '@effect/schema/Schema'
import * as AST from '@effect/schema/AST'

/**
 * Returns an array of the string literal types for values of x of the form
 * { type: 'foo' } | { type: 'bar' }
 * @param x
 * @param tagKey
 */
export const extractStringTagsFromUnion = <T extends S.Schema<any>>(
  x: T,
  tagKey = 'type'
) => {
  if (!AST.isUnion(x.ast)) {
    return []
  }
  if (!x.ast.types.every((x) => AST.isTypeLiteral(x))) {
    return []
  }
  if (
    !x.ast.types.every((x) =>
      (x as AST.TypeLiteral).propertySignatures.some(
        (x) =>
          x.name === tagKey &&
          AST.isLiteral(x.type) &&
          typeof x.type === 'string'
      )
    )
  ) {
    return []
  }
  return x.ast.types.map(
    (x) =>
      (x as AST.TypeLiteral).propertySignatures.find((x) => x.name === 'type')!
        .type
  )
}
