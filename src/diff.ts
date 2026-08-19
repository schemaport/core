import type {
  CanonicalTool,
  ChangeClassification,
  DiffResult,
  JsonSchema,
  SchemaChange,
} from './types.js';
import { asSchema, deepEqual, isPlainObject, joinPath, schemaTypes } from './schema.js';

/**
 * Structural comparison of canonical tool schemas.
 *
 * The question this answers is narrow and practical: *would an argument object
 * that was valid against the old schema still be valid against the new one, and
 * would a caller written against the old schema still work?* It does not attempt
 * general JSON Schema subsumption. Cases it cannot classify with confidence are
 * reported as breaking, because a false "safe" is the expensive mistake.
 */
export function diffToolSets(
  before: readonly CanonicalTool[],
  after: readonly CanonicalTool[],
): DiffResult {
  const changes: SchemaChange[] = [];

  const beforeByName = new Map(before.map((tool) => [tool.name, tool]));
  const afterByName = new Map(after.map((tool) => [tool.name, tool]));

  const removed = before.filter((tool) => !afterByName.has(tool.name));
  const added = after.filter((tool) => !beforeByName.has(tool.name));

  // A removed tool and an added tool with an identical input schema is almost
  // always a rename. Naming it as such is more useful than two separate lines.
  const unmatchedAdded = [...added];
  const stillRemoved: CanonicalTool[] = [];

  for (const gone of removed) {
    const matchIndex = unmatchedAdded.findIndex((candidate) =>
      deepEqual(gone.inputSchema, candidate.inputSchema),
    );
    if (matchIndex === -1) {
      stillRemoved.push(gone);
      continue;
    }
    const match = unmatchedAdded.splice(matchIndex, 1)[0] as CanonicalTool;
    changes.push({
      classification: 'breaking',
      code: 'tool-renamed',
      toolName: gone.name,
      path: 'name',
      message: `Tool \`${gone.name}\` was renamed to \`${match.name}\`. Callers using the old name will fail.`,
      before: gone.name,
      after: match.name,
    });
    changes.push(...diffTools({ ...gone, name: gone.name }, { ...match, name: gone.name }));
  }

  for (const gone of stillRemoved) {
    changes.push({
      classification: 'breaking',
      code: 'tool-removed',
      toolName: gone.name,
      path: 'name',
      message: `Tool \`${gone.name}\` was removed.`,
      before: gone.name,
    });
  }

  for (const fresh of unmatchedAdded) {
    changes.push({
      classification: 'non-breaking',
      code: 'tool-added',
      toolName: fresh.name,
      path: 'name',
      message: `Tool \`${fresh.name}\` was added.`,
      after: fresh.name,
    });
  }

  for (const tool of before) {
    const next = afterByName.get(tool.name);
    if (next) changes.push(...diffTools(tool, next));
  }

  return summarizeChanges(changes);
}

/** Compare two versions of the same tool. */
export function diffTools(before: CanonicalTool, after: CanonicalTool): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const context: DiffContext = { toolName: before.name, changes };

  if (before.description !== after.description) {
    record(context, 'informational', 'tool-description-changed', 'description',
      'The tool description changed.', before.description, after.description);
  }

  diffSchema(before.inputSchema, after.inputSchema, 'inputSchema', context);
  return sortChanges(changes);
}

/** Group a flat change list into a `DiffResult` with counts. */
export function summarizeChanges(changes: readonly SchemaChange[]): DiffResult {
  const sorted = sortChanges(changes);
  return {
    changes: sorted,
    summary: {
      breaking: sorted.filter((change) => change.classification === 'breaking').length,
      nonBreaking: sorted.filter((change) => change.classification === 'non-breaking').length,
      informational: sorted.filter((change) => change.classification === 'informational').length,
    },
  };
}

const CLASSIFICATION_ORDER: Record<ChangeClassification, number> = {
  breaking: 0,
  'non-breaking': 1,
  informational: 2,
};

function sortChanges(changes: readonly SchemaChange[]): SchemaChange[] {
  return [...changes].sort(
    (a, b) =>
      a.toolName.localeCompare(b.toolName) ||
      CLASSIFICATION_ORDER[a.classification] - CLASSIFICATION_ORDER[b.classification] ||
      a.path.localeCompare(b.path) ||
      a.code.localeCompare(b.code),
  );
}

/* -------------------------------------------------------------------------- */

interface DiffContext {
  toolName: string;
  changes: SchemaChange[];
}

