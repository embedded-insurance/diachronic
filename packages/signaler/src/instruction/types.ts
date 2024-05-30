import * as S from '@effect/schema/Schema'
import { def } from '@diachronic/http/types'
import { Instruction } from '../types'

export const instruction = def({
  'diachronic.http': {
    method: 'POST',
    path: '/instruction',
    request: {
      type: 'json',
      body: Instruction,
    },
    response: {
      json: [
        { status: S.Literal(200), body: S.Any },
        { status: S.Literal(400), body: S.Any },
        { status: S.Literal(500), body: S.Any },
      ],
    },
  },
  name: 'instruction',
  error: S.Unknown,
  input: S.Unknown,
  output: S.Any,
})
