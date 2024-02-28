import * as S from '@effect/schema/Schema'

export const KubectlOpts = S.partial(
  S.struct({
    name: S.string,
    namespace: S.string,
    labels: S.partial(S.record(S.string, S.string)),
    extraFlags: S.string,
    allNamespaces: S.literal(true),
  })
)
export type KubectlOpts = S.Schema.To<typeof KubectlOpts>

export class NoDeploymentsFound extends S.TaggedError<NoDeploymentsFound>()(
  'NoDeploymentsFound',
  {
    message: S.string,
    data: S.record(S.string, S.any),
  }
) {}