function record(
  context: DiffContext,
  classification: ChangeClassification,
  code: string,
  path: string,
  message: string,
  before?: unknown,
  after?: unknown,
): void {
  const change: SchemaChange = {
    classification,
    code,
    toolName: context.toolName,
    path,
    message,
  };
  if (before !== undefined) change.before = before;
  if (after !== undefined) change.after = after;
  context.changes.push(change);
}

function diffSchema(before: JsonSchema, after: JsonSchema, path: string, context: DiffContext): void {
  diffTypes(before, after, path, context);
  diffEnum(before, after, path, context);
  diffConst(before, after, path, context);
  diffNumericConstraints(before, after, path, context);
  diffPattern(before, after, path, context);
  diffArray(before, after, path, context);
  diffObject(before, after, path, context);
  diffComposition(before, after, path, context);
  diffMetadata(before, after, path, context);
}

/* --- types ---------------------------------------------------------------- */

function diffTypes(before: JsonSchema, after: JsonSchema, path: string, context: DiffContext): void {
  const oldTypes = new Set(schemaTypes(before));
  const newTypes = new Set(schemaTypes(after));
  if (setsEqual(oldTypes, newTypes)) return;

  const typePath = joinPath(path, 'type');
  const oldList = [...oldTypes].sort().join(' | ') || '(any)';
  const newList = [...newTypes].sort().join(' | ') || '(any)';

  if (oldTypes.size === 0) {
    record(context, 'breaking', 'type-narrowed', typePath,
      `Type constraint ${newList} was added where any type was previously accepted.`,
      undefined, after.type);
    return;
  }
  if (newTypes.size === 0) {
    record(context, 'non-breaking', 'type-widened', typePath,
      `Type constraint ${oldList} was removed; any type is now accepted.`, before.type);
    return;
  }
  if (isSuperset(newTypes, oldTypes)) {
    record(context, 'non-breaking', 'type-widened', typePath,
      `Type widened from ${oldList} to ${newList}.`, before.type, after.type);
    return;
  }
  if (isSuperset(oldTypes, newTypes)) {
    record(context, 'breaking', 'type-narrowed', typePath,
      `Type narrowed from ${oldList} to ${newList}.`, before.type, after.type);
    return;
  }
  record(context, 'breaking', 'type-changed', typePath,
    `Type changed from ${oldList} to ${newList}.`, before.type, after.type);
}

/* --- enum / const --------------------------------------------------------- */

function diffEnum(before: JsonSchema, after: JsonSchema, path: string, context: DiffContext): void {
  const enumPath = joinPath(path, 'enum');
  const oldEnum = Array.isArray(before.enum) ? before.enum : undefined;
  const newEnum = Array.isArray(after.enum) ? after.enum : undefined;

  if (!oldEnum && !newEnum) return;
  if (!oldEnum && newEnum) {
    record(context, 'breaking', 'enum-added', enumPath,
      `An enum was added, restricting accepted values to ${format(newEnum)}.`, undefined, newEnum);
    return;
  }
  if (oldEnum && !newEnum) {
    record(context, 'non-breaking', 'enum-removed', enumPath,
      'The enum was removed; the value is no longer restricted to a fixed list.', oldEnum);
    return;
  }
  if (!oldEnum || !newEnum) return;

  const oldKeys = oldEnum.map((value) => JSON.stringify(value));
  const newKeys = newEnum.map((value) => JSON.stringify(value));
  const dropped = oldEnum.filter((_, index) => !newKeys.includes(oldKeys[index] as string));
  const gained = newEnum.filter((_, index) => !oldKeys.includes(newKeys[index] as string));

  if (dropped.length > 0) {
    record(context, 'breaking', 'enum-narrowed', enumPath,
      `Enum value${dropped.length > 1 ? 's' : ''} ${format(dropped)} removed.`, oldEnum, newEnum);
  }
  if (gained.length > 0) {
    record(context, 'non-breaking', 'enum-expanded', enumPath,
      `Enum value${gained.length > 1 ? 's' : ''} ${format(gained)} added.`, oldEnum, newEnum);
  }
}

function diffConst(before: JsonSchema, after: JsonSchema, path: string, context: DiffContext): void {
  if (deepEqual(before.const, after.const)) return;
  const constPath = joinPath(path, 'const');
  if (before.const === undefined) {
    record(context, 'breaking', 'const-added', constPath,
      `A fixed value ${format([after.const])} was required.`, undefined, after.const);
  } else if (after.const === undefined) {
    record(context, 'non-breaking', 'const-removed', constPath,
      'The fixed value requirement was removed.', before.const);
  } else {
    record(context, 'breaking', 'const-changed', constPath,
      `The required fixed value changed from ${format([before.const])} to ${format([after.const])}.`,
      before.const, after.const);
  }
}

