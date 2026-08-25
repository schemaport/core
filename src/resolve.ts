/**
 * `$ref` resolution.
 *
 * SchemaPort inlines same-document JSON Pointer references so that everything
 * downstream — value validation, structural validation, diff — sees what the
 * schema actually says rather than a pointer it cannot follow.
 *
 * Four things are deliberately *not* resolved, and each is reported instead of
 * being passed over in silence:
 *
 *  - **External references.** Anything not starting with `#` names another
 *    document. Core reads no files and makes no network requests.
 *  - **`$anchor` fragments** such as `#money`. Core indexes JSON Pointers only.
 *  - **Dangling pointers**, including a pointer that lands on something which
 *    is not a schema object.
 *  - **Recursive references.** A schema that refers to itself, directly or
 *    through a cycle, has no finite inlining. Cycles are found *before* any
 *    expansion happens, so a recursive reference is left exactly as written —
 *    the output is never half-expanded.
 *
 * Resolution is deterministic and never mutates its input.
 */

import type { CanonicalTool, JsonSchema } from './types.js';
import {
  MAX_REF_DEPTH,
  asSchema,
  compareStrings,
  deepEqual,
  isPlainObject,
  joinPath,
  lookupRef,
} from './schema.js';

/** Why one `$ref` could not be resolved. Codes are stable; messages are not. */
export type RefIssueCode =
  | 'external-ref'
  | 'anchor-ref'
  | 'dangling-ref'
  | 'invalid-ref'
  | 'recursive-ref'
  | 'ref-depth-exceeded';

export interface RefResolutionIssue {
  /** Stable machine-readable code, e.g. `dangling-ref`. */
  code: RefIssueCode;
  /** The `$ref` value itself, e.g. `#/$defs/Money`. */
  pointer: string;
  /** Dotted path to the `$ref` keyword, e.g. `inputSchema.properties.total.$ref`. */
  path: string;
  /** One short human explanation, including the cycle path for a recursive ref. */
  message: string;
}

export interface ResolvedSchema {
  /** The schema with every resolvable reference inlined. */
  schema: JsonSchema;
  /** One entry per `$ref` left in place, sorted by path. */
  issues: RefResolutionIssue[];
  /** How many `$ref` keywords were replaced by their target. */
  resolvedCount: number;
}

export interface ResolveOptions {
  /**
   * Dotted path the reported issue paths are built from. Defaults to
   * `inputSchema`, which is where a canonical tool's schema lives.
   */
  rootPath?: string;
  /**
   * How many nested `$ref` expansions to allow. Defaults to
   * {@link MAX_REF_DEPTH}. Cycles are caught before expansion begins; this is
   * the guard for a chain that is finite but pathologically deep.
   */
  maxDepth?: number;
  /**
   * Keep `$defs` / `definitions` even when every reference resolved. By
   * default the definition maps are dropped once nothing points at them, so
   * that an inlined schema and its `$ref` form compare as equal.
   */
  keepDefinitions?: boolean;
}

/** Keyword slots holding a map of subschemas. Definition maps are not among them. */
const MAP_SLOTS = ['properties'] as const;
/** Keyword slots holding an array of subschemas. */
const LIST_SLOTS = ['prefixItems', 'anyOf', 'oneOf', 'allOf'] as const;
/** Keyword slots holding a single subschema. */
const SINGLE_SLOTS = ['items', 'not', 'additionalProperties'] as const;

/**
 * Keywords a `$ref` sibling may override outright.
 *
 * These annotate; they assert nothing about the value. When a reference and
 * its target both carry one, the reference's own is the more specific and
 * wins. Everything else is an assertion and is combined, never replaced.
 */
const ANNOTATION_KEYWORDS = new Set([
  '$anchor',
  '$comment',
  '$defs',
  '$id',
  '$schema',
  'default',
  'definitions',
  'deprecated',
  'description',
  'examples',
  'readOnly',
  'title',
  'writeOnly',
]);

