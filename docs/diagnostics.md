# Diagnostics

A `Diagnostic` is SchemaPort's unit of "here is something you should know about
this tool on this provider". `check()` returns them; `compile()` carries the
relevant ones through into its result and the manifest.

```ts
interface Diagnostic {
  providerId: string;      // 'openai'
  toolName: string;        // 'refund_order'
  severity: 'error' | 'warning' | 'info';
  code: string;            // 'openai/strict-optional-property'
  message: string;         // one short human explanation
  path: string;            // 'inputSchema.properties.amount'
  compile: CompileAbility; // what compile() will do about it
  docsUrl?: string;        // the official page the rule came from
}
```

## Severity levels

**`error`** — the provider will reject this schema as written, **or** compiling it
requires a lossy transformation. An error does not necessarily mean you are
stuck: check `compile.supported`.

**`warning`** — the schema is usable, but the provider represents or enforces part
of it differently. This is where "your optional property will arrive as `null`"
and "this constraint is accepted but not promised to be enforced" live.

**`info`** — worth knowing, nothing changes.

`schemaport check` exits non-zero when any `error` is present (configurable with
`--fail-on`). That is intentional: an `error` means the canonical schema cannot
be handed to that provider directly. The fix is usually `schemaport compile`, and
the diagnostic says so.

## `compile`: what happens next

Every diagnostic states what compilation will do about it. This is what lets
`check` answer "can SchemaPort fix this for me?" rather than just complaining.

```ts
interface CompileAbility {
  supported: boolean; // can compile() produce usable output despite this?
  lossy: boolean;     // does the fix drop or weaken a canonical constraint?
  detail: string;     // "Emits `amount` as required and nullable."
}
```

Three helpers build these:

| Helper | Meaning | Effect on compile |
|---|---|---|
| `compilable(detail)` | Fixable, nothing lost | Compiles normally |
| `compilableLossy(detail)` | Fixable, but a constraint is dropped | Refused unless `--allow-lossy` |
| `notCompilable(detail)` | No safe representation exists | Always refused |

## Diagnostic codes

Codes are stable, machine-readable, and namespaced by the adapter that raised
them: `<providerId>/<kebab-case-rule>`.

```
openai/strict-optional-property
gemini/unsupported-keyword
mcp/input-schema-not-object
core/lossy-transformation-refused
```

`core/` codes come from core itself. There is currently one:
`core/lossy-transformation-refused`, added by `finalizeCompile` when compilation
is refused because a transformation would weaken the schema.

Codes are part of the public interface — filter on them in CI, not on message
text. Messages are written for humans and may be reworded.

## Ordering

`sortDiagnostics` orders by severity, then path, then code. Provider adapters and
the CLI use it so identical inputs always produce identically ordered output.

## Value validation

`validateValue(schema, value)` checks a JSON value against a canonical schema. It
backs the Probe question *"did the provider actually produce arguments matching
the canonical shape?"* — which is how SchemaPort catches a provider that accepted
a constraint and then ignored it.

It implements the supported subset only, and is explicit about its gaps:

- **`$ref` is not resolved.** A schema containing `$ref` reports that the value
  could not be verified — it never silently passes.
- `not`, `if`/`then`/`else` and `dependentSchemas` are ignored.
- `format` is not enforced (providers treat it as advisory).

Errors are returned sorted, so results are deterministic.
