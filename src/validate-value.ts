import type { JsonSchema } from './types.js';
import { asSchema, isPlainObject, schemaTypes } from './schema.js';
import { hasRefs, resolveSchemaRefs } from './resolve.js';

export interface ValueValidationResult {
  valid: boolean;
  /** Human-readable messages, one per failed constraint, sorted for determinism. */
  errors: string[];
}

/**
 * Validate a JSON value against the subset of JSON Schema SchemaPort supports.
 *
 * This exists so Probe can answer "did the provider produce arguments matching
 * the canonical shape?" without pulling in a full validator. It is deliberately
 * small and its limitations are documented in `docs/diagnostics.md`:
 *
 *  - Same-document `$ref` is resolved first, so a reference is validated
 *    through. A reference that cannot be resolved — external, dangling or
 *    recursive — is reported as unverifiable, with the reason, rather than
 *    silently passing.
 *  - `not`, `if`/`then`/`else`, and `dependentSchemas` are ignored.
 *  - `format` is not enforced.
 */
export function validateValue(schema: JsonSchema, value: unknown, path = '$'): ValueValidationResult {
  if (!hasRefs(schema)) return runValidation(schema, value, path, EMPTY_REASONS);

  const resolved = resolveSchemaRefs(schema);
  const reasons = new Map<string, string>();
  for (const issue of resolved.issues) {
    if (!reasons.has(issue.pointer)) reasons.set(issue.pointer, issue.message);
  }
  return runValidation(resolved.schema, value, path, reasons);
}

/** Reasons a `$ref` was left unresolved, keyed by the pointer itself. */
type RefReasons = ReadonlyMap<string, string>;

const EMPTY_REASONS: RefReasons = new Map();

function runValidation(
  schema: JsonSchema,
  value: unknown,
  path: string,
  reasons: RefReasons,
): ValueValidationResult {
  const errors: string[] = [];
  validateInto(schema, value, path, { errors, reasons });
  errors.sort();
  return { valid: errors.length === 0, errors };
}

/** Carried through validation so an unresolved `$ref` can state why it is one. */
interface ValidationContext {
  errors: string[];
  reasons: RefReasons;
}

function validateInto(
  schema: JsonSchema,
  value: unknown,
  path: string,
  context: ValidationContext,
): void {
  const { errors } = context;

  if (typeof schema.$ref === 'string') {
    const reason = context.reasons.get(schema.$ref);
    errors.push(
      `${path}: contains \`$ref\` \`${schema.$ref}\`, which SchemaPort could not resolve; value not verified.` +
        (reason === undefined ? '' : ` ${reason}`),
    );
    return;
  }

  const types = schemaTypes(schema);
  if (types.length > 0 && !types.some((type) => matchesType(type, value))) {
    errors.push(`${path}: expected type ${types.join(' | ')}, received ${describe(value)}.`);
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((option) => sameJson(option, value))) {
    errors.push(`${path}: value is not one of the allowed enum values.`);
  }

  if (schema.const !== undefined && !sameJson(schema.const, value)) {
    errors.push(`${path}: value does not equal the required const.`);
  }

  if (typeof value === 'number') validateNumber(schema, value, path, errors);
  if (typeof value === 'string') validateString(schema, value, path, errors);
  if (Array.isArray(value)) validateArray(schema, value, path, context);
  if (isPlainObject(value)) validateObject(schema, value, path, context);

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      const sub = asSchema(branch);
      if (sub) validateInto(sub, value, path, context);
    }
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const matched = schema.anyOf.some((branch) => {
      const sub = asSchema(branch);
      return sub ? runValidation(sub, value, path, context.reasons).valid : false;
    });
    if (!matched) errors.push(`${path}: value does not match any \`anyOf\` branch.`);
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const matches = schema.oneOf.filter((branch) => {
      const sub = asSchema(branch);
      return sub ? runValidation(sub, value, path, context.reasons).valid : false;
    }).length;
    if (matches !== 1) {
      errors.push(`${path}: value matched ${matches} \`oneOf\` branches, expected exactly 1.`);
    }
  }
}

function validateNumber(schema: JsonSchema, value: number, path: string, errors: string[]): void {
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    errors.push(`${path}: ${value} is below minimum ${schema.minimum}.`);
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    errors.push(`${path}: ${value} is above maximum ${schema.maximum}.`);
  }
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
    errors.push(`${path}: ${value} must be greater than ${schema.exclusiveMinimum}.`);
  }
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
    errors.push(`${path}: ${value} must be less than ${schema.exclusiveMaximum}.`);
  }
  if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
    const quotient = value / schema.multipleOf;
    if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
      errors.push(`${path}: ${value} is not a multiple of ${schema.multipleOf}.`);
    }
  }
}

function validateString(schema: JsonSchema, value: string, path: string, errors: string[]): void {
  const length = [...value].length;
  if (typeof schema.minLength === 'number' && length < schema.minLength) {
    errors.push(`${path}: string shorter than minLength ${schema.minLength}.`);
  }
  if (typeof schema.maxLength === 'number' && length > schema.maxLength) {
    errors.push(`${path}: string longer than maxLength ${schema.maxLength}.`);
  }
  if (typeof schema.pattern === 'string') {
    let regex: RegExp | undefined;
    try {
      regex = new RegExp(schema.pattern);
    } catch {
      errors.push(`${path}: \`pattern\` is not a valid regular expression.`);
    }
    if (regex && !regex.test(value)) {
      errors.push(`${path}: string does not match pattern ${schema.pattern}.`);
    }
  }
}

function validateArray(
  schema: JsonSchema,
  value: unknown[],
  path: string,
  context: ValidationContext,
): void {
  const { errors } = context;
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    errors.push(`${path}: array has fewer than minItems ${schema.minItems}.`);
  }
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    errors.push(`${path}: array has more than maxItems ${schema.maxItems}.`);
  }
  if (schema.uniqueItems === true) {
    const seen = new Set(value.map((item) => JSON.stringify(item)));
    if (seen.size !== value.length) errors.push(`${path}: array items are not unique.`);
  }
  const items = asSchema(schema.items);
  if (items) {
    value.forEach((item, index) => validateInto(items, item, `${path}[${index}]`, context));
  }
}

function validateObject(
  schema: JsonSchema,
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
): void {
  const { errors } = context;
  const properties = isPlainObject(schema.properties) ? schema.properties : {};

  if (Array.isArray(schema.required)) {
    for (const name of schema.required) {
      if (typeof name === 'string' && !(name in value)) {
        errors.push(`${path}: missing required property \`${name}\`.`);
      }
    }
  }

  if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) {
    errors.push(`${path}: fewer than minProperties ${schema.minProperties}.`);
  }
  if (typeof schema.maxProperties === 'number' && Object.keys(value).length > schema.maxProperties) {
    errors.push(`${path}: more than maxProperties ${schema.maxProperties}.`);
  }

  for (const [key, raw] of Object.entries(value)) {
    const child = asSchema((properties as Record<string, unknown>)[key]);
    if (child) {
      validateInto(child, raw, `${path}.${key}`, context);
      continue;
    }
    if (schema.additionalProperties === false) {
      errors.push(`${path}: unexpected property \`${key}\`.`);
      continue;
    }
    const additional = asSchema(schema.additionalProperties);
    if (additional) validateInto(additional, raw, `${path}.${key}`, context);
  }
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
