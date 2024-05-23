# diachronic

> "Diachronic" refers to an approach or analysis that is concerned with the way in which something, especially language,
> has developed and evolved over time. It is often used in contrast with "synchronic," which refers to the analysis of a
> subject, such as a language, at a particular moment in time without considering historical context. In linguistics, a
> diachronic analysis would look at how languages change and evolve, examining historical and evolutionary aspects.
>
> -- _ChatGPT, personal communication, February 2024._

## Overview
Diachronic lets you change your workflow's behavior without losing context or current state.

### How it works
Diachronic workflows accumulate data in a simple in-memory variable, called "context". They track the current logical step, or "state", that the workflow is in, as well as all running timers.

When a new workflow is deployed, old workflows are told to continue on the new version. The new workflow starts and runs a user-supplied migration function that can map the old workflow's data to the new version if needed. The new workflow then resumes the application logic. 

### Example

Say you have a simple workflow that models a toaster. The toaster can be in one of two states-- "on" when the timer is running and it’s plugged in, "off" otherwise. It also has a counter that accumulates the number of toasts it's made. 

You model this with the following state transition diagram:
off -> plugged-in -> on
off -> timer on -> on
on -> timer off? -> off
on -> unplug-it -> off

You write the workflow and deploy to prod. 

But there’s a bug: Just because the toaster is plugged in doesn’t mean there’s power. You need to fix the workflow to reflect this, requiring you depart from its history. 

You receive a new event for when the toaster is receiving power and are informed it takes at least 100v for it to function properly. You revise the state diagram:
off -> ~~plugged-in~~  power on (timer on?) -> on
off -> timer on (~~plugged-in?~~ power on?) -> on
on -> timer off -> off
on -> ~~unplug-it~~ power off -> off

These changes break with the past: For the same sequence of events, the new program will not produce the same outcomes as the original.

We need to solve this. 

We decide changing the context variable from “plugged-in” -> “powered” is a reasonable translation. We want our new workflow to receive a “power” event that sets “powered: true” when volts >= 100. Previously, the “plugged-in” event set "plugged-in" to true. 

We can evolve our context this way with a workflow migration function. In this case we simply map the old “plugged-in” value to the new ”powered” value. 

The migration function runs inside the new workflow when it takes over for the old workflow. Along with our context transformation, we specify all active timers should transition from the old workflow to the new one, and that the workflow should resume in the same place it left off.

You deploy to prod. Everything works. And there was much rejocing. 

## Technical Implementation
Diachronic was written for use with several assumptions: namely, TypeScript, Effect, and XState. 

None are needed to implement a diachronic workflow. 

If you are interested in an alternative implementation, don't hesitate to reach out to the authors. 

Additional implementation details are available in the (@diachronic/migrate)[https://github.com/embedded-insurance/diachronic/tree/main/packages/migrate] package. 


## Background

Durable programs play through a recording of what's happened to determine what happens next.

This provides solutions to core issues in distributed computing while also giving software powerful new abilities.

Durable programs can continue from where they left off on another machine, model a long-lived process while consuming
minimal compute resources, or reset back to a previous step.

The catch is this only works for one version of a program.

Diachronic solves this.


## Status

Diachronic is used in production at Embedded Insurance.

We are working to open source the project and continue to develop the open source version.
