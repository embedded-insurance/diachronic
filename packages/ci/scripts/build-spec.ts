export const buildSpec = [
  {
    type: 'workflow' as const,
    name: 'workflowCI',
    ignoreModules: ['@temporalio/client', 'events', 'fs', 'child_process'],
  },
  {
    type: 'activities' as const,
    name: 'workflowCI',
  },
]
