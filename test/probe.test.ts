import { describe, expect, it } from 'vitest';
import {
  classifyProviderError,
  probeAccepted,
  probeCompileRefused,
  probeError,
  probeMissingCredentials,
  probePrompt,
  probeRejected,
  probeSkipped,
  resolveApiKey,
  resolveProbeModel,
  toErrorDetail,
} from '../src/probe.js';
import { finalizeCompile, transformation } from '../src/compile.js';
import { refundOrderTool } from '../src/fixtures.js';

const base = { providerId: 'openai', toolName: 'refund_order' };

describe('probe result helpers', () => {
  it('marks a skipped probe without claiming acceptance', () => {
    const result = probeSkipped(base, 'MCP has no hosted API.');

    expect(result.status).toBe('skipped');
    expect(result.schemaAccepted).toBe(false);
    expect(result.notes).toEqual(['MCP has no hosted API.']);
  });

  it('reports missing credentials as an environment error, not a rejection', () => {
    const result = probeMissingCredentials(base, 'OPENAI_API_KEY');

    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('missing-credentials');
    expect(result.schemaAccepted).toBe(false);
    expect(result.notes[0]).toContain('OPENAI_API_KEY');
  });

  it('reports a refused compilation without sending anything', () => {
    const refused = finalizeCompile({
      providerId: 'openai',
      tool: refundOrderTool,
      output: {},
      transformations: [transformation('dropped-minimum', 'inputSchema.properties.amount.minimum', 'Dropped.', true)],
      diagnostics: [],
    });
    const result = probeCompileRefused(base, refused);

    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('compile-refused');
    expect(result.notes.join(' ')).toContain('no request was sent');
    expect(result.notes.join(' ')).toContain('--allow-lossy');
  });

  it('keeps the provider error verbatim on rejection', () => {
    const result = probeRejected(base, 'gpt-test', {
      message: 'Invalid schema for function: unsupported keyword',
      status: 400,
    });

    expect(result.status).toBe('rejected');
    expect(result.schemaAccepted).toBe(false);
    expect(result.providerError?.message).toBe('Invalid schema for function: unsupported keyword');
    expect(result.model).toBe('gpt-test');
  });

  it('labels a non-schema failure with a note saying so', () => {
    const result = probeError(base, 'model-not-found', { message: 'model not found', status: 404 }, 'bad-model');

    expect(result.status).toBe('error');
    expect(result.notes[0]).toContain('not a schema problem');
    expect(result.model).toBe('bad-model');
  });
});

describe('probeAccepted', () => {
  it('validates returned arguments against the canonical schema', () => {
    const result = probeAccepted({
      ...base,
      model: 'gpt-test',
      tool: refundOrderTool,
      argumentsReceived: { orderId: 'ord_123', amount: 10 },
    });

    expect(result.status).toBe('accepted');
    expect(result.schemaAccepted).toBe(true);
    expect(result.toolCallReturned).toBe(true);
    expect(result.argumentsValid).toBe(true);
    expect(result.notes).toContain('Tool call arguments matched the canonical input schema.');
  });

  it('reports accepted-but-wrong-shape when the provider ignored a constraint', () => {
    const result = probeAccepted({
      ...base,
      model: 'gpt-test',
      tool: refundOrderTool,
      argumentsReceived: { orderId: 'ord_123', amount: -50 },
    });

    expect(result.status).toBe('accepted');
    expect(result.argumentsValid).toBe(false);
    expect(result.argumentErrors?.[0]).toContain('below minimum 0');
    expect(result.notes).toContain('Tool call arguments did NOT match the canonical input schema.');
  });

  it('does not claim argument verification when no tool call came back', () => {
    const result = probeAccepted({ ...base, model: 'gpt-test', tool: refundOrderTool });

    expect(result.status).toBe('accepted');
    expect(result.toolCallReturned).toBe(false);
    expect(result.argumentsValid).toBeUndefined();
    expect(result.notes.join(' ')).toContain('did not return a tool call');
  });
});

