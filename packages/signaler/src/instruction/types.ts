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
        { status: S.literal(200), body: S.any },
        { status: S.literal(400), body: S.any },
        { status: S.literal(500), body: S.any },
      ],
    },
  },
  name: 'instruction',
  error: S.unknown,
  input: S.unknown,
  output: S.any,
})
