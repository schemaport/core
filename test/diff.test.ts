import { describe, expect, it } from 'vitest';
import type { CanonicalTool, JsonSchema, SchemaChange } from '../src/types.js';
import { diffToolSets, diffTools } from '../src/diff.js';
import { recursiveTool, refundOrderTool } from '../src/fixtures.js';

/** Build a one-property tool so each rule can be exercised in isolation. */
function tool(property: JsonSchema, required = false, name = 'demo_tool'): CanonicalTool {
  return {
    name,
    inputSchema: {
      type: 'object',
      properties: { value: property },
      ...(required ? { required: ['value'] } : {}),
    },
  };
}

function codes(changes: readonly SchemaChange[]): string[] {
  return changes.map((change) => change.code);
}

function find(changes: readonly SchemaChange[], code: string): SchemaChange | undefined {
  return changes.find((change) => change.code === code);
}

describe('diffTools — no change', () => {
  it('reports nothing when the tools are identical', () => {
    expect(diffTools(refundOrderTool, refundOrderTool)).toEqual([]);
  });
});

describe('diffTools — breaking changes', () => {
  it('detects a removed property', () => {
    const before = tool({ type: 'string' });
    const after: CanonicalTool = { name: 'demo_tool', inputSchema: { type: 'object', properties: {} } };
    const change = find(diffTools(before, after), 'property-removed');

    expect(change?.classification).toBe('breaking');
    expect(change?.path).toBe('inputSchema.properties.value');
  });

  it('detects an optional property becoming required', () => {
    const change = find(diffTools(tool({ type: 'string' }), tool({ type: 'string' }, true)), 'property-made-required');

    expect(change?.classification).toBe('breaking');
  });

  it('detects a newly added required property', () => {
    const before: CanonicalTool = { name: 'demo_tool', inputSchema: { type: 'object', properties: {} } };
    const change = find(diffTools(before, tool({ type: 'string' }, true)), 'required-property-added');

    expect(change?.classification).toBe('breaking');
    expect(change?.path).toBe('inputSchema.properties.value');
  });

  it('detects a changed property type', () => {
    const change = find(diffTools(tool({ type: 'number' }), tool({ type: 'string' })), 'type-changed');

    expect(change?.classification).toBe('breaking');
    expect(change?.path).toBe('inputSchema.properties.value.type');
  });

  it('detects a narrowed type union', () => {
    const change = find(
      diffTools(tool({ type: ['string', 'null'] }), tool({ type: 'string' })),
      'type-narrowed',
    );

    expect(change?.classification).toBe('breaking');
  });

  it('detects a narrowed enum', () => {
    const before = tool({ type: 'string', enum: ['a', 'b', 'c'] });
    const after = tool({ type: 'string', enum: ['a', 'b'] });
    const change = find(diffTools(before, after), 'enum-narrowed');

    expect(change?.classification).toBe('breaking');
    expect(change?.message).toContain('"c"');
  });

  it('detects an enum introduced where any value was accepted', () => {
    const change = find(diffTools(tool({ type: 'string' }), tool({ type: 'string', enum: ['a'] })), 'enum-added');

    expect(change?.classification).toBe('breaking');
  });

  it('detects a narrowed numeric range', () => {
    const before = tool({ type: 'number', minimum: 0, maximum: 100 });
    const after = tool({ type: 'number', minimum: 10, maximum: 50 });
    const changes = diffTools(before, after);

    expect(codes(changes).filter((code) => code === 'constraint-narrowed')).toHaveLength(2);
    expect(changes.every((change) => change.classification === 'breaking')).toBe(true);
  });

  it('treats an added bound as breaking', () => {
    const change = find(diffTools(tool({ type: 'number' }), tool({ type: 'number', minimum: 1 })), 'constraint-added');

    expect(change?.classification).toBe('breaking');
    expect(change?.path).toBe('inputSchema.properties.value.minimum');
  });

  it('detects a narrowed string length and an added pattern', () => {
    const before = tool({ type: 'string', maxLength: 100 });
    const after = tool({ type: 'string', maxLength: 10, pattern: '^a' });
    const changes = diffTools(before, after);

    expect(find(changes, 'constraint-narrowed')?.classification).toBe('breaking');
    expect(find(changes, 'pattern-added')?.classification).toBe('breaking');
  });

  it('detects an incompatible array item shape', () => {
    const before = tool({ type: 'array', items: { type: 'string' } });
    const after = tool({ type: 'array', items: { type: 'number' } });
    const change = find(diffTools(before, after), 'type-changed');

    expect(change?.classification).toBe('breaking');
    expect(change?.path).toBe('inputSchema.properties.value.items.type');
  });

  it('detects a narrowed array length', () => {
    const before = tool({ type: 'array', items: { type: 'string' }, maxItems: 10 });
    const after = tool({ type: 'array', items: { type: 'string' }, maxItems: 2 });

    expect(find(diffTools(before, after), 'constraint-narrowed')?.classification).toBe('breaking');
  });

  it('detects an object closing to additional properties', () => {
    const before = tool({ type: 'object', properties: {} });
    const after = tool({ type: 'object', properties: {}, additionalProperties: false });

    expect(find(diffTools(before, after), 'additional-properties-restricted')?.classification).toBe('breaking');
  });

  it('detects a nested object shape change', () => {
    const before = tool({ type: 'object', properties: { inner: { type: 'string' } } });
    const after = tool({ type: 'object', properties: { inner: { type: 'boolean' } } });
    const change = find(diffTools(before, after), 'type-changed');

    expect(change?.path).toBe('inputSchema.properties.value.properties.inner.type');
    expect(change?.classification).toBe('breaking');
  });

  it('treats an unclassifiable composition change as breaking', () => {
    const before = tool({ anyOf: [{ type: 'string' }, { type: 'number' }] });
    const after = tool({ anyOf: [{ type: 'boolean' }] });

    expect(find(diffTools(before, after), 'composition-changed')?.classification).toBe('breaking');
  });

  it('treats a narrowed anyOf as breaking', () => {
    const before = tool({ anyOf: [{ type: 'string' }, { type: 'number' }] });
    const after = tool({ anyOf: [{ type: 'string' }] });

    expect(find(diffTools(before, after), 'composition-narrowed')?.classification).toBe('breaking');
  });
});

