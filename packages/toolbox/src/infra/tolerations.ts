// import { Toleration } from '@ei-tech/k8s-core/v1/Toleration'
type Toleration = any

/**
 * Makes it so that pods can be scheduled on preemptible nodes.
 */
export const gkeSpotInstanceTolerations = [
  {
    key: 'cloud.google.com/gke-spot',
    operator: 'Equal',
    value: 'true',
    effect: 'NoSchedule',
  },
  {
    key: 'cloud.google.com/gke-spot',
    operator: 'Equal',
    value: 'true',
    effect: 'PreferNoSchedule',
  },
] as Toleration[]
