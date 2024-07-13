import * as AST from '@effect/schema/AST'
import type { Schema } from '@effect/schema/Schema'
import * as R from 'ramda'
import { IntTypeId } from '@effect/schema/Schema'

export type StringType = 'string'
export type BooleanType = 'boolean'
export type IntegerType = 'integer'
export type LongType = 'long'
export type DoubleType = 'double'
export type FloatType = 'float'
export type ShortType = 'short'
export type ByteType = 'byte'
export type BinaryType = 'binary'
export type DateType = 'date'
export type TimestampType = 'timestamp'
export type DecimalType = 'decimal' // 'decimal(10,5)'

export type MapType = {
  type: 'map'
  keyType: StringType
  valueType: SparkSchema
  valueContainsNull: boolean
}

export type ArrayType = {
  type: 'array'
  elementType: SparkSchema
  containsNull: boolean
}

export type StructField = {
  name: string
  type: SparkSchema
  nullable: boolean
  metadata: Record<string, any>
}
export type StructType = {
  type: 'struct'
  fields: Array<StructField>
}
export type SparkSchema =
  | StringType
  | BooleanType
  | IntegerType
  | LongType
  | DoubleType
  | FloatType
  | ShortType
  | ByteType
  | BinaryType
  | DateType
  | TimestampType
  | DecimalType
  | StructType
  | ArrayType
  | MapType

/**
 * Note: annotations are merged such that all annotations from the narrowest type are preserved.
 * @param x
 */
const widen = (x: AST.AST): AST.AST => {
  switch (x._tag) {
    case 'Literal': {
      const typ = typeof x.literal
      switch (typ) {
        case 'bigint':
          return AST.annotations(AST.bigIntKeyword, x.annotations)
        case 'boolean':
          return AST.annotations(AST.booleanKeyword, x.annotations)
        case 'number':
          return AST.annotations(AST.numberKeyword, x.annotations)
        case 'string':
          return AST.annotations(AST.stringKeyword, x.annotations)
        case 'symbol':
          return AST.annotations(AST.symbolKeyword, x.annotations)
      }
      if (x.literal === null) {
        return x
      }
      throw new Error('Unhandled literal')
    }

    case 'UndefinedKeyword':
    case 'Declaration':
    case 'VoidKeyword':
    case 'NeverKeyword':
    case 'UnknownKeyword':
    case 'AnyKeyword':
    case 'StringKeyword':
    case 'NumberKeyword':
    case 'BooleanKeyword':
    case 'BigIntKeyword':
    case 'SymbolKeyword':
    case 'ObjectKeyword':
    case 'Enums':
      return x

    case 'UniqueSymbol':
    case 'TemplateLiteral':
      return AST.annotations(AST.stringKeyword, x.annotations)
    case 'Refinement':
      return AST.annotations(
        // note this is a recursive widen
        // stepping should not recurse in this function
        widen(x.from),
        x.annotations
      )
    case 'TupleType': {
      return new AST.TupleType(
        // @ts-expect-error TODO.
        x.elements.map((x) => ({
          type: widen(x.type),
          isOptional: x.isOptional,
        })),
        // todo.
        x.rest,
        x.isReadonly,
        x.annotations
      )
    }

    case 'TypeLiteral':
      return new AST.TypeLiteral(
        x.propertySignatures.map((x) => ({
          ...x,
          type: AST.annotations(widen(x.type), x.type.annotations),
          // maybe wrong?
        })) as unknown as ReadonlyArray<AST.PropertySignature>,
        x.indexSignatures.map((x) => ({
          ...x,
          type: AST.annotations(widen(x.type), x.type.annotations),
          // maybe wrong?
        })) as unknown as ReadonlyArray<AST.IndexSignature>,
        x.annotations
      )
    case 'Union':
      // todo. union w/ null -> null fast path?
      return AST.Union.make(
        x.types.map((x) => widen(x)),
        x.annotations
      )

    case 'Suspend':
    case 'Transformation':
      throw new Error('Not a type')
  }
  return x
}

const intersectsWithSelfAsGiven = new Set<AST.AST['_tag']>([
  'StringKeyword',
  'NumberKeyword',
  'BooleanKeyword',
  'BigIntKeyword',
  'SymbolKeyword',
  'ObjectKeyword',
  'AnyKeyword',
  'VoidKeyword',
  'UnknownKeyword',
  'NeverKeyword',
])

