# Core concepts

SchemaPort exists because a tool schema that works on one provider does not
reliably work on another. The same JSON can be accepted by Anthropic, rejected by
OpenAI's strict mode, and accepted by Gemini only after a validation keyword is
quietly discarded. SchemaPort gives you one canonical schema and four honest
answers about it.

```
                 One canonical tool schema
                            |
        +---------+---------+---------+---------+
        |         |         |         |         |
      Check    Compile    Probe     Diff
```

## The four capabilities

**Check** is static and local. It runs each provider's compatibility rules
against your canonical schema and reports what is wrong, where, and whether
SchemaPort can compile around it. No network, no API keys.

**Compile** produces the provider-native tool definition for each target,
applying the minimum transformations required and recording every one of them in
a manifest. It refuses rather than silently weakening your schema.

**Probe** is the only capability that touches the network. It compiles the schema,
sends the smallest safe request to the real API, and reports whether the provider
currently accepts it. This is the answer to "the static rules might be out of
date" — provider behaviour changes, and Probe checks reality.

**Diff** compares two versions of your canonical schemas and classifies every
change as breaking, non-breaking or informational. It is the CI gate that stops a
new required property shipping without anyone noticing.

## Why check and compile are separate

`check` tells you what is true about your canonical schema. `compile` gives you
something you can send.

An `error` from `check` usually does not mean you are stuck — it means the
canonical schema cannot be handed to that provider *directly*. Most such errors
carry `compile.supported: true` and a `detail` explaining the fix. That is why
check output says things like:

```
✗ Optional property `amount` is not allowed in strict mode.
  Path: inputSchema.properties.amount
  SchemaPort can compile this as required and nullable.
```

The failure and the fix are reported together.

## Why the canonical schema is the reference for everything

Compiled output is derived, never authoritative. That has three consequences
worth knowing:

- **Diff compares canonical schemas**, not compiled ones. A provider-specific
  representation change is not a change to your contract.
- **Probe validates returned arguments against the canonical schema**, not the
  compiled one. A provider that accepted `minimum: 0` and then produced `-50`
  shows up as accepted-but-wrong-shape instead of a clean pass.
- **Generated output is disposable.** Commit it or generate it during a build —
  either works, because compiling the same canonical schema always produces
  byte-identical files.

## Determinism

Everything except live Probe requests is deterministic. Tools load sorted by
name; diagnostics, transformations and changes all sort by stable keys; manifests
contain no timestamps. Compiling twice produces byte-identical files, which is
what makes generated output safe to commit and review in a pull request.

## The honesty rules

Three rules run through the whole product:

1. **No silent weakening.** See [Safe and lossy compilation](safe-and-lossy-compilation.md).
2. **No invented guarantees.** Provider rules are implemented only where there is
   evidence in official documentation. Uncertain behaviour is a warning that says
   it is uncertain, never a clean pass.
3. **No fabricated results.** A missing API key, a stale model id and a network
   failure are reported as environment errors — never as a schema rejection.

## Where things live

| Package | Owns |
|---|---|
| `@schemaport/core` | Canonical format, loading, diagnostics, compile policy, diff |
| `@schemaport/provider-openai` | OpenAI rules, transformations, probing |
| `@schemaport/provider-anthropic` | Anthropic rules, transformations, probing |
| `@schemaport/provider-gemini` | Gemini rules, transformations, probing |
| `@schemaport/provider-mcp` | MCP rules, transformations, local validation |
| `schemaport` | The CLI: four commands, output formats, exit codes |

Provider rules live in provider packages so they can be updated and released as
providers change, without touching core or the CLI.
