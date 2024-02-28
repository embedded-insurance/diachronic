## User manual

### Timers

Timers are recalculated based on XState delay functions.

When a workflow migrates:
If a delay function is specified in the migration function:

- the workflow will resume with the delay value you specify

If **no override for the timer is specified** in the migration function:

- delays are recomputed based on the time elapsed and timers are set when the workflow resumes based on this value

**This means if your delay computes a duration as `someFuturePointInTime - Date.now()` and not a fixed
value like `1h` you must recalculate your own delay in the migration function.**

This optimizes for the following:
```typescript
const myDelays = { 'the-delay': () => ms('1h') }

```

Diachronic records the time the delay starts. This lets us pick up where we left off when the
workflow resumes. For us, this has been sane default behavior -- everything just works without us having to think
about it. It may not be for you.

Diachronic also stores the event object that was passed to the timer function originally.
This event is available to you in the migration function so you could do something like:

```typescript
import { TimerData } from '@diachronic/migrate/src/interpreterport'
import { getDelayFunctionName } from '@diachronic/migrate/src/analysis'

const migrationFunction = (args: { context: any, timers: TimerData }) => {

  Object.values(args.timers).map(x => ({ 
    ...x,
    timerName: getDelayFunctionName(x), }))
}


```


For a case where you have a 
delay that 
computes itself based on the 
current time and a fixed point in the future 
from say context or an event:

Timers resume with their time elapsed calculated and subtracted from their desired duration. This means delays
run for their duration regardless of how long migration takes or any downtime.

It also means if the "fires at" time has passed when the new workflow is starting up, this timer will fire immediately.
The order is no special order we fire the timers in (mostly what xstate)

### Actors and activities

The framework waits for the state machine to exit any node with an `invoke` in it unless it is specifically marked
"interruptable".

This entails things like if the actor returns an error and you don't handle it by transitioning to a different state,
migration will not happen. If this happens to you, redeploying the current version of your code with an
annotation that allows migration from this state is unlikely to trigger
nondeterminism. As a best practice, handle invoke errors by transition the machine to a state that is migratory.

complete
before migrating unless they are
specifically 