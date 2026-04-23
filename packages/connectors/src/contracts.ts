import type { DigitalLifeConfig } from '@digital-life/core';
import type { ToolSet } from 'ai';
import type { z } from 'zod';

export const CONNECTOR_CAPABILITIES = ['read', 'write', 'execute'] as const;
export const CONNECTOR_ROLES = ['discover', 'list', 'search', 'fetch', 'lookup', 'action'] as const;
export const CONNECTOR_PHASES = ['bootstrap', 'learning', 'live', 'maintenance'] as const;

export type ToolCapability = (typeof CONNECTOR_CAPABILITIES)[number];
export type ToolRole = (typeof CONNECTOR_ROLES)[number];
export type ConnectorPhase = (typeof CONNECTOR_PHASES)[number];
export type LearningRunMode = 'baseline' | 'incremental' | 'resync';

export type ScopeOption = {
  id: string;
  label: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type ToolExecutionContext = {
  connectorId: string;
  phase: ConnectorPhase;
  signal?: AbortSignal;
};

export type SourceToolDefinition<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput = unknown,
> = {
  id: string;
  description: string;
  capability: ToolCapability;
  role: ToolRole;
  phases: readonly ConnectorPhase[];
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  learningHints?: {
    pagination?: boolean;
    sinceWindow?: boolean;
  };
  execute: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>;
};

export type ScopeDiscoveryManifest = {
  toolIds: readonly string[];
  mapResult: (toolId: string, result: unknown) => ScopeOption[];
};

export type LearningManifest = {
  enumerateToolIds: readonly string[];
  fetchToolIds: readonly string[];
  defaultMode: LearningRunMode;
  supportedModes: readonly LearningRunMode[];
};

export type StartupCheckResult = {
  ok: boolean;
  messages: Array<{
    level: 'info' | 'warning' | 'error';
    message: string;
  }>;
};

export type SourceToolConnector = {
  id: string;
  displayName: string;
  kind: 'builtin' | 'extension' | 'mcp';
  startupCheck: () => Promise<StartupCheckResult>;
  listTools: () => Promise<SourceToolDefinition[]>;
  scopeDiscovery?: ScopeDiscoveryManifest;
  learning?: LearningManifest;
  configSchema?: z.ZodTypeAny;
};

export type ConnectorFactoryContext = {
  connectorId: string;
  registration: DigitalLifeConfig['connectors'][string];
};

export type BuiltinConnectorFactory = (context: ConnectorFactoryContext) => SourceToolConnector;
export type ExtensionConnectorModule =
  | SourceToolConnector
  | ((context: ConnectorFactoryContext) => SourceToolConnector | Promise<SourceToolConnector>);

export type ToolAccessResolver = (
  definition: SourceToolDefinition,
  phase: ConnectorPhase,
) => { enabled: boolean; reason?: string };

export type UnifiedToolRegistry = {
  aiToolsForPhase: (phase: ConnectorPhase) => ToolSet;
  getTool: (toolId: string) => SourceToolDefinition | undefined;
  invoke: (
    toolId: string,
    input: Record<string, unknown>,
    phase: ConnectorPhase,
  ) => Promise<unknown>;
  listTools: () => SourceToolDefinition[];
};
