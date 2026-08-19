import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadTools, toolFileBaseName } from '../src/load.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (...parts: string[]): string => join(here, 'fixtures', ...parts);

describe('loadTools', () => {
  it('loads a single tool file', () => {
    const result = loadTools(fixture('tools', 'refund-order.json'));

    expect(result.errors).toEqual([]);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]?.tool.name).toBe('refund_order');
    expect(result.tools[0]?.tool.inputSchema.required).toEqual(['orderId']);
    expect(result.tools[0]?.sourcePath).toBe(fixture('tools', 'refund-order.json'));
  });

  it('loads a directory, recursing into subdirectories', () => {
    const result = loadTools(fixture('tools'));

    expect(result.errors).toEqual([]);
    expect(result.tools.map((entry) => entry.tool.name)).toEqual([
      'alpha_tool',
      'beta_tool',
      'refund_order',
      'search_orders',
    ]);
  });

  it('stops at the top level when recursive is false', () => {
    const result = loadTools(fixture('tools'), { recursive: false });

    expect(result.tools.map((entry) => entry.tool.name)).not.toContain('search_orders');
  });

  it('reads a file containing an array of tools', () => {
    const result = loadTools(fixture('tools', 'array-file.json'));

    expect(result.errors).toEqual([]);
    expect(result.tools.map((entry) => entry.tool.name)).toEqual(['alpha_tool', 'beta_tool']);
  });

  it('returns tools sorted by name regardless of file-system order', () => {
    const names = loadTools(fixture('tools')).tools.map((entry) => entry.tool.name);

    expect(names).toEqual([...names].sort());
  });

  it('is deterministic across repeated loads', () => {
    const first = loadTools(fixture('tools'));
    const second = loadTools(fixture('tools'));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('reports a missing path instead of throwing', () => {
    const result = loadTools(fixture('does-not-exist'));

    expect(result.tools).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('does not exist');
  });

  it('reports an empty directory', () => {
    const result = loadTools(fixture('empty'));

    expect(result.tools).toEqual([]);
    expect(result.errors[0]?.message).toContain('no .json tool definitions');
  });

  it('reports invalid JSON with the file path', () => {
    const result = loadTools(fixture('invalid', 'malformed.json'));

    expect(result.tools).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/Invalid JSON/);
    expect(result.errors[0]?.sourcePath).toContain('malformed.json');
  });

  it('reports a file that is valid JSON but not a canonical tool', () => {
    const result = loadTools(fixture('invalid', 'not-a-tool.json'));

    expect(result.tools).toEqual([]);
    expect(result.errors.some((error) => error.message.includes('`name` is required'))).toBe(true);
    expect(result.errors.some((error) => error.message.includes('`inputSchema` is required'))).toBe(true);
  });

  it('reports required properties that are not declared', () => {
    const result = loadTools(fixture('invalid', 'dangling-required.json'));

    expect(result.tools).toEqual([]);
    expect(result.errors[0]?.message).toContain('not declared in `properties`');
  });

  it('keeps loading other files when one file is broken', () => {
    const result = loadTools(fixture('invalid'));

    expect(result.errors.length).toBeGreaterThan(1);
    expect(result.tools).toEqual([]);
  });

  it('flags duplicate tool names across files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'schemaport-load-'));
    const tool = { name: 'refund_order', inputSchema: { type: 'object', properties: {} } };
    writeFileSync(join(directory, 'a.json'), JSON.stringify(tool));
    writeFileSync(join(directory, 'b.json'), JSON.stringify(tool));

    const result = loadTools(directory);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('Duplicate tool name `refund_order`');

    rmSync(directory, { recursive: true, force: true });
  });
});

describe('toolFileBaseName', () => {
  it('converts a snake_case tool name to a kebab-case file name', () => {
    expect(toolFileBaseName('refund_order')).toBe('refund-order');
  });

  it('normalizes spaces, repeated separators and casing', () => {
    expect(toolFileBaseName('Refund  Order')).toBe('refund-order');
    expect(toolFileBaseName('__refund__order__')).toBe('refund-order');
  });

  it('drops characters that are unsafe in file names', () => {
    expect(toolFileBaseName('refund/order?')).toBe('refund-order');
  });

  it('is deterministic', () => {
    expect(toolFileBaseName('create_ticket')).toBe(toolFileBaseName('create_ticket'));
  });
});
