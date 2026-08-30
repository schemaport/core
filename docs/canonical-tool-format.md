# The canonical tool format

SchemaPort has one input format. Every provider adapter reads it; nothing else is
accepted. It is deliberately close to what most tool-calling APIs already use, so
adopting SchemaPort rarely means rewriting anything.

## Shape

```json
{
  "name": "refund_order",
  "description": "Refunds all or part of an order",
  "inputSchema": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string", "description": "The order to refund" },
      "amount": { "type": "number", "minimum": 0 }
    },
    "required": ["orderId"]
  }
}
```

| Field | Required | Rules |
|---|---|---|
| `name` | yes | Non-empty string, no whitespace, at most 128 characters. Provider packages apply their own stricter naming rules on top. |
| `description` | no | String. |
| `inputSchema` | yes | A JSON Schema object that must declare `"type": "object"`. |

`inputSchema` must be an object schema because tool arguments are always a named
set. A tool taking a bare string is not expressible, and no target supports it.

## Source files

`loadTools(path)` accepts a single `.json` file or a directory. Directories are
searched recursively; `node_modules`, `dist`, `coverage` and dot-directories are
skipped.

A `.json` file may contain any of:

```json
{ "name": "one_tool", "inputSchema": { "type": "object", "properties": {} } }
```
```json
[ { "name": "first", ... }, { "name": "second", ... } ]
```
```json
{ "tools": [ { "name": "first", ... } ] }
```

Loading never throws on bad input. Malformed files are collected into
`result.errors` so one broken file does not hide the rest of the directory.
Tools come back sorted by name, which is what makes every downstream output
deterministic regardless of file-system ordering.

Duplicate tool names across files are reported as errors — the compiled output
directory is keyed by tool name, so duplicates would silently overwrite.

Because the walk is recursive, this rule applies to the whole tree under the path
you pass. A layout that keeps two versions of the same tool side by side, such as

```
examples/refund-order/v1/refund-order.json
examples/refund-order/v2/refund-order.json
```

can be loaded as `.../v1` or `.../v2` — and diffed against each other — but not as
`examples/refund-order`, which would see `refund_order` declared twice. Keep
version directories as siblings and point commands at one of them.

## Supported JSON Schema

SchemaPort targets the common cases well rather than implementing all of JSON
Schema. The keywords below are understood by the loader, the walker, `diff`, and
`validateValue`. Whether a given keyword *survives compilation* is a separate,
per-provider question — see each provider package's documentation.

**Types** — `object`, `array`, `string`, `number`, `integer`, `boolean`, `null`,
and type unions such as `["string", "null"]`.

**Objects** — `properties`, `required`, `additionalProperties` (boolean or
schema), `minProperties`, `maxProperties`.

**Arrays** — `items`, `prefixItems`, `minItems`, `maxItems`, `uniqueItems`.

**Numbers** — `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`,
`multipleOf`.

**Strings** — `minLength`, `maxLength`, `pattern`.

**Values** — `enum`, `const`, `default`, `examples`.

**Composition** — `anyOf`, `oneOf`, `allOf`, `not` (walked, but `not` is not
evaluated by `validateValue`).

**Metadata** — `title`, `description`, `format`.