describe('classifyProviderError', () => {
  it('classifies a 400 as a schema rejection', () => {
    expect(classifyProviderError({ status: 400, message: 'Invalid schema' }).kind).toBe('rejected');
  });

  it('classifies a 401 as authentication, not a rejection', () => {
    expect(classifyProviderError({ status: 401, message: 'Incorrect API key' }).kind).toBe('authentication');
  });

  it('classifies a 404 as a missing model, not a rejection', () => {
    expect(classifyProviderError({ status: 404, message: 'The model does not exist' }).kind).toBe('model-not-found');
  });

  it('classifies a 400 that names a missing model as model-not-found', () => {
    const error = { status: 400, message: 'The model `gpt-nope` does not exist' };

    expect(classifyProviderError(error).kind).toBe('model-not-found');
  });

  it('keeps a schema rejection that happens to mention the model field', () => {
    const error = {
      status: 400,
      message: 'Invalid JSON payload received. Unknown name "minLength" at GenerateContentRequest.model.tools',
    };

    expect(classifyProviderError(error).kind).toBe('rejected');
  });

  it('classifies a 429 as a rate limit', () => {
    expect(classifyProviderError({ status: 429, message: 'Rate limit' }).kind).toBe('rate-limit');
  });

  it('classifies a 5xx as network', () => {
    expect(classifyProviderError({ status: 503, message: 'Service unavailable' }).kind).toBe('network');
  });

  it('classifies a DNS failure as network', () => {
    const error = Object.assign(new Error('getaddrinfo ENOTFOUND api.example.com'), { code: 'ENOTFOUND' });

    expect(classifyProviderError(error).kind).toBe('network');
  });

  it('classifies an aborted request as network', () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';

    expect(classifyProviderError(error).kind).toBe('network');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifyProviderError(new Error('something surprising')).kind).toBe('unknown');
  });
});

describe('toErrorDetail', () => {
  it('reads status, type and message from a nested provider error body', () => {
    const detail = toErrorDetail({
      status: 400,
      error: { message: 'Invalid schema for function', type: 'invalid_request_error' },
    });

    expect(detail).toEqual({
      message: 'Invalid schema for function',
      status: 400,
      type: 'invalid_request_error',
    });
  });

  it('handles a plain Error', () => {
    expect(toErrorDetail(new Error('boom')).message).toBe('boom');
  });

  it('handles a non-object throw', () => {
    expect(toErrorDetail('boom').message).toBe('boom');
  });
});

describe('probePrompt', () => {
  it('asks for one synthetic call and says it will not be executed', () => {
    const prompt = probePrompt(refundOrderTool);

    expect(prompt).toContain('refund_order');
    expect(prompt).toContain('will not be executed');
  });
});

describe('resolveProbeModel and resolveApiKey', () => {
  it('prefers the explicit option over the environment', () => {
    const env = { SCHEMAPORT_OPENAI_MODEL: 'from-env' };

    expect(resolveProbeModel('explicit', 'SCHEMAPORT_OPENAI_MODEL', 'fallback', env)).toBe('explicit');
  });

  it('treats an empty model environment variable as unset', () => {
    expect(resolveProbeModel(undefined, 'SCHEMAPORT_OPENAI_MODEL', 'fallback', { SCHEMAPORT_OPENAI_MODEL: '' })).toBe('fallback');
    expect(resolveProbeModel('', 'SCHEMAPORT_OPENAI_MODEL', 'fallback', {})).toBe('fallback');
  });

  it('falls back to the environment, then to the default', () => {
    expect(resolveProbeModel(undefined, 'SCHEMAPORT_OPENAI_MODEL', 'fallback', { SCHEMAPORT_OPENAI_MODEL: 'from-env' })).toBe('from-env');
    expect(resolveProbeModel(undefined, 'SCHEMAPORT_OPENAI_MODEL', 'fallback', {})).toBe('fallback');
  });

  it('treats an empty API key as absent', () => {
    expect(resolveApiKey(undefined, 'OPENAI_API_KEY', { OPENAI_API_KEY: '' })).toBeUndefined();
    expect(resolveApiKey(undefined, 'OPENAI_API_KEY', { OPENAI_API_KEY: 'sk-x' })).toBe('sk-x');
    expect(resolveApiKey('explicit', 'OPENAI_API_KEY', { OPENAI_API_KEY: 'sk-x' })).toBe('explicit');
  });
});
