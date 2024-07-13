import * as S from '@effect/schema/Schema'
import { intersect, sparkSchemaFor } from '../src'

test('unify union', () => {
  expect(sparkSchemaFor(S.Union(S.Literal('a'), S.Literal('b')))).toEqual(
    'string'
  )
  expect(
    sparkSchemaFor(
      S.Union(
        S.Struct({ type: S.Literal('a') }),
        S.Struct({ type: S.Literal('b') })
      )
    )
  ).toEqual({
    type: 'struct',
    fields: [{ name: 'type', type: 'string', nullable: false, metadata: {} }],
  })
})

test('failures', () => {
  expect(() => sparkSchemaFor(S.Union(S.Array(S.Boolean), S.Boolean))).toThrow()
  expect(() => sparkSchemaFor(S.Undefined)).toThrow()
  expect(() => sparkSchemaFor(S.Null)).toThrow()
})

test('complex effect schema type', () => {
  const simpleSchema = S.Struct({
    type: S.Literal('a'),
    arr: S.Array(S.Number),
    payload: S.extend(
      S.Struct({
        orNullOrUndefined: S.Union(S.String, S.Null, S.Undefined),
        req: S.String,
      }),
      S.partial(S.Struct({ opt: S.String }))
    ),
  })
  expect(sparkSchemaFor(simpleSchema)).toEqual({
    fields: [
      {
        metadata: {},
        name: 'type',
        nullable: false,
        type: 'string',
      },
      {
        metadata: {},
        name: 'arr',
        nullable: false,
        type: {
          containsNull: false,
          elementType: 'double',
          type: 'array',
        },
      },
      {
        metadata: {},
        name: 'payload',
        nullable: false,
        type: {
          fields: [
            {
              metadata: {},
              name: 'req',
              nullable: false,
              type: 'string',
            },
            {
              metadata: {},
              name: 'orNullOrUndefined',
              // fixme. true
              nullable: false,
              type: 'string',
            },
            {
              metadata: {},
              name: 'opt',
              nullable: true,
              type: 'string',
            },
          ],
          type: 'struct',
        },
      },
    ],
    type: 'struct',
  })
})

test('record type', () => {
  expect(sparkSchemaFor(S.Record(S.String, S.Number))).toEqual({
    keyType: 'string',
    type: 'map',
    valueContainsNull: true,
    valueType: 'double',
  })
})

test('discriminated union', () => {
  const ActionA = S.Struct({
    actionType: S.Literal('a'),
    actionAProp: S.String,
  })
  const ActionB = S.Struct({
    actionType: S.Literal('b'),
    actionBProp: S.Struct({
      some: S.String,
      props: S.String,
    }),
  })
  const ActionC = S.Struct({
    actionType: S.Literal('c'),
    actionCProp: S.String,
  })
  const Action = S.Union(ActionA, ActionB, ActionC)
  const Actions = S.Struct({
    actions: S.Array(Action),
  })

  expect(
    Object.fromEntries(
      Object.entries({
        ActionA,
        ActionB,
        ActionC,
        Action,
        Actions,
      }).map(([k, v]) => [
        k,
        sparkSchemaFor(
          // @ts-expect-error "annotations" is incompatible?
          v
        ),
      ])
    )
  ).toEqual({
    Action: {
      fields: [
        {
          metadata: {},
          name: 'actionType',
          nullable: false,
          type: 'string',
        },
        {
          metadata: {},
          name: 'actionAProp',
          nullable: true,
          type: 'string',
        },
        {
          metadata: {},
          name: 'actionCProp',
          nullable: true,
          type: 'string',
        },
        {
          metadata: {},
          name: 'actionBProp',
          nullable: true,
          type: {
            fields: [
              {
                metadata: {},
                name: 'some',
                nullable: false,
                type: 'string',
              },
              {
                metadata: {},
                name: 'props',
                nullable: false,
                type: 'string',
              },
            ],
            type: 'struct',
          },
        },
      ],
      type: 'struct',
    },
    ActionA: {
      fields: [
        {
          metadata: {},
          name: 'actionType',
          nullable: false,
          type: 'string',
        },
        {
          metadata: {},
          name: 'actionAProp',
          nullable: false,
          type: 'string',
        },
      ],
      type: 'struct',
    },
    ActionB: {
      fields: [
        {
          metadata: {},
          name: 'actionType',
          nullable: false,
          type: 'string',
        },
        {
          metadata: {},
          name: 'actionBProp',
          nullable: false,
          type: {
            fields: [
              {
                metadata: {},
                name: 'some',
                nullable: false,
                type: 'string',
              },
              {
                metadata: {},
                name: 'props',
                nullable: false,
                type: 'string',
              },
            ],
            type: 'struct',
          },
        },
      ],
      type: 'struct',
    },
    ActionC: {
      fields: [
        {
          metadata: {},
          name: 'actionType',
          nullable: false,
          type: 'string',
        },
        {
          metadata: {},
          name: 'actionCProp',
          nullable: false,
          type: 'string',
        },
      ],
      type: 'struct',
    },
    Actions: {
      fields: [
        {
          metadata: {},
          name: 'actions',
          nullable: false,
          type: {
            containsNull: false,
            elementType: {
              fields: [
                {
                  metadata: {},
                  name: 'actionType',
                  nullable: false,
                  type: 'string',
                },
                {
                  metadata: {},
                  name: 'actionAProp',
                  nullable: true,
                  type: 'string',
                },
                {
                  metadata: {},
                  name: 'actionCProp',
                  nullable: true,
                  type: 'string',
                },
                {
                  metadata: {},
                  name: 'actionBProp',
                  nullable: true,
                  type: {
                    fields: [
                      {
                        metadata: {},
                        name: 'some',
                        nullable: false,
                        type: 'string',
                      },
                      {
                        metadata: {},
                        name: 'props',
                        nullable: false,
                        type: 'string',
                      },
                    ],
                    type: 'struct',
                  },
                },
              ],
              type: 'struct',
            },
            type: 'array',
          },
        },
      ],
      type: 'struct',
    },
  })
})

