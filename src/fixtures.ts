import type { CanonicalTool } from './types.js';

/**
 * Canonical tools shared by the tests in every SchemaPort repository.
 *
 * Provider packages assert against these so that "what does OpenAI do with a
 * nested array of objects?" is answered against the same input everywhere.
 */

/** The PRD's headline example: one required property, one optional property. */
export const refundOrderTool: CanonicalTool = {
  name: 'refund_order',
  description: 'Refunds all or part of an order',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: {
        type: 'string',
        description: 'The order to refund',
      },
      amount: {
        type: 'number',
        minimum: 0,
        description: 'Amount to refund. Omit to refund the full order.',
      },
    },
    required: ['orderId'],
  },
};

/** The smallest possible valid tool. */
export const minimalTool: CanonicalTool = {
  name: 'ping',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

/** Exercises every scalar type, enums, arrays and nested objects. */
export const nestedTool: CanonicalTool = {
  name: 'create_ticket',
  description: 'Creates a support ticket',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      escalated: { type: 'boolean' },
      attempts: { type: 'integer', minimum: 0, maximum: 10 },
      labels: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 20,
      },
      requester: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
        },
        required: ['email'],
      },
      history: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            at: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['at'],
        },
      },
    },
    required: ['title', 'priority'],
  },
};

/** An open-ended string map. Providers that require closed objects lose this constraint. */
export const openMapTool: CanonicalTool = {
  name: 'tag_resource',
  description: 'Attaches arbitrary string tags to a resource',
  inputSchema: {
    type: 'object',
    properties: {
      resourceId: { type: 'string' },
      tags: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['resourceId', 'tags'],
  },
};

/** A union-typed property, expressed with `anyOf`. */
export const unionTool: CanonicalTool = {
  name: 'set_limit',
  description: 'Sets a numeric limit or removes it',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        anyOf: [{ type: 'number', minimum: 1 }, { type: 'null' }],
      },
    },
    required: ['limit'],
  },
};

/** Heavy on validation keywords, for constraint-preservation tests. */
export const constraintTool: CanonicalTool = {
  name: 'schedule_job',
  description: 'Schedules a background job',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', pattern: '^job_[a-z0-9]+$', minLength: 5 },
      runEvery: { type: 'integer', minimum: 60, maximum: 86400, multipleOf: 60 },
      window: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
    },
    required: ['jobId', 'runEvery'],
  },
};

/** All shared fixtures, keyed by tool name. */
export const FIXTURE_TOOLS: Readonly<Record<string, CanonicalTool>> = Object.freeze({
  refund_order: refundOrderTool,
  ping: minimalTool,
  create_ticket: nestedTool,
  tag_resource: openMapTool,
  set_limit: unionTool,
  schedule_job: constraintTool,
});

/** Values that are *not* valid canonical tools, for negative tests. */
export const INVALID_TOOL_VALUES: readonly unknown[] = Object.freeze([
  null,
  'refund_order',
  {},
  { name: 'no_schema' },
  { name: 'bad_schema', inputSchema: { type: 'string' } },
  { name: 'bad required', inputSchema: { type: 'object', properties: {} } },
  { name: 'dangling_required', inputSchema: { type: 'object', properties: {}, required: ['nope'] } },
]);