**References** — `$ref`, `$defs`, `definitions`. **Same-document `$ref` is
resolved**: see [References](#references) below for exactly what is followed and
what is not.

**Boolean subschemas are rejected.** JSON Schema permits `{"properties": {"x": true}}`
and `{"items": false}`, but SchemaPort's canonical format does not accept them.
The schema walker only descends into objects, so a boolean would be skipped
silently and the property could disappear from compiled output with no
diagnostic. Loading fails with a clear message instead. Use `{}` to accept any
value, or omit the entry to disallow it. `additionalProperties` is exempt — a
boolean is its normal form there.

Unknown keywords are preserved in the loaded schema rather than stripped, so
nothing is silently lost before a provider adapter sees it.

## Deliberate non-goals

- No custom schema language. Canonical schemas are plain JSON Schema.
- No Zod, Pydantic, TypeBox or OpenAPI source adapters in 0.1.0. The JSON
  workflow works first; source adapters can be added cleanly on top later.
- No external `$ref` resolution: core reads no files and makes no network
  requests, so a reference into another document is reported, not fetched.
- No recursive schemas. The cycle is detected and named; it is never inlined.
- No `if`/`then`/`else`, no `dependentSchemas`, no `patternProperties`.
- No boolean subschemas, and no `outputSchema`. The canonical format describes a
  tool's *arguments* only. MCP's `outputSchema` and provider structured-output
  response schemas are out of scope for 0.1.0.

## References

`resolveSchemaRefs(schema)` inlines every same-document `$ref`, and everything
in core runs it first — `validateValue` validates *through* a reference,
`validateCanonicalTool` reports one that cannot be followed, and `diff` compares
resolved schemas so an inline subschema and an equivalent `$ref` are the same
contract.

```ts
import { resolveSchemaRefs } from '@schemaport/core';

const { schema, issues, resolvedCount } = resolveSchemaRefs(tool.inputSchema);
```

### What resolves

JSON Pointer fragments against the document root:

```
#/$defs/Money            a 2020-12 definition
#/definitions/Money      a draft-07 definition
#/properties/orderId     any location in the document
#/anyOf/0                array positions included
#                        the document root
```

Segments are percent-decoded and then unescaped, `~1` to `/` and `~0` to `~`, as
RFC 6901 requires — so `#/$defs/a~1b` names the definition `a/b`. A reference to
a reference is followed through, up to a chain 64 deep (`MAX_REF_DEPTH`).

References are inlined **at their use site**. Definitions are a library, not
part of the schema being described, so the resolver does not go hunting inside
`$defs` for work: a definition nothing points at is left alone, and a definition
reached from a use site is reported once, where it is used. Once every reference
has resolved, the definition maps are dropped — nothing can point at them any
more, and removing them is what makes an inlined schema compare equal to its
`$ref` form.

### What does not resolve

Each of these leaves the `$ref` exactly as written and reports it. Nothing is
ever passed over in silence, and nothing is ever half-expanded.

| Code | Meaning |
|---|---|
| `external-ref` | Does not start with `#`. Core reads no files and makes no network requests. |
| `dangling-ref` | The pointer targets nothing, or targets something that is not a schema object. |
| `invalid-ref` | `$ref` is not a string, or a percent-escape in it cannot be decoded. |
| `anchor-ref` | A plain-name fragment such as `#money`. Core indexes JSON Pointers, not `$anchor`. |
| `recursive-ref` | The reference sits on, or reaches, a cycle. |
| `ref-depth-exceeded` | The chain is more than `MAX_REF_DEPTH` (64) references deep. |

`external-ref`, `dangling-ref` and `invalid-ref` are also **structural errors**:
`validateCanonicalTool` rejects them, so `loadTools` refuses the file. A
reference nothing can follow is a defect in the document.

The other three are not. `anchor-ref` and `ref-depth-exceeded` are limits of the
resolver rather than mistakes by the author, and a recursive schema is well
formed — some targets accept one. They load, and they are reported everywhere
resolution matters.

### Recursion

**Recursive schemas are still unsupported**, and this is the one place the
feature stops. A schema that refers to itself, directly or through a cycle, has
no finite inlining, so SchemaPort does not attempt one.

What it does instead is find the cycle *before* expanding anything, so the
reference is left exactly as written rather than expanded once and abandoned:

```
`#/$defs/Node` is recursive (#/$defs/Node -> #/$defs/Node).
`#/$defs/Entry` reaches a recursive definition (#/$defs/Node -> #/$defs/Node).
```

Mutual recursion is reported the same way, with the whole loop named:
`#/$defs/A -> #/$defs/B -> #/$defs/A`. Downstream, `validateValue` reports the
value as unverified and repeats the cycle, and `diff` compares the definition
where it is declared rather than pretending it can see through the reference.

### Sibling keywords

JSON Schema 2020-12 says keywords beside a `$ref` still apply, on top of the
reference. Inlining must therefore never drop or loosen either side. Three cases:

1. **Annotation** — `title`, `description`, `default`, `examples`, `deprecated`,
   `readOnly`, `writeOnly`, `$comment` and the identifier keywords. The local
   one is the more specific, so it overrides the target's.
2. **An assertion the target does not declare** — merged in directly, which is
   exactly the conjunction.
3. **An assertion the target also declares** — kept as an `allOf` branch, the
   only faithful way to say *and also*.

```json
{ "$ref": "#/$defs/Name", "minLength": 3 }
```

against `{"type": "string", "minLength": 5}` resolves to:

```json
{ "type": "string", "minLength": 5, "allOf": [{ "minLength": 3 }] }
```

Both bounds survive, so the effective minimum is still 5. Merging the sibling
over the target would have quietly relaxed it to 3, which is exactly the silent
weakening SchemaPort refuses to do. A sibling repeating the target verbatim is
recognised and does not produce a branch.

### Walking through references

`walkSchema` and `collectSchemas` do not follow references by default, and that
default will not change — every existing caller depends on a purely syntactic
walk. Opt in per call:

```ts
collectSchemas(tool.inputSchema, 'inputSchema', { followRefs: true });
```

A resolved target is then visited as an extra child of the schema carrying the
reference, with the keyword `$ref` and the path `<referring path>.$ref`. A
reference already being followed on the current branch is not followed again, so
a recursive schema terminates. Pass `refRoot` when the walk starts partway down
a document.

## Schema paths

Every diagnostic, transformation and change carries a dotted path built by
`joinPath`, so you can find the exact keyword being discussed:

```
inputSchema.properties.amount.minimum
inputSchema.properties.history.items.properties.note
inputSchema.anyOf[1]
inputSchema.properties["order id"]
```

Plain identifiers use dots, array positions use `[0]`, and anything else is
bracketed and JSON-quoted.
