import { pipe } from 'effect'
import * as S from '@effect/schema/Schema'

export const ISODateString = pipe(
  S.string,
  S.filter((s) => !Number.isNaN(new Date(s).getTime()) && s.endsWith('Z'), {
    jsonSchema: { format: 'date-time' },
    identifier: 'ISODateString',
    description: 'An ISO-8601 date string in UTC',
    examples: ['1970-01-01T00:00:00.000Z', '2023-09-06T17:19:28.287Z'],
    arbitrary: () => (fc) => fc.date().map((x) => x.toISOString()),
  })
)
export type ISODateString = S.Schema.To<typeof ISODateString>
