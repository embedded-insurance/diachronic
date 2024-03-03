# @diachronic/ci

## Overview
- Automates workflow migration
- Start via GitHub deployment webhook events or manual signal
- Progressive traffic rollout via feature flag service (Unleash)
- Safe testing in production via custom traffic routing rules
- Automates cleanup of workflow Kubernetes deployments
- Full support for workflows that don't implement migration

## How it works
When a webhook service receives a GitHub event (deployment success), we start a CI workflow with a version id (the short sha of the commit) and the workflow's name. 

When a workflow deployment is successful, we create a feature flag in Unleash that includes the version id and a 0-indexed sequence id. 

If it's not the initial deployment, the ci workflow uses the feature flag service as a database to obtain the previous version by decrementing the current sequence number.

Because there is no previous version, an initial deployment has no migration, progressive rollout, or worker cleanup. 

All other deployments of migration-cabable workfloes will progress though the following stages:
1 & 2:
Concurrently, we spawn child workflow processes for rollout and migration. 

The rollout workflow increases the traffic sent to the new version on a schedule. 

The migration workflow sends migration signals to old workflows based on the traffic routing feature flag.

Together with the signaler service that starts workflows via feature flag, this provides:
1. gradual rollout of workflows starting on the new version of code
2. gradual migration of workflows on the old version of code to the new

If at any time during a migration the feature flag rollout percentage is changed (via UI or API) the rollout workflow identifies the inconsistency and cancels itself. This provides a safeguard in the event of unexpected errors during migration and a way to fast forward the rollout schedule.

The migration workflow runs until all old workflows have been told to migrate exactly once. After signaling all old workflows, it waits until all have migrated (0 running on the old task queue). At this point it removes the old worker deployment and archives the feature flag for the old version. 

When rollout and migrate workflows are complete, the parent ci workflow for the deployment exits. 

CI automated deployments run one at a time and have no queue. One can easily be implemented if needed.

## Dark deploy
A dark deployment waits to route live traffic. This is useful for testing in production. We provide a route rule isTest that lets developers, QA or automated tests run on the latest version before any live traffic. When acceptance criteria is met you can signal the ci workflow to continue the rollout and migration per normal. 

## Nonmigratory workflow support
The CI workflow supports workflows that do not implement Diachronic's migration pattern. For short running workflows this is often unnecessary. Waiting for current workflows to end won't take a year. 

Even in this case you won't want deploy a new version of code that introduces nondeterminism. One way to eliminate that possibility is immutable task queues. 

Since Diachronic already uses immutable task queues for ci/cd with migration we support a mode where we simply skip the migration step but perform all other steps you probably want (feature flag creation, progressive rollout and cleanup of old workers, and support for dark deploy). 

In this case we spawn a cleanup workflow separate from migration that polls on a longer interval to check whether it's ok to remove the old worker. 


ci process configuration matrix

- rollout + migrate + cleanup - ci process completes when rollout and migrate processes exit. this blocks concurrent rollout. 
- rollout + cleanup - ci process completes when rollout exits. cleanup is a background process independent of future rollouts

