# diachronic

> "Diachronic" refers to an approach or analysis that is concerned with the way in which something, especially language,
> has developed and evolved over time. It is often used in contrast with "synchronic," which refers to the analysis of a
> subject, such as a language, at a particular moment in time without considering historical context. In linguistics, a
> diachronic analysis would look at how languages change and evolve, examining historical and evolutionary aspects.
>
> -- _ChatGPT, personal communication, February 2024._

## Overview
Diachronic makes workflow nondeterminism a thing of the past.

### How it works
Workflows take their current state and pass it to the next version of the program. The new program receives it and continues where the old program left off, subject to a user-defined transformation.

Say, for some reason, you have a program that models a toaster. The toaster can be in one of two states, “on” or “off” — on when the timer is running and it’s plugged in, off otherwise. It also has a counter for number of toasts.

We can model this with the following state transition diagram:
off -> plugged-in -> on
off -> timer on -> on
on -> timer off? -> off
on -> unplug-it -> off

You deploy to prod. Toasters run around the world. And there was much rejoicing.

But there’s a bug. Simply because the toaster is plugged in doesn’t mean there’s power. This means need to change a workflow that has been modeling the live state of thousands of devices in a way that could break their history. 

You receive a new source of information for whether the toaster is receiving power. The units require at least 100v of current to warm bread. You revise the program accordingly:
off -> ~~plugged-in~~  power on (timer on?) -> on
off -> timer on (~~plugged-in?~~ power on?) -> on
on -> timer off -> off
on -> ~~unplug-it~~ power off -> off

These changes break with the past. Simply put, for the same sequence of events, the new program will not produce the same outcomes as the original.

We need something to help us manage this. 

Diachronic lets you transition the workflow’s behavior  and context to the next version of the workflow without stopping it, losing context, or running it over from the beginning.

Observe.

The new program dictates a “power” event sets variable “powered: true” when volts >= 100. Prior, an event of “plugged” set plugged in to true. We decide “plugged” -> “powered” is reasonable under the circumstances.

For all toasters that are plugged in, we map the prior plugged value to the new powered value via a migration function. After, new toastings will be subject to the new logic only, based on power only. All the while we honor the (powerless) toast count, as product has advised. If a timer is in progress in the old program, it will be transferred to the new program automatically.


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
