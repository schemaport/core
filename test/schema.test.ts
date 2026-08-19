import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '../src/types.js';
import {
  collectSchemas,
  deepEqual,
  isType,
  joinPath,
  schemaTypes,
  stableStringify,
  walkSchema,
} from '../src/schema.js';
import { nestedTool, refundOrderTool } from '../src/fixtures.js';

describe('joinPath', () => {
  it('builds dotted paths for identifier segments', () => {
    expect(joinPath('inputSchema', 'properties', 'amount')).toBe('inputSchema.properties.amount');
  });

  it('brackets numeric segments', () => {
    expect(joinPath('inputSchema', 'anyOf', 0)).toBe('inputSchema.anyOf[0]');
  });

  it('quotes segments that are not plain identifiers', () => {
    expect(joinPath('inputSchema', 'properties', 'order id')).toBe('inputSchema.properties["order id"]');
  });
});

describe('schemaTypes', () => {
  it('normalizes a single type to an array', () => {
    expect(schemaTypes({ type: 'string' })).toEqual(['string']);
  });

  it('passes through a type union', () => {
    expect(schemaTypes({ type: ['string', 'null'] })).toEqual(['string', 'null']);
  });

  it('returns an empty array for an untyped schema', () => {
    expect(schemaTypes({})).toEqual([]);
  });
});

describe('isType', () => {
  it('is true only for a single matching type', () => {
    expect(isType({ type: 'object' }, 'object')).toBe(true);
    expect(isType({ type: ['object', 'null'] }, 'object')).toBe(false);
    expect(isType({}, 'object')).toBe(false);
  });
});

describe('walkSchema', () => {
  it('visits the root first', () => {
    const visited: string[] = [];
    walkSchema(refundOrderTool.inputSchema, 'inputSchema', (entry) => visited.push(entry.path));

    expect(visited[0]).toBe('inputSchema');
  });

  it('visits every property subschema with its path', () => {
    const paths = collectSchemas(refundOrderTool.inputSchema, 'inputSchema').map((entry) => entry.path);

    expect(paths).toContain('inputSchema.properties.orderId');
    expect(paths).toContain('inputSchema.properties.amount');
  });

  it('recurses into nested objects and array items', () => {
    const paths = collectSchemas(nestedTool.inputSchema, 'inputSchema').map((entry) => entry.path);

    expect(paths).toContain('inputSchema.properties.requester.properties.email');
    expect(paths).toContain('inputSchema.properties.labels.items');
    expect(paths).toContain('inputSchema.properties.history.items.properties.note');
  });

  it('reports the parent and the keyword a subschema sits under', () => {
    const entries = collectSchemas(refundOrderTool.inputSchema, 'inputSchema');
    const amount = entries.find((entry) => entry.path === 'inputSchema.properties.amount');

    expect(amount?.keyword).toBe('properties');
    expect(amount?.key).toBe('amount');
    expect(amount?.parent).toBe(refundOrderTool.inputSchema);
  });

  it('walks composition branches by index', () => {
    const schema: JsonSchema = { anyOf: [{ type: 'number' }, { type: 'null' }] };
    const paths = collectSchemas(schema, 'inputSchema').map((entry) => entry.path);

    expect(paths).toEqual(['inputSchema', 'inputSchema.anyOf[0]', 'inputSchema.anyOf[1]']);
  });

  it('does not treat a boolean additionalProperties as a subschema', () => {
    const schema: JsonSchema = { type: 'object', additionalProperties: false };

    expect(collectSchemas(schema, 'inputSchema')).toHaveLength(1);
  });

  it('walks a schema-valued additionalProperties', () => {
    const schema: JsonSchema = { type: 'object', additionalProperties: { type: 'string' } };
    const paths = collectSchemas(schema, 'inputSchema').map((entry) => entry.path);

    expect(paths).toContain('inputSchema.additionalProperties');
  });

  it('produces the same order on every walk', () => {
    const first = collectSchemas(nestedTool.inputSchema, 'inputSchema').map((entry) => entry.path);
    const second = collectSchemas(nestedTool.inputSchema, 'inputSchema').map((entry) => entry.path);

    expect(first).toEqual(second);
  });
});

describe('deepEqual', () => {
  it('ignores object key order', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('respects array order', () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });

  it('distinguishes missing keys', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it('compares nested structures', () => {
    expect(deepEqual({ a: { b: [1, { c: 'x' }] } }, { a: { b: [1, { c: 'x' }] } })).toBe(true);
    expect(deepEqual({ a: { b: [1, { c: 'x' }] } }, { a: { b: [1, { c: 'y' }] } })).toBe(false);
  });
});

describe('stableStringify', () => {
  it('produces indented JSON with a trailing newline', () => {
    expect(stableStringify({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  it('preserves key insertion order so output is byte-stable', () => {
    expect(stableStringify({ type: 'object', properties: {} })).toBe(
      stableStringify({ type: 'object', properties: {} }),
    );
    expect(stableStringify({ b: 1, a: 2 })).toContain('"b": 1');
  });
});