/* --- numeric-style constraints -------------------------------------------- */

/** `lower` bounds narrow when raised; `upper` bounds narrow when lowered. */
const NUMERIC_CONSTRAINTS: { keyword: string; direction: 'lower' | 'upper' }[] = [
  { keyword: 'minimum', direction: 'lower' },
  { keyword: 'exclusiveMinimum', direction: 'lower' },
  { keyword: 'minLength', direction: 'lower' },
  { keyword: 'minItems', direction: 'lower' },
  { keyword: 'minProperties', direction: 'lower' },
  { keyword: 'maximum', direction: 'upper' },
  { keyword: 'exclusiveMaximum', direction: 'upper' },
  { keyword: 'maxLength', direction: 'upper' },
  { keyword: 'maxItems', direction: 'upper' },
  { keyword: 'maxProperties', direction: 'upper' },
];

function diffNumericConstraints(
  before: JsonSchema,
  after: JsonSchema,
  path: string,
  context: DiffContext,
): void {
  for (const { keyword, direction } of NUMERIC_CONSTRAINTS) {
    const oldValue = before[keyword];
    const newValue = after[keyword];
    if (oldValue === newValue) continue;

    const constraintPath = joinPath(path, keyword);
    if (typeof oldValue !== 'number' && typeof newValue === 'number') {
      record(context, 'breaking', 'constraint-added', constraintPath,
        `\`${keyword}\` of ${newValue} was added, narrowing accepted values.`, undefined, newValue);
      continue;
    }
    if (typeof oldValue === 'number' && typeof newValue !== 'number') {
      record(context, 'non-breaking', 'constraint-removed', constraintPath,
        `\`${keyword}\` of ${oldValue} was removed, relaxing accepted values.`, oldValue);
      continue;
    }
    if (typeof oldValue !== 'number' || typeof newValue !== 'number') continue;

    const narrowed = direction === 'lower' ? newValue > oldValue : newValue < oldValue;
    record(
      context,
      narrowed ? 'breaking' : 'non-breaking',
      narrowed ? 'constraint-narrowed' : 'constraint-relaxed',
      constraintPath,
      `\`${keyword}\` changed from ${oldValue} to ${newValue}, ${narrowed ? 'narrowing' : 'relaxing'} accepted values.`,
      oldValue,
      newValue,
    );
  }

  if (before.multipleOf !== after.multipleOf) {
    const multiplePath = joinPath(path, 'multipleOf');
    if (after.multipleOf === undefined) {
      record(context, 'non-breaking', 'constraint-removed', multiplePath,
        '`multipleOf` was removed.', before.multipleOf);
    } else {
      record(context, 'breaking', before.multipleOf === undefined ? 'constraint-added' : 'constraint-narrowed',
        multiplePath, `\`multipleOf\` is now ${after.multipleOf}.`, before.multipleOf, after.multipleOf);
    }
  }

  if (before.uniqueItems !== after.uniqueItems) {
    const uniquePath = joinPath(path, 'uniqueItems');
    const narrowed = after.uniqueItems === true;
    record(context, narrowed ? 'breaking' : 'non-breaking',
      narrowed ? 'constraint-added' : 'constraint-removed', uniquePath,
      narrowed ? '`uniqueItems` was enabled.' : '`uniqueItems` was disabled.',
      before.uniqueItems, after.uniqueItems);
  }
}

function diffPattern(before: JsonSchema, after: JsonSchema, path: string, context: DiffContext): void {
  if (before.pattern === after.pattern) return;
  const patternPath = joinPath(path, 'pattern');
  if (before.pattern === undefined) {
    record(context, 'breaking', 'pattern-added', patternPath,
      `A \`pattern\` (${after.pattern}) was added, rejecting previously valid strings.`,
      undefined, after.pattern);
  } else if (after.pattern === undefined) {
    record(context, 'non-breaking', 'pattern-removed', patternPath,
      'The `pattern` constraint was removed.', before.pattern);
  } else {
    record(context, 'breaking', 'pattern-changed', patternPath,
      `\`pattern\` changed from ${before.pattern} to ${after.pattern}.`, before.pattern, after.pattern);
  }
}

