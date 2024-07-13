# @diachronic/effect-schema-spark

> Generate Apache Spark schema from `@effect/schema` type definitions

## Usage

```ts
import * as S from '@effect/schema/Schema'
import { sparkSchemaFor } from '@diachronic/effect-schema-spark'

const GetUserActivityOutput = S.Struct({
  id: S.Int,
  name: S.String,
  roles: S.optional(S.Array(S.String)),
})

sparkSchemaFor(GetUserActivityOutput)

//  {
//       "type": "struct",
//       "fields": [
//         {
//           "type": "string",
//           "name": "name",
//           "nullable": false,
//           "metadata": {}
//         },
//         {
//           "type": "integer",
//           "name": "id",
//           "nullable": false,
//           "metadata": {}
//         },
//         {
//           "type": {
//             "type": "array",
//             "elementType": "string",
//             "containsNull": false
//           },
//           "name": "roles",
//           "nullable": true,
//           "metadata": {}
//         }
//       ]
//     }
```

## Usage in Spark
If you have CDC hooked up to Temporal (see https://github.com/embedded-insurance/diachronic/tree/main/packages/cdc) you can easily derive schemas for all types used in Temporal workflows (signals, activity input/output/error, workflow input/output/error).


```python
get_user_output = """{
      "type": "struct",
      "fields": [
        {
          "type": "string",
          "name": "name",
          "nullable": false,
          "metadata": {}
        },
        {
          "type": "integer",
          "name": "id",
          "nullable": false,
          "metadata": {}
        },
        {
          "type": {
            "type": "array",
            "elementType": "string",
            "containsNull": false
          },
          "name": "roles",
          "nullable": true,
          "metadata": {}
        }
      ]
    }"""

schemas = {'getUser': {'output': get_user_output}}

from pyspark.sql.functions import *

df = (
    spark.table("temporal.activities")
    .where(col("activity_type") == 'getUser')
    .withColumn("output", from_json("output", schemas['getUser']['output']))
)

```

## Overview

The package aims to be as permissive as possible.

If a type can be translated from Effect Schema, the goal is to do it even if the type is very general with respect to
the original.

Warnings are printed when types cannot be generated. Errors are thrown in only when a schema cannot be produced at all.

This is in part because Spark Schema is much less specific than Effect Schema, and because in our experience it is
better to have some description of the data than none at all.
