import { Console, Duration, Effect, Schedule } from 'effect'
import { pipe } from 'effect/Function'

export const withRetry = (args: { attempts: number }) =>
  Effect.retry(
    pipe(
      Schedule.intersect(
        Schedule.recurs(args.attempts - 1),
        Schedule.exponential('500 millis', 2)
      ),
      Schedule.tapInput((x) =>
        Console.log(
          // @ts-ignore
          x?.stderr
        )
      ),
      Schedule.tapOutput((x) => {
        if (x[0] === args.attempts - 1) {
          return Console.log(
            `Retries exhausted after ${args.attempts} attempts`
          )
        }
        return Console.log(
          `Attempt ${
            x[0] + 2 // +2 because the first attempt is the initial attempt and is zero indexed
          } of ${args.attempts}. Retrying in ${Duration.toMillis(x[1])}ms`
        )
      })
    )
  )