/* --- arrays --------------------------------------------------------------- */

function diffArray(before: JsonSchema, after: JsonSchema, path: string, context: DiffContext): void {
  const oldItems = asSchema(before.items);
  const newItems = asSchema(after.items);
  const itemsPath = joinPath(path, 'items');

  if (oldItems && newItems) {
    diffSchema(oldItems, newItems, itemsPath, context);
    return;
  }
  if (!oldItems && newItems) {
    record(context, 'breaking', 'array-items-added', itemsPath,
      'An `items` schema was added, restricting what the array may contain.', undefined, after.items);
  } else if (oldItems && !newItems) {
    record(context, 'non-breaking', 'array-items-removed', itemsPath,
      'The `items` schema was removed; array contents are no longer restricted.', before.items);
  }
}

/* --- objects -------------------------------------------------------------- */

function diffObject(before: JsonSchema, after: JsonSchema, path: string, context: DiffContext): void {
  const oldProperties = isPlainObject(before.properties) ? before.properties : undefined;
  const newProperties = isPlainObject(after.properties) ? after.properties : undefined;
  const oldRequired = new Set(Array.isArray(before.required) ? before.required : []);
  const newRequired = new Set(Array.isArray(after.required) ? after.required : []);

  if (oldProperties || newProperties) {
    const oldKeys = Object.keys(oldProperties ?? {});
    const newKeys = Object.keys(newProperties ?? {});

    for (const key of oldKeys) {
      if (newKeys.includes(key)) continue;
      record(context, 'breaking', 'property-removed', joinPath(path, 'properties', key),
        `Property \`${key}\` was removed.`, (oldProperties ?? {})[key]);
    }

    for (const key of newKeys) {
      if (oldKeys.includes(key)) continue;
      const propertyPath = joinPath(path, 'properties', key);
      if (newRequired.has(key)) {
        record(context, 'breaking', 'required-property-added', propertyPath,
          `Required property \`${key}\` was added. Existing callers do not send it.`,
          undefined, (newProperties ?? {})[key]);
      } else {
        record(context, 'non-breaking', 'optional-property-added', propertyPath,
          `Optional property \`${key}\` was added.`, undefined, (newProperties ?? {})[key]);
      }
    }

    for (const key of oldKeys) {
      if (!newKeys.includes(key)) continue;
      const oldChild = asSchema((oldProperties ?? {})[key]);
      const newChild = asSchema((newProperties ?? {})[key]);
      if (oldChild && newChild) {
        diffSchema(oldChild, newChild, joinPath(path, 'properties', key), context);
      }

      const wasRequired = oldRequired.has(key);
      const isRequired = newRequired.has(key);
      if (!wasRequired && isRequired) {
        record(context, 'breaking', 'property-made-required', joinPath(path, 'required'),
          `Optional property \`${key}\` is now required.`, false, true);
      } else if (wasRequired && !isRequired) {
        record(context, 'non-breaking', 'property-made-optional', joinPath(path, 'required'),
          `Required property \`${key}\` is now optional.`, true, false);
      }
    }
  }

  diffAdditionalProperties(before, after, path, context);
}

function diffAdditionalProperties(
  before: JsonSchema,
  after: JsonSchema,
  path: string,
  context: DiffContext,
): void {
  const oldValue = before.additionalProperties;
  const newValue = after.additionalProperties;
  if (deepEqual(oldValue ?? null, newValue ?? null)) return;

  const additionalPath = joinPath(path, 'additionalProperties');
  const oldOpen = oldValue !== false;
  const newOpen = newValue !== false;

  if (oldOpen && !newOpen) {
    record(context, 'breaking', 'additional-properties-restricted', additionalPath,
      'Extra properties are no longer accepted (`additionalProperties: false`).', oldValue, newValue);
    return;
  }
  if (!oldOpen && newOpen) {
    record(context, 'non-breaking', 'additional-properties-relaxed', additionalPath,
      'Extra properties are now accepted.', oldValue, newValue);
    return;
  }

  const oldSchema = asSchema(oldValue);
  const newSchema = asSchema(newValue);
  if (oldSchema && newSchema) {
    diffSchema(oldSchema, newSchema, additionalPath, context);
    return;
  }
  if (!oldSchema && newSchema) {
    record(context, 'breaking', 'additional-properties-restricted', additionalPath,
      'Extra properties must now match a schema.', oldValue, newValue);
  } else if (oldSchema && !newSchema) {
    record(context, 'non-breaking', 'additional-properties-relaxed', additionalPath,
      'The schema for extra properties was removed.', oldValue, newValue);
  }
}

