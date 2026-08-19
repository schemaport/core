import type { CompileAbility, Diagnostic, DiagnosticSeverity } from './types.js';

export interface DiagnosticInit {
  providerId: string;
  toolName: string;
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  path: string;
  compile: CompileAbility;
  docsUrl?: string;
}

/** Build a diagnostic. Providers use this so every field is filled consistently. */
export function diagnostic(init: DiagnosticInit): Diagnostic {
  const built: Diagnostic = {
    providerId: init.providerId,
    toolName: init.toolName,
    severity: init.severity,
    code: init.code,
    message: init.message,
    path: init.path,
    compile: init.compile,
  };
  if (init.docsUrl !== undefined) built.docsUrl = init.docsUrl;
  return built;
}

/** `compile.supported === true`, nothing lost. */
export function compilable(detail: string): CompileAbility {
  return { supported: true, lossy: false, detail };
}

/** `compile.supported === true`, but a constraint is dropped or weakened. */
export function compilableLossy(detail: string): CompileAbility {
  return { supported: true, lossy: true, detail };
}

/** compile() cannot produce usable output for this issue. */
export function notCompilable(detail: string): CompileAbility {
  return { supported: false, lossy: false, detail };
}

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Sort by severity, then path, then code, so output is deterministic. */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.path.localeCompare(b.path) ||
      a.code.localeCompare(b.code),
  );
}

export interface SeverityCounts {
  error: number;
  warning: number;
  info: number;
}

export function countBySeverity(diagnostics: readonly Diagnostic[]): SeverityCounts {
  const counts: SeverityCounts = { error: 0, warning: 0, info: 0 };
  for (const item of diagnostics) counts[item.severity] += 1;
  return counts;
}

/** Whether any diagnostic should fail a CI run. */
export function hasBlockingErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error');
}
