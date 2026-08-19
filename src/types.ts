/**
 * Shared types for SchemaPort.
 *
 * Everything here is provider-independent. Provider packages import these
 * types; core never imports a provider package.
 */

/**
 * A JSON Schema fragment.
 *
 * SchemaPort treats schemas as plain JSON. The named keywords below are the
 * subset SchemaPort understands; the index signature keeps unknown keywords
 * readable and round-trippable instead of silently dropping them.
 */
export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  examples?: unknown[];
  enum?: unknown[];
  const?: unknown;
  format?: string;

  // objects
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  minProperties?: number;
  maxProperties?: number;

  // arrays
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;

  // numbers
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;

  // strings
  minLength?: number;
  maxLength?: number;
  pattern?: string;

  // composition
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;

  // references
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;

  /** OpenAPI 3.0 style nullability, used by some providers. */
  nullable?: boolean;

  [keyword: string]: unknown;
}

/** A tool definition in SchemaPort's canonical format. */
export interface CanonicalTool {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * - `error`   The provider will reject the schema, or SchemaPort cannot
 *             preserve its meaning without explicit permission.
 * - `warning` The schema is usable, but the provider represents or enforces
 *             part of it differently.
 * - `info`    Worth knowing; nothing changes.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/** What `compile()` will do about a diagnostic. */
export interface CompileAbility {
  /** Whether compile() can produce a usable provider schema despite this issue. */
  supported: boolean;
  /**
   * Whether the fix drops or weakens a constraint expressed in the canonical
   * schema. Lossy transformations are refused unless the caller opts in.
   */
  lossy: boolean;
  /** One line describing what compile() does, e.g. "Emits `amount` as required and nullable." */
  detail: string;
}

export interface Diagnostic {
  /** Provider adapter id, e.g. `openai`. */
  providerId: string;
  toolName: string;
  severity: DiagnosticSeverity;
  /** Stable machine-readable code, e.g. `openai/strict-optional-property`. */
  code: string;
  /** Short human explanation of the incompatibility. */
  message: string;
  /** Dotted path into the canonical tool, e.g. `inputSchema.properties.amount`. */
  path: string;
  compile: CompileAbility;
  /** Official documentation backing this rule. */
  docsUrl?: string;
}

/* -------------------------------------------------------------------------- */
/* Compilation                                                                 */
/* -------------------------------------------------------------------------- */

/** A single change compile() made to the canonical schema. */
export interface Transformation {
  /** Stable machine-readable code, e.g. `converted-optional-property-to-nullable`. */
  code: string;
  /** Dotted path into the canonical tool. */
  path: string;
  /** One line describing the change. */
  detail: string;
  /**
   * `true` when the transformation drops or weakens a constraint from the
   * canonical schema. See `docs/safe-and-lossy-compilation.md`.
   */
  lossy: boolean;
}

export interface CompileOptions {
  /** Permit lossy transformations. Without this, compile() refuses them. */
  allowLossy?: boolean;
}

export interface CompileResult {
  providerId: string;
  toolName: string;
  /** `false` when compilation was refused; `output` is then absent. */
  ok: boolean;
  /** The provider-native tool definition, ready to send to the provider API. */
  output?: unknown;
  transformations: Transformation[];
  /** Warnings kept from check(), plus any blocking error explaining `ok: false`. */
  diagnostics: Diagnostic[];
}

/* -------------------------------------------------------------------------- */
/* Probing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * - `accepted` The provider accepted the compiled tool definition.
 * - `rejected` The provider rejected the schema itself.
 * - `error`    We never got a verdict (missing key, network, bad model, ...).
 * - `skipped`  Probing is not applicable, e.g. MCP has no hosted API.
 */
export type ProbeStatus = 'accepted' | 'rejected' | 'error' | 'skipped';

/**
 * Why a probe produced no verdict. These are deliberately distinct from a real
 * schema rejection so the CLI never reports a stale model id as a bad schema.
 */
export type ProbeErrorKind =
  | 'missing-credentials'
  | 'authentication'
  | 'model-not-found'
  | 'rate-limit'
  | 'network'
  | 'compile-refused'
  | 'unsupported'
  | 'unknown';

export interface ProbeOptions {
  /** Overrides the provider's API-key environment variable. */
  apiKey?: string;
  /** Overrides the provider's default probe model. */
  model?: string;
  allowLossy?: boolean;
  timeoutMs?: number;
  /**
   * Test seam: a pre-constructed provider SDK client. When supplied, the
   * adapter must not construct its own client or read the environment.
   */
  client?: unknown;
}

export interface ProviderErrorDetail {
  /** The provider's own error message, unmodified. */
  message: string;
  status?: number;
  type?: string;
}

export interface ProbeResult {
  providerId: string;
  toolName: string;
  status: ProbeStatus;
  /** The model actually used for the probe request. */
  model?: string;
  /** Whether the provider accepted the tool definition. */
  schemaAccepted: boolean;
  /** Whether the provider returned a tool call we could inspect. */
  toolCallReturned: boolean;
  /** Whether returned arguments validated against the canonical input schema. */
  argumentsValid?: boolean;
  argumentErrors?: string[];
  argumentsReceived?: unknown;
  /** The provider's original error, when it rejected the request. */
  providerError?: ProviderErrorDetail;
  errorKind?: ProbeErrorKind;
  /** Human-readable lines the CLI prints under the result. */
  notes: string[];
}

/* -------------------------------------------------------------------------- */
/* Provider adapter contract                                                   */
/* -------------------------------------------------------------------------- */

export interface ProviderDocReference {
  title: string;
  url: string;
}

/**
 * The contract every provider package implements.
 *
 * Adapters know nothing about the CLI: no printing, no process exit, no file
 * system. The CLI knows nothing about provider compatibility rules.
 */
export interface SchemaPortProvider {
  /** Stable target id used on the command line, e.g. `openai`. */
  readonly id: string;
  readonly displayName: string;
  /** ISO date (YYYY-MM-DD) the rules were last reviewed against official docs. */
  readonly rulesReviewedAt: string;
  /** Official documentation the rules are derived from. */
  readonly docs: readonly ProviderDocReference[];
  /** Environment variable read by probe(), when probing is supported. */
  readonly apiKeyEnvVar?: string;

  check(tool: CanonicalTool): Diagnostic[];
  compile(tool: CanonicalTool, options?: CompileOptions): CompileResult;
  probe?(tool: CanonicalTool, options?: ProbeOptions): Promise<ProbeResult>;
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

export interface LoadedTool {
  tool: CanonicalTool;
  /** Path the tool was read from, as given by the caller. */
  sourcePath: string;
}

export interface LoadError {
  sourcePath: string;
  message: string;
  /** Location inside the file, when known. */
  path?: string;
}

export interface LoadResult {
  tools: LoadedTool[];
  errors: LoadError[];
}

/* -------------------------------------------------------------------------- */
/* Diff                                                                        */
/* -------------------------------------------------------------------------- */

export type ChangeClassification = 'breaking' | 'non-breaking' | 'informational';

export interface SchemaChange {
  classification: ChangeClassification;
  /** Stable machine-readable code, e.g. `property-removed`. */
  code: string;
  toolName: string;
  /** Dotted path into the canonical tool. */
  path: string;
  message: string;
  before?: unknown;
  after?: unknown;
}

export interface DiffResult {
  changes: SchemaChange[];
  summary: {
    breaking: number;
    nonBreaking: number;
    informational: number;
  };
}
