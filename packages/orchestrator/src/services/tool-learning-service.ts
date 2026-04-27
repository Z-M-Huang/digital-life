import type {
  ToolLearningRepository,
  ToolNeedRecord,
  ToolProposalRecord,
  ToolProposalRisk,
  ToolProposalStatus,
  ToolProposalType,
} from '../repositories/tool-learning-repository';

const ALLOWED_AUTO_APPLY: ReadonlySet<ToolProposalRisk> = new Set(['low']);

const ALLOWED_TRANSITIONS: Record<ToolProposalStatus, ReadonlyArray<ToolProposalStatus>> = {
  draft: ['review', 'rejected'],
  review: ['approved', 'rejected'],
  approved: ['staged', 'rejected'],
  rejected: [],
  staged: ['active', 'rejected'],
  active: ['rejected'],
};

export class ToolLearningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolLearningError';
  }
}

export class ToolLearningService {
  constructor(private readonly repository: ToolLearningRepository) {}

  async listProposals(): Promise<ToolProposalRecord[]> {
    return this.repository.listProposals();
  }

  async listToolNeeds(): Promise<ToolNeedRecord[]> {
    return this.repository.listToolNeeds();
  }

  async recordNeed(input: {
    signal: string;
    detail: string;
    metadata?: Record<string, unknown>;
  }): Promise<ToolNeedRecord> {
    return this.repository.recordToolNeed({
      signal: input.signal,
      detail: input.detail,
      occurrences: 1,
      metadata: input.metadata ?? {},
    });
  }

  async createProposal(input: {
    type: ToolProposalType;
    risk: ToolProposalRisk;
    title: string;
    problem: string;
    expectedValue: string;
    evidenceRefs?: string[];
    implementationPlan?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<ToolProposalRecord> {
    const approvalRequired = input.risk !== 'low';
    return this.repository.createProposal({
      type: input.type,
      status: 'draft',
      title: input.title,
      problem: input.problem,
      expectedValue: input.expectedValue,
      risk: input.risk,
      approvalRequired,
      evidenceRefs: input.evidenceRefs ?? [],
      implementationPlan: input.implementationPlan ?? [],
      metadata: input.metadata ?? {},
    });
  }

  async transition(id: string, status: ToolProposalStatus): Promise<ToolProposalRecord> {
    const proposals = await this.repository.listProposals();
    const current = proposals.find((proposal) => proposal.id === id);
    if (!current) {
      throw new ToolLearningError(`Unknown proposal: ${id}`);
    }
    const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(status)) {
      throw new ToolLearningError(
        `Disallowed transition ${current.status} -> ${status} on proposal ${id}`,
      );
    }
    if (status === 'staged' && current.approvalRequired && !ALLOWED_AUTO_APPLY.has(current.risk)) {
      // approved must come from explicit transition first; staged shouldn't auto-apply for high risk
    }
    const updated = await this.repository.updateProposalStatus(id, status);
    if (!updated) {
      throw new ToolLearningError(`Failed to update proposal ${id}`);
    }
    return updated;
  }

  /**
   * Auto-apply low-risk proposals that have been approved. Non-low risk requires
   * an explicit operator transition through review/approved/staged/active.
   */
  async autoApplyEligibleProposals(): Promise<ToolProposalRecord[]> {
    const proposals = await this.repository.listProposals();
    const applied: ToolProposalRecord[] = [];
    for (const proposal of proposals) {
      if (
        proposal.status === 'approved' &&
        ALLOWED_AUTO_APPLY.has(proposal.risk) &&
        !proposal.approvalRequired
      ) {
        const next = await this.repository.updateProposalStatus(proposal.id, 'active');
        if (next) {
          applied.push(next);
        }
      }
    }
    return applied;
  }
}
