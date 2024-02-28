import { DiachronicCloudEnvironment, Environment } from './environment'

const gcloudEnv = {
  development: 'gcloud-example-development',
  production: 'gcloud-example-production',
}

export const googleCloudLoggingLink = (args: {
  workflowName?: string
  versionId?: string
  environment: DiachronicCloudEnvironment
}) => {
  const project = gcloudEnv[args.environment]
  const data = {
    query: [
      args.workflowName
        ? `labels."k8s-pod/diachronic/workflow-name"="${args.workflowName}"`
        : '',
      args.versionId
        ? `labels."k8s-pod/diachronic/version-id"="${args.versionId}"`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  }
  // not working?
  // `summaryFields=spanId,trace:false:32:beginning` : ''
  const rest = [
    `cursorTimestamp=${new Date().toISOString()}`,
    `duration=PT1H?project=${project}`,
  ].join(';')
  return `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(
    data.query
  )}${rest ? ';' + rest : ''}`
}

const temporalUIBaseURL = (env: Environment) => {
  switch (env) {
    case 'development':
      return 'https://localhost:8082'
    case 'production':
      return 'https://localhost:8082'
    case 'local':
      return 'http://localhost:8082'
  }
}
const temporalNamespaceForEnvironment = (env: Environment) => {
  switch (env) {
    case 'development':
      return 'development'
    case 'production':
      return 'production'
    case 'local':
      return 'default'
  }
}
export const temporalUILink = (
  env: Environment,
  workflowName: string,
  workflowId?: string,
  runId?: string
) => {
  if (workflowId) {
    return `${temporalUIBaseURL(
      env
    )}/namespaces/${temporalNamespaceForEnvironment(
      env
    )}/workflows/${workflowId}${runId ? `/${runId}` : ''}`
  }
  return `${temporalUIBaseURL(
    env
  )}/namespaces/${temporalNamespaceForEnvironment(
    env
  )}/workflows?query=WorkflowType%3D%22${workflowName}%22`
}

export const githubCommitLink = (sha: string) => {
  return `https://github.com/embedded-insurance/diachronic/commit/${sha}`
}
