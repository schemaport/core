import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '../src/types.js';
import { hasRefs, resolveSchemaRefs, resolveToolRefs } from '../src/resolve.js';
import { lookupRef } from '../src/schema.js';
import {
  danglingRefTool,
  externalRefTool,
  recursiveTool,
  refDefsTool,
  refundOrderTool,
} from '../src/fixtures.js';

/** Wrap one property schema in an object schema, with optional definitions. */
function withDefs(property: JsonSchema, defs?: Record<string, JsonSchema>): JsonSchema {
  return {
    type: 'object',
    ...(defs ? { $defs: defs } : {}),
    properties: { value: property },
  };
}

/** The resolved schema for `properties.value`. */
function resolvedValue(schema: JsonSchema): JsonSchema {
  const { schema: out } = resolveSchemaRefs(schema);
  return (out.properties as Record<string, JsonSchema>)['value'] as JsonSchema;
}

function codes(schema: JsonSchema): string[] {
  return resolveSchemaRefs(schema).issues.map((issue) => issue.code);
}

describe('hasRefs', () => {
  it('is false for a schema with no references', () => {
    expect(hasRefs(refundOrderTool.inputSchema)).toBe(false);
  });

  it('is true for a reference at any depth', () => {
    expect(hasRefs(withDefs({ items: { $ref: '#/$defs/X' } }))).toBe(true);
  });

  it('is true for a reference that only appears inside a definition', () => {
    expect(hasRefs({ type: 'object', $defs: { A: { $ref: '#/$defs/B' } } })).toBe(true);
  });
});

describe('lookupRef', () => {
  const root: JsonSchema = {
    type: 'object',
    $defs: { Money: { type: 'number' } },
    properties: { orderId: { type: 'string' } },
    anyOf: [{ type: 'object' }],
    required: ['orderId'],
  };

  it('resolves a `$defs` pointer', () => {
    expect(lookupRef(root, '#/$defs/Money')).toEqual({ kind: 'found', schema: { type: 'number' } });
  });

  it('resolves a pointer into `properties`', () => {
    expect(lookupRef(root, '#/properties/orderId')).toEqual({
      kind: 'found',
      schema: { type: 'string' },
    });
  });

  it('resolves an array index', () => {
    expect(lookupRef(root, '#/anyOf/0')).toEqual({ kind: 'found', schema: { type: 'object' } });
  });

  it('resolves the root pointer to the document itself', () => {
    expect(lookupRef(root, '#')).toEqual({ kind: 'found', schema: root });
  });

  it('classifies each way a lookup can fail', () => {
    expect(lookupRef(root, 'https://example.com/a.json').kind).toBe('external');
    expect(lookupRef(root, '#money').kind).toBe('anchor');
    expect(lookupRef(root, '#/$defs/%zz').kind).toBe('malformed');
    expect(lookupRef(root, '#/$defs/Missing').kind).toBe('missing');
    expect(lookupRef(root, '#/anyOf/7').kind).toBe('missing');
    expect(lookupRef(root, '#/required/0').kind).toBe('not-a-schema');
  });
});

