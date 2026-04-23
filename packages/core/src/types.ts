export const TOOL_CAPABILITIES = ['read', 'write', 'execute'] as const;
export const TOOL_ROLES = ['discover', 'list', 'search', 'fetch', 'lookup', 'action'] as const;
export const RUNTIME_PHASES = ['bootstrap', 'learning', 'live', 'maintenance'] as const;
export const GOVERNED_PHASES = ['learning', 'live', 'maintenance'] as const;

export type ToolCapability = (typeof TOOL_CAPABILITIES)[number];
export type ToolRole = (typeof TOOL_ROLES)[number];
export type RuntimePhase = (typeof RUNTIME_PHASES)[number];
export type GovernedPhase = (typeof GOVERNED_PHASES)[number];
export type AccessDecision = 'allow' | 'deny';

export type RuntimeToolPolicyRecord = {
  toolId: string;
  phase: GovernedPhase;
  enabled: boolean;
  reason?: string | null;
  updatedAt?: Date;
};

export type StartupLogLevel = 'info' | 'warning' | 'error';
export type LearningRunMode = 'baseline' | 'incremental' | 'resync';
export type LearningRunStatus = 'queued' | 'running' | 'completed' | 'failed';
