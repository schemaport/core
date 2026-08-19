# Safe and lossy compilation

This is SchemaPort's most important rule, and the reason the product exists:

> **SchemaPort must never weaken your schema silently.**

A provider that accepts your schema *after quietly dropping `minimum`* has not
given you a working tool — it has given you a tool that will eventually be called
with a negative refund amount. SchemaPort's job is to make that visible before it
happens.

## Transformations

Every change `compile()` makes is recorded:

```ts
interface Transformation {
  code: string;    // 'converted-optional-property-to-nullable'
  path: string;    // 'inputSchema.properties.amount'
  detail: string;  // one line, human-readable
  lossy: boolean;  // the gate
}
```

Transformations end up in the compile manifest, so you can always inspect exactly
what SchemaPort did to your schema.

## The lossy classification

**`lossy: false` — a representation change.** The compiled schema expresses the
same contract in the shape the provider requires. No canonical constraint stops
being enforced.

Examples: renaming `inputSchema` to the provider's field name; adding
`additionalProperties: false` to a schema that was already closed in practice;
converting an optional property to required-and-nullable; normalizing type casing.

**`lossy: true` — a constraint-destroying change.** The compiled schema accepts
inputs your canonical schema rejects, because a keyword had to be dropped or
weakened for the target to accept it at all.

Examples: dropping `minimum` / `maximum` / `pattern` / `multipleOf` because the
target's schema dialect has no such field; erasing
`additionalProperties: { type: "string" }` into an untyped map; collapsing an
`anyOf` into an untyped value; truncating an `enum`.

The distinction is not about how much the JSON changed. It is about whether the
set of argument values the provider will accept grew beyond what your canonical
schema allows.

## The gate

Compilation is **refused** when any transformation is `lossy` and the caller did
not opt in:

```bash
# Refused, exit code 1, nothing written
schemaport compile ./schemas --targets gemini

# Explicitly accept the weaker output
schemaport compile ./schemas --targets gemini --allow-lossy
```

Provider adapters do not implement this refusal themselves. They mark
transformations and return through `finalizeCompile`, which applies the policy in
one place so all four providers draw the line identically:

```ts
import { finalizeCompile, transformation } from '@schemaport/core';

return finalizeCompile({
  providerId: 'gemini',
  tool,
  output: functionDeclaration,
  transformations,
  diagnostics: check(tool),
  options,
});
```

`finalizeCompile` also:

- refuses when a diagnostic is an `error` that compile cannot work around
  (`compile.supported === false`), regardless of `allowLossy`;
- drops `error` diagnostics that compile *did* work around, because the
  transformation record already describes them;
- always keeps `warning` and `info` diagnostics.

## Lossless is not the same as invisible

A `lossy: false` transformation can still change what the model emits at runtime.
The clearest case is OpenAI strict mode: an optional `amount` becomes required
and nullable, so the model sends `{"orderId": "ord_1", "amount": null}` instead of
`{"orderId": "ord_1"}`. No constraint was dropped — but your handler now has to
treat `null` as "not supplied".

So the rule has a second half: **a transformation that changes runtime behaviour
must produce a `warning` diagnostic**, and that warning survives into the compile
result and the manifest. "Compiled with zero warnings" is only ever printed when
the provider genuinely preserves the canonical contract.

## What this means in practice

| Situation | Result |
|---|---|
| Provider needs a different shape, same contract | Compiles. Transformation recorded. |
| Provider needs a different shape, runtime behaviour changes | Compiles. Transformation recorded **and** a warning. |
| Provider cannot express a constraint | Refused. Re-run with `--allow-lossy` to accept it. |
| Provider cannot express the schema at all | Refused. `--allow-lossy` does not help. |

The one thing that never happens is a schema quietly getting weaker.
