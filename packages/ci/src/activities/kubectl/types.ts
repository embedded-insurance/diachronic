import * as S from '@effect/schema/Schema'

export const KubectlOpts = S.partial(
  S.Struct({
    name: S.String,
    namespace: S.String,
    labels: S.partial(S.Record(S.String, S.String)),
    extraFlags: S.String,
    allNamespaces: S.Literal(true),
  })
)
export type KubectlOpts = S.Schema.Type<typeof KubectlOpts>

export class NoDeploymentsFound extends S.TaggedError<NoDeploymentsFound>()(
  'NoDeploymentsFound',
  {
    message: S.String,
    data: S.Record(S.String, S.Any),
  }
) {}