describe('diffTools — non-breaking changes', () => {
  it('detects an added optional property', () => {
    const before: CanonicalTool = { name: 'demo_tool', inputSchema: { type: 'object', properties: {} } };
    const change = find(diffTools(before, tool({ type: 'string' })), 'optional-property-added');

    expect(change?.classification).toBe('non-breaking');
  });

  it('detects an expanded enum', () => {
    const before = tool({ type: 'string', enum: ['a'] });
    const after = tool({ type: 'string', enum: ['a', 'b'] });

    expect(find(diffTools(before, after), 'enum-expanded')?.classification).toBe('non-breaking');
  });

  it('detects a relaxed constraint', () => {
    const before = tool({ type: 'number', minimum: 10 });
    const after = tool({ type: 'number', minimum: 0 });

    expect(find(diffTools(before, after), 'constraint-relaxed')?.classification).toBe('non-breaking');
  });

  it('detects a removed constraint', () => {
    const before = tool({ type: 'string', maxLength: 5 });
    const after = tool({ type: 'string' });

    expect(find(diffTools(before, after), 'constraint-removed')?.classification).toBe('non-breaking');
  });

  it('detects a widened type union', () => {
    const before = tool({ type: 'string' });
    const after = tool({ type: ['string', 'null'] });

    expect(find(diffTools(before, after), 'type-widened')?.classification).toBe('non-breaking');
  });

  it('detects a required property becoming optional', () => {
    const change = find(diffTools(tool({ type: 'string' }, true), tool({ type: 'string' })), 'property-made-optional');

    expect(change?.classification).toBe('non-breaking');
  });

  it('detects an object opening to additional properties', () => {
    const before = tool({ type: 'object', properties: {}, additionalProperties: false });
    const after = tool({ type: 'object', properties: {} });

    expect(find(diffTools(before, after), 'additional-properties-relaxed')?.classification).toBe('non-breaking');
  });

  it('detects a widened anyOf', () => {
    const before = tool({ anyOf: [{ type: 'string' }] });
    const after = tool({ anyOf: [{ type: 'string' }, { type: 'number' }] });

    expect(find(diffTools(before, after), 'composition-widened')?.classification).toBe('non-breaking');
  });
});