// null if no intersection
// basically performs assignment
export const intersect = (left: AST.AST, right: AST.AST): AST.AST | null => {
  if (left._tag === right._tag) {
    if (intersectsWithSelfAsGiven.has(left._tag)) {
      // merge annotations?
      return left
    }

    // both type literals
    if (AST.isTypeLiteral(left)) {
      try {
        const r = Object.values(
          R.omit(
            // @ts-ignore
            left.propertySignatures.map((x) => x.name),
            R.indexBy(
              // @ts-ignore
              R.prop('name'),
              (right as AST.TypeLiteral).propertySignatures
            )
          )
          // @ts-ignore
        ).map((x) => ({ ...x, isOptional: true }))
        return new AST.TypeLiteral(
          // @ts-expect-error TODO
          left.propertySignatures
            .map((leftProperty) => {
              const rightProperty = (
                right as AST.TypeLiteral
              ).propertySignatures.find((x) => x.name === leftProperty.name)
              if (!rightProperty) {
                return { ...leftProperty, isOptional: true }
              }
              const type = intersect(
                widen(leftProperty.type),
                widen(rightProperty.type)
              )
              // bail when any non-intersection
              if (type == null) {
                throw new Error('bail')
              }
              return new AST.PropertySignature(
                leftProperty.name,
                type,
                leftProperty.isOptional && rightProperty.isOptional,
                leftProperty.isReadonly && rightProperty.isReadonly,
                leftProperty.annotations
              )
            })
            .concat(r as any),
          left.indexSignatures, // todo.
          left.annotations
        )
      } catch (e) {
        return null
      }
    }

    // both arrays (or tuples)
    if (AST.isTupleType(left)) {
      try {
        // todo. handle "rest" elements
        const members = [
          ...left.elements,
          ...left.rest.map((x) => ({ type: x, isOptional: true })),
          ...(right as AST.TupleType).elements,
          ...(right as AST.TupleType).rest.map((x) => ({
            type: x,
            isOptional: true,
          })),
        ]
        const unified = members
          .filter((x) => !isNullOrUndefined(x.type))
          .reduce((a, b) => {
            const typ = intersect(widen(a.type), widen(b.type))
            if (typ) {
              return new AST.Element(typ, a.isOptional && b.isOptional)
            }
            throw new Error('bail')
          }) as AST.Element

        return new AST.TupleType(
          [unified],
          left.rest,
          left.isReadonly && (right as AST.TupleType).isReadonly,
          left.annotations
        )
      } catch (e) {
        return null
      }
    }

    // both unions
    if (AST.isUnion(left)) {
      try {
        const members = [...left.types, ...(right as AST.Union).types]
        return members
          .filter((x) => !isNullOrUndefined(x))
          .reduce((a, b) => {
            const typ = intersect(widen(a), widen(b))
            if (typ) {
              return typ
            }
            throw new Error('bail')
          })
      } catch (e) {
        return null
      }
    }
    return null
  }

  if ([left, right].some((a) => a._tag === 'Union')) {
    const idx = [left, right].findIndex((a) => a._tag === 'Union')
    const union = [left, right][idx] as AST.Union
    const nonUnion = [left, right][1 - idx]
    const members = union.types
      .concat([nonUnion])
      .filter((x) => !isNullOrUndefined(x))
    return members.reduce((a, b) => {
      const typ = intersect(widen(a), widen(b))
      if (typ) {
        return typ
      }
      throw new Error('bail')
    })
  }

  // will miss some cases but is fine for spark schema
  return null
}

const isNullOrUndefined = (x: AST.AST) =>
  AST.isUndefinedKeyword(x) || (AST.isLiteral(x) && x.literal === null)
// x._tag === 'UndefinedKeyword' || (x._tag === 'Literal' && x.literal === null)

const isDatetime = (x: AST.AST) =>
  R.path(['annotations', AST.JSONSchemaAnnotationId as any, 'format'], x) ===
  'date-time'

const isInteger = (x: AST.AST) =>
  // @ts-ignore
  x.annotations[Symbol.for('@effect/schema/annotation/Type')] === IntTypeId

const isRecord = (ast: AST.AST) =>
  AST.isTypeLiteral(ast) &&
  ast.propertySignatures.length === 0 &&
  ast.indexSignatures.length

