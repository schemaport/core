import type { CanonicalTool, JsonSchema } from './types.js';
import { asSchema, collectSchemas, isPlainObject, joinPath, schemaTypes } from './schema.js';
import { validateSchemaValues } from './validate-schema-values.js';
import { resolveSchemaRefs } from './resolve.js';

export interface ToolValidationIssue {
  message: string;
  /** Dotted path into the tool object, e.g. `inputSchema.properties.amount.enum`. */
  path: string;
}

/** JSON Schema types SchemaPort understands. */
const KNOWN_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/** Tool names must be usable as an identifier by every target. */
const NAME_PATTERN = /^\S{1,128}$/;

/**
 * Validate the canonical SchemaPort tool structure.
 *
 * This is a structural check of the canonical format only. It deliberately
 * does not apply provider rules — those live in the provider packages.
 *
 * Returns an empty array when the value is a valid `CanonicalTool`.
 */
export function validateCanonicalTool(value: unknown, basePath = ''): ToolValidationIssue[] {
  const issues: ToolValidationIssue[] = [];
  const at = (...segments: string[]): string =>
    basePath === '' ? segments.join('.') : joinPath(basePath, ...segments);

  if (!isPlainObject(value)) {
    return [{ message: 'A tool definition must be a JSON object.', path: basePath || '(root)' }];
  }

  if (typeof value['name'] !== 'string' || value['name'].length === 0) {
    issues.push({ message: '`name` is required and must be a non-empty string.', path: at('name') });
  } else if (!NAME_PATTERN.test(value['name'])) {
    issues.push({
      message: '`name` must be at most 128 characters and contain no whitespace.',
      path: at('name'),
    });
  }

  if (value['description'] !== undefined && typeof value['description'] !== 'string') {
    issues.push({ message: '`description` must be a string when present.', path: at('description') });
  }

  const inputSchema = asSchema(value['inputSchema']);
  if (!inputSchema) {
    issues.push({
      message: '`inputSchema` is required and must be a JSON Schema object.',
      path: at('inputSchema'),
    });
    return issues;
  }

  const rootTypes = schemaTypes(inputSchema);
  if (rootTypes.length !== 1 || rootTypes[0] !== 'object') {
    issues.push({
      message: '`inputSchema` must declare `"type": "object"`. Tool arguments are always a named set.',
      path: at('inputSchema', 'type'),
    });
  }

  issues.push(...validateSubschemas(inputSchema, at('inputSchema')));
  issues.push(...validateReferences(inputSchema, at('inputSchema')));

  // Only worth running once the schema is structurally sound. Validating a
  // `default` against a malformed schema produces errors about the
  // malformation, reported at the wrong keyword.
  if (issues.length === 0) {
    issues.push(...validateSchemaValues(inputSchema, at('inputSchema')));
  }

  return issues;
}

/**
 * `$ref` codes that make a tool definition structurally invalid.
 *
 * A reference nothing can follow is a defect in the document itself, so the
 * tool is refused at load rather than compiled around a hole. The codes left
 * out are deliberate:
 *
 *  - `recursive-ref` — a recursive schema is well formed, and some targets
 *    (OpenAI, for one) accept it. Core cannot inline it, and says so through
 *    `resolveSchemaRefs` and `validateValue`, but refusing to *load* it would
 *    make a schema those targets support unexpressible.
 *  - `anchor-ref` — `$anchor` is valid JSON Schema that core does not index.
 *    Not resolving it is core's limitation, not the author's mistake.
 *  - `ref-depth-exceeded` — likewise a limit of the resolver, not a defect.
 */
const STRUCTURAL_REF_CODES = new Set(['external-ref', 'dangling-ref', 'invalid-ref']);

function validateReferences(inputSchema: JsonSchema, rootPath: string): ToolValidationIssue[] {
  const { issues } = resolveSchemaRefs(inputSchema, { rootPath });
  return issues
    .filter((issue) => STRUCTURAL_REF_CODES.has(issue.code))
    .map((issue) => ({ message: issue.message, path: issue.path }));
}

