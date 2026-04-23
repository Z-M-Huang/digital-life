import type { SourceToolConnector, UnifiedToolRegistry } from '@digital-life/connectors';

import type {
  ReadinessState,
  RuntimeStateRepository,
} from '../repositories/runtime-state-repository';

export class ReadinessService {
  constructor(
    private readonly connectors: SourceToolConnector[],
    private readonly registry: UnifiedToolRegistry,
    private readonly repository: RuntimeStateRepository,
  ) {}

  async getDashboard(): Promise<{
    connectors: number;
    scopedConnectors: number;
    tools: number;
    readiness: ReadinessState;
    latestRunId: string | null;
  }> {
    const readiness = await this.recompute();
    const scopes = await this.repository.listConnectorScopes();
    const runs = await this.repository.listLearningRuns();

    return {
      connectors: this.connectors.length,
      scopedConnectors: Object.values(scopes).filter((scope) => scope.length > 0).length,
      tools: this.registry.listTools().length,
      readiness,
      latestRunId: runs[0]?.id ?? null,
    };
  }

  async getReadiness(): Promise<ReadinessState> {
    return this.recompute();
  }

  async recompute(): Promise<ReadinessState> {
    const startupLogs = await this.repository.listStartupLogs();
    const bootstrap = await this.repository.getBootstrapState();
    const scopes = await this.repository.listConnectorScopes();
    const runs = await this.repository.listLearningRuns();
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (startupLogs.some((log) => log.level === 'error')) {
      blockers.push('Startup validation has errors.');
    }

    if (Object.keys(bootstrap.persona).length === 0) {
      blockers.push('Persona is not defined.');
    }

    if (Object.values(scopes).every((scope) => scope.length === 0)) {
      warnings.push('No connector scope selected yet.');
    }

    if (!bootstrap.baselineRunId) {
      warnings.push('Baseline run has not been started.');
    } else {
      const baselineRun = runs.find((run) => run.id === bootstrap.baselineRunId);
      if (!baselineRun || baselineRun.status !== 'completed') {
        warnings.push('Baseline run has not completed yet.');
      } else if (!this.hasBaselineKnowledge(baselineRun.details)) {
        warnings.push('Baseline run completed without persisted knowledge.');
      }
    }

    const score = Math.max(0, 100 - blockers.length * 40 - warnings.length * 10);
    const readiness: ReadinessState = {
      status: blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'partial' : 'ready',
      score,
      blockers,
      warnings,
      updatedAt: new Date(),
    };

    await this.repository.saveReadinessState(readiness);
    return readiness;
  }

  private hasBaselineKnowledge(details: Record<string, unknown>): boolean {
    if (!('totals' in details) || typeof details.totals !== 'object' || !details.totals) {
      return false;
    }

    const totals = details.totals as Record<string, unknown>;
    return typeof totals.fragmentsWritten === 'number' && totals.fragmentsWritten > 0;
  }
}
