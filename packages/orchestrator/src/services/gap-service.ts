import type {
  GapRecord,
  GapStatus,
  ToolLearningRepository,
} from '../repositories/tool-learning-repository';
import type { ReflectionService } from './reflection-service';

export class GapService {
  constructor(
    private readonly repository: ToolLearningRepository,
    private readonly reflectionService: ReflectionService,
  ) {}

  async listGaps(): Promise<GapRecord[]> {
    return this.repository.listGaps();
  }

  async updateStatus(id: string, status: GapStatus): Promise<GapRecord | null> {
    return this.repository.updateGapStatus(id, status);
  }

  /**
   * Re-derive gaps from existing reflection items and capability needs. The
   * Self-Reflection LLM upgrade in Phase 7+ can override this with richer
   * detection; the deterministic version preserves existing signals.
   */
  async recompute(): Promise<GapRecord[]> {
    const items = await this.reflectionService.listItems();
    const computed: GapRecord[] = [];
    for (const item of items) {
      const gap = await this.repository.upsertGap({
        id: `reflection-${item.id}`,
        type:
          item.category === 'scope'
            ? 'missing_access'
            : item.category === 'knowledge'
              ? 'missing_context'
              : item.category === 'maintenance'
                ? 'stale_coverage'
                : 'reflection_follow_up',
        status: item.status === 'resolved' ? 'resolved' : 'open',
        severity: item.severity === 'error' ? 80 : item.severity === 'warning' ? 50 : 30,
        title: item.title,
        description: item.detail,
        evidenceRefs: item.runId ? [item.runId] : [],
        relatedConnector: item.connectorId ?? null,
        relatedScope: null,
        resolutionHint: null,
        metadata: { reflectionId: item.id, category: item.category },
      });
      computed.push(gap);
    }
    return computed;
  }
}