/**
 * Resolve every same-document `$ref` in `schema`.
 *
 * References are inlined at their use site. Definitions are treated as a
 * library: the resolver does not walk into `$defs` / `definitions` looking for
 * work, so an unused recursive definition is not reported, and a definition
 * reached from a use site is reported once, at that use site.
 *
 * The definition maps are removed from the result when at least one reference
 * resolved and none was left behind — at that point nothing can point at them,
 * and dropping them is what makes an inlined schema compare equal to its
 * `$ref` form. Pass `keepDefinitions` to keep them regardless.
 *
 * Sibling keywords are preserved. See `docs/canonical-tool-format.md` for the
 * three-case rule; briefly, annotations override, non-overlapping assertions
 * merge, and an assertion the target also declares becomes an `allOf` branch
 * so that both still apply, as JSON Schema 2020-12 requires.
 *
 * The input is never mutated.
 */
export function resolveSchemaRefs(schema: JsonSchema, options: ResolveOptions = {}): ResolvedSchema {
  const rootPath = options.rootPath ?? 'inputSchema';
  const maxDepth = options.maxDepth ?? MAX_REF_DEPTH;

  const state: ResolveState = {
    root: schema,
    maxDepth,
    issues: [],
    resolvedCount: 0,
    unresolvedCount: 0,
    recursion: findRecursiveRefs(schema),
  };

  let resolved = resolveNode(schema, rootPath, [], state);

  const dropDefinitions =
    options.keepDefinitions !== true && state.resolvedCount > 0 && state.unresolvedCount === 0;
  if (dropDefinitions && (resolved['$defs'] !== undefined || resolved['definitions'] !== undefined)) {
    resolved = { ...resolved };
    delete resolved['$defs'];
    delete resolved['definitions'];
  }

  return { schema: resolved, issues: sortIssues(state.issues), resolvedCount: state.resolvedCount };
}

/**
 * Resolve the references in a canonical tool's `inputSchema`.
 *
 * A convenience over {@link resolveSchemaRefs} that keeps `name` and
 * `description` intact and reports paths under `inputSchema`.
 */
export function resolveToolRefs(
  tool: CanonicalTool,
  options: ResolveOptions = {},
): { tool: CanonicalTool; issues: RefResolutionIssue[] } {
  const result = resolveSchemaRefs(tool.inputSchema, options);
  return { tool: { ...tool, inputSchema: result.schema }, issues: result.issues };
}

/** Whether `schema` contains a `$ref` anywhere, including inside its definitions. */
export function hasRefs(schema: JsonSchema): boolean {
  return containsRef(schema);
}

function containsRef(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRef);
  if (!isPlainObject(value)) return false;
  if (typeof value['$ref'] === 'string') return true;
  return Object.values(value).some(containsRef);
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

interface ResolveState {
  root: JsonSchema;
  maxDepth: number;
  issues: RefResolutionIssue[];
  resolvedCount: number;
  unresolvedCount: number;
  /** Pointers that cannot be inlined because they sit on, or reach, a cycle. */
  recursion: ReadonlyMap<string, readonly string[]>;
}

function resolveNode(
  schema: JsonSchema,
  path: string,
  stack: readonly string[],
  state: ResolveState,
): JsonSchema {
  const ref = schema['$ref'];
  if (ref === undefined) return resolveChildren(schema, path, stack, state);

  const refPath = joinPath(path, '$ref');

  if (typeof ref !== 'string') {
    report(state, 'invalid-ref', String(ref), refPath, '`$ref` must be a string.');
    return resolveChildren(schema, path, stack, state);
  }

  const problem = classify(ref, stack, state);
  if (problem !== undefined) {
    report(state, problem.code, ref, refPath, problem.message);
    return resolveChildren(schema, path, stack, state);
  }

  // `classify` returning `undefined` guarantees the lookup succeeds.
  const target = lookupRef(state.root, ref);
  if (target.kind !== 'found') return resolveChildren(schema, path, stack, state);

  const { $ref: _pointer, ...rest } = schema;
  const siblings = resolveChildren(rest as JsonSchema, path, stack, state);
  const expanded = resolveNode(target.schema, path, [...stack, ref], state);
  state.resolvedCount += 1;
  return mergeSiblings(expanded, siblings);
}

