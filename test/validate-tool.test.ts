import { describe, expect, it } from 'vitest';
import { isCanonicalTool, validateCanonicalTool } from '../src/validate-tool.js';
import {
  FIXTURE_TOOLS,
  INVALID_TOOL_VALUES,
  danglingRefTool,
  externalRefTool,
  recursiveTool,
  refDefsTool,
} from '../src/fixtures.js';

describe('validateCanonicalTool', () => {
  it('accepts every shared fixture tool', () => {
    for (const [name, tool] of Object.entries(FIXTURE_TOOLS)) {
      expect(validateCanonicalTool(tool), `fixture ${name}`).toEqual([]);
    }
  });

  it('rejects every value in the invalid fixture list', () => {
    for (const value of INVALID_TOOL_VALUES) {
      expect(validateCanonicalTool(value).length, JSON.stringify(value)).toBeGreaterThan(0);
    }
  });

  it('requires a name', () => {
    const issues = validateCanonicalTool({ inputSchema: { type: 'object' } });

    expect(issues.map((issue) => issue.path)).toContain('name');
  });

  it('rejects a name containing whitespace', () => {
    const issues = validateCanonicalTool({ name: 'refund order', inputSchema: { type: 'object' } });

    expect(issues[0]?.message).toContain('no whitespace');
  });

  it('requires inputSchema to be an object schema', () => {
    const issues = validateCanonicalTool({ name: 'x', inputSchema: { type: 'string' } });

    expect(issues[0]?.message).toContain('"type": "object"');
    expect(issues[0]?.path).toBe('inputSchema.type');
  });

  it('requires inputSchema to be present', () => {
    const issues = validateCanonicalTool({ name: 'x' });

    expect(issues[0]?.message).toContain('`inputSchema` is required');
  });

  it('rejects a description that is not a string', () => {
    const issues = validateCanonicalTool({ name: 'x', description: 7, inputSchema: { type: 'object' } });

    expect(issues.some((issue) => issue.path === 'description')).toBe(true);
  });

  it('reports required entries missing from properties, with the schema path', () => {
    const issues = validateCanonicalTool({
      name: 'x',
      inputSchema: {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a', 'b'],
      },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('`b`');
    expect(issues[0]?.path).toBe('inputSchema.required');
  });

  it('finds problems in nested subschemas and reports their path', () => {
    const issues = validateCanonicalTool({
      name: 'x',
      inputSchema: {
        type: 'object',
        properties: {
          nested: { type: 'object', properties: { deep: { type: 'stringg' } } },
        },
      },
    });

    expect(issues[0]?.message).toContain('Unknown JSON Schema type `stringg`');
    expect(issues[0]?.path).toBe('inputSchema.properties.nested.properties.deep.type');
  });

  it('rejects an empty enum', () => {
    const issues = validateCanonicalTool({
      name: 'x',
      inputSchema: { type: 'object', properties: { a: { type: 'string', enum: [] } } },
    });

    expect(issues[0]?.message).toContain('non-empty array');
  });

  it('rejects a non-numeric numeric constraint', () => {
    const issues = validateCanonicalTool({
      name: 'x',
      inputSchema: { type: 'object', properties: { a: { type: 'number', minimum: 'zero' } } },
    });

    expect(issues[0]?.message).toContain('`minimum` must be a number');
  });

  it('rejects an invalid regular expression in pattern', () => {
    const issues = validateCanonicalTool({
      name: 'x',
      inputSchema: { type: 'object', properties: { a: { type: 'string', pattern: '([' } } },
    });

    expect(issues[0]?.message).toContain('not a valid regular expression');
  });

  it('rejects a boolean subschema instead of silently skipping it', () => {
    const issues = validateCanonicalTool({
      name: 'x',
      inputSchema: { type: 'object', properties: { anything: true } },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('does not support boolean subschemas');
    expect(issues[0]?.path).toBe('inputSchema.properties.anything');
  });

  it('rejects boolean subschemas in items and composition branches', () => {
    const issues = validateCanonicalTool({
      name: 'x',
      inputSchema: {
        type: 'object',
        properties: {
          list: { type: 'array', items: false },
          either: { anyOf: [{ type: 'string' }, true] },
        },
      },
    });

    // Issues come back in traversal order, which follows property declaration order.
    expect(issues.map((issue) => issue.path)).toEqual([
      'inputSchema.properties.list.items',
      'inputSchema.properties.either.anyOf[1]',
    ]);
  });

  it('still accepts a boolean additionalProperties, which is its normal form', () => {
    expect(
      validateCanonicalTool({
        name: 'x',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }),
    ).toEqual([]);
  });

  it('applies a base path so callers can report array positions', () => {
    const issues = validateCanonicalTool({ inputSchema: { type: 'object' } }, '[2]');

    expect(issues[0]?.path).toBe('[2].name');
  });

  it('produces identical output for identical input', () => {
    const input = { name: 'x', inputSchema: { type: 'object', properties: { a: { type: 'bogus' } } } };

    expect(validateCanonicalTool(input)).toEqual(validateCanonicalTool(input));
  });
});

describe('isCanonicalTool', () => {
  it('narrows a valid tool', () => {
    const value: unknown = FIXTURE_TOOLS['refund_order'];

    expect(isCanonicalTool(value)).toBe(true);
    if (isCanonicalTool(value)) expect(value.name).toBe('refund_order');
  });

  it('returns false for an invalid tool', () => {
    expect(isCanonicalTool({ name: 'x' })).toBe(false);
  });
});

describe('validateCanonicalTool — references', () => {
  it('accepts a tool whose references all resolve', () => {
    expect(validateCanonicalTool(refDefsTool)).toEqual([]);
  });

  it('accepts a recursive tool', () => {
    // Recursion is not a defect in the document: it is well formed, and some
    // targets accept it. Core reports that it cannot inline it elsewhere.
    expect(validateCanonicalTool(recursiveTool)).toEqual([]);
  });

  it('rejects a dangling internal reference', () => {
    const issues = validateCanonicalTool(danglingRefTool);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('inputSchema.properties.coupon.$ref');
    expect(issues[0]?.message).toContain('does not resolve');
  });

  it('rejects an external reference', () => {
    const issues = validateCanonicalTool(externalRefTool);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('inputSchema.properties.address.$ref');
    expect(issues[0]?.message).toContain('points outside this document');
  });

  it('rejects a pointer that lands on something that is not a schema', () => {
    const issues = validateCanonicalTool({
      name: 'alias_tool',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, alias: { $ref: '#/required/0' } },
        required: ['id'],
      },
    });

    expect(issues[0]?.message).toContain('not a schema object');
  });

  it('accepts an `$anchor` reference rather than calling it malformed', () => {
    const issues = validateCanonicalTool({
      name: 'anchor_tool',
      inputSchema: {
        type: 'object',
        $defs: { Money: { $anchor: 'money', type: 'object' } },
        properties: { total: { $ref: '#money' } },
      },
    });

    expect(issues).toEqual([]);
  });

  it('reports the reference path alongside other structural issues', () => {
    const issues = validateCanonicalTool({
      name: 'mixed',
      inputSchema: {
        type: 'object',
        properties: { a: { $ref: '#/$defs/Nope' } },
        required: ['missing'],
      },
    });

    expect(issues.map((issue) => issue.path)).toEqual([
      'inputSchema.required',
      'inputSchema.properties.a.$ref',
    ]);
  });
});