test('empty struct', () => {
  expect(() => sparkSchemaFor(S.Struct({}))).toThrow(new Error('null schema'))
})

test('impossible union intersections', () => {
  expect(() =>
    sparkSchemaFor(
      S.Struct({
        impossible: S.Union(S.Number, S.String),
        impossible2: S.Union(S.String, S.Literal(42)),
      })
    )
  ).toThrow(new Error('null schema'))

  expect(() =>
    sparkSchemaFor(
      S.Union(
        S.Struct({
          impossible: S.Union(S.Number, S.String),
        }),
        S.Struct({
          impossible2: S.Union(S.String, S.Literal(42)),
        })
      )
    )
  ).toThrow(new Error('null schema'))

  expect(() =>
    sparkSchemaFor(
      S.Union(
        S.Struct({
          impossible: S.Struct({ nested: S.Union(S.Number, S.String) }),
        }),
        S.Struct({
          impossible2: S.Union(S.String, S.Literal(42)),
        })
      )
    )
  ).toThrow(new Error('null schema'))

  expect(
    sparkSchemaFor(
      S.Union(
        S.Struct({
          impossible: S.Union(S.Number, S.String),
        }),
        S.Struct({
          ok: S.String,
        })
      )
    )
  ).toEqual({
    fields: [
      {
        metadata: {},
        name: 'ok',
        nullable: true,
        type: 'string',
      },
    ],
    type: 'struct',
  })
})

test('optional with default', () => {
  expect(
    sparkSchemaFor(
      S.Struct({
        foo: S.optional(S.Number, { exact: true, default: () => 42 }),
      })
    )
  ).toEqual({
    fields: [
      {
        metadata: {},
        name: 'foo',
        nullable: false,
        type: 'double',
      },
    ],
    type: 'struct',
    // todo. don't need this
    [Symbol.for('@effect/schema/annotation/Title')]: 'Struct (Type side)',
  })
})

test('intersect with null literal', () => {
  expect(
    intersect(S.Union(S.String, S.Null).ast, S.Union(S.String, S.Null).ast)
  ).toEqual({
    _tag: 'StringKeyword',
    annotations: {
      [Symbol.for('@effect/schema/annotation/Title')]: 'string',
      [Symbol.for('@effect/schema/annotation/Description')]: 'a string',
    },
  })
})

test('intersect simple type with union of assignable type and null|undefined', () => {
  expect(intersect(S.String.ast, S.Union(S.String, S.Null).ast)).toEqual({
    _tag: 'StringKeyword',
    annotations: {
      [Symbol.for('@effect/schema/annotation/Title')]: 'string',
      [Symbol.for('@effect/schema/annotation/Description')]: 'a string',
    },
  })
  expect(intersect(S.Union(S.String, S.Null).ast, S.String.ast)).toEqual({
    _tag: 'StringKeyword',
    annotations: {
      [Symbol.for('@effect/schema/annotation/Title')]: 'string',
      [Symbol.for('@effect/schema/annotation/Description')]: 'a string',
    },
  })

  expect(intersect(S.String.ast, S.Union(S.String, S.Undefined).ast)).toEqual({
    _tag: 'StringKeyword',
    annotations: {
      [Symbol.for('@effect/schema/annotation/Title')]: 'string',
      [Symbol.for('@effect/schema/annotation/Description')]: 'a string',
    },
  })

  expect(intersect(S.Union(S.String, S.Undefined).ast, S.String.ast)).toEqual({
    _tag: 'StringKeyword',
    annotations: {
      [Symbol.for('@effect/schema/annotation/Title')]: 'string',
      [Symbol.for('@effect/schema/annotation/Description')]: 'a string',
    },
  })
})
