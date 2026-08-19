# Changelog

All notable changes to `@schemaport/core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-08-20

Initial release.

### Added

- **Canonical tool format.** `CanonicalTool` (`name`, `description`,
  `inputSchema`) with `validateCanonicalTool` and `isCanonicalTool`.
- **Schema loading.** `loadTools` reads a single `.json` file or a directory
  (recursively), accepting one tool per file, an array of tools, or
  `{ "tools": [...] }`. Malformed files are collected as errors instead of
  thrown, duplicate tool names are reported, and results are sorted by name so
  downstream output is deterministic.
- **Schema utilities.** `walkSchema` / `collectSchemas` for deterministic
  depth-first traversal, `joinPath` for readable dotted schema paths,
  `schemaTypes`, `isType`, `deepEqual`, `cloneSchema` and `stableStringify`.
- **Diagnostics.** `Diagnostic` with three severity levels, a stable namespaced
  `code`, a schema `path`, a `docsUrl`, and a `CompileAbility` stating whether
  compilation can work around the issue and at what cost. Helpers: `diagnostic`,
  `compilable`, `compilableLossy`, `notCompilable`, `sortDiagnostics`,
  `countBySeverity`, `hasBlockingErrors`.
- **Compilation policy.** `finalizeCompile` applies SchemaPort's lossy rule
  mechanically for every provider: compilation is refused when a transformation
  is `lossy` and the caller did not pass `allowLossy`, and when an error cannot
  be compiled around. Errors that compile resolved are dropped in favour of their
  transformation records; warnings always survive. Helpers: `transformation`,
  `isLossy`.
- **Value validation.** `validateValue` checks a JSON value against the supported
  JSON Schema subset. `$ref` is reported as unverifiable rather than silently
  passing.
- **Probe result helpers.** `probeAccepted`, `probeRejected`,
  `probeMissingCredentials`, `probeCompileRefused`, `probeError`, `probeSkipped`,
  plus `classifyProviderError`, `toErrorDetail`, `resolveApiKey`,
  `resolveProbeModel` and `probePrompt`. Missing credentials, stale model ids,
  rate limits and network failures are classified separately from schema
  rejections.
- **Diff engine.** `diffToolSets` and `diffTools` classify changes as breaking,
  non-breaking or informational, covering tool add/remove/rename, property
  add/remove/require, type changes, enum narrowing and expansion, numeric and
  string constraint changes, array and object structure changes, composition
  changes, and metadata changes. Unclassifiable changes are reported as breaking.
- **Provider adapter contract.** `SchemaPortProvider`, with `rulesReviewedAt` and
  `docs` so compatibility rules carry their own provenance.
- **Shared fixtures.** `refundOrderTool`, `minimalTool`, `nestedTool`,
  `openMapTool`, `unionTool`, `constraintTool`, `FIXTURE_TOOLS` and
  `INVALID_TOOL_VALUES`, so every provider package tests against the same inputs.
- Documentation covering the canonical format, core concepts, diagnostics, safe
  and lossy compilation, breaking-change rules, and the provider adapter
  contract.

### Known limitations

- `$ref` is never resolved; recursive schemas are unsupported.
- `if`/`then`/`else`, `dependentSchemas`, `patternProperties` and `not` are not
  evaluated.
- Diff performs structural comparison, not general JSON Schema subsumption.
  Changes it cannot classify with confidence are reported as breaking.

[0.1.0]: https://github.com/schemaport/core/releases/tag/v0.1.0
