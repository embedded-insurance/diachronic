# @diachronic/ci

## Overview
- Automates workflow migration
- Start via GitHub deployment webhook events or manual signal
- Progressive traffic rollout via feature flag service (Unleash)
- Safe testing in production via custom traffic routing rules
- Automates cleanup of workflow Kubernetes deployments
- Full support for workflows that don't implement migration



ci process configuration matrix

- rollout + migrate + cleanup - ci process completes when rollout and migrate processes exit. this blocks concurrent rollout. 
- rollout + cleanup - ci process completes when rollout exits. cleanup is a background process independent of future rollouts