/* --- composition ---------------------------------------------------------- */

function diffComposition(
  before: JsonSchema,
  after: JsonSchema,
  path: string,
  context: DiffContext,
): void {
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const oldBranches = Array.isArray(before[keyword]) ? (before[keyword] as JsonSchema[]) : undefined;
    const newBranches = Array.isArray(after[keyword]) ? (after[keyword] as JsonSchema[]) : undefined;
    if (!oldBranches && !newBranches) continue;

    const compositionPath = joinPath(path, keyword);
    if (!oldBranches && newBranches) {
      record(context, 'breaking', 'composition-added', compositionPath,
        `\`${keyword}\` was added, restricting accepted values.`, undefined, newBranches);
      continue;
    }
    if (oldBranches && !newBranches) {
      record(context, 'non-breaking', 'composition-removed', compositionPath,
        `\`${keyword}\` was removed.`, oldBranches);
      continue;
    }
    if (!oldBranches || !newBranches) continue;
    if (deepEqual(oldBranches, newBranches)) continue;

    const oldKeys = oldBranches.map((branch) => JSON.stringify(branch));
    const newKeys = newBranches.map((branch) => JSON.stringify(branch));
    const allOldKept = oldKeys.every((key) => newKeys.includes(key));
    const allNewExisted = newKeys.every((key) => oldKeys.includes(key));

    // `allOf` is a conjunction: adding a branch narrows rather than widens.
    const widening = keyword === 'allOf' ? allNewExisted && !allOldKept : allOldKept && !allNewExisted;
    const narrowing = keyword === 'allOf' ? allOldKept && !allNewExisted : allNewExisted && !allOldKept;

    if (widening) {
      record(context, 'non-breaking', 'composition-widened', compositionPath,
        `\`${keyword}\` accepts more values than before.`, oldBranches, newBranches);
    } else if (narrowing) {
      record(context, 'breaking', 'composition-narrowed', compositionPath,
        `\`${keyword}\` accepts fewer values than before.`, oldBranches, newBranches);
    } else {
      record(context, 'breaking', 'composition-changed', compositionPath,
        `\`${keyword}\` branches changed in a way SchemaPort cannot prove is safe.`,
        oldBranches, newBranches);
    }
  }
}

/* --- metadata ------------------------------------------------------------- */

function diffMetadata(before: JsonSchema, after: JsonSchema, path: string, context: DiffContext): void {
  if (before.description !== after.description) {
    record(context, 'informational', 'description-changed', joinPath(path, 'description'),
      'The description changed.', before.description, after.description);
  }
  if (before.title !== after.title) {
    record(context, 'informational', 'title-changed', joinPath(path, 'title'),
      'The title changed.', before.title, after.title);
  }
  if (!deepEqual(before.default ?? null, after.default ?? null)) {
    record(context, 'informational', 'default-changed', joinPath(path, 'default'),
      'The default value changed.', before.default, after.default);
  }
  if (!deepEqual(before.examples ?? null, after.examples ?? null)) {
    record(context, 'informational', 'examples-changed', joinPath(path, 'examples'),
      'Examples were added or changed.', before.examples, after.examples);
  }
  if (before.format !== after.format) {
    // Providers treat `format` as advisory, so a format change is reported but
    // not classified as breaking. See docs/breaking-changes.md.
    record(context, 'informational', 'format-changed', joinPath(path, 'format'),
      `\`format\` changed from ${before.format ?? '(none)'} to ${after.format ?? '(none)'}. Providers treat format as advisory.`,
      before.format, after.format);
  }
  if (before.nullable !== after.nullable) {
    const narrowed = after.nullable !== true;
    record(context, narrowed ? 'breaking' : 'non-breaking',
      narrowed ? 'nullable-removed' : 'nullable-added', joinPath(path, 'nullable'),
      narrowed ? 'The value may no longer be null.' : 'The value may now be null.',
      before.nullable, after.nullable);
  }
}

/* --- small helpers -------------------------------------------------------- */

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function isSuperset(candidate: ReadonlySet<string>, subset: ReadonlySet<string>): boolean {
  return [...subset].every((value) => candidate.has(value));
}

function format(values: readonly unknown[]): string {
  return values.map((value) => `\`${JSON.stringify(value)}\``).join(', ');
}