function validateSubschemas(root: JsonSchema, rootPath: string): ToolValidationIssue[] {
  const issues: ToolValidationIssue[] = [];

  for (const { schema, path } of collectSchemas(root, rootPath)) {
    issues.push(...findBooleanSubschemas(schema, path));

    for (const type of schemaTypes(schema)) {
      if (!KNOWN_TYPES.has(type)) {
        issues.push({
          message: `Unknown JSON Schema type \`${type}\`.`,
          path: joinPath(path, 'type'),
        });
      }
    }
    if (schema['type'] !== undefined && typeof schema['type'] !== 'string' && !Array.isArray(schema['type'])) {
      issues.push({ message: '`type` must be a string or an array of strings.', path: joinPath(path, 'type') });
    }

    if (schema.properties !== undefined && !isPlainObject(schema.properties)) {
      issues.push({ message: '`properties` must be an object.', path: joinPath(path, 'properties') });
    }

    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required) || schema.required.some((n) => typeof n !== 'string')) {
        issues.push({
          message: '`required` must be an array of property names.',
          path: joinPath(path, 'required'),
        });
      } else if (isPlainObject(schema.properties)) {
        for (const name of schema.required) {
          if (!(name in schema.properties)) {
            issues.push({
              message: `\`required\` lists \`${name}\`, which is not declared in \`properties\`.`,
              path: joinPath(path, 'required'),
            });
          }
        }
      }
    }

    if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
      issues.push({ message: '`enum` must be a non-empty array.', path: joinPath(path, 'enum') });
    }

    for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'] as const) {
      const raw = schema[keyword];
      if (raw !== undefined && typeof raw !== 'number') {
        issues.push({ message: `\`${keyword}\` must be a number.`, path: joinPath(path, keyword) });
      }
    }

    if (schema.pattern !== undefined) {
      if (typeof schema.pattern !== 'string') {
        issues.push({ message: '`pattern` must be a string.', path: joinPath(path, 'pattern') });
      } else {
        try {
          new RegExp(schema.pattern);
        } catch {
          issues.push({ message: '`pattern` is not a valid regular expression.', path: joinPath(path, 'pattern') });
        }
      }
    }
  }

  return issues;
}

/**
 * Reject boolean subschemas such as `{"properties": {"x": true}}`.
 *
 * JSON Schema permits them, but SchemaPort's canonical format does not: the
 * schema walker only descends into objects, so a boolean would be skipped
 * silently and the property could vanish from compiled output with no
 * diagnostic. Refusing loudly is the honest behaviour.
 *
 * `additionalProperties` is exempt — a boolean is its normal form.
 */
function findBooleanSubschemas(schema: JsonSchema, path: string): ToolValidationIssue[] {
  const issues: ToolValidationIssue[] = [];
  const advice =
    'SchemaPort does not support boolean subschemas. Use `{}` to accept any value, ' +
    'or remove the entry to disallow it.';

  for (const keyword of ['properties', '$defs', 'definitions'] as const) {
    const map = schema[keyword];
    if (!isPlainObject(map)) continue;
    for (const [key, value] of Object.entries(map)) {
      if (typeof value === 'boolean') {
        issues.push({ message: advice, path: joinPath(path, keyword, key) });
      }
    }
  }

  for (const keyword of ['items', 'not'] as const) {
    if (typeof schema[keyword] === 'boolean') {
      issues.push({ message: advice, path: joinPath(path, keyword) });
    }
  }

  for (const keyword of ['prefixItems', 'anyOf', 'oneOf', 'allOf'] as const) {
    const list = schema[keyword];
    if (!Array.isArray(list)) continue;
    list.forEach((value, index) => {
      if (typeof value === 'boolean') {
        issues.push({ message: advice, path: joinPath(path, keyword, index) });
      }
    });
  }

  return issues;
}

/** Type guard form of {@link validateCanonicalTool}. */
export function isCanonicalTool(value: unknown): value is CanonicalTool {
  return validateCanonicalTool(value).length === 0;
}