/** Why this reference cannot be expanded here, or `undefined` when it can. */
function classify(
  ref: string,
  stack: readonly string[],
  state: ResolveState,
): { code: RefIssueCode; message: string } | undefined {
  const cycle = state.recursion.get(ref);
  if (cycle !== undefined) {
    const trail = cycle.join(' -> ');
    const direct = cycle[0] === ref;
    return {
      code: 'recursive-ref',
      message: direct
        ? `\`${ref}\` is recursive (${trail}). SchemaPort does not inline recursive schemas, so the reference is left in place and anything beneath it is unverified.`
        : `\`${ref}\` reaches a recursive definition (${trail}). SchemaPort does not inline recursive schemas, so the reference is left in place and anything beneath it is unverified.`,
    };
  }

  // Defence in depth: findRecursiveRefs has already ruled every cycle out.
  if (stack.includes(ref)) {
    return {
      code: 'recursive-ref',
      message: `\`${ref}\` is recursive (${[...stack.slice(stack.indexOf(ref)), ref].join(' -> ')}).`,
    };
  }

  if (stack.length >= state.maxDepth) {
    return {
      code: 'ref-depth-exceeded',
      message: `\`${ref}\` is nested more than ${state.maxDepth} references deep, which SchemaPort will not expand. The reference is left in place.`,
    };
  }

  const target = lookupRef(state.root, ref);
  switch (target.kind) {
    case 'found':
      return undefined;
    case 'external':
      return {
        code: 'external-ref',
        message: `\`${ref}\` points outside this document. SchemaPort resolves same-document references only — inline the target into \`$defs\` to have it resolved.`,
      };
    case 'anchor':
      return {
        code: 'anchor-ref',
        message: `\`${ref}\` names an \`$anchor\`, which SchemaPort does not index. Use a JSON Pointer such as \`#/$defs/Name\`.`,
      };
    case 'malformed':
      return {
        code: 'invalid-ref',
        message: `\`${ref}\` is not a valid JSON Pointer: a percent-escape in it could not be decoded.`,
      };
    case 'not-a-schema':
      return {
        code: 'dangling-ref',
        message: `\`${ref}\` resolves to something that is not a schema object.`,
      };
    case 'missing':
      return {
        code: 'dangling-ref',
        message: `\`${ref}\` does not resolve: nothing exists at that location in this document.`,
      };
  }
}

function report(
  state: ResolveState,
  code: RefIssueCode,
  pointer: string,
  path: string,
  message: string,
): void {
  state.unresolvedCount += 1;
  state.issues.push({ code, pointer, path, message });
}

/**
 * Rebuild `schema` with every subschema slot resolved.
 *
 * Keys keep their original position, so a resolved schema serializes in the
 * same order as the one it came from.
 */
function resolveChildren(
  schema: JsonSchema,
  path: string,
  stack: readonly string[],
  state: ResolveState,
): JsonSchema {
  const out: JsonSchema = { ...schema };

  for (const slot of MAP_SLOTS) {
    const map = schema[slot];
    if (!isPlainObject(map)) continue;
    const next: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(map)) {
      const child = asSchema(value);
      next[key] = child
        ? resolveNode(child, joinPath(path, slot, key), stack, state)
        : (value as JsonSchema);
    }
    out[slot] = next;
  }

  for (const slot of LIST_SLOTS) {
    const list = schema[slot];
    if (!Array.isArray(list)) continue;
    out[slot] = list.map((value, index) => {
      const child = asSchema(value);
      return child ? resolveNode(child, joinPath(path, slot, index), stack, state) : value;
    });
  }

  for (const slot of SINGLE_SLOTS) {
    const child = asSchema(schema[slot]);
    if (!child) continue;
    out[slot] = resolveNode(child, joinPath(path, slot), stack, state);
  }

  return out;
}

/**
 * Combine a resolved target with the keywords that sat beside the `$ref`.
 *
 * JSON Schema 2020-12 says both still apply, so the merge must never drop or
 * loosen either side. Annotations override, assertions the target does not
 * declare are copied across, and an assertion both sides declare becomes an
 * `allOf` branch — the only faithful way to say "and also".
 */
