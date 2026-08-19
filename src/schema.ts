import type { JsonSchema } from './types.js';

/** Narrow an unknown value to a plain JSON object. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrow an unknown value to a JSON Schema object, or `undefined`. */
export function asSchema(value: unknown): JsonSchema | undefined {
  return isPlainObject(value) ? (value as JsonSchema) : undefined;
}

/**
 * Normalize `type` into an array. Returns `[]` when no type is declared,
 * which is meaningful: an untyped schema accepts anything.
 */
export function schemaTypes(schema: JsonSchema): string[] {
  const { type } = schema;
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === 'string');
  return [];
}

/** Whether the schema declares exactly one type, and that type is `expected`. */
export function isType(schema: JsonSchema, expected: string): boolean {
  const types = schemaTypes(schema);
  return types.length === 1 && types[0] === expected;
}

/** Deep structural clone. Inputs are always plain JSON. */
export function cloneSchema<T>(value: T): T {
  return structuredClone(value);
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Build a readable dotted path.
 *
 * `joinPath('inputSchema', 'properties', 'amount')` -> `inputSchema.properties.amount`
 * Segments that are not plain identifiers are bracketed and quoted.
 */
export function joinPath(base: string, ...segments: (string | number)[]): string {
  let path = base;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      path += `[${segment}]`;
    } else if (IDENTIFIER.test(segment)) {
      path += `.${segment}`;
    } else {
      path += `[${JSON.stringify(segment)}]`;
    }
  }
  return path;
}

/** One subschema encountered while walking. */
export interface SchemaVisit {
  schema: JsonSchema;
  /** Dotted path to this subschema, e.g. `inputSchema.properties.amount`. */
  path: string;
  /** The keyword this subschema sits under in its parent. Absent for the root. */
  keyword?: string;
  /** The property name, when `keyword` is `properties`. */
  key?: string;
  parent?: JsonSchema;
}

/** Keyword slots recursed into, in a fixed order so walks are deterministic. */
const OBJECT_MAP_KEYWORDS = ['properties', '$defs', 'definitions'] as const;
const ARRAY_KEYWORDS = ['prefixItems', 'anyOf', 'oneOf', 'allOf'] as const;
const SINGLE_KEYWORDS = ['items', 'not', 'additionalProperties'] as const;

/**
 * Visit `root` and every subschema beneath it, depth-first in a deterministic
 * order. Boolean `additionalProperties` is not a schema and is not visited.
 */
export function walkSchema(
  root: JsonSchema,
  rootPath: string,
  visit: (entry: SchemaVisit) => void,
): void {
  const stack: SchemaVisit[] = [{ schema: root, path: rootPath }];

  while (stack.length > 0) {
    const entry = stack.pop() as SchemaVisit;
    visit(entry);

    // Children are pushed in reverse so they pop in declaration order.
    const children: SchemaVisit[] = [];
    const { schema, path } = entry;

    for (const keyword of OBJECT_MAP_KEYWORDS) {
      const map = schema[keyword];
      if (!isPlainObject(map)) continue;
      for (const [key, value] of Object.entries(map)) {
        const child = asSchema(value);
        if (child) {
          children.push({
            schema: child,
            path: joinPath(path, keyword, key),
            keyword,
            key,
            parent: schema,
          });
        }
      }
    }

    for (const keyword of ARRAY_KEYWORDS) {
      const list = schema[keyword];
      if (!Array.isArray(list)) continue;
      list.forEach((value, index) => {
        const child = asSchema(value);
        if (child) {
          children.push({
            schema: child,
            path: joinPath(path, keyword, index),
            keyword,
            parent: schema,
          });
        }
      });
    }

    for (const keyword of SINGLE_KEYWORDS) {
      const child = asSchema(schema[keyword]);
      if (child) {
        children.push({ schema: child, path: joinPath(path, keyword), keyword, parent: schema });
      }
    }

    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i] as SchemaVisit);
    }
  }
}

/** Collect every subschema, root first, in deterministic order. */
export function collectSchemas(root: JsonSchema, rootPath: string): SchemaVisit[] {
  const out: SchemaVisit[] = [];
  walkSchema(root, rootPath, (entry) => out.push(entry));
  return out;
}

/**
 * Compare two strings by code point.
 *
 * Deliberately not `localeCompare`: that is locale- and ICU-sensitive, so the
 * same inputs can sort differently on different machines. Every ordering in
 * SchemaPort is part of its determinism guarantee, so all of them use this.
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Structural equality for plain JSON values. Object key order is ignored. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    if (!aKeys.every((key, index) => key === bKeys[index])) return false;
    return aKeys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

/**
 * Serialize a value to JSON with object keys in insertion order.
 *
 * Compiled output is written with this so repeated compilations of the same
 * canonical schema produce byte-identical files.
 */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
