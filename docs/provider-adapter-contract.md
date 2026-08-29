# The provider adapter contract

A provider package's whole job is to answer three questions about one target:

1. What is wrong with this canonical tool? (`check`)
2. What does a working version look like, and what did that cost? (`compile`)
3. Does the real API accept it right now? (`probe`)

Adapters know nothing about the CLI — no printing, no `process.exit`, no file
system. The CLI knows nothing about provider compatibility rules. That split is
what lets provider rules be versioned and released independently as APIs change.

```ts
interface SchemaPortProvider {
  readonly id: string;               // 'openai'
  readonly displayName: string;      // 'OpenAI'
  readonly rulesReviewedAt: string;  // 'YYYY-MM-DD'
  readonly docs: readonly ProviderDocReference[];
  readonly apiKeyEnvVar?: string;    // 'OPENAI_API_KEY'

  check(tool: CanonicalTool): Diagnostic[];
  compile(tool: CanonicalTool, options?: CompileOptions): CompileResult;
  probe?(tool: CanonicalTool, options?: ProbeOptions): Promise<ProbeResult>;
}
```

`rulesReviewedAt` and `docs` are not decoration. Provider behaviour changes;
these fields let a user see when the rules were last checked against official
documentation and read the sources themselves.

## `check`

Walk the canonical tool and return one diagnostic per problem found. Use
`collectSchemas(tool.inputSchema, 'inputSchema')` to visit every subschema with
its path, and `joinPath` to build paths — never hand-build path strings.

```ts
import { collectSchemas, diagnostic, compilable, joinPath } from '@schemaport/core';

for (const { schema, path } of collectSchemas(tool.inputSchema, 'inputSchema')) {
  if (schema.type === 'object' && schema.additionalProperties === undefined) {
    diagnostics.push(diagnostic({
      providerId: 'openai',
      toolName: tool.name,
      severity: 'error',
      code: 'openai/missing-additional-properties-false',
      message: 'Strict mode requires `additionalProperties: false` on every object.',
      path,
      compile: compilable('Adds `additionalProperties: false`.'),
      docsUrl: 'https://platform.openai.com/docs/guides/function-calling',
    }));
  }
}
```

`check` must be pure: same tool in, same diagnostics out, in the same order.

### References

`collectSchemas` still does **not** follow `$ref` by default, and that will not
change — a purely syntactic walk is what most rules want. Two opt-ins are
available when a rule needs to see through a reference:

```ts
import { collectSchemas, resolveSchemaRefs } from '@schemaport/core';

// Visit reference targets as well, with cycle protection.
collectSchemas(tool.inputSchema, 'inputSchema', { followRefs: true });

// Or check the inlined schema, and report what could not be inlined.
const { schema, issues } = resolveSchemaRefs(tool.inputSchema);
```

Which one you want depends on the target:

- **The target supports `$ref`** — check the schema as written, and add rules
  for the reference forms it will not accept. `resolveSchemaRefs` issues tell
  you which references core could not follow either.
- **The target has no reference support** — inline with `resolveSchemaRefs`
  before compiling. Inlining a non-recursive reference preserves every
  constraint, so it is a `lossy: false` transformation. A reference left in
  `issues` cannot be inlined at all: that is a `notCompilable` error, not a
  lossy one, and the `RefResolutionIssue` message is written to be quoted
  straight into the diagnostic.

Core rejects `external-ref`, `dangling-ref` and `invalid-ref` at load, so a tool
that reaches your adapter will not carry those. It may still carry a recursive
reference, an `$anchor`, or a chain deeper than `MAX_REF_DEPTH` — those are
legal schemas core simply does not inline, and each target answers for itself
whether it accepts them.

Only implement rules you have evidence for. If a target's behaviour is uncertain,
emit a `warning` that says it is uncertain. Never invent a guarantee, and never
report a schema as fully compatible when a constraint would be accepted and then
ignored.

## `compile`

Produce the provider-native tool definition, record every change, and return
through `finalizeCompile`. Never implement the lossy refusal yourself — mark
transformations and let core apply the policy.

```ts
import { finalizeCompile, transformation, cloneSchema } from '@schemaport/core';

export function compile(tool, options) {
  const transformations = [];
  const parameters = cloneSchema(tool.inputSchema);

  // ... mutate `parameters`, pushing a transformation for each change ...
  transformations.push(transformation(
    'added-additional-properties-false',
    'inputSchema',
    'Closed the object, as strict mode requires.',
    false, // lossy
  ));

  return finalizeCompile({
    providerId: 'openai',
    tool,
    output: { type: 'function', name: tool.name, parameters, strict: true },
    transformations,
    diagnostics: check(tool),
    options,
  });
}
```

See [Safe and lossy compilation](safe-and-lossy-compilation.md) for the `lossy`
classification. It is the same rule for every provider, and it is not a judgement
call: the question is whether the compiled schema accepts inputs the canonical
schema rejects.

Compilation must be deterministic. No timestamps, no `Date.now()`, no
`Math.random()`, no iteration over unordered sets.

## `probe`

Optional, and only meaningful for targets with a hosted API. The rules exist to
keep a probe from lying:

- **Compile first.** If compilation is refused, return `probeCompileRefused` —
  never send a schema SchemaPort would not generate.
- **Resolve credentials with `resolveApiKey`.** Missing key returns
  `probeMissingCredentials`, which is an environment error, not a rejection.
- **Resolve the model with `resolveProbeModel`**, so it can be overridden by
  option and environment variable. The default should come from current official
  documentation.
- **Send the smallest request that answers the question**: the compiled tool, one
  short instruction from `probePrompt(tool)`, and a small output cap.
- **Never execute the developer's function** and never send real data.
- **Classify failures with `classifyProviderError`.** Only `'rejected'` means the
  schema was refused. An expired key, a stale model id, a rate limit and a
  network failure are all environment problems and must never be reported as a
  bad schema.
- **Accept `options.client`** as a test seam. When it is supplied, use it and do
  not construct a client or read `process.env`.

`probeAccepted` validates any returned tool-call arguments against the
**canonical** schema, not the compiled one — so a provider that accepted a
constraint and then ignored it shows up as accepted-but-wrong-shape rather than a
clean pass.

## Packaging rules

- Depend on `@schemaport/core` with a semver range. Never `file:` or `link:`.
- Never depend on another provider package.
- Never copy a core type into your package.
- Export your provider as a named export plus a default export.

## Testing

Provider packages own their evidence. Each should ship:

- valid, invalid and warning fixtures;
- one test per implemented rule, asserting the diagnostic `code`;
- a determinism test that compiles the same fixture twice and compares output;
- the lossy refusal path and the `allowLossy` path;
- mocked probe tests covering accepted, rejected, missing credentials, and at
  least one non-schema failure.

Shared canonical fixtures are importable from core, so every provider is tested
against the same inputs:

```ts
import { refundOrderTool, nestedTool, openMapTool } from '@schemaport/core';
```

Reference fixtures are a separate set, because three of the four are not meant
to compile and `FIXTURE_TOOLS` is iterated wholesale by several packages:

```ts
import {
  REF_FIXTURE_TOOLS, // all four, keyed by name
  refDefsTool,       // `$defs` + `$ref`, resolves cleanly
  recursiveTool,     // self-recursive through `$defs`
  danglingRefTool,   // pointer targets nothing
  externalRefTool,   // pointer into another document
} from '@schemaport/core';
```

`danglingRefTool` and `externalRefTool` are also in `INVALID_TOOL_VALUES`, since
core refuses to load them.

No test may make a network request.
