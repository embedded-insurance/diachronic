// Possible Spark Schema types
const full = {
  type: 'struct',
  fields: [
    {
      name: 'IntegerTypeField',
      type: 'integer',
      nullable: true,
      metadata: {},
    },
    {
      name: 'LongTypeField',
      type: 'long',
      nullable: true,
      metadata: {},
    },
    {
      name: 'DoubleTypeField',
      type: 'double',
      nullable: true,
      metadata: {},
    },
    {
      name: 'FloatTypeField',
      type: 'float',
      nullable: true,
      metadata: {},
    },
    {
      name: 'StringTypeField',
      type: 'string',
      nullable: true,
      metadata: {},
    },
    {
      name: 'BooleanTypeField',
      type: 'boolean',
      nullable: true,
      metadata: {},
    },
    {
      name: 'DateTypeField',
      type: 'date',
      nullable: true,
      metadata: {},
    },
    {
      name: 'TimestampTypeField',
      type: 'timestamp',
      nullable: true,
      metadata: {},
    },
    {
      name: 'BinaryTypeField',
      type: 'binary',
      nullable: true,
      metadata: {},
    },
    {
      name: 'ArrayTypeField',
      type: {
        type: 'array',
        elementType: 'string',
        containsNull: true,
      },
      nullable: true,
      metadata: {},
    },
    {
      name: 'MapTypeField',
      type: {
        type: 'map',
        keyType: 'string',
        valueType: 'integer',
        valueContainsNull: true,
      },
      nullable: true,
      metadata: {},
    },
    {
      name: 'StructTypeField',
      type: {
        type: 'struct',
        fields: [
          {
            name: 'NestedField',
            type: 'string',
            nullable: true,
            metadata: {},
          },
        ],
      },
      nullable: true,
      metadata: {},
    },
    {
      name: 'DecimalTypeField',
      type: 'decimal(10,5)',
      nullable: true,
      metadata: {},
    },
    {
      name: 'ShortTypeField',
      type: 'short',
      nullable: true,
      metadata: {},
    },
    {
      name: 'ByteTypeField',
      type: 'byte',
      nullable: true,
      metadata: {},
    },
  ],
}
