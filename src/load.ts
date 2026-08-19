import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { CanonicalTool, LoadError, LoadResult, LoadedTool } from './types.js';
import { compareStrings, isPlainObject } from './schema.js';
import { validateCanonicalTool } from './validate-tool.js';

export interface LoadOptions {
  /** Recurse into subdirectories. Default `true`. */
  recursive?: boolean;
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage']);

/**
 * Load canonical tool definitions from a file or directory.
 *
 * A `.json` file may contain:
 *   - one tool object,
 *   - an array of tool objects, or
 *   - `{ "tools": [ ... ] }`.
 *
 * Malformed files are reported in `errors` rather than thrown, so one bad file
 * does not hide the rest. Tools are returned sorted by name, which keeps every
 * downstream output deterministic regardless of file-system ordering.
 */
export function loadTools(inputPath: string, options: LoadOptions = {}): LoadResult {
  const recursive = options.recursive ?? true;
  const tools: LoadedTool[] = [];
  const errors: LoadError[] = [];

  let stats;
  try {
    stats = statSync(inputPath);
  } catch {
    return { tools, errors: [{ sourcePath: inputPath, message: 'Path does not exist.' }] };
  }

  const files = stats.isDirectory() ? listJsonFiles(inputPath, recursive) : [inputPath];

  if (stats.isDirectory() && files.length === 0) {
    errors.push({ sourcePath: inputPath, message: 'Directory contains no .json tool definitions.' });
  }

  for (const file of files) {
    readToolFile(file, tools, errors);
  }

  const seen = new Map<string, string>();
  for (const loaded of tools) {
    const previous = seen.get(loaded.tool.name);
    if (previous !== undefined) {
      errors.push({
        sourcePath: loaded.sourcePath,
        message: `Duplicate tool name \`${loaded.tool.name}\`, already defined in ${previous}.`,
      });
    } else {
      seen.set(loaded.tool.name, loaded.sourcePath);
    }
  }

  tools.sort((a, b) => compareStrings(a.tool.name, b.tool.name));
  errors.sort((a, b) => compareStrings(`${a.sourcePath}${a.message}`, `${b.sourcePath}${b.message}`));

  return { tools, errors };
}

function listJsonFiles(directory: string, recursive: boolean): string[] {
  const found: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    compareStrings(a.name, b.name),
  );

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (recursive && !SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...listJsonFiles(full, recursive));
      }
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      found.push(full);
    }
  }

  return found;
}

function readToolFile(file: string, tools: LoadedTool[], errors: LoadError[]): void {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    errors.push({ sourcePath: file, message: `Could not read file: ${messageOf(error)}` });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    errors.push({ sourcePath: file, message: `Invalid JSON: ${messageOf(error)}` });
    return;
  }

  for (const [index, candidate] of toolCandidates(parsed).entries()) {
    const basePath = Array.isArray(parsed) || isPlainObject(parsed) && Array.isArray(parsed['tools'])
      ? `[${index}]`
      : '';
    const issues = validateCanonicalTool(candidate, basePath);
    if (issues.length > 0) {
      for (const issue of issues) {
        errors.push({ sourcePath: file, message: issue.message, path: issue.path });
      }
      continue;
    }
    tools.push({ tool: candidate as CanonicalTool, sourcePath: file });
  }
}

function toolCandidates(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (isPlainObject(parsed) && Array.isArray(parsed['tools'])) return parsed['tools'];
  return [parsed];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turn a tool name into a stable output file base name.
 * `refund_order` -> `refund-order`
 */
export function toolFileBaseName(name: string): string {
  return name
    .replace(/[_\s]+/g, '-')
    .replace(/[^A-Za-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/** Present a path relative to `from`, using forward slashes. */
export function displayPath(target: string, from: string = process.cwd()): string {
  const rel = relative(from, target);
  const normalized = (rel === '' ? target : rel).split(sep).join('/');
  return normalized.startsWith('..') ? normalized : normalized;
}
