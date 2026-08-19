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

**References** — `$ref`, `$defs`, `definitions` are parsed and walked, but
**`$ref` is never resolved**. Anything that would require following a reference
reports that it could not be verified rather than passing silently. Recursive
schemas are therefore not supported.

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
- No `$ref` resolution, no recursive schemas, no `if`/`then`/`else`, no
  `dependentSchemas`, no `patternProperties`.
- No boolean subschemas, and no `outputSchema`. The canonical format describes a
  tool's *arguments* only. MCP's `outputSchema` and provider structured-output
  response schemas are out of scope for 0.1.0.

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
