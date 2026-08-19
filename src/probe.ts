import type {
  CanonicalTool,
  CompileResult,
  ProbeErrorKind,
  ProbeResult,
  ProviderErrorDetail,
} from './types.js';
import { validateValue } from './validate-value.js';

interface BaseProbe {
  providerId: string;
  toolName: string;
}

/** Probing is not applicable for this target (for example MCP, which has no hosted API). */
export function probeSkipped(base: BaseProbe, reason: string): ProbeResult {
  return {
    ...base,
    status: 'skipped',
    schemaAccepted: false,
    toolCallReturned: false,
    notes: [reason],
  };
}

/** No API key was found. This is deliberately not a schema rejection. */
export function probeMissingCredentials(base: BaseProbe, envVar: string): ProbeResult {
  return {
    ...base,
    status: 'error',
    schemaAccepted: false,
    toolCallReturned: false,
    errorKind: 'missing-credentials',
    notes: [`No API key found. Set ${envVar} to probe this provider.`],
  };
}

/** The schema could not be compiled, so there was nothing safe to send. */
export function probeCompileRefused(base: BaseProbe, compileResult: CompileResult): ProbeResult {
  const reasons = compileResult.diagnostics
    .filter((item) => item.severity === 'error')
    .map((item) => item.message);
  return {
    ...base,
    status: 'error',
    schemaAccepted: false,
    toolCallReturned: false,
    errorKind: 'compile-refused',
    notes: [
      'Compilation was refused, so no request was sent.',
      ...(reasons.length > 0 ? reasons : ['See `schemaport check` for details.']),
    ],
  };
}

/** The provider rejected the tool definition itself. */
export function probeRejected(
  base: BaseProbe,
  model: string,
  providerError: ProviderErrorDetail,
): ProbeResult {
  return {
    ...base,
    status: 'rejected',
    model,
    schemaAccepted: false,
    toolCallReturned: false,
    providerError,
    notes: ['Schema rejected by the provider API.'],
  };
}

/** We never reached a verdict about the schema. */
export function probeError(
  base: BaseProbe,
  kind: ProbeErrorKind,
  providerError: ProviderErrorDetail,
  model?: string,
): ProbeResult {
  const result: ProbeResult = {
    ...base,
    status: 'error',
    schemaAccepted: false,
    toolCallReturned: false,
    errorKind: kind,
    providerError,
    notes: [PROBE_ERROR_NOTES[kind]],
  };
  if (model !== undefined) result.model = model;
  return result;
}

const PROBE_ERROR_NOTES: Record<ProbeErrorKind, string> = {
  'missing-credentials': 'No API key was available.',
  authentication: 'The provider rejected the API key. This is not a schema problem.',
  'model-not-found': 'The probe model does not exist or is not available to this key. This is not a schema problem.',
  'rate-limit': 'The provider rate-limited the probe. This is not a schema problem.',
  network: 'The request never reached the provider. This is not a schema problem.',
  'compile-refused': 'Compilation was refused, so nothing was sent.',
  unsupported: 'This provider does not support probing.',
  unknown: 'The probe failed for a reason SchemaPort could not classify.',
};

export interface ProbeAcceptedInput extends BaseProbe {
  model: string;
  /** Arguments the provider produced for the synthetic tool call, if any. */
  argumentsReceived?: unknown;
  /** The canonical tool, used to validate the returned arguments. */
  tool: CanonicalTool;
  notes?: string[];
}

/**
 * The provider accepted the schema. When a tool call came back, its arguments
 * are validated against the *canonical* input schema, so a provider that
 * silently ignored a constraint is visible instead of being reported as a pass.
 */
