import { describe, expect, it } from 'vitest';
import type { CanonicalTool } from '../src/types.js';
import { diffToolSets, diffTools } from '../src/diff.js';

const before: CanonicalTool = {
  name: 'refund_order',
  description: 'Refunds an order',
  inputSchema: {
    type: 'object',
    title: 'Refund arguments',
    properties: {
      orderId: { type: 'string', description: 'The order to refund' },
      amount: { type: 'number', minimum: 0 },
    },
    required: ['orderId'],
  },
};

/** Every prose field edited, and one real constraint tightened. */
const after: CanonicalTool = {
  name: 'refund_order',
  description: 'Refunds all or part of an order',
  inputSchema: {
    type: 'object',
    title: 'Refund input',
    properties: {
      orderId: { type: 'string', description: 'Identifier of the order to refund' },
      amount: { type: 'number', minimum: 1 },
    },
    required: ['orderId'],
  },
};

const codes = (options?: { ignoreDescriptions?: boolean }) =>
  diffTools(before, after, options).map((change) => change.code);

describe('diffTools with ignoreDescriptions', () => {
  it('reports prose changes by default', () => {
    expect(codes()).toContain('tool-description-changed');
    expect(codes()).toContain('description-changed');
    expect(codes()).toContain('title-changed');
  });

  it('drops them when asked', () => {
    const filtered = codes({ ignoreDescriptions: true });

    expect(filtered).not.toContain('tool-description-changed');
    expect(filtered).not.toContain('description-changed');
    expect(filtered).not.toContain('title-changed');
  });

  it('keeps every change that is not prose', () => {
    expect(codes({ ignoreDescriptions: true })).toEqual(['constraint-narrowed']);
  });

  it('treats an absent option and an explicit false the same as no options', () => {
    expect(diffTools(before, after)).toEqual(diffTools(before, after, {}));
    expect(diffTools(before, after)).toEqual(diffTools(before, after, { ignoreDescriptions: false }));
  });

  it('does not touch `format`, `default` or `examples`, which can change what a model sends', () => {
    const a: CanonicalTool = {
      name: 't',
      inputSchema: { type: 'object', properties: { when: { type: 'string', format: 'date' } } },
    };
    const b: CanonicalTool = {
      name: 't',
      inputSchema: { type: 'object', properties: { when: { type: 'string', format: 'date-time' } } },
    };

    expect(diffTools(a, b, { ignoreDescriptions: true }).map((c) => c.code)).toEqual([
      'format-changed',
    ]);
  });

  it('returns an empty list when prose was the only thing that changed', () => {
    const proseOnly: CanonicalTool = { ...before, description: 'Totally rewritten' };

    expect(diffTools(before, proseOnly, { ignoreDescriptions: true })).toEqual([]);
    expect(diffTools(before, proseOnly)).toHaveLength(1);
  });

  it('is deterministic', () => {
    expect(codes({ ignoreDescriptions: true })).toEqual(codes({ ignoreDescriptions: true }));
  });
});

describe('diffToolSets with ignoreDescriptions', () => {
  it('filters, and recounts the summary to match', () => {
    const unfiltered = diffToolSets([before], [after]);
    const filtered = diffToolSets([before], [after], { ignoreDescriptions: true });

    expect(unfiltered.summary.informational).toBe(3);
    expect(filtered.summary.informational).toBe(0);
    expect(filtered.changes.map((change) => change.code)).toEqual(['constraint-narrowed']);
  });

  it('still reports added and removed tools', () => {
    const result = diffToolSets([before], [after, { name: 'new_tool', inputSchema: { type: 'object' } }], {
      ignoreDescriptions: true,
    });

    expect(result.changes.map((change) => change.code)).toContain('tool-added');
  });

  it('filters the prose changes inside a detected rename', () => {
    const renamed: CanonicalTool = { ...before, name: 'issue_refund', description: 'Reworded' };
    const result = diffToolSets([before], [renamed], { ignoreDescriptions: true });

    expect(result.changes.map((change) => change.code)).toEqual(['tool-renamed']);
  });
});
