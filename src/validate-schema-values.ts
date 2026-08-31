/**
 * Check that a schema's own literal values satisfy the schema they sit in.
 *
 * A schema can contradict itself:
 *
 * ```json
 * { "type": "number", "minimum": 10, "default": 0 }
 * { "type": "string", "enum": ["basic", "pro"], "default": "enterprise" }
 * ```
 *
 * Both are accepted by every JSON Schema validator, because `default` and
 * `const` are not validated against their own subschema by the specification.
 * Neither is caught by anything else in SchemaPort: the structure is fine, the
 * types are fine, and every provider compiles them without complaint.
 *
 * They still matter. `default` is emitted by every adapter and read by the
 * model as guidance, so an invalid one actively steers the model towards a call
 * the schema rejects. `const` is stranger still: a `const` that fails its own
 * sibling constraints describes a property no value can satisfy.
 *
 * `examples` is deliberately **not** checked here. It is documentation, it is
 * never sent as guidance, and an issue raised here drops the whole tool from
 * `loadTools` — losing a tool over a typo in a doc example would be a worse
 * outcome than the typo.
 */

import type { JsonSchema } from './types.js';
import { collectSchemas, joinPath } from './schema.js';
import { UNVERIFIED_MARKER, validateValue } from './validate-value.js';
import type { ToolValidationIssue } from './validate-tool.js';

/** Keywords holding a literal value that must satisfy the schema around it. */
const VALUE_KEYWORDS = ['const', 'default'] as const;

/**
 * Validate every `default` and `const` against the subschema declaring it.
 *
 * Returns an empty array when every literal is consistent with its own schema.
 */
export function validateSchemaValues(root: JsonSchema, rootPath: string): ToolValidationIssue[] {
  const issues: ToolValidationIssue[] = [];

  for (const { schema, path } of collectSchemas(root, rootPath)) {
    for (const keyword of VALUE_KEYWORDS) {
      if (!(keyword in schema)) continue;
      const problems = violations(schema, schema[keyword], root);
      if (problems.length === 0) continue;

      issues.push({
        message:
          `\`${keyword}\` is ${JSON.stringify(schema[keyword])}, which its own schema rejects: ` +
          `${problems.join(' ')} ` +
          (keyword === 'default'
            ? 'A `default` is emitted to the provider and read by the model as guidance, so an ' +
              'invalid one steers the model towards a call this schema will reject.'
            : 'A `const` that fails its sibling constraints describes a property no value can ' +
              'satisfy.'),
        path: joinPath(path, keyword),
      });
    }
  }

  return issues;
}

/**
 * Constraint violations for one literal, with the schema's own copy of the
 * keyword removed.
 *
 * `const` has to be stripped or it would only ever be compared against itself
 * and pass. `default` is stripped for symmetry and because it constrains
 * nothing. Anything the validator could not actually check — an unresolvable
 * `$ref` — is dropped: "not verified" is not evidence of a bad value, and
 * reporting it as one would turn a reference SchemaPort cannot follow into an
 * accusation about a literal that may be perfectly correct.
 */
function violations(schema: JsonSchema, value: unknown, refRoot: JsonSchema): string[] {
  const { const: _const, default: _default, ...constraints } = schema;
  const result = validateValue(constraints as JsonSchema, value, 'value', { refRoot });
  return result.errors.filter((error) => !error.includes(UNVERIFIED_MARKER));
}
