# Changelog

All notable changes to `@schemaport/core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`$ref` resolution.** `resolveSchemaRefs(schema, options?)` inlines every
  same-document JSON Pointer reference and reports every one it cannot follow.
  Handles `#/$defs/<name>`, `#/definitions/<name>`, general pointers such as
  `#/properties/orderId`, array positions such as `#/anyOf/0`, the root pointer
  `#`, and RFC 6901 escaping (`~1` to `/`, `~0` to `~`) with percent-decoding. A
  reference to a reference is followed through, up to `MAX_REF_DEPTH` (64).
  `resolveToolRefs(tool, options?)` does the same for a canonical tool, and
  `hasRefs(schema)` answers whether there is any work to do. Resolution is
  deterministic and never mutates its input.
- **`lookupRef(root, ref)`** resolves one pointer and classifies the failure —
  `external`, `anchor`, `malformed`, `missing` or `not-a-schema` — so adapters
  no longer need their own copy.
- **`walkSchema` / `collectSchemas` can follow references.** Opt in with
  `{ followRefs: true }`; a resolved target is visited as an extra child under
  the keyword `$ref`, with cycle protection and a depth limit. The default walk
  is unchanged, and stays that way.
- **Reference fixtures.** `refDefsTool`, `recursiveTool`, `danglingRefTool`,
  `externalRefTool` and `REF_FIXTURE_TOOLS`, kept out of `FIXTURE_TOOLS` because
  three of them are not meant to compile.

### Changed

- **`validateValue` resolves before validating.** A constraint that only exists
  behind a `$ref` is now genuinely enforced. A reference that cannot be
  resolved still reports the value as unverified — now naming the pointer and
  the reason, and still checking everything around it.
- **`validateCanonicalTool` rejects a reference nothing can follow.** External
  references, dangling pointers and malformed ones are structural errors, so
  `loadTools` refuses the file. Recursive references, `$anchor` fragments and
  over-deep chains are *not* errors: those schemas are well formed, and some
  targets accept them. `danglingRefTool` and `externalRefTool` joined
  `INVALID_TOOL_VALUES`.
- **`diff` resolves both sides first.** Replacing an inline subschema with an
  equivalent `$ref`, or inlining one, is now correctly reported as no change
  instead of a false breaking change. Rename detection resolves too. A real
  edit behind a reference is still reported at the full path of the use site.
- **`diff` compares definitions that survive resolution.** Editing a recursive
  definition is now reported under `inputSchema.$defs.<Name>`, where previously
  it produced no change at all because the use site is an opaque `$ref` on both
  sides.
- **`diff` compares an unresolvable `$ref`.** New `ref-added`, `ref-removed` and
  `ref-changed` changes, all breaking: a change across an opaque reference
  cannot be proven safe. Previously such a change was reported as no change.

### Sibling keywords

Keywords beside a `$ref` still apply, as JSON Schema 2020-12 requires.
Annotations (`title`, `description`, `default`, `examples`, `deprecated`,
`readOnly`, `writeOnly`, `$comment`, identifiers) override the target's, as the
more specific. An assertion the target does not declare is merged in. An
assertion the target *also* declares is kept as an `allOf` branch, so both
bounds survive — merging the sibling over the target would silently relax the
stricter one.

### Still unsupported

- **Recursive schemas.** A schema that refers to itself, directly or through a
  cycle, has no finite inlining. The cycle is now found *before* any expansion
  and reported in full (`#/$defs/A -> #/$defs/B -> #/$defs/A`), and the
  reference is left exactly as written — core never emits a half-expanded
  schema, and never hangs or overflows on one.
- **External references.** Core reads no files and makes no network requests.
- **`$anchor` fragments.** Core indexes JSON Pointers only.

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
  passing. (Superseded in Unreleased: references are now resolved.)
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

### Determinism

Every ordering helper compares strings by code point rather than with
`localeCompare`, which is locale- and ICU-sensitive. Identical inputs therefore
sort identically on every machine, which is what makes compiled output safe to
commit and review.

### Known limitations

- `$ref` is never resolved; recursive schemas are unsupported. (Resolved in
  Unreleased for same-document references; recursive schemas remain
  unsupported.)
- Boolean subschemas (`{"properties": {"x": true}}`) are rejected rather than
  silently skipped. `additionalProperties` still accepts a boolean.
- `CanonicalTool` describes tool *arguments* only. There is no `outputSchema`,
  so MCP's `outputSchema` and provider structured-output response schemas cannot
  be expressed or compiled.
- `if`/`then`/`else`, `dependentSchemas`, `patternProperties` and `not` are not
  evaluated.
- Diff performs structural comparison, not general JSON Schema subsumption.
  Changes it cannot classify with confidence are reported as breaking.

[Unreleased]: https://github.com/schemaport/core/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/schemaport/core/releases/tag/v0.1.0