export function probeAccepted(input: ProbeAcceptedInput): ProbeResult {
  const result: ProbeResult = {
    providerId: input.providerId,
    toolName: input.toolName,
    status: 'accepted',
    model: input.model,
    schemaAccepted: true,
    toolCallReturned: input.argumentsReceived !== undefined,
    notes: ['Schema accepted by the provider API.', ...(input.notes ?? [])],
  };

  if (input.argumentsReceived === undefined) {
    result.notes.push('The model did not return a tool call, so argument shape was not verified.');
    return result;
  }

  const validation = validateValue(input.tool.inputSchema, input.argumentsReceived);
  result.argumentsReceived = input.argumentsReceived;
  result.argumentsValid = validation.valid;
  if (!validation.valid) result.argumentErrors = validation.errors;
  result.notes.push(
    validation.valid
      ? 'Tool call arguments matched the canonical input schema.'
      : 'Tool call arguments did NOT match the canonical input schema.',
  );
  return result;
}

/**
 * Classify a thrown provider SDK error using HTTP status and message shape.
 *
 * Returns `'rejected'` only for statuses that mean "the request body was
 * invalid". Everything else maps to a `ProbeErrorKind`, which keeps a stale
 * model id or an expired key from being reported as a bad schema.
 */
export function classifyProviderError(error: unknown): {
  kind: ProbeErrorKind | 'rejected';
  detail: ProviderErrorDetail;
} {
  const detail = toErrorDetail(error);
  const status = detail.status;
  const message = detail.message.toLowerCase();

  if (status === 401 || status === 403) return { kind: 'authentication', detail };
  if (status === 429) return { kind: 'rate-limit', detail };
  if (status === 404) return { kind: 'model-not-found', detail };
  if (status !== undefined && status >= 500) return { kind: 'network', detail };
  if (status === 400 || status === 422) {
    if (message.includes('model') && (message.includes('not found') || message.includes('does not exist'))) {
      return { kind: 'model-not-found', detail };
    }
    return { kind: 'rejected', detail };
  }
  if (status === undefined && isNetworkError(error, message)) return { kind: 'network', detail };
  return { kind: 'unknown', detail };
}

function isNetworkError(error: unknown, message: string): boolean {
  const code = typeof error === 'object' && error !== null ? String(Reflect.get(error, 'code') ?? '') : '';
  const name = error instanceof Error ? error.name : '';
  return (
    ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code) ||
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('timeout')
  );
}

/** Extract status/type/message from a provider SDK error without assuming its class. */
export function toErrorDetail(error: unknown): ProviderErrorDetail {
  if (typeof error !== 'object' || error === null) {
    return { message: String(error) };
  }

  const record = error as Record<string, unknown>;
  const status = firstNumber(record['status'], record['statusCode'], nested(record, 'error', 'code'));
  const type = firstString(nested(record, 'error', 'type'), record['type'], record['name']);
  const message =
    firstString(nested(record, 'error', 'message'), record['message']) ?? String(error);

  const detail: ProviderErrorDetail = { message };
  if (status !== undefined) detail.status = status;
  if (type !== undefined) detail.type = type;
  return detail;
}

function nested(record: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = record;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) if (typeof value === 'number') return value;
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

/**
 * The instruction sent to the model during a probe.
 *
 * Probe never executes the developer's function; it only asks the provider to
 * emit one syntactically valid call so the argument shape can be inspected.
 */
export function probePrompt(tool: CanonicalTool): string {
  return (
    `Call the \`${tool.name}\` tool exactly once using plausible placeholder values ` +
    'that satisfy every constraint in its schema. This is an automated schema ' +
    'compatibility check; the call will not be executed. Do not ask questions.'
  );
}

/** Resolve the probe model: explicit option, then environment override, then default. */
export function resolveProbeModel(
  explicit: string | undefined,
  envVar: string,
  fallback: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return explicit ?? env[envVar] ?? fallback;
}

/** Resolve an API key: explicit option first, then the provider's environment variable. */
export function resolveApiKey(
  explicit: string | undefined,
  envVar: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = explicit ?? env[envVar];
  return value !== undefined && value.length > 0 ? value : undefined;
}
