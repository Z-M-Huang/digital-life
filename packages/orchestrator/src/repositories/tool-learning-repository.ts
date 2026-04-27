export type GapType =
  | 'missing_access'
  | 'missing_context'
  | 'stale_coverage'
  | 'uncertain_learning'
  | 'reflection_follow_up'
  | 'capability_gap';

export type GapStatus = 'open' | 'queued' | 'surfaced' | 'snoozed' | 'resolved' | 'dismissed';

export type GapRecord = {
  id: string;
  type: GapType;
  status: GapStatus;
  severity: number;
  title: string;
  description: string;
  evidenceRefs: string[];
  relatedConnector?: string | null;
  relatedScope?: string | null;
  resolutionHint?: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type ToolNeedRecord = {
  id: string;
  signal: string;
  detail: string;
  occurrences: number;
  lastSeenAt: Date;
  metadata: Record<string, unknown>;
};

export type ToolProposalStatus = 'draft' | 'review' | 'approved' | 'rejected' | 'staged' | 'active';

export type ToolProposalType = 'connector' | 'action_tool' | 'workflow_improvement';
export type ToolProposalRisk = 'low' | 'medium' | 'high';

export type ToolProposalRecord = {
  id: string;
  type: ToolProposalType;
  status: ToolProposalStatus;
  title: string;
  problem: string;
  expectedValue: string;
  risk: ToolProposalRisk;
  approvalRequired: boolean;
  evidenceRefs: string[];
  implementationPlan: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type ToolLearningRepository = {
  listGaps: () => Promise<GapRecord[]>;
  upsertGap: (
    gap: Omit<GapRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ) => Promise<GapRecord>;
  updateGapStatus: (id: string, status: GapStatus) => Promise<GapRecord | null>;
  listToolNeeds: () => Promise<ToolNeedRecord[]>;
  recordToolNeed: (
    need: Omit<ToolNeedRecord, 'id' | 'lastSeenAt'> & { id?: string },
  ) => Promise<ToolNeedRecord>;
  listProposals: () => Promise<ToolProposalRecord[]>;
  createProposal: (
    proposal: Omit<ToolProposalRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ) => Promise<ToolProposalRecord>;
  updateProposalStatus: (
    id: string,
    status: ToolProposalStatus,
  ) => Promise<ToolProposalRecord | null>;
};

const cryptoSafeId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const createInMemoryToolLearningRepository = (): ToolLearningRepository => {
  const gaps = new Map<string, GapRecord>();
  const toolNeeds = new Map<string, ToolNeedRecord>();
  const proposals = new Map<string, ToolProposalRecord>();

  return {
    async listGaps() {
      return Array.from(gaps.values()).sort(
        (left, right) => right.severity - left.severity || left.title.localeCompare(right.title),
      );
    },
    async upsertGap(input) {
      const now = new Date();
      const id = input.id ?? cryptoSafeId();
      const previous = gaps.get(id);
      const record: GapRecord = {
        id,
        type: input.type,
        status: input.status,
        severity: input.severity,
        title: input.title,
        description: input.description,
        evidenceRefs: input.evidenceRefs,
        relatedConnector: input.relatedConnector ?? null,
        relatedScope: input.relatedScope ?? null,
        resolutionHint: input.resolutionHint ?? null,
        metadata: input.metadata,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      gaps.set(id, record);
      return record;
    },
    async updateGapStatus(id, status) {
      const previous = gaps.get(id);
      if (!previous) {
        return null;
      }
      const record: GapRecord = { ...previous, status, updatedAt: new Date() };
      gaps.set(id, record);
      return record;
    },
    async listToolNeeds() {
      return Array.from(toolNeeds.values()).sort(
        (left, right) => right.lastSeenAt.valueOf() - left.lastSeenAt.valueOf(),
      );
    },
    async recordToolNeed(need) {
      const id = need.id ?? cryptoSafeId();
      const now = new Date();
      const previous = toolNeeds.get(id);
      const record: ToolNeedRecord = {
        id,
        signal: need.signal,
        detail: need.detail,
        occurrences: previous ? previous.occurrences + need.occurrences : need.occurrences,
        lastSeenAt: now,
        metadata: need.metadata,
      };
      toolNeeds.set(id, record);
      return record;
    },
    async listProposals() {
      return Array.from(proposals.values()).sort(
        (left, right) => right.createdAt.valueOf() - left.createdAt.valueOf(),
      );
    },
    async createProposal(input) {
      const now = new Date();
      const record: ToolProposalRecord = {
        id: cryptoSafeId(),
        type: input.type,
        status: input.status,
        title: input.title,
        problem: input.problem,
        expectedValue: input.expectedValue,
        risk: input.risk,
        approvalRequired: input.approvalRequired,
        evidenceRefs: input.evidenceRefs,
        implementationPlan: input.implementationPlan,
        metadata: input.metadata,
        createdAt: now,
        updatedAt: now,
      };
      proposals.set(record.id, record);
      return record;
    },
    async updateProposalStatus(id, status) {
      const previous = proposals.get(id);
      if (!previous) {
        return null;
      }
      const record: ToolProposalRecord = { ...previous, status, updatedAt: new Date() };
      proposals.set(id, record);
      return record;
    },
  };
};
