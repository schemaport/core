import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '../src/types.js';
import { validateValue } from '../src/validate-value.js';
import {
  constraintTool,
  externalRefTool,
  nestedTool,
  recursiveTool,
  refundOrderTool,
} from '../src/fixtures.js';

describe('validateValue', () => {
  it('accepts a value satisfying the canonical schema', () => {
    const result = validateValue(refundOrderTool.inputSchema, { orderId: 'ord_1', amount: 25 });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('accepts a value omitting an optional property', () => {
    expect(validateValue(refundOrderTool.inputSchema, { orderId: 'ord_1' }).valid).toBe(true);
  });

  it('rejects a missing required property and names it', () => {
    const result = validateValue(refundOrderTool.inputSchema, { amount: 1 });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('missing required property `orderId`');
  });

  it('rejects a wrong type and reports the path', () => {
    const result = validateValue(refundOrderTool.inputSchema, { orderId: 7 });

    expect(result.errors[0]).toContain('$.orderId: expected type string, received number');
  });

  it('enforces numeric bounds', () => {
    const result = validateValue(refundOrderTool.inputSchema, { orderId: 'ord_1', amount: -5 });

    expect(result.errors[0]).toContain('below minimum 0');
  });

  it('distinguishes integer from number', () => {
    const schema: JsonSchema = { type: 'object', properties: { n: { type: 'integer' } } };

    expect(validateValue(schema, { n: 3 }).valid).toBe(true);
    expect(validateValue(schema, { n: 3.5 }).valid).toBe(false);
  });

  it('enforces enums', () => {
    const schema: JsonSchema = { type: 'object', properties: { s: { type: 'string', enum: ['a', 'b'] } } };

    expect(validateValue(schema, { s: 'a' }).valid).toBe(true);
    expect(validateValue(schema, { s: 'c' }).errors[0]).toContain('not one of the allowed enum values');
  });

  it('enforces const', () => {
    const schema: JsonSchema = { type: 'object', properties: { s: { const: 'fixed' } } };

    expect(validateValue(schema, { s: 'fixed' }).valid).toBe(true);
    expect(validateValue(schema, { s: 'other' }).valid).toBe(false);
  });

  it('enforces string length and pattern', () => {
    const result = validateValue(constraintTool.inputSchema, { jobId: 'BAD', runEvery: 60 });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('minLength'))).toBe(true);
    expect(result.errors.some((error) => error.includes('does not match pattern'))).toBe(true);
  });

  it('enforces multipleOf', () => {
    const result = validateValue(constraintTool.inputSchema, { jobId: 'job_abc', runEvery: 90 });

    expect(result.errors[0]).toContain('not a multiple of 60');
  });

  it('enforces array bounds and item types', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { list: { type: 'array', items: { type: 'string' }, minItems: 2 } },
    };

    expect(validateValue(schema, { list: ['a', 'b'] }).valid).toBe(true);
    expect(validateValue(schema, { list: ['a'] }).errors[0]).toContain('minItems');
    expect(validateValue(schema, { list: ['a', 2] }).errors[0]).toContain('$.list[1]');
  });

  it('enforces uniqueItems', () => {
    const schema: JsonSchema = { type: 'object', properties: { l: { type: 'array', uniqueItems: true } } };

    expect(validateValue(schema, { l: ['a', 'a'] }).errors[0]).toContain('not unique');
  });

  it('validates nested objects and reports a dotted path', () => {
    const result = validateValue(nestedTool.inputSchema, {
      title: 'Broken login',
      priority: 'high',
      requester: { name: 'Sam' },
    });

    expect(result.errors[0]).toContain('$.requester: missing required property `email`');
  });

  it('rejects unexpected properties when additionalProperties is false', () => {
    const schema: JsonSchema = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false };

    expect(validateValue(schema, { a: 'x', b: 'y' }).errors[0]).toContain('unexpected property `b`');
  });

  it('validates values against a schema-valued additionalProperties', () => {
    const schema: JsonSchema = { type: 'object', additionalProperties: { type: 'string' } };

    expect(validateValue(schema, { anything: 'ok' }).valid).toBe(true);
    expect(validateValue(schema, { anything: 5 }).valid).toBe(false);
  });

  it('supports anyOf', () => {
    const schema: JsonSchema = { anyOf: [{ type: 'number' }, { type: 'null' }] };

    expect(validateValue(schema, 5).valid).toBe(true);
    expect(validateValue(schema, null).valid).toBe(true);
    expect(validateValue(schema, 'x').errors[0]).toContain('does not match any `anyOf` branch');
  });

  it('requires exactly one oneOf branch to match', () => {
    const schema: JsonSchema = { oneOf: [{ type: 'number' }, { type: 'integer' }] };

    expect(validateValue(schema, 5).errors[0]).toContain('matched 2 `oneOf` branches');
  });

  it('accepts a null value for a nullable type union', () => {
    const schema: JsonSchema = { type: 'object', properties: { a: { type: ['string', 'null'] } } };

    expect(validateValue(schema, { a: null }).valid).toBe(true);
  });

  it('reports a $ref it cannot resolve as unverified rather than silently passing', () => {
    const schema: JsonSchema = { $ref: '#/$defs/thing' };
    const result = validateValue(schema, { anything: true });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('could not resolve');
    expect(result.errors[0]).toContain('#/$defs/thing');
  });

  it('produces sorted, deterministic error lists', () => {
    const value = { orderId: 7, amount: -1 };
    const first = validateValue(refundOrderTool.inputSchema, value);
    const second = validateValue(refundOrderTool.inputSchema, value);

    expect(first.errors).toEqual(second.errors);
    expect(first.errors).toEqual([...first.errors].sort());
  });
});

