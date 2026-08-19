import { describe, expect, it } from 'vitest';
import { finalizeCompile, isLossy, transformation } from '../src/compile.js';
import { compilable, compilableLossy, diagnostic, notCompilable } from '../src/diagnostics.js';
import { refundOrderTool } from '../src/fixtures.js';

const base = {
  providerId: 'test',
  tool: refundOrderTool,
  output: { name: 'refund_order', parameters: { type: 'object' } },
};

const warning = diagnostic({
  providerId: 'test',
  toolName: refundOrderTool.name,
  severity: 'warning',
  code: 'test/nullable-instead-of-omitted',
  message: 'The model may emit `amount: null` instead of omitting it.',
  path: 'inputSchema.properties.amount',
  compile: compilable('Emits `amount` as required and nullable.'),
});

const resolvableError = diagnostic({
  providerId: 'test',
  toolName: refundOrderTool.name,
  severity: 'error',
  code: 'test/strict-optional-property',
  message: 'Optional properties are not allowed in strict mode.',
  path: 'inputSchema.properties.amount',
  compile: compilable('Emits `amount` as required and nullable.'),
});

const unresolvableError = diagnostic({
  providerId: 'test',
  toolName: refundOrderTool.name,
  severity: 'error',
  code: 'test/unsupported-feature',
  message: 'This target cannot express recursive schemas.',
  path: 'inputSchema',
  compile: notCompilable('No safe representation exists.'),
});

const lossyError = diagnostic({
  providerId: 'test',
  toolName: refundOrderTool.name,
  severity: 'error',
  code: 'test/unsupported-minimum',
  message: '`minimum` is not supported by this target.',
  path: 'inputSchema.properties.amount.minimum',
  compile: compilableLossy('Drops `minimum`.'),
});

describe('finalizeCompile', () => {
  it('succeeds and returns the output when nothing is lossy', () => {
    const result = finalizeCompile({ ...base, transformations: [], diagnostics: [] });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual(base.output);
    expect(result.providerId).toBe('test');
    expect(result.toolName).toBe('refund_order');
  });

  it('keeps warnings on a successful compile', () => {
    const result = finalizeCompile({ ...base, transformations: [], diagnostics: [warning] });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([warning]);
  });

  it('drops errors that compile worked around, because transformations record them', () => {
    const result = finalizeCompile({
      ...base,
      transformations: [
        transformation('converted-optional-property-to-nullable', 'inputSchema.properties.amount', 'Required and nullable.'),
      ],
      diagnostics: [resolvableError],
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.transformations).toHaveLength(1);
  });

  it('refuses when an error cannot be compiled around', () => {
    const result = finalizeCompile({ ...base, transformations: [], diagnostics: [unresolvableError] });

    expect(result.ok).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.diagnostics).toEqual([unresolvableError]);
  });

  it('refuses a lossy transformation by default', () => {
    const result = finalizeCompile({
      ...base,
      transformations: [
        transformation('dropped-unsupported-keyword', 'inputSchema.properties.amount.minimum', 'Dropped `minimum`.', true),
      ],
      diagnostics: [lossyError],
    });

    expect(result.ok).toBe(false);
    expect(result.output).toBeUndefined();
    const refusal = result.diagnostics.find((item) => item.code === 'core/lossy-transformation-refused');
    expect(refusal?.severity).toBe('error');
    expect(refusal?.message).toContain('--allow-lossy');
    expect(refusal?.message).toContain('dropped-unsupported-keyword');
  });

  it('allows the same lossy transformation when the caller opts in', () => {
    const result = finalizeCompile({
      ...base,
      transformations: [
        transformation('dropped-unsupported-keyword', 'inputSchema.properties.amount.minimum', 'Dropped `minimum`.', true),
      ],
      diagnostics: [lossyError],
      options: { allowLossy: true },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual(base.output);
    expect(isLossy(result)).toBe(true);
    expect(result.diagnostics.some((item) => item.code === 'core/lossy-transformation-refused')).toBe(false);
  });

  it('still refuses an unresolvable error even with allowLossy', () => {
    const result = finalizeCompile({
      ...base,
      transformations: [],
      diagnostics: [unresolvableError],
      options: { allowLossy: true },
    });

    expect(result.ok).toBe(false);
  });

  it('deduplicates identical transformations but preserves order', () => {
    const first = transformation('a', 'inputSchema', 'first');
    const second = transformation('b', 'inputSchema', 'second');
    const result = finalizeCompile({
      ...base,
      transformations: [first, second, { ...first }],
      diagnostics: [],
    });

    expect(result.transformations.map((item) => item.code)).toEqual(['a', 'b']);
  });

  it('is deterministic for the same input', () => {
    const input = {
      ...base,
      transformations: [transformation('added-additional-properties-false', 'inputSchema', 'Closed the object.')],
      diagnostics: [warning],
    };

    expect(JSON.stringify(finalizeCompile(input))).toBe(JSON.stringify(finalizeCompile(input)));
  });
});

describe('isLossy', () => {
  it('is false when every transformation preserves the contract', () => {
    const result = finalizeCompile({
      ...base,
      transformations: [transformation('renamed-field', 'inputSchema', 'Renamed to `parameters`.')],
      diagnostics: [],
    });

    expect(isLossy(result)).toBe(false);
  });
});