describe('resolveSchemaRefs — resolvable references', () => {
  it('inlines a `$defs` reference and drops the definition map', () => {
    const { schema, issues, resolvedCount } = resolveSchemaRefs(
      withDefs({ $ref: '#/$defs/Money' }, { Money: { type: 'number', minimum: 0 } }),
    );

    expect(issues).toEqual([]);
    expect(resolvedCount).toBe(1);
    expect(schema).toEqual({
      type: 'object',
      properties: { value: { type: 'number', minimum: 0 } },
    });
  });

  it('inlines a draft-07 `definitions` reference', () => {
    const schema: JsonSchema = {
      type: 'object',
      definitions: { Money: { type: 'number' } },
      properties: { value: { $ref: '#/definitions/Money' } },
    };

    expect(resolveSchemaRefs(schema).schema).toEqual({
      type: 'object',
      properties: { value: { type: 'number' } },
    });
  });

  it('follows a reference to a reference', () => {
    const schema = withDefs({ $ref: '#/$defs/Alias' }, {
      Alias: { $ref: '#/$defs/Money' },
      Money: { type: 'number' },
    });

    expect(resolvedValue(schema)).toEqual({ type: 'number' });
    expect(resolveSchemaRefs(schema).resolvedCount).toBe(2);
  });

  it('resolves a deep pointer into `properties`', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        orderId: { type: 'string', minLength: 3 },
        alias: { $ref: '#/properties/orderId' },
      },
    };

    expect(resolveSchemaRefs(schema).schema).toEqual({
      type: 'object',
      properties: {
        orderId: { type: 'string', minLength: 3 },
        alias: { type: 'string', minLength: 3 },
      },
    });
  });

  it('unescapes `~1` as `/` and `~0` as `~`', () => {
    const schema = withDefs({ $ref: '#/$defs/a~1b' }, { 'a/b': { type: 'string' } });
    expect(resolvedValue(schema)).toEqual({ type: 'string' });

    const tilde = withDefs({ $ref: '#/$defs/c~0d' }, { 'c~d': { type: 'number' } });
    expect(resolvedValue(tilde)).toEqual({ type: 'number' });
  });

  it('percent-decodes a pointer segment', () => {
    const schema = withDefs({ $ref: '#/$defs/unit%20price' }, { 'unit price': { type: 'number' } });
    expect(resolvedValue(schema)).toEqual({ type: 'number' });
  });

  it('resolves references inside items, anyOf and additionalProperties', () => {
    const schema: JsonSchema = {
      type: 'object',
      $defs: { Id: { type: 'string' } },
      properties: {
        list: { type: 'array', items: { $ref: '#/$defs/Id' } },
        either: { anyOf: [{ $ref: '#/$defs/Id' }, { type: 'null' }] },
        map: { type: 'object', additionalProperties: { $ref: '#/$defs/Id' } },
      },
    };

    const { schema: out, resolvedCount } = resolveSchemaRefs(schema);
    const properties = out.properties as Record<string, JsonSchema>;

    expect(resolvedCount).toBe(3);
    expect(properties['list']?.items).toEqual({ type: 'string' });
    expect(properties['either']?.anyOf?.[0]).toEqual({ type: 'string' });
    expect(properties['map']?.additionalProperties).toEqual({ type: 'string' });
  });

  it('resolves a reference nested inside a resolved target', () => {
    const schema = withDefs({ $ref: '#/$defs/Order' }, {
      Order: { type: 'object', properties: { line: { $ref: '#/$defs/Line' } } },
      Line: { type: 'object', properties: { sku: { type: 'string' } } },
    });

    expect(resolvedValue(schema)).toEqual({
      type: 'object',
      properties: { line: { type: 'object', properties: { sku: { type: 'string' } } } },
    });
  });

  it('keeps the definition map when the caller asks for it', () => {
    const schema = withDefs({ $ref: '#/$defs/Money' }, { Money: { type: 'number' } });
    const { schema: out } = resolveSchemaRefs(schema, { keepDefinitions: true });

    expect(out['$defs']).toEqual({ Money: { type: 'number' } });
  });

  it('keeps the definition map when a reference was left unresolved', () => {
    const schema: JsonSchema = {
      type: 'object',
      $defs: { Money: { type: 'number' } },
      properties: {
        good: { $ref: '#/$defs/Money' },
        bad: { $ref: '#/$defs/Missing' },
      },
    };

    expect(resolveSchemaRefs(schema).schema['$defs']).toEqual({ Money: { type: 'number' } });
  });

  it('keeps a definition map that nothing referenced', () => {
    const schema: JsonSchema = { type: 'object', $defs: { Money: { type: 'number' } }, properties: {} };

    expect(resolveSchemaRefs(schema).schema['$defs']).toEqual({ Money: { type: 'number' } });
  });
});

describe('resolveSchemaRefs — sibling keywords', () => {
  it('keeps a sibling keyword the target does not declare', () => {
    const schema = withDefs({ $ref: '#/$defs/Money', minimum: 0 }, { Money: { type: 'number' } });

    expect(resolvedValue(schema)).toEqual({ type: 'number', minimum: 0 });
  });

  it('lets a sibling annotation override the target', () => {
    const schema = withDefs(
      { $ref: '#/$defs/Money', description: 'the local one' },
      { Money: { type: 'number', description: 'the shared one' } },
    );

    expect(resolvedValue(schema)).toEqual({ type: 'number', description: 'the local one' });
  });

  it('keeps both assertions with `allOf` when the target declares the same keyword', () => {
    const schema = withDefs(
      { $ref: '#/$defs/Name', minLength: 3 },
      { Name: { type: 'string', minLength: 5 } },
    );

    expect(resolvedValue(schema)).toEqual({
      type: 'string',
      minLength: 5,
      allOf: [{ minLength: 3 }],
    });
  });

  it('appends the conflict branch to an existing `allOf`', () => {
    const schema = withDefs(
      { $ref: '#/$defs/Name', minLength: 3 },
      { Name: { type: 'string', minLength: 5, allOf: [{ maxLength: 9 }] } },
    );

    expect(resolvedValue(schema)?.allOf).toEqual([{ maxLength: 9 }, { minLength: 3 }]);
  });

  it('does not build an `allOf` when the sibling repeats the target verbatim', () => {
    const schema = withDefs(
      { $ref: '#/$defs/Name', minLength: 5 },
      { Name: { type: 'string', minLength: 5 } },
    );

    expect(resolvedValue(schema)).toEqual({ type: 'string', minLength: 5 });
  });
});

