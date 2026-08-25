# Breaking-change detection

`diffToolSets(before, after)` compares two sets of canonical tools and classifies
every difference. It never calls a provider API and needs no network access.

The question it answers is narrow and practical:

> Would an argument object that was valid against the old schema still be valid
> against the new one, and would a caller written against the old schema still
> work?

It does not attempt general JSON Schema subsumption. When a change cannot be
classified with confidence, it is reported as **breaking** — a false "safe" is
the expensive mistake.

Both sides are `$ref`-resolved before anything is compared, so a change to how
the schema is *written* is never mistaken for a change to what it *accepts*.

## Classifications

- **breaking** — existing callers or existing valid arguments will stop working.
- **non-breaking** — the new schema accepts everything the old one did.
- **informational** — documentation or metadata changed; behaviour did not.

`schemaport diff` exits non-zero when breaking changes exist.

## Tool-level rules

| Code | Class | Trigger |
|---|---|---|
| `tool-removed` | breaking | A tool present before is gone |
| `tool-renamed` | breaking | A removed tool and an added tool have identical input schemas |
| `tool-added` | non-breaking | A new tool appeared |
| `tool-description-changed` | informational | Only the description differs |

Rename detection is a heuristic: identical `inputSchema` is treated as the same
tool under a new name. It is reported as breaking (callers use the old name), but
naming it a rename is more useful than reporting an unrelated removal plus
addition. When a rename is identified, the two tools are then diffed against each
other so any schema changes made at the same time are still reported.

## Property rules

| Code | Class | Trigger |
|---|---|---|
| `property-removed` | breaking | A declared property is gone |
| `required-property-added` | breaking | A new property was added to `required` |
| `property-made-required` | breaking | An existing optional property became required |
| `optional-property-added` | non-breaking | A new optional property |
| `property-made-optional` | non-breaking | A required property became optional |

## Type rules

| Code | Class | Trigger |
|---|---|---|
| `type-changed` | breaking | Types differ and neither is a superset |
| `type-narrowed` | breaking | The new type set is a strict subset, or a type was added where any type was accepted |
| `type-widened` | non-breaking | The new type set is a strict superset, e.g. `string` → `["string", "null"]` |

## Value rules

| Code | Class | Trigger |
|---|---|---|
| `enum-narrowed` | breaking | An enum value was removed |
| `enum-added` | breaking | An enum was introduced where any value was accepted |
| `enum-expanded` | non-breaking | An enum value was added |
| `enum-removed` | non-breaking | The enum constraint was dropped |
| `const-added` / `const-changed` | breaking | A fixed value was introduced or changed |
| `const-removed` | non-breaking | The fixed value requirement was dropped |

An enum that both gains and loses values produces both changes, so the breaking
half is never hidden by the safe half.

## Constraint rules

Applies to `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`,
`minLength`, `maxLength`, `minItems`, `maxItems`, `minProperties`,
`maxProperties`.

| Code | Class | Trigger |
|---|---|---|
| `constraint-added` | breaking | A bound was introduced |
| `constraint-narrowed` | breaking | A lower bound rose, or an upper bound fell |
| `constraint-relaxed` | non-breaking | A lower bound fell, or an upper bound rose |
| `constraint-removed` | non-breaking | A bound was dropped |
| `pattern-added` / `pattern-changed` | breaking | A regex was introduced or altered |
| `pattern-removed` | non-breaking | The regex was dropped |

`multipleOf` follows the same shape; any change other than removal is breaking,
because proving one divisor subsumes another is out of scope. `uniqueItems`
turning on is breaking; turning off is not.

## Structural rules

| Code | Class | Trigger |
|---|---|---|
| `additional-properties-restricted` | breaking | Extra properties stopped being accepted, or must now match a schema |
| `additional-properties-relaxed` | non-breaking | Extra properties started being accepted |
| `array-items-added` | breaking | An `items` schema was introduced |
| `array-items-removed` | non-breaking | The `items` schema was dropped |
| `nullable-removed` | breaking | `nullable` stopped being true |
| `nullable-added` | non-breaking | `nullable` became true |

Nested objects and array `items` are compared recursively, so
`inputSchema.properties.history.items.properties.note.type` is reported at full
depth.

## Reference rules

Because both sides are resolved first, pulling a repeated subschema out into
`$defs` and pointing at it with `$ref` — or inlining one that was there — is
correctly reported as **no change**. A real edit made behind a reference is
still reported, at the full path of the use site:

```
inputSchema.properties.value.properties.cents.minimum
```

Rename detection resolves too, so an inline/`$ref` refactor made at the same
time as a rename is still recognised as one tool under a new name.

A reference that could not be resolved is compared as a reference, because there
is nothing behind it to compare:

| Code | Class | Trigger |
|---|---|---|
| `ref-changed` | breaking | An unresolvable `$ref` now points somewhere else |
| `ref-added` | breaking | An unresolvable `$ref` replaced an inline schema |
| `ref-removed` | breaking | An inline schema replaced an unresolvable `$ref` |

All three are breaking for the same reason: a change across an opaque reference
cannot be proven safe.

Definition maps survive resolution only when something referencing them could
not be inlined — in practice, a recursive schema. Definitions present on **both**
sides are then compared under `inputSchema.$defs.<Name>`, so editing a recursive
definition is reported even though its use site is an opaque `$ref` on both
sides. A definition that appeared or vanished is not itself reported: if
anything still points at it, that surfaces as a dangling reference, and if
nothing does, it was never part of the tool's surface.

## Composition rules

| Code | Class | Trigger |
|---|---|---|
| `composition-added` | breaking | `anyOf`/`oneOf`/`allOf` introduced |
| `composition-narrowed` | breaking | Fewer values accepted than before |
| `composition-changed` | breaking | Branches changed in a way that cannot be proven safe |
| `composition-widened` | non-breaking | More values accepted than before |
| `composition-removed` | non-breaking | The composition constraint was dropped |

`allOf` is a conjunction, so adding a branch narrows rather than widens; that
inversion is handled explicitly. Branch comparison is structural equality, not
subsumption — reordering branches is recognised as equivalent, but a branch
edited in place counts as changed.

## Metadata rules

`description-changed`, `title-changed`, `default-changed`, `examples-changed` and
`format-changed` are all informational.

`format-changed` is informational because every target treats `format` as
advisory: no provider guarantees enforcement, so adding `format: "email"` does
not actually narrow what will be accepted. If you rely on format enforcement,
add an explicit `pattern` — which *is* classified.

## Determinism

Changes are sorted by tool name, then classification, then path, then code. The
same pair of inputs always produces byte-identical output.