describe('diffTools — informational changes', () => {
  it('reports a changed tool description', () => {
    const before: CanonicalTool = { ...refundOrderTool, description: 'Old' };
    const after: CanonicalTool = { ...refundOrderTool, description: 'New' };
    const change = find(diffTools(before, after), 'tool-description-changed');

    expect(change?.classification).toBe('informational');
  });

  it('reports a changed property description', () => {
    const before = tool({ type: 'string', description: 'Old' });
    const after = tool({ type: 'string', description: 'New' });

    expect(find(diffTools(before, after), 'description-changed')?.classification).toBe('informational');
  });

  it('reports added examples and defaults as informational', () => {
    const before = tool({ type: 'string' });
    const after = tool({ type: 'string', examples: ['x'], default: 'x' });
    const changes = diffTools(before, after);

    expect(find(changes, 'examples-changed')?.classification).toBe('informational');
    expect(find(changes, 'default-changed')?.classification).toBe('informational');
  });

  it('reports a format change as informational because providers treat format as advisory', () => {
    const before = tool({ type: 'string' });
    const after = tool({ type: 'string', format: 'email' });

    expect(find(diffTools(before, after), 'format-changed')?.classification).toBe('informational');
  });
});

describe('diffToolSets', () => {
  const alpha: CanonicalTool = { name: 'alpha', inputSchema: { type: 'object', properties: { a: { type: 'string' } } } };
  const beta: CanonicalTool = { name: 'beta', inputSchema: { type: 'object', properties: { b: { type: 'string' } } } };

  it('detects a removed tool', () => {
    const result = diffToolSets([alpha, beta], [alpha]);

    expect(find(result.changes, 'tool-removed')?.classification).toBe('breaking');
    expect(result.summary.breaking).toBe(1);
  });

  it('detects an added tool as non-breaking', () => {
    const result = diffToolSets([alpha], [alpha, beta]);

    expect(find(result.changes, 'tool-added')?.classification).toBe('non-breaking');
    expect(result.summary.breaking).toBe(0);
  });

  it('identifies a rename when the input schema is unchanged', () => {
    const renamed: CanonicalTool = { ...alpha, name: 'alpha_v2' };
    const result = diffToolSets([alpha], [renamed]);

    const change = find(result.changes, 'tool-renamed');
    expect(change?.classification).toBe('breaking');
    expect(change?.before).toBe('alpha');
    expect(change?.after).toBe('alpha_v2');
    expect(codes(result.changes)).not.toContain('tool-removed');
    expect(codes(result.changes)).not.toContain('tool-added');
  });

  it('counts every classification', () => {
    const before = [tool({ type: 'string', enum: ['a', 'b'], description: 'Old' })];
    const after = [
      {
        name: 'demo_tool',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'string', enum: ['a'], description: 'New' },
            extra: { type: 'string' },
          },
        },
      } as CanonicalTool,
    ];
    const result = diffToolSets(before, after);

    expect(result.summary.breaking).toBe(1);
    expect(result.summary.nonBreaking).toBe(1);
    expect(result.summary.informational).toBe(1);
  });

  it('sorts changes deterministically', () => {
    const first = diffToolSets([alpha, beta], [beta]);
    const second = diffToolSets([alpha, beta], [beta]);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.changes.map((change) => change.toolName)).toEqual(
      [...first.changes].map((change) => change.toolName).sort(),
    );
  });

  it('reports nothing for identical tool sets', () => {
    const result = diffToolSets([alpha, beta], [alpha, beta]);

    expect(result.changes).toEqual([]);
    expect(result.summary).toEqual({ breaking: 0, nonBreaking: 0, informational: 0 });
  });
});