describe('resolveSchemaRefs — references that cannot be resolved', () => {
  it('reports an external reference and leaves it in place', () => {
    const schema = withDefs({ $ref: 'https://example.com/schemas/money.json' });
    const { schema: out, issues } = resolveSchemaRefs(schema);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('external-ref');
    expect(issues[0]?.path).toBe('inputSchema.properties.value.$ref');
    expect(issues[0]?.pointer).toBe('https://example.com/schemas/money.json');
    expect(issues[0]?.message).toContain('points outside this document');
    expect(resolvedValue(out)).toEqual({ $ref: 'https://example.com/schemas/money.json' });
  });

  it('reports a dangling pointer', () => {
    const schema = withDefs({ $ref: '#/$defs/Missing' }, { Money: { type: 'number' } });
    const [issue] = resolveSchemaRefs(schema).issues;

    expect(issue?.code).toBe('dangling-ref');
    expect(issue?.message).toContain('does not resolve');
  });

  it('reports a pointer that lands on something that is not a schema', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { id: { type: 'string' }, alias: { $ref: '#/required/0' } },
      required: ['id'],
    };
    const [issue] = resolveSchemaRefs(schema).issues;

    expect(issue?.code).toBe('dangling-ref');
    expect(issue?.message).toContain('not a schema object');
  });

  it('reports an `$anchor` fragment as a form it does not index', () => {
    expect(codes(withDefs({ $ref: '#money' }))).toEqual(['anchor-ref']);
  });

  it('reports a malformed percent-escape', () => {
    const schema = withDefs({ $ref: '#/$defs/%zz' }, { Money: { type: 'number' } });
    expect(codes(schema)).toEqual(['invalid-ref']);
  });

  it('reports a `$ref` that is not a string', () => {
    expect(codes(withDefs({ $ref: 7 } as unknown as JsonSchema))).toEqual(['invalid-ref']);
  });

  it('still resolves the rest of the document around an unresolvable reference', () => {
    const schema: JsonSchema = {
      type: 'object',
      $defs: { Money: { type: 'number' } },
      properties: { good: { $ref: '#/$defs/Money' }, bad: { $ref: '#/$defs/Missing' } },
    };
    const { schema: out, issues, resolvedCount } = resolveSchemaRefs(schema);
    const properties = out.properties as Record<string, JsonSchema>;

    expect(resolvedCount).toBe(1);
    expect(issues).toHaveLength(1);
    expect(properties['good']).toEqual({ type: 'number' });
    expect(properties['bad']).toEqual({ $ref: '#/$defs/Missing' });
  });

  it('stops a chain that is deeper than `maxDepth`', () => {
    const schema = withDefs({ $ref: '#/$defs/A' }, {
      A: { $ref: '#/$defs/B' },
      B: { $ref: '#/$defs/C' },
      C: { type: 'string' },
    });
    const { issues } = resolveSchemaRefs(schema, { maxDepth: 2 });

    expect(issues.map((issue) => issue.code)).toEqual(['ref-depth-exceeded']);
    expect(issues[0]?.message).toContain('more than 2 references deep');
  });
});

describe('resolveSchemaRefs — recursion', () => {
  it('detects direct self-recursion and names the cycle', () => {
    const { schema, issues, resolvedCount } = resolveSchemaRefs(recursiveTool.inputSchema);

    expect(resolvedCount).toBe(0);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('recursive-ref');
    expect(issues[0]?.pointer).toBe('#/$defs/Node');
    expect(issues[0]?.path).toBe('inputSchema.properties.root.$ref');
    expect(issues[0]?.message).toContain('#/$defs/Node -> #/$defs/Node');
    // Left exactly as written — never half expanded.
    expect(schema).toEqual(recursiveTool.inputSchema);
  });

  it('detects mutual recursion and reports the whole loop', () => {
    const schema = withDefs({ $ref: '#/$defs/A' }, {
      A: { type: 'object', properties: { b: { $ref: '#/$defs/B' } } },
      B: { type: 'object', properties: { a: { $ref: '#/$defs/A' } } },
    });
    const { issues, resolvedCount } = resolveSchemaRefs(schema);

    expect(resolvedCount).toBe(0);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('#/$defs/A -> #/$defs/B -> #/$defs/A');
  });

  it('reports a reference that only reaches a cycle, without expanding it', () => {
    const schema = withDefs({ $ref: '#/$defs/Entry' }, {
      Entry: { type: 'object', properties: { node: { $ref: '#/$defs/Node' } } },
      Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } },
    });
    const { schema: out, issues } = resolveSchemaRefs(schema);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.pointer).toBe('#/$defs/Entry');
    expect(issues[0]?.message).toContain('reaches a recursive definition');
    expect(issues[0]?.message).toContain('#/$defs/Node -> #/$defs/Node');
    expect(resolvedValue(out)).toEqual({ $ref: '#/$defs/Entry' });
  });

  it('treats a reference to the document root as recursive', () => {
    expect(codes(withDefs({ $ref: '#' }))).toEqual(['recursive-ref']);
  });

  it('resolves a non-recursive reference that sits beside a recursive one', () => {
    const schema: JsonSchema = {
      type: 'object',
      $defs: {
        Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } },
        Id: { type: 'string' },
      },
      properties: { tree: { $ref: '#/$defs/Node' }, id: { $ref: '#/$defs/Id' } },
    };
    const { schema: out, issues, resolvedCount } = resolveSchemaRefs(schema);
    const properties = out.properties as Record<string, JsonSchema>;

    expect(resolvedCount).toBe(1);
    expect(issues.map((issue) => issue.code)).toEqual(['recursive-ref']);
    expect(properties['id']).toEqual({ type: 'string' });
    expect(properties['tree']).toEqual({ $ref: '#/$defs/Node' });
  });

  it('does not report a recursive definition nothing points at', () => {
    const schema: JsonSchema = {
      type: 'object',
      $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } },
      properties: { name: { type: 'string' } },
    };

    expect(resolveSchemaRefs(schema).issues).toEqual([]);
  });
});

