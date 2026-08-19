import type {
  CanonicalTool,
  CompileOptions,
  CompileResult,
  Diagnostic,
  Transformation,
} from './types.js';
import { diagnostic, notCompilable } from './diagnostics.js';

/** Build a transformation record. */
export function transformation(
  code: string,
  path: string,
  detail: string,
  lossy = false,
): Transformation {
  return { code, path, detail, lossy };
}

export interface FinalizeCompileInput {
  providerId: string;
  tool: CanonicalTool;
  /** The provider-native tool definition the adapter produced. */
  output: unknown;
  transformations: readonly Transformation[];
  /** Diagnostics from the adapter's own check pass. */
  diagnostics: readonly Diagnostic[];
  options?: CompileOptions | undefined;
}

/**
 * Apply SchemaPort's compilation policy and produce the final `CompileResult`.
 *
 * Every provider adapter must return through this function. The lossy gate is
 * mechanical on purpose: an adapter marks a transformation `lossy: true` and
 * the refusal happens here, so all four providers draw the line in one place.
 *
 * Policy:
 *  - Compilation is refused when a diagnostic is an `error` that compile
 *    cannot work around (`compile.supported === false`).
 *  - Compilation is refused when any transformation is `lossy` and the caller
 *    did not pass `allowLossy`.
 *  - Errors that compile *did* work around are dropped from the result: they
 *    are represented by the transformation records instead.
 *  - Warnings and infos are always kept, so a successful compile still reports
 *    where the provider represents the schema differently.
 */
export function finalizeCompile(input: FinalizeCompileInput): CompileResult {
  const allowLossy = input.options?.allowLossy ?? false;
  const transformations = dedupeTransformations(input.transformations);

  const unresolvedErrors = input.diagnostics.filter(
    (item) => item.severity === 'error' && !item.compile.supported,
  );
  const kept = input.diagnostics.filter(
    (item) => item.severity !== 'error' || !item.compile.supported,
  );

  const lossy = transformations.filter((item) => item.lossy);
  const diagnostics: Diagnostic[] = [...kept];

  if (unresolvedErrors.length > 0) {
    return {
      providerId: input.providerId,
      toolName: input.tool.name,
      ok: false,
      transformations,
      diagnostics,
    };
  }

  if (lossy.length > 0 && !allowLossy) {
    diagnostics.push(
      diagnostic({
        providerId: input.providerId,
        toolName: input.tool.name,
        severity: 'error',
        code: 'core/lossy-transformation-refused',
        message:
          `Compiling for ${input.providerId} would weaken this schema: ` +
          `${lossy.map((item) => `${item.code} at ${item.path}`).join(', ')}. ` +
          'Re-run with --allow-lossy to accept the weaker output.',
        path: 'inputSchema',
        compile: notCompilable('Refused: the output would drop or weaken a canonical constraint.'),
      }),
    );
    return {
      providerId: input.providerId,
      toolName: input.tool.name,
      ok: false,
      transformations,
      diagnostics,
    };
  }

  return {
    providerId: input.providerId,
    toolName: input.tool.name,
    ok: true,
    output: input.output,
    transformations,
    diagnostics,
  };
}

/** Remove exact duplicates while preserving the order transformations were applied. */
function dedupeTransformations(list: readonly Transformation[]): Transformation[] {
  const seen = new Set<string>();
  const out: Transformation[] = [];
  for (const item of list) {
    const key = `${item.code} ${item.path} ${item.detail} ${item.lossy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Whether a compile result weakened the canonical contract in any way. */
export function isLossy(result: CompileResult): boolean {
  return result.transformations.some((item) => item.lossy);
}
