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

/* -------------------------------------------------------------------------- */
/* JSON Pointer lookup                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The outcome of looking a `$ref` up against a document root.
 *
 * The failure kinds are distinct because they need different advice: an
 * external reference needs the document inlining, a missing one is a typo, and
 * an `$anchor` is a form SchemaPort does not index.
 */
export type RefLookup =
  | { kind: 'found'; schema: JsonSchema }
  /** Not a same-document reference — it does not start with `#`. */
  | { kind: 'external' }
  /** A plain-name fragment such as `#money`, which names an `$anchor`. */
  | { kind: 'anchor' }
  /** The pointer contains a percent-escape that cannot be decoded. */
  | { kind: 'malformed' }
  /** The pointer is well formed but nothing sits at that location. */
  | { kind: 'missing' }
  /** Something sits there, but it is not a schema object. */
  | { kind: 'not-a-schema' };

/**
 * Resolve a same-document `$ref` to the subschema it names.
 *
 * Supports the root pointer (`#`) and RFC 6901 JSON Pointer fragments such as
 * `#/$defs/Money`, `#/properties/orderId` and `#/anyOf/0`. Segments are
 * percent-decoded and then unescaped (`~1` before `~0`, as RFC 6901 requires).
 *
 * This is a lookup only — it never follows the reference chain and never
 * detects recursion. {@link resolveSchemaRefs} in `resolve.ts` does both.
 */
export function lookupRef(root: JsonSchema, ref: string): RefLookup {
  if (!ref.startsWith('#')) return { kind: 'external' };
  if (ref === '#' || ref === '#/') return { kind: 'found', schema: root };
  if (!ref.startsWith('#/')) return { kind: 'anchor' };

  let current: unknown = root;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = unescapePointerSegment(rawSegment);
    if (segment === undefined) return { kind: 'malformed' };
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { kind: 'missing' };
      current = current[index];
      continue;
    }
    if (!isPlainObject(current) || !(segment in current)) return { kind: 'missing' };
    current = current[segment];
  }

  const schema = asSchema(current);
  return schema ? { kind: 'found', schema } : { kind: 'not-a-schema' };
}

/**
 * Percent-decode one pointer segment, then apply the RFC 6901 escapes in the
 * required order (`~1` before `~0`). Returns `undefined` for a malformed
 * percent-escape, which makes the pointer unresolvable rather than throwing.
 */
function unescapePointerSegment(segment: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~');
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

/** How far a walk may follow a chain of `$ref`s before it gives up. */
export const MAX_REF_DEPTH = 64;

export interface WalkOptions {
  /**
   * Also visit the target of every resolvable same-document `$ref`, as an
   * extra child of the schema that carries the reference, with the keyword
   * `$ref` and the path `<referring path>.$ref`.
   *
   * Off by default: the default walk is purely syntactic, and every existing
   * caller depends on that. A followed target is visited *in addition to* the
   * normal traversal, so a `$defs` entry reached from a use site is visited
   * twice — once as a definition, once as the reference target.
   *
   * Recursion cannot loop: a reference already being followed on the current
   * branch is not followed again, and chains stop at {@link MAX_REF_DEPTH}.
   */
  followRefs?: boolean;
  /**
   * Document root that `$ref` pointers resolve against. Defaults to `root`,
   * which is correct whenever the walk starts at the whole document.
   */
  refRoot?: JsonSchema;
}

/**
 * Visit `root` and every subschema beneath it, depth-first in a deterministic
 * order. Boolean `additionalProperties` is not a schema and is not visited.
 *
 * With `followRefs`, resolvable `$ref` targets are visited too — see
 * {@link WalkOptions}.
 */
export function walkSchema(
  root: JsonSchema,
  rootPath: string,
  visit: (entry: SchemaVisit) => void,
  options: WalkOptions = {},
): void {
  const followRefs = options.followRefs ?? false;
  const refRoot = options.refRoot ?? root;

  // The stack carries the chain of references followed to reach each entry, so
  // a cycle is stopped without that state leaking into the public visit shape.
  const stack: { entry: SchemaVisit; refs: readonly string[] }[] = [
    { entry: { schema: root, path: rootPath }, refs: [] },
  ];

  while (stack.length > 0) {
    const { entry, refs } = stack.pop() as { entry: SchemaVisit; refs: readonly string[] };
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

    // Pushed first so it pops last: a followed target is visited after the
    // referring schema's own children.
    const ref = followRefs ? schema['$ref'] : undefined;
    if (typeof ref === 'string' && !refs.includes(ref) && refs.length < MAX_REF_DEPTH) {
      const target = lookupRef(refRoot, ref);
      if (target.kind === 'found') {
        stack.push({
          entry: {
            schema: target.schema,
            path: joinPath(path, '$ref'),
            keyword: '$ref',
            parent: schema,
          },
          refs: [...refs, ref],
        });
      }
    }

    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({ entry: children[i] as SchemaVisit, refs });
    }
  }
}

/** Collect every subschema, root first, in deterministic order. */
export function collectSchemas(
  root: JsonSchema,
  rootPath: string,
  options: WalkOptions = {},
): SchemaVisit[] {
  const out: SchemaVisit[] = [];
  walkSchema(root, rootPath, (entry) => out.push(entry), options);
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
