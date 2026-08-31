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

- **Same-document `$ref` is resolved first**, so a constraint that only exists
  behind a reference is genuinely checked. A reference that cannot be
  resolved — external, dangling, recursive — reports that the value could not
  be verified, and says why. It never silently passes.
- `if`/`then`/`else` and `dependentSchemas` are ignored.
- `format` is not enforced (providers treat it as advisory).

```
$.total.cents: -1 is below minimum 0.
$.root: contains `$ref` `#/$defs/Node`, which SchemaPort could not resolve;
        value not verified. `#/$defs/Node` is recursive (#/$defs/Node -> #/$defs/Node).
```

Everything around an unresolvable reference is still checked — one opaque
pointer does not make the whole value unverifiable.

Every "could not resolve" error carries `UNVERIFIED_MARKER`, which is exported
so a caller can tell *nothing was checked here* apart from *this value is
wrong*. `validateSchemaValues` uses it to stay silent about a `default` sitting
behind a reference it cannot follow.

## Schema self-consistency

`validateSchemaValues(schema, path)` checks that a schema's own literals satisfy
the schema declaring them. `validateCanonicalTool` runs it, so loading a tool
catches this:

```
`default` is 0, which its own schema rejects: value: 0 is below minimum 10.
  Path: inputSchema.properties.amount.default
```

Only `default` and `const` are checked, and only once the schema is otherwise
structurally sound — validating a literal against a malformed schema produces
errors about the malformation, reported at the wrong keyword. See
[canonical-tool-format.md](canonical-tool-format.md) for why `examples` is
excluded.

Errors are returned sorted, so results are deterministic.

## Reference resolution issues

`resolveSchemaRefs` reports its own issues, separately from `Diagnostic`. They
are not provider-specific and carry no `CompileAbility`, because nothing about
them depends on a target:

```ts
interface RefResolutionIssue {
  code: RefIssueCode; // 'dangling-ref'
  pointer: string;    // '#/$defs/Money'
  path: string;       // 'inputSchema.properties.total.$ref'
  message: string;
}
```

The codes are listed in
[the canonical tool format](canonical-tool-format.md#what-does-not-resolve).
Issues are sorted by path, then pointer, then code.