function mergeSiblings(expanded: JsonSchema, siblings: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...expanded };
  const conflicting: Record<string, unknown> = {};
  let conflicts = false;

  for (const [keyword, value] of Object.entries(siblings)) {
    if (ANNOTATION_KEYWORDS.has(keyword) || !(keyword in expanded)) {
      out[keyword] = value;
      continue;
    }
    if (deepEqual(value, expanded[keyword])) continue;
    conflicting[keyword] = value;
    conflicts = true;
  }

  if (!conflicts) return out;
  const existing = Array.isArray(out.allOf) ? out.allOf : [];
  out.allOf = [...existing, conflicting as JsonSchema];
  return out;
}

/* -------------------------------------------------------------------------- */
/* Cycle detection                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Find every pointer that cannot be inlined because it sits on a cycle, or
 * reaches one.
 *
 * This runs before any expansion, which is what lets a recursive reference be
 * left exactly as written instead of expanded once and then abandoned. Each
 * entry maps the pointer to the cycle that condemns it, so the reported
 * message can name the loop rather than just asserting one exists.
 */
function findRecursiveRefs(root: JsonSchema): Map<string, readonly string[]> {
  const unsafe = new Map<string, readonly string[]>();
  const settled = new Set<string>();
  const trail: string[] = [];

  /** Returns the cycle condemning `pointer`, or `undefined` when it is safe. */
  function visit(pointer: string): readonly string[] | undefined {
    const onTrail = trail.indexOf(pointer);
    if (onTrail !== -1) {
      const cycle = [...trail.slice(onTrail), pointer];
      unsafe.set(pointer, cycle);
      return cycle;
    }
    if (settled.has(pointer)) return unsafe.get(pointer);

    const target = lookupRef(root, pointer);
    if (target.kind !== 'found') {
      settled.add(pointer);
      return undefined;
    }

    trail.push(pointer);
    let cycle: readonly string[] | undefined;
    for (const next of refsWithin(target.schema)) {
      cycle = visit(next) ?? cycle;
    }
    trail.pop();

    settled.add(pointer);
    // A pointer already condemned by a back edge onto itself keeps that cycle.
    if (cycle !== undefined && !unsafe.has(pointer)) unsafe.set(pointer, cycle);
    return unsafe.get(pointer);
  }

  for (const pointer of refsWithin(root)) visit(pointer);
  return unsafe;
}

/**
 * Every `$ref` reachable from `schema` without leaving its own subtree.
 *
 * Definition maps are skipped for the same reason resolution skips them: a
 * definition is a library entry, not part of the schema being described.
 * Returned in a deterministic order and de-duplicated.
 */
function refsWithin(schema: JsonSchema): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const stack: JsonSchema[] = [schema];

  while (stack.length > 0) {
    const current = stack.pop() as JsonSchema;
    const ref = current['$ref'];
    if (typeof ref === 'string' && !seen.has(ref)) {
      seen.add(ref);
      found.push(ref);
    }

    for (const slot of MAP_SLOTS) {
      const map = current[slot];
      if (!isPlainObject(map)) continue;
      for (const value of Object.values(map)) {
        const child = asSchema(value);
        if (child) stack.push(child);
      }
    }
    for (const slot of LIST_SLOTS) {
      const list = current[slot];
      if (!Array.isArray(list)) continue;
      for (const value of list) {
        const child = asSchema(value);
        if (child) stack.push(child);
      }
    }
    for (const slot of SINGLE_SLOTS) {
      const child = asSchema(current[slot]);
      if (child) stack.push(child);
    }
  }

  return found;
}

/* -------------------------------------------------------------------------- */

function sortIssues(issues: readonly RefResolutionIssue[]): RefResolutionIssue[] {
  return [...issues].sort(
    (a, b) =>
      compareStrings(a.path, b.path) ||
      compareStrings(a.pointer, b.pointer) ||
      compareStrings(a.code, b.code),
  );
}
