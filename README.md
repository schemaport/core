# @schemaport/core

Provider-independent core for [SchemaPort](https://github.com/schemaport) — define an AI tool schema once, then use it safely across OpenAI, Anthropic, Gemini and MCP.

This package contains everything that is true regardless of provider: the canonical tool format, schema loading and validation, the diagnostic format, the compilation policy, and structural breaking-change detection. It has **no runtime dependencies** and never imports a provider package.

Most people should install the CLI instead:

```bash
npm install -g schemaport
```

Install this package directly only if you are embedding SchemaPort in your own tooling, or writing a provider adapter.

```bash
npm install @schemaport/core
```

## What is in here

| Area | Exports |
|---|---|
| Canonical format | `CanonicalTool`, `JsonSchema`, `validateCanonicalTool`, `isCanonicalTool` |
| Loading | `loadTools`, `toolFileBaseName`, `displayPath` |
| Schema utilities | `walkSchema`, `collectSchemas`, `joinPath`, `schemaTypes`, `deepEqual`, `stableStringify`, `lookupRef` |
| Reference resolution | `resolveSchemaRefs`, `resolveToolRefs`, `hasRefs`, `MAX_REF_DEPTH` |
| Diagnostics | `diagnostic`, `compilable`, `compilableLossy`, `notCompilable`, `sortDiagnostics`, `countBySeverity` |
| Compilation policy | `finalizeCompile`, `transformation`, `isLossy` |
| Probing | `probeAccepted`, `probeRejected`, `probeMissingCredentials`, `probeCompileRefused`, `probeError`, `probeSkipped`, `classifyProviderError`, `resolveApiKey`, `resolveProbeModel`, `probePrompt` |
| Value validation | `validateValue`, `validateSchemaValues` |
| Diff | `diffToolSets`, `diffTools`, `summarizeDiff`, `DiffOptions` (`summarizeChanges` is a deprecated alias) |
| Adapter contract | `SchemaPortProvider` |
| Shared fixtures | `refundOrderTool`, `nestedTool`, `openMapTool`, `unionTool`, `constraintTool`, `minimalTool`, `FIXTURE_TOOLS`, `INVALID_TOOL_VALUES` |
| Reference fixtures | `refDefsTool`, `recursiveTool`, `danglingRefTool`, `externalRefTool`, `REF_FIXTURE_TOOLS` |

## Quick example

```ts
import { loadTools, diffToolSets, validateValue } from '@schemaport/core';

const { tools, errors } = loadTools('./schemas');
if (errors.length > 0) throw new Error(errors[0].message);

const previous = loadTools('./schemas-v1').tools.map((entry) => entry.tool);
const current = tools.map((entry) => entry.tool);

const { changes, summary } = diffToolSets(previous, current);
console.log(`${summary.breaking} breaking changes`);

// Prose edits bury the changes that matter on a large tool set. Both entry
// points can drop them; `format`, `default` and `examples` are kept, because
// each can change what the model sends.
diffToolSets(previous, current, { ignoreDescriptions: true });

// Check a value against a canonical schema. Same-document `$ref` is resolved
// first, so a constraint that only exists behind a reference is really checked.
validateValue(current[0].inputSchema, { orderId: 'ord_1' });
```

## `$ref`

Same-document JSON Pointer references are resolved — `#/$defs/Money`,
`#/definitions/Money`, `#/properties/orderId`, `#/anyOf/0`, `#`, with RFC 6901
escaping. Everything in core resolves first, so `validateValue` validates
through a reference, and `diff` treats an inline subschema and an equivalent
`$ref` as the same contract rather than a breaking change.

```ts
import { resolveSchemaRefs } from '@schemaport/core';

const { schema, issues, resolvedCount } = resolveSchemaRefs(tool.inputSchema);
```

Keywords beside a `$ref` still apply, as JSON Schema 2020-12 requires:
annotations override the target, other assertions merge, and an assertion the
target also declares becomes an `allOf` branch so neither side is weakened.

What is *not* resolved is reported rather than passed over: external references,
dangling pointers, `$anchor` fragments, and chains deeper than `MAX_REF_DEPTH`
(64). **Recursive schemas remain unsupported** — the cycle is detected before
any expansion, named in full (`#/$defs/A -> #/$defs/B -> #/$defs/A`), and the
reference is left exactly as written. Core never emits a half-expanded schema.

See [the canonical tool format](docs/canonical-tool-format.md#references) for
the complete rules.

## Documentation

- [Canonical tool format](docs/canonical-tool-format.md) — the input format, what is supported, what is not
- [Core concepts](docs/core-concepts.md) — how check, compile, probe and diff fit together
- [Diagnostics](docs/diagnostics.md) — severity levels, the diagnostic shape, diagnostic codes
- [Safe and lossy compilation](docs/safe-and-lossy-compilation.md) — the rule that stops SchemaPort weakening your schema silently
- [Breaking changes](docs/breaking-changes.md) — exactly what diff classifies and how
- [Provider adapter contract](docs/provider-adapter-contract.md) — how to write a provider package

## Design constraints

- **`core` depends on nothing.** No runtime dependencies, no provider packages, no CLI concerns.
- **Deterministic.** No timestamps, no randomness. The same input always produces byte-identical output.
- **Honest over complete.** SchemaPort supports a practical subset of JSON Schema and says so, rather than pretending to handle every keyword. A `$ref` it cannot follow is reported, never resolved by guesswork.

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

## License

MIT
