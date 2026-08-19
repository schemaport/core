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
| Schema utilities | `walkSchema`, `collectSchemas`, `joinPath`, `schemaTypes`, `deepEqual`, `stableStringify` |
| Diagnostics | `diagnostic`, `compilable`, `compilableLossy`, `notCompilable`, `sortDiagnostics`, `countBySeverity` |
| Compilation policy | `finalizeCompile`, `transformation`, `isLossy` |
| Probing | `probeAccepted`, `probeRejected`, `probeMissingCredentials`, `probeCompileRefused`, `probeError`, `probeSkipped`, `classifyProviderError`, `resolveApiKey`, `resolveProbeModel`, `probePrompt` |
| Value validation | `validateValue` |
| Diff | `diffToolSets`, `diffTools`, `summarizeChanges` |
| Adapter contract | `SchemaPortProvider` |
| Shared fixtures | `refundOrderTool`, `nestedTool`, `openMapTool`, `unionTool`, `constraintTool`, `minimalTool`, `FIXTURE_TOOLS`, `INVALID_TOOL_VALUES` |

## Quick example

```ts
import { loadTools, diffToolSets, validateValue } from '@schemaport/core';

const { tools, errors } = loadTools('./schemas');
if (errors.length > 0) throw new Error(errors[0].message);

const previous = loadTools('./schemas-v1').tools.map((entry) => entry.tool);
const current = tools.map((entry) => entry.tool);

const { changes, summary } = diffToolSets(previous, current);
console.log(`${summary.breaking} breaking changes`);

// Check a value against a canonical schema
validateValue(current[0].inputSchema, { orderId: 'ord_1' });
```

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
- **Honest over complete.** SchemaPort supports a practical subset of JSON Schema and says so, rather than pretending to handle every keyword.

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

## License

MIT