export const sparkSchemaFor = <A, B, C>(
  schema: Schema<A, B, C>
): SparkSchema => {
  const go = (ast: AST.AST): SparkSchema | null => {
    const annotations = ast.annotations
    switch (ast._tag) {
      case 'Declaration':
        throw new Error('Unsupported: Declaration')
      case 'Literal': {
        const typ = typeof ast.literal
        if (typ === 'string') {
          return 'string'
        } else if (typ === 'bigint') {
          return 'long'
        } else if (ast.literal === null) {
          return null
        } else if (typ === 'boolean') {
          return 'boolean'
        } else if (typ === 'number') {
          return 'double'
        }
        throw new Error('Unhandled literal')
      }

      case 'AnyKeyword':
      case 'SymbolKeyword':
      case 'UniqueSymbol':
        return 'string'

      case 'UndefinedKeyword':
      case 'VoidKeyword':
      case 'UnknownKeyword':
      case 'NeverKeyword':
        return null

      case 'StringKeyword':
        return 'string'
      case 'NumberKeyword':
        return 'double'
      case 'BooleanKeyword':
        return 'boolean'
      case 'BigIntKeyword':
        return 'long'

      case 'ObjectKeyword':
        throw new Error("Don't use object")
      case 'TupleType': {
        try {
          const typ = [...ast.elements.map((x) => x.type), ...ast.rest].reduce(
            (a, b) => {
              const ok = intersect(widen(a), widen(b))
              if (ok) {
                return ok
              }
              throw new Error('bail')
            }
          )
          const t = go(typ)
          if (!t) {
            return null
            // throw new Error("no t")
          }
          return {
            ...annotations,
            type: 'array',
            elementType: t as SparkSchema,
            containsNull: false,
          }
        } catch (e) {
          console.log('cannot create intersection of array elements', ast)
          return null
        }
      }
      case 'TypeLiteral': {
        if (
          ast.indexSignatures.length <
          ast.indexSignatures.filter(
            (is) => is.parameter._tag === 'StringKeyword'
          ).length
        ) {
          // I think this is because Symbols
          // I expect those are handled ok but let's leave this here so if we ever encounter them we make sure we know about it :)
          throw new Error(`Cannot encode some index signature to Spark Schema`)
        }
        // todo. throw error when indexSignatures and propertySignatures at the same time as we don't
        // handle this well enough

        if (isRecord(ast)) {
          const valueType = ast.indexSignatures
            .map((x) => x.type)
            .reduce((a, b) => {
              const ok = intersect(widen(a), widen(b))
              if (ok) {
                return ok
              }
              throw new Error('No intersection found for map value type')
            })
          const valueSchema = go(valueType)
          if (!valueSchema) {
            throw new Error('No schema for map value type')
          }
          return {
            type: 'map',
            // Note: Hardcoding string key type
            // effect schema at present wants symbol or string or refinement that resolves to string,
            // Not sure what spark supports other than string.
            keyType: 'string',
            valueType: valueSchema,
            valueContainsNull: true,
          }
        }

        const propertySignatures = ast.propertySignatures.map((ps) =>
          go(ps.type)
        )

        const output: StructType = {
          ...annotations,
          type: 'struct',
          fields: [],
        }
        // ---------------------------------------------
        // handle property signatures
        // ---------------------------------------------
        for (let i = 0; i < propertySignatures.length; i++) {
          const name = ast.propertySignatures[i].name
          if (typeof name === 'string') {
            if (propertySignatures[i] !== null) {
              output.fields.push({
                type: propertySignatures[i] as SparkSchema,
                name: name,
                nullable: ast.propertySignatures[i].isOptional,
                metadata: {},
              })
            } else {
              console.warn('Omitting property signature, unparseable', {
                name,
                ast,
                v: propertySignatures[i],
              })
            }

            // handle optional property signatures
            // ---------------------------------------------
          } else {
            throw new Error(`Cannot encode ${String(name)} key to Spark Schema`)
          }
        }

        if (output.fields.length === 0) {
          return null //throw new Error('No fields in struct')
        }
        return output
      }

      case 'Union': {
        try {
          const typ = ast.types
            .filter(
              (x) =>
                // remove any null or undefined. The presence of either should be communicated to
                // parent container types (struct, array) so they can set nullability appropriately
                !isNullOrUndefined(x)
            )
            .reduce((a, b) => {
              const ok = intersect(widen(a), widen(b))
              if (ok) {
                return ok
              }
              throw new Error('bail')
            })
          return go(typ)
        } catch (e) {
          console.log('cannot create intersection of union members in', ast)
          return null
        }
      }

      case 'Enums': {
        if (ast.enums.every(([_, value]) => typeof value === 'string')) {
          return 'string'
        }
        return 'double'
      }

      case 'Refinement':
        // this stops further description of this value
        // that would be described by further recursive depth levels of Refinement
        if (isDatetime(ast)) {
          return 'timestamp'
        }
        if (isInteger(ast)) {
          return 'integer'
        }
        return go(ast.from)

      case 'Transformation':
        return go(ast.to)
    }
    throw new Error(`unhandled ${ast._tag}`)
  }

  const result = go(schema.ast)
  if (result === null) {
    throw new Error('null schema')
  }
  return result
}
