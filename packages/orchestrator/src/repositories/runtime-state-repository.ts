import type {
  GovernedPhase,
  LearningRunMode,
  LearningRunStatus,
  RuntimeToolPolicyRecord,
  StartupLogLevel,
} from '@digital-life/core';

export type StoredScopeSelection = Array<{
  id: string;
  label: string;
  metadata?: Record<string, unknown>;
}>;

export type BootstrapState = {
  status: 'not_started' | 'in_progress' | 'complete';
  persona: Record<string, unknown>;
  manualContext: Array<Record<string, unknown>>;
  recommendedConnectors: string[];
  baselineRunId: string | null;
  updatedAt: Date;
};

export type StartupLogRecord = {
  connectorId: string | null;
  createdAt: Date;
  level: StartupLogLevel;
  message: string;
};

export type LearningRunRecord = {
  id: string;
  mode: LearningRunMode;
  status: LearningRunStatus;
  connectorIds: string[];
  details: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type LearningRunEvent = {
  runId: string;
  type: 'phase' | 'progress' | 'log' | 'warning' | 'done' | 'error';
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type CursorWindowRecord = {
  runId: string;
  connectorId: string;
  cursorKey: string;
  cursorValue: string | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  metadata: Record<string, unknown>;
};

export type ReadinessState = {
  status: 'blocked' | 'partial' | 'ready';
  score: number;
  blockers: string[];
  warnings: string[];
  updatedAt: Date;
};

export type RuntimeStateRepository = {
  appendLearningRunEvent: (event: LearningRunEvent) => Promise<void>;
  createLearningRun: (
    input: Pick<LearningRunRecord, 'connectorIds' | 'details' | 'mode' | 'status'>,
  ) => Promise<LearningRunRecord>;
  getBootstrapState: () => Promise<BootstrapState>;
  getConnectorScope: (connectorId: string) => Promise<StoredScopeSelection>;
  listCursorWindows: (connectorId?: string) => Promise<CursorWindowRecord[]>;
  getLearningRun: (runId: string) => Promise<LearningRunRecord | null>;
  getReadinessState: () => Promise<ReadinessState>;
  listConnectorScopes: () => Promise<Record<string, StoredScopeSelection>>;
  listLearningRunEvents: (runId: string) => Promise<LearningRunEvent[]>;
  listLearningRuns: () => Promise<LearningRunRecord[]>;
  listStartupLogs: () => Promise<StartupLogRecord[]>;
  listToolPolicies: () => Promise<RuntimeToolPolicyRecord[]>;
  replaceStartupLogs: (logs: StartupLogRecord[]) => Promise<void>;
  saveBootstrapState: (state: Partial<BootstrapState>) => Promise<BootstrapState>;
  saveConnectorScope: (connectorId: string, scope: StoredScopeSelection) => Promise<void>;
  saveCursorWindow: (record: CursorWindowRecord) => Promise<void>;
  saveReadinessState: (state: ReadinessState) => Promise<void>;
  upsertToolPolicy: (
    policy: Omit<RuntimeToolPolicyRecord, 'updatedAt'> & { phase: GovernedPhase },
  ) => Promise<RuntimeToolPolicyRecord>;
  updateLearningRun: (
    runId: string,
    patch: Partial<Pick<LearningRunRecord, 'details' | 'status'>>,
  ) => Promise<LearningRunRecord>;
};

const createInitialBootstrapState = (): BootstrapState => ({
  status: 'not_started',
  persona: {},
  manualContext: [],
  recommendedConnectors: [],
  baselineRunId: null,
  updatedAt: new Date(),
});

const createInitialReadinessState = (): ReadinessState => ({
  status: 'partial',
  score: 0,
  blockers: [],
  warnings: [],
  updatedAt: new Date(),
});

export const createInMemoryRuntimeStateRepository = (): RuntimeStateRepository => {
  let bootstrapState = createInitialBootstrapState();
  let readinessState = createInitialReadinessState();
  let startupLogs: StartupLogRecord[] = [];
  const scopes = new Map<string, StoredScopeSelection>();
  const toolPolicies = new Map<string, RuntimeToolPolicyRecord>();
  const learningRuns = new Map<string, LearningRunRecord>();
  const learningRunEvents = new Map<string, LearningRunEvent[]>();
  const cursorWindows = new Map<string, CursorWindowRecord>();

  return {
    async appendLearningRunEvent(event) {
      const existingEvents = learningRunEvents.get(event.runId) ?? [];
      learningRunEvents.set(event.runId, [...existingEvents, event]);
    },
    async createLearningRun(input) {
      const run: LearningRunRecord = {
        id: crypto.randomUUID(),
        connectorIds: input.connectorIds,
        details: input.details,
        mode: input.mode,
        status: input.status,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      learningRuns.set(run.id, run);
      return run;
    },
    async getBootstrapState() {
      return bootstrapState;
    },
    async getConnectorScope(connectorId) {
      return scopes.get(connectorId) ?? [];
    },
    async listCursorWindows(connectorId) {
      const records = Array.from(cursorWindows.values());
      if (!connectorId) {
        return records;
      }

      return records.filter((record) => record.connectorId === connectorId);
    },
    async getLearningRun(runId) {
      return learningRuns.get(runId) ?? null;
    },
    async getReadinessState() {
      return readinessState;
    },
    async listConnectorScopes() {
      return Object.fromEntries(scopes.entries());
    },
    async listLearningRunEvents(runId) {
      return learningRunEvents.get(runId) ?? [];
    },
    async listLearningRuns() {
      return Array.from(learningRuns.values()).sort(
        (left, right) => right.createdAt.valueOf() - left.createdAt.valueOf(),
      );
    },
    async listStartupLogs() {
      return startupLogs;
    },
    async listToolPolicies() {
      return Array.from(toolPolicies.values());
    },
    async replaceStartupLogs(logs) {
      startupLogs = logs;
    },
    async saveBootstrapState(state) {
      bootstrapState = {
        ...bootstrapState,
        ...state,
        updatedAt: new Date(),
      };
      return bootstrapState;
    },
    async saveConnectorScope(connectorId, scope) {
      scopes.set(connectorId, scope);
    },
    async saveCursorWindow(record) {
      cursorWindows.set(`${record.runId}:${record.connectorId}:${record.cursorKey}`, record);
    },
    async saveReadinessState(state) {
      readinessState = state;
    },
    async upsertToolPolicy(policy) {
      const storedPolicy: RuntimeToolPolicyRecord = {
        ...policy,
        updatedAt: new Date(),
      };
      toolPolicies.set(`${policy.toolId}:${policy.phase}`, storedPolicy);
      return storedPolicy;
    },
    async updateLearningRun(runId, patch) {
      const current = learningRuns.get(runId);
      if (!current) {
        throw new Error(`Unknown learning run: ${runId}`);
      }

      const updatedRun = {
        ...current,
        ...patch,
        updatedAt: new Date(),
      };
      learningRuns.set(runId, updatedRun);
      return updatedRun;
    },
  };
};
