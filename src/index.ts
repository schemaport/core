/**
 * `@schemaport/core`
 *
 * Provider-independent building blocks for SchemaPort. Provider packages and
 * the CLI depend on this package; it depends on none of them.
 */

export { SCHEMAPORT_VERSION } from './version.js';

export type {
  CanonicalTool,
  ChangeClassification,
  CompileAbility,
  CompileOptions,
  CompileResult,
  Diagnostic,
  DiagnosticSeverity,
  DiffResult,
  JsonSchema,
  LoadError,
  LoadResult,
  LoadedTool,
  ProbeErrorKind,
  ProbeOptions,
  ProbeResult,
  ProbeStatus,
  ProviderDocReference,
  ProviderErrorDetail,
  SchemaChange,
  SchemaPortProvider,
  Transformation,
} from './types.js';

export {
  MAX_REF_DEPTH,
  asSchema,
  cloneSchema,
  collectSchemas,
  compareStrings,
  deepEqual,
  isPlainObject,
  isType,
  joinPath,
  lookupRef,
  schemaTypes,
  stableStringify,
  walkSchema,
} from './schema.js';
export type { RefLookup, SchemaVisit, WalkOptions } from './schema.js';

export { hasRefs, resolveSchemaRefs, resolveToolRefs } from './resolve.js';
export type {
  RefIssueCode,
  RefResolutionIssue,
  ResolveOptions,
  ResolvedSchema,
} from './resolve.js';

export { displayPath, loadTools, toolFileBaseName } from './load.js';
export type { LoadOptions } from './load.js';

export { isCanonicalTool, validateCanonicalTool } from './validate-tool.js';
export { validateSchemaValues } from './validate-schema-values.js';
export type { ToolValidationIssue } from './validate-tool.js';

export {
  compilable,
  compilableLossy,
  countBySeverity,
  diagnostic,
  hasBlockingErrors,
  notCompilable,
  sortDiagnostics,
} from './diagnostics.js';
export type { DiagnosticInit, SeverityCounts } from './diagnostics.js';

export { finalizeCompile, isLossy, transformation } from './compile.js';
export type { FinalizeCompileInput } from './compile.js';

export { UNVERIFIED_MARKER, validateValue } from './validate-value.js';
export type { ValueValidationOptions, ValueValidationResult } from './validate-value.js';

export {
  classifyProviderError,
  probeAccepted,
  probeCompileRefused,
  probeError,
  probeMissingCredentials,
  probePrompt,
  probeRejected,
  probeSkipped,
  resolveApiKey,
  resolveProbeModel,
  toErrorDetail,
} from './probe.js';
export type { ProbeAcceptedInput } from './probe.js';

export { diffToolSets, diffTools, summarizeDiff } from './diff.js';
export type { DiffOptions } from './diff.js';
/** @deprecated Renamed to `summarizeDiff`. The old name still works. */
export { summarizeChanges } from './diff.js';

export {
  FIXTURE_TOOLS,
  INVALID_TOOL_VALUES,
  REF_FIXTURE_TOOLS,
  constraintTool,
  danglingRefTool,
  externalRefTool,
  minimalTool,
  nestedTool,
  openMapTool,
  recursiveTool,
  refDefsTool,
  refundOrderTool,
  unionTool,
} from './fixtures.js';