describe('validateValue — references', () => {
  const schema: JsonSchema = {
    type: 'object',
    $defs: {
      Money: {
        type: 'object',
        properties: { cents: { type: 'integer', minimum: 0 } },
        required: ['cents'],
      },
    },
    properties: { total: { $ref: '#/$defs/Money' } },
    required: ['total'],
  };

  it('validates through a resolvable reference', () => {
    expect(validateValue(schema, { total: { cents: 5 } }).valid).toBe(true);
  });

  it('enforces a constraint that only exists behind a reference', () => {
    const result = validateValue(schema, { total: { cents: -1 } });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('below minimum 0');
    expect(result.errors[0]).toContain('$.total.cents');
  });

  it('enforces a required property that only exists behind a reference', () => {
    expect(validateValue(schema, { total: {} }).errors[0]).toContain('missing required property');
  });

  it('applies a sibling keyword alongside the reference', () => {
    const withSibling: JsonSchema = {
      type: 'object',
      $defs: { Name: { type: 'string' } },
      properties: { value: { $ref: '#/$defs/Name', minLength: 4 } },
    };

    expect(validateValue(withSibling, { value: 'abcd' }).valid).toBe(true);
    expect(validateValue(withSibling, { value: 'abc' }).errors[0]).toContain('minLength 4');
  });

  it('applies both sides when a sibling and its target constrain the same keyword', () => {
    const conflicting: JsonSchema = {
      type: 'object',
      $defs: { Name: { type: 'string', minLength: 5 } },
      properties: { value: { $ref: '#/$defs/Name', minLength: 3 } },
    };

    expect(validateValue(conflicting, { value: 'abcde' }).valid).toBe(true);
    expect(validateValue(conflicting, { value: 'abcd' }).errors[0]).toContain('minLength 5');
  });

  it('validates through a reference inside `items`', () => {
    const arrays: JsonSchema = {
      type: 'object',
      $defs: { Id: { type: 'string', pattern: '^id_' } },
      properties: { ids: { type: 'array', items: { $ref: '#/$defs/Id' } } },
    };

    expect(validateValue(arrays, { ids: ['id_1', 'id_2'] }).valid).toBe(true);
    expect(validateValue(arrays, { ids: ['nope'] }).errors[0]).toContain('$.ids[0]');
  });

  it('reports a recursive reference as unverified, with the cycle', () => {
    const result = validateValue(recursiveTool.inputSchema, { root: { label: 'a' } });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('$.root');
    expect(result.errors[0]).toContain('is recursive');
    expect(result.errors[0]).toContain('#/$defs/Node -> #/$defs/Node');
  });

  it('reports an external reference as unverified, with the reason', () => {
    const result = validateValue(externalRefTool.inputSchema, { address: { city: 'Lagos' } });

    expect(result.errors[0]).toContain('points outside this document');
  });

  it('still checks everything around an unresolvable reference', () => {
    const mixed: JsonSchema = {
      type: 'object',
      properties: {
        known: { type: 'integer' },
        opaque: { $ref: 'https://example.com/a.json' },
      },
    };
    const result = validateValue(mixed, { known: 'not an integer', opaque: {} });

    expect(result.errors).toHaveLength(2);
    expect(result.errors.some((error) => error.includes('expected type integer'))).toBe(true);
  });

  it('is deterministic across repeated runs of a referencing schema', () => {
    const value = { total: { cents: -1 } };

    expect(validateValue(schema, value).errors).toEqual(validateValue(schema, value).errors);
  });

  it('does not mutate the schema it validates against', () => {
    const before = JSON.stringify(schema);
    validateValue(schema, { total: { cents: 1 } });

    expect(JSON.stringify(schema)).toBe(before);
  });
});