describe('resolveSchemaRefs — determinism and purity', () => {
  it('produces byte-identical output when run twice', () => {
    const first = resolveSchemaRefs(refDefsTool.inputSchema);
    const second = resolveSchemaRefs(refDefsTool.inputSchema);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('is deterministic for a document full of unresolvable references', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        b: { $ref: '#/$defs/Missing' },
        a: { $ref: 'https://example.com/a.json' },
        c: { $ref: '#anchor' },
      },
    };

    expect(JSON.stringify(resolveSchemaRefs(schema))).toBe(JSON.stringify(resolveSchemaRefs(schema)));
  });

  it('sorts issues by path', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        z: { $ref: '#/$defs/Missing' },
        a: { $ref: '#/$defs/Missing' },
      },
    };

    expect(resolveSchemaRefs(schema).issues.map((issue) => issue.path)).toEqual([
      'inputSchema.properties.a.$ref',
      'inputSchema.properties.z.$ref',
    ]);
  });

  it('does not mutate the schema it was given', () => {
    const before = JSON.stringify(refDefsTool.inputSchema);
    resolveSchemaRefs(refDefsTool.inputSchema);

    expect(JSON.stringify(refDefsTool.inputSchema)).toBe(before);
  });

  it('does not mutate the input when a reference stays unresolved', () => {
    const before = JSON.stringify(recursiveTool.inputSchema);
    resolveSchemaRefs(recursiveTool.inputSchema);

    expect(JSON.stringify(recursiveTool.inputSchema)).toBe(before);
  });

  it('preserves keyword order so resolved output serializes stably', () => {
    const schema: JsonSchema = {
      type: 'object',
      $defs: { Money: { type: 'number' } },
      properties: { b: { type: 'string' }, a: { $ref: '#/$defs/Money' } },
      required: ['a'],
    };

    expect(Object.keys(resolveSchemaRefs(schema).schema)).toEqual([
      'type',
      'properties',
      'required',
    ]);
    expect(Object.keys(resolveSchemaRefs(schema).schema.properties ?? {})).toEqual(['b', 'a']);
  });

  it('is a no-op on an already resolved schema', () => {
    const once = resolveSchemaRefs(refDefsTool.inputSchema).schema;
    const twice = resolveSchemaRefs(once);

    expect(twice.resolvedCount).toBe(0);
    expect(twice.schema).toEqual(once);
  });
});

describe('resolveToolRefs', () => {
  it('resolves the input schema and keeps the rest of the tool', () => {
    const { tool, issues } = resolveToolRefs(refDefsTool);

    expect(issues).toEqual([]);
    expect(tool.name).toBe(refDefsTool.name);
    expect(tool.description).toBe(refDefsTool.description);
    expect(tool.inputSchema['$defs']).toBeUndefined();
  });

  it('reports issues under `inputSchema`', () => {
    expect(resolveToolRefs(externalRefTool).issues[0]?.path).toBe(
      'inputSchema.properties.address.$ref',
    );
    expect(resolveToolRefs(danglingRefTool).issues[0]?.path).toBe(
      'inputSchema.properties.coupon.$ref',
    );
  });

  it('leaves a tool without references untouched', () => {
    const { tool, issues } = resolveToolRefs(refundOrderTool);

    expect(issues).toEqual([]);
    expect(tool.inputSchema).toEqual(refundOrderTool.inputSchema);
  });
});
