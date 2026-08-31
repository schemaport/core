import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '../src/types.js';
import { validateSchemaValues } from '../src/validate-schema-values.js';
import { validateCanonicalTool } from '../src/validate-tool.js';
import { FIXTURE_TOOLS } from '../src/fixtures.js';

const check = (inputSchema: JsonSchema) => validateSchemaValues(inputSchema, 'inputSchema');
const paths = (inputSchema: JsonSchema) => check(inputSchema).map((issue) => issue.path);
const prop = (property: JsonSchema): JsonSchema => ({
  type: 'object',
  properties: { value: property },
});

describe('default', () => {
  it('accepts a default its own schema allows', () => {
    expect(check(prop({ type: 'number', minimum: 10, default: 10 }))).toEqual([]);
  });

  it.each([
    ['below minimum', { type: 'number', minimum: 10, default: 0 }],
    ['above maximum', { type: 'number', maximum: 5, default: 9 }],
    ['outside enum', { type: 'string', enum: ['basic', 'pro'], default: 'enterprise' }],
    ['wrong type', { type: 'string', default: 7 }],
    ['failing pattern', { type: 'string', pattern: '^[A-Z]{3}$', default: 'abc' }],
    ['too short', { type: 'string', minLength: 3, default: 'a' }],
    ['too few items', { type: 'array', minItems: 2, default: [] }],
  ])('rejects a default that is %s', (_label, property) => {
    const issues = check(prop(property as JsonSchema));

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('inputSchema.properties.value.default');
  });

  it('quotes the offending value and the reason', () => {
    const [issue] = check(prop({ type: 'number', minimum: 10, default: 0 }));

    expect(issue?.message).toContain('`default` is 0');
    expect(issue?.message).toContain('below minimum 10');
  });

  it('explains why an invalid default matters', () => {
    const [issue] = check(prop({ type: 'number', minimum: 10, default: 0 }));

    expect(issue?.message).toContain('read by the model as guidance');
  });

  it('checks a default on the root schema', () => {
    expect(
      paths({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], default: {} }),
    ).toEqual(['inputSchema.default']);
  });

  it('checks defaults nested inside items and composition branches', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        list: { type: 'array', items: { type: 'number', minimum: 1, default: 0 } },
        either: { anyOf: [{ type: 'string', minLength: 5, default: 'ab' }] },
      },
    };

    expect(paths(schema)).toEqual([
      'inputSchema.properties.list.items.default',
      'inputSchema.properties.either.anyOf[0].default',
    ]);
  });

  it('accepts `default: null` when the type permits null', () => {
    expect(check(prop({ type: ['string', 'null'], default: null }))).toEqual([]);
  });

  it('reports `default: null` when the type does not permit null', () => {
    expect(check(prop({ type: 'string', default: null }))).toHaveLength(1);
  });

  it('distinguishes an absent default from an explicit `undefined`', () => {
    expect(check(prop({ type: 'string' }))).toEqual([]);
    // `default: undefined` is present as a key; JSON never produces it, but an
    // object built in memory can, and it must not be read as the string case.
    expect(check(prop({ type: 'string', default: undefined }))).toHaveLength(1);
  });
});

describe('const', () => {
  it('accepts a const its siblings allow', () => {
    expect(check(prop({ type: 'string', minLength: 2, const: 'ok' }))).toEqual([]);
  });

  it('is not compared only against itself', () => {
    const issues = check(prop({ type: 'string', const: 7 }));

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('expected type string');
  });

  it('is checked against a sibling enum', () => {
    expect(paths(prop({ type: 'string', enum: ['a', 'b'], const: 'c' }))).toEqual([
      'inputSchema.properties.value.const',
    ]);
  });

  it('explains why an impossible const matters', () => {
    const [issue] = check(prop({ type: 'string', const: 7 }));

    expect(issue?.message).toContain('no value can satisfy');
  });
});

describe('what it deliberately leaves alone', () => {
  it('ignores `examples`, which is documentation', () => {
    expect(check(prop({ type: 'string', pattern: '^[A-Z]{3}$', examples: ['abc', 'nope'] }))).toEqual([]);
  });

  it('says nothing when a `$ref` could not be resolved', () => {
    // "not verified" is not evidence of a bad value.
    expect(check(prop({ $ref: 'https://example.com/other.json#/X', default: 1 }))).toEqual([]);
  });

  it('resolves a same-document `$ref` and checks against the target', () => {
    const schema: JsonSchema = {
      type: 'object',
      $defs: { positive: { type: 'number', minimum: 1 } },
      properties: { value: { $ref: '#/$defs/positive', default: 0 } },
    };

    expect(paths(schema)).toEqual(['inputSchema.properties.value.default']);
  });

  it('is silent for every shared fixture', () => {
    for (const [name, tool] of Object.entries(FIXTURE_TOOLS)) {
      expect(validateSchemaValues(tool.inputSchema, 'inputSchema'), name).toEqual([]);
    }
  });

  it('is deterministic', () => {
    const schema = prop({ type: 'number', minimum: 10, default: 0 });

    expect(check(schema)).toEqual(check(schema));
  });
});

describe('integration with validateCanonicalTool', () => {
  it('reports an inconsistent default as a tool validation issue', () => {
    const issues = validateCanonicalTool({
      name: 'set_limit',
      inputSchema: { type: 'object', properties: { a: { type: 'number', minimum: 10, default: 0 } } },
    });

    expect(issues.map((issue) => issue.path)).toEqual(['inputSchema.properties.a.default']);
  });

  it('does not run while the schema is still structurally broken', () => {
    // The bad `type` is the real problem; a value error at the same path would
    // be noise reported against the wrong keyword.
    const issues = validateCanonicalTool({
      name: 'x',
      inputSchema: { type: 'object', properties: { a: { type: 'bogus', default: 1 } } },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('Unknown JSON Schema type');
  });
});
