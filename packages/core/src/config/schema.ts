import { z } from 'zod';

import { GOVERNED_PHASES, RUNTIME_PHASES, TOOL_CAPABILITIES, TOOL_ROLES } from '../types';

const envInterpolatedString = z.string().min(1);

const recordOfUnknown = z.record(z.string(), z.unknown());
const recordOfString = z.record(z.string(), z.string());

const builtinConnectorSchema = z.object({
  kind: z.literal('builtin'),
  enabled: z.boolean().default(true),
  source: z.string().min(1),
  config: recordOfUnknown.default({}),
  headers: recordOfString.default({}),
  hardDeny: z.array(z.string()).default([]),
});

const extensionConnectorSchema = z.object({
  kind: z.literal('extension'),
  enabled: z.boolean().default(true),
  path: z.string().min(1),
  exportName: z.string().default('default'),
  config: recordOfUnknown.default({}),
  headers: recordOfString.default({}),
  hardDeny: z.array(z.string()).default([]),
});

const processTransportSchema = z.object({
  type: z.literal('process'),
  command: envInterpolatedString,
  args: z.array(envInterpolatedString).default([]),
  cwd: envInterpolatedString.optional(),
  env: recordOfString.default({}),
});

const sseTransportSchema = z.object({
  type: z.literal('sse'),
  url: envInterpolatedString,
  headers: recordOfString.default({}),
});

const streamableHttpTransportSchema = z.object({
  type: z.literal('streamable-http'),
  url: envInterpolatedString,
  headers: recordOfString.default({}),
});

const mcpConnectorSchema = z.object({
  kind: z.literal('mcp'),
  enabled: z.boolean().default(true),
  transport: z.union([processTransportSchema, sseTransportSchema, streamableHttpTransportSchema]),
  headers: recordOfString.default({}),
  hardDeny: z.array(z.string()).default([]),
});

const safetyDefaultsSchema = z.object({
  read: z.enum(['allow', 'deny']).default('allow'),
  write: z.enum(['allow', 'deny']).default('deny'),
  execute: z.enum(['allow', 'deny']).default('deny'),
});

export const digitalLifeConfigSchema = z.object({
  persona: z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
  }),
  ai: z.object({
    model: z.string().min(1),
    temperature: z.number().min(0).max(2).default(0.2),
    promptOverrides: z.record(z.string(), z.string()).default({}),
  }),
  safety: z.object({
    defaults: safetyDefaultsSchema.default({
      read: 'allow',
      write: 'deny',
      execute: 'deny',
    }),
    hardDeny: z.array(z.string()).default([]),
  }),
  denseMem: z.object({
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    namespace: z.string().min(1),
    timeoutMs: z.number().int().positive().default(8000),
  }),
  connectors: z.record(
    z.string(),
    z.union([builtinConnectorSchema, extensionConnectorSchema, mcpConnectorSchema]),
  ),
});

export const sourceToolDefinitionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  capability: z.enum(TOOL_CAPABILITIES),
  role: z.enum(TOOL_ROLES),
  phases: z.array(z.enum(RUNTIME_PHASES)).min(1),
  learningHints: z
    .object({
      pagination: z.boolean().default(false),
      sinceWindow: z.boolean().default(false),
    })
    .default({ pagination: false, sinceWindow: false }),
});

export const scopeOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  metadata: recordOfUnknown.default({}),
});

export const scopeDiscoveryManifestSchema = z.object({
  toolIds: z.array(z.string()).min(1),
  mapResult: z.custom<(toolId: string, result: unknown) => ScopeOption[]>(
    (value) => typeof value === 'function',
    'mapResult must be a function',
  ),
});

export const learningManifestSchema = z.object({
  enumerateToolIds: z.array(z.string()).default([]),
  fetchToolIds: z.array(z.string()).default([]),
  defaultMode: z.enum(['baseline', 'incremental', 'resync']).default('baseline'),
  supportedModes: z
    .array(z.enum(['baseline', 'incremental', 'resync']))
    .default(['baseline', 'incremental', 'resync']),
});

export const runtimePolicyRecordSchema = z.object({
  toolId: z.string().min(1),
  phase: z.enum(GOVERNED_PHASES),
  enabled: z.boolean(),
  reason: z.string().nullable().optional(),
});

export type DigitalLifeConfig = z.infer<typeof digitalLifeConfigSchema>;
export type SourceToolDefinitionConfig = z.infer<typeof sourceToolDefinitionSchema>;
export type ScopeOption = z.infer<typeof scopeOptionSchema>;
export type ScopeDiscoveryManifestConfig = z.infer<typeof scopeDiscoveryManifestSchema>;
export type LearningManifestConfig = z.infer<typeof learningManifestSchema>;
