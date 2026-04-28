import type { SourceToolConnector } from '@digital-life/connectors';

import type {
  BootstrapState,
  RuntimeStateRepository,
} from '../repositories/runtime-state-repository';
import type { LearningService } from './learning-service';

export class BootstrapService {
  constructor(
    private readonly connectors: SourceToolConnector[],
    private readonly repository: RuntimeStateRepository,
    private readonly learningService: LearningService,
  ) {}

  async getState(): Promise<BootstrapState> {
    const state = await this.repository.getBootstrapState();
    const configuredConnectorIds = new Set(this.connectors.map((connector) => connector.id));
    return {
      ...state,
      recommendedConnectors: state.recommendedConnectors.filter((connectorId) =>
        configuredConnectorIds.has(connectorId),
      ),
    };
  }

  async saveManualContext(entries: Array<Record<string, unknown>>): Promise<BootstrapState> {
    const current = await this.repository.getBootstrapState();
    return this.repository.saveBootstrapState({
      manualContext: [...current.manualContext, ...entries],
    });
  }

  async savePersona(persona: Record<string, unknown>): Promise<BootstrapState> {
    return this.repository.saveBootstrapState({
      persona,
      recommendedConnectors: this.connectors.map((connector) => connector.id),
      status: 'in_progress',
    });
  }

  async startBaselineRun(): Promise<{ bootstrap: BootstrapState; runId: string }> {
    const run = await this.learningService.createRun({
      mode: 'baseline',
    });

    const bootstrap = await this.repository.saveBootstrapState({
      baselineRunId: run.id,
      status: run.status === 'completed' ? 'complete' : 'in_progress',
    });

    return {
      bootstrap,
      runId: run.id,
    };
  }
}
