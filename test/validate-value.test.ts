import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '../src/types.js';
import { validateValue } from '../src/validate-value.js';
import { constraintTool, nestedTool, refundOrderTool } from '../src/fixtures.js';

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

  it('reports a $ref as unverified rather than silently passing', () => {
    const schema: JsonSchema = { $ref: '#/$defs/thing' };
    const result = validateValue(schema, { anything: true });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('does not resolve');
  });

  it('produces sorted, deterministic error lists', () => {
    const value = { orderId: 7, amount: -1 };
    const first = validateValue(refundOrderTool.inputSchema, value);
    const second = validateValue(refundOrderTool.inputSchema, value);

    expect(first.errors).toEqual(second.errors);
    expect(first.errors).toEqual([...first.errors].sort());
  });
});
