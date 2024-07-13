# @diachronic/effect-schema-spark
> Generate Spark Schema from @effect/schema type definitions

## Overview
The package aims to be as permissive as possible. 

If a type can be translated from Effect Schema, the goal is to do it even if the type is very general with respect to the original.

Warnings are printed when types cannot be generated. Errors are thrown in only when a schema cannot be produced at all.

This is in part because Spark Schema is much less specific than Effect Schema, and because in our experience it is better to have some description of the data than none at all.
