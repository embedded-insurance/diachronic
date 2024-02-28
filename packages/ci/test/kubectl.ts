import { parseOpts } from '../src/activities/kubectl'

test('get query with and labels', () => {
  const { labelsFilter, allNamespaces, name, extraFlags, namespaceFilter } =
    parseOpts({
      labels: {
        'diachronic/workflow-name': 'workflowName',
        'diachronic/version-id': 'versionId',
      },
      allNamespaces: true,
    })
  const result = [
    name,
    namespaceFilter,
    labelsFilter,
    allNamespaces,
    extraFlags,
  ]
    .filter(Boolean)
    .join(' ')
  expect(result).toEqual(
    '-l diachronic/workflow-name=workflowName,diachronic/version-id=versionId -A'
  )
})
