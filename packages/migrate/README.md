# @diachronic/migrate

## Goals
- Create an XState state machine that can run inside a Temporal workflow indefinitely
- Make changes to durable function workflows with Temporal as easy as possible


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

### Migration function
The migration function takes the previous workflow's data and returns the new workflow data. It is defined as part of the new workflow code and deployed with the new workflow. 

You may not need a migration function for most deployments. Some cases where you will:

#### A state in the previous workflow doesn't exist in the new one. 
This will happen when you rename a state or remove it. 

#### You messed up the shape of the machine context. 
Suppose you save data to the workflow context in the wrong place and it got past the type checker and your tests. With your "normal" fix you can deploy a migration function that fixes it for all running workflows. Just write a function that takes the old context and returns it in the right shape. 

#### You want to recalculate a running timer based on arbitrary logic. 
You can return the timers the new machine will have as a function of the previous timers, context, and state. The framework will set them for you. 

If you want to cancel a timer, simply omit it from the return value of the migration function. 

Situations where a migration function is nice to have:

#### Arbitrary domain data changes. 
Perhaps you forgot to normalize email addresses to all lower case. You guessed it: You can deploy a migration function to fix this too. 

#### Database migrations. 
A workflow may be an entity workflow that writes part of its context to a database row whenever the context changes. 

You can update the database record on migration automatically by implementing the DbFns interface. These are just two functions: One takes the context and returns the value you want to write, the other writes it. 

The function is memoized so write is only called when the row data changes. 

### Migrate signal
Diachronic workflows migrate when they receive a migrate signal.

Mostly, there is nothing for you to do here except ensure the new version of your workflow is deployed on a separate Temporal task queue and send the signal. Tecnically, the first step is optional if your workflow can experience downtime -- your workflow will migrate to a task queue of your choosing and resume execution as soon as your new workflow is deployed. 

Typically, for a migration in production you will want to signal all old workflows in a batch, to remove the old worker once the migration is complete, and to ensure new workflows start on the latest version. Because it isn't practical for developers to perform these every time they want to deploy new code, the ci workflow in the ci package was written to automate this process. 
