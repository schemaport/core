/**
 * JSON value utilities.
 *
 * These three are about plain JSON values, not JSON Schema: two of them never
 * see a schema at all. They lived in `schema.ts` because that is where the
 * first caller was, and stayed there while it grew into the schema walker.
 * Splitting them out leaves `schema.ts` to schema shapes and traversal.
 *
 * `schema.ts` re-exports all three, so every existing import path still works.
 */

import { isPlainObject } from './schema.js';

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