describe('diffTools — reference resolution', () => {
  const inline: CanonicalTool = {
    name: 'demo_tool',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'object', properties: { cents: { type: 'integer' } }, required: ['cents'] },
      },
    },
  };

  const referenced: CanonicalTool = {
    name: 'demo_tool',
    inputSchema: {
      type: 'object',
      $defs: {
        Money: { type: 'object', properties: { cents: { type: 'integer' } }, required: ['cents'] },
      },
      properties: { value: { $ref: '#/$defs/Money' } },
    },
  };

  it('reports no change when an inline subschema becomes an equivalent `$ref`', () => {
    expect(diffTools(inline, referenced)).toEqual([]);
  });

  it('reports no change when a `$ref` is inlined again', () => {
    expect(diffTools(referenced, inline)).toEqual([]);
  });

  it('reports no change through a set diff, so rename detection sees it too', () => {
    expect(diffToolSets([inline], [referenced]).summary).toEqual({
      breaking: 0,
      nonBreaking: 0,
      informational: 0,
    });
  });

  it('still sees a real change made behind a `$ref`', () => {
    const narrowed: CanonicalTool = {
      name: 'demo_tool',
      inputSchema: {
        type: 'object',
        $defs: {
          Money: {
            type: 'object',
            properties: { cents: { type: 'integer', minimum: 0 } },
            required: ['cents'],
          },
        },
        properties: { value: { $ref: '#/$defs/Money' } },
      },
    };
    const changes = diffTools(inline, narrowed);

    expect(codes(changes)).toEqual(['constraint-added']);
    expect(changes[0]?.path).toBe('inputSchema.properties.value.properties.cents.minimum');
  });

  it('matches a rename across an inline/`$ref` refactor', () => {
    const renamed: CanonicalTool = { ...referenced, name: 'demo_tool_v2' };
    const changes = diffToolSets([inline], [renamed]).changes;

    expect(codes(changes)).toEqual(['tool-renamed']);
  });

  it('compares a sibling keyword through the reference', () => {
    const described: CanonicalTool = {
      name: 'demo_tool',
      inputSchema: {
        type: 'object',
        $defs: {
          Money: { type: 'object', properties: { cents: { type: 'integer' } }, required: ['cents'] },
        },
        properties: { value: { $ref: '#/$defs/Money', description: 'How much' } },
      },
    };

    expect(codes(diffTools(inline, described))).toEqual(['description-changed']);
  });
});

describe('diffTools — references that could not be resolved', () => {
  function refTool(property: JsonSchema): CanonicalTool {
    return { name: 'demo_tool', inputSchema: { type: 'object', properties: { value: property } } };
  }

  it('reports a changed unresolvable reference as breaking', () => {
    const changes = diffTools(
      refTool({ $ref: 'https://example.com/a.json' }),
      refTool({ $ref: 'https://example.com/b.json' }),
    );

    expect(codes(changes)).toEqual(['ref-changed']);
    expect(changes[0]?.classification).toBe('breaking');
    expect(changes[0]?.path).toBe('inputSchema.properties.value.$ref');
  });

  it('reports an unresolvable reference replacing an inline schema as breaking', () => {
    const changes = diffTools(refTool({ type: 'string' }), refTool({ $ref: '#/$defs/Nope' }));

    expect(codes(changes)).toContain('ref-added');
    expect(find(changes, 'ref-added')?.classification).toBe('breaking');
  });

  it('reports an unresolvable reference being replaced as breaking', () => {
    expect(codes(diffTools(refTool({ $ref: '#/$defs/Nope' }), refTool({ type: 'string' })))).toContain(
      'ref-removed',
    );
  });

  it('reports nothing when the same recursive reference is on both sides', () => {
    expect(diffTools(recursiveTool, recursiveTool)).toEqual([]);
  });

  it('reports the change when a recursive definition is edited', () => {
    const edited: CanonicalTool = {
      ...recursiveTool,
      inputSchema: {
        ...recursiveTool.inputSchema,
        $defs: {
          Node: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              children: { type: 'array', items: { $ref: '#/$defs/Node' } },
            },
            required: ['label', 'children'],
          },
        },
      },
    };

    // The use site is an opaque `$ref` on both sides, so the edit surfaces at
    // the definition instead: a recursive schema is compared where it is
    // declared, because it cannot be compared where it is used.
    const changes = diffTools(recursiveTool, edited);

    expect(codes(changes)).toEqual(['property-made-required']);
    expect(changes[0]?.path).toBe('inputSchema.$defs.Node.required');
  });
});