describe('validateValue — refRoot', () => {
  const document: JsonSchema = {
    type: 'object',
    $defs: { Money: { type: 'integer', minimum: 0 } },
    properties: { total: { $ref: '#/$defs/Money' } },
  };
  const fragment = (document.properties as Record<string, JsonSchema>)['total'] as JsonSchema;

  it('validates a fragment against the document it came from', () => {
    expect(validateValue(fragment, 5, '$.total', { refRoot: document }).valid).toBe(true);
    expect(validateValue(fragment, -1, '$.total', { refRoot: document }).errors[0]).toContain(
      'below minimum 0',
    );
  });

  it('reports the reference as unresolved without it, rather than passing', () => {
    const result = validateValue(fragment, -1, '$.total');

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('could not resolve');
  });
});

describe('not', () => {
  it('rejects a value that matches the excluded subschema', () => {
    const result = validateValue({ not: { type: 'string' } }, 'excluded');

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('matches the `not` subschema');
  });

  it('accepts a value that does not match it', () => {
    expect(validateValue({ not: { type: 'string' } }, 7).valid).toBe(true);
  });

  it('reports the failing path, not the inner reasons', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { a: { not: { type: 'number', minimum: 0 } } },
    };
    const result = validateValue(schema, { a: 5 });

    expect(result.errors).toEqual(['$.a: value matches the `not` subschema, which excludes it.']);
  });

  it('composes with the rest of the schema', () => {
    const schema: JsonSchema = { type: 'string', not: { const: 'reserved' } };

    expect(validateValue(schema, 'fine').valid).toBe(true);
    expect(validateValue(schema, 'reserved').valid).toBe(false);
    expect(validateValue(schema, 7).valid).toBe(false);
  });

  it('ignores a non-schema `not`', () => {
    expect(validateValue({ not: 'nonsense' } as unknown as JsonSchema, 1).valid).toBe(true);
  });
});

describe('prefixItems', () => {
  const tuple: JsonSchema = {
    type: 'array',
    prefixItems: [{ type: 'number' }, { type: 'string' }],
  };

  it('validates each position against its own subschema', () => {
    expect(validateValue(tuple, [1, 'a']).valid).toBe(true);
    expect(validateValue(tuple, ['a', 1]).errors).toEqual([
      '$[0]: expected type number, received string.',
      '$[1]: expected type string, received number.',
    ]);
  });

  it('does not require the array to be as long as the tuple', () => {
    // Length is `minItems`\'s job; `prefixItems` only types the positions present.
    expect(validateValue(tuple, [1]).valid).toBe(true);
    expect(validateValue(tuple, []).valid).toBe(true);
  });

  it('leaves the tail to `items`, per 2020-12', () => {
    const withTail: JsonSchema = { ...tuple, items: { type: 'boolean' } };

    expect(validateValue(withTail, [1, 'a', true, false]).valid).toBe(true);
    expect(validateValue(withTail, [1, 'a', 'not a boolean']).errors).toEqual([
      '$[2]: expected type boolean, received string.',
    ]);
  });

  it('does not apply `items` to the prefixed positions', () => {
    const withTail: JsonSchema = { ...tuple, items: { type: 'boolean' } };

    expect(validateValue(withTail, [1, 'a']).valid).toBe(true);
  });

  it('still honours minItems and maxItems', () => {
    expect(validateValue({ ...tuple, minItems: 2 }, [1]).errors).toEqual([
      '$: array has fewer than minItems 2.',
    ]);
  });

  it('ignores a non-array `prefixItems`', () => {
    expect(validateValue({ prefixItems: {} } as unknown as JsonSchema, [1]).valid).toBe(true);
  });
});
