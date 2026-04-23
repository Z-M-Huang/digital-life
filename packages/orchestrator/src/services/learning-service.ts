import { runDefaultLearners } from '@digital-life/agents';
import type { SourceToolConnector, UnifiedToolRegistry } from '@digital-life/connectors';
import {
  type DenseMemClient,
  type DigitalLifeConfig,
  evaluateToolPhasePolicy,
  type LearningRunMode,
} from '@digital-life/core';

import type {
  CursorWindowRecord,
  LearningRunEvent,
  LearningRunRecord,
  RuntimeStateRepository,
} from '../repositories/runtime-state-repository';
import { consolidateLearnedFragments } from './consolidation-service';
import type { KnowledgeService } from './knowledge-service';
import {
  buildFetchInput,
  deriveScopeSelections,
  resultToLearningMaterials,
} from './learning-support';

export class LearningService {
  constructor(
    private readonly config: DigitalLifeConfig,
    private readonly connectors: SourceToolConnector[],
    private readonly registry: UnifiedToolRegistry,
    private readonly repository: RuntimeStateRepository,
    private readonly denseMemClient: DenseMemClient,
    private readonly knowledgeService: KnowledgeService,
    private readonly recomputeReadiness: () => Promise<unknown>,
  ) {}

  async createRun({
    connectorIds,
    details = {},
    mode,
  }: {
    connectorIds?: string[];
    details?: Record<string, unknown>;
    mode: LearningRunMode;
  }): Promise<LearningRunRecord> {
    const selectedConnectors = connectorIds ?? this.connectors.map((connector) => connector.id);
    let run = await this.repository.createLearningRun({
      connectorIds: selectedConnectors,
      details,
      mode,
      status: 'queued',
    });

    await this.appendEvent(run.id, 'phase', { phase: 'queued' });

    try {
      run = await this.repository.updateLearningRun(run.id, { status: 'running' });
      await this.appendEvent(run.id, 'phase', { phase: 'running' });

      const connectorSummaries = [];
      const policies = await this.repository.listToolPolicies();
      const learnedFragments = [];

      for (const connectorId of selectedConnectors) {
        const connector = this.connectors.find((entry) => entry.id === connectorId);
        if (!connector) {
          throw new Error(`Unknown connector for learning run: ${connectorId}`);
        }

        const summary = await this.processConnector(connector, mode, policies, run);
        connectorSummaries.push(summary);
        learnedFragments.push(...summary.learnedFragments);
      }

      const consolidatedFragments = consolidateLearnedFragments(learnedFragments);
      if (consolidatedFragments.length > 0) {
        const denseMemHealthy = await this.denseMemClient.healthCheck();
        if (!denseMemHealthy) {
          throw new Error('dense-mem health check failed before fragment write.');
        }

        await this.denseMemClient.writeFragments({
          namespace: this.config.denseMem.namespace,
          fragments: consolidatedFragments.map(({ sourceCount, ...fragment }) => fragment),
        });
        await this.knowledgeService.persistFacts(run.id, consolidatedFragments);
        await this.appendEvent(run.id, 'log', {
          fragmentsWritten: consolidatedFragments.length,
          knowledgeFactsStored: consolidatedFragments.length,
          target: 'dense-mem',
        });
      } else {
        await this.appendEvent(run.id, 'warning', {
          message: 'Learning run produced no consolidated fragments.',
        });
      }

      run = await this.repository.updateLearningRun(run.id, {
        status: 'completed',
        details: {
          ...run.details,
          connectorSummaries: connectorSummaries.map(
            ({ learnedFragments: _fragments, ...summary }) => summary,
          ),
          totals: {
            connectorsProcessed: connectorSummaries.length,
            fragmentsGenerated: learnedFragments.length,
            fragmentsWritten: consolidatedFragments.length,
            materialsDiscovered: connectorSummaries.reduce(
              (total, summary) => total + summary.materialsDiscovered,
              0,
            ),
          },
        },
      });
      await this.appendEvent(run.id, 'done', {
        status: run.status,
        totals: run.details.totals,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown learning error';
      run = await this.repository.updateLearningRun(run.id, {
        status: 'failed',
        details: {
          ...run.details,
          error: message,
        },
      });
      await this.appendEvent(run.id, 'error', { message });
    }

    await this.recomputeReadiness();
    return run;
  }

  async getRun(runId: string): Promise<LearningRunRecord | null> {
    return this.repository.getLearningRun(runId);
  }

  async getRunEvents(runId: string): Promise<LearningRunEvent[]> {
    return this.repository.listLearningRunEvents(runId);
  }

  async listRuns(): Promise<LearningRunRecord[]> {
    return this.repository.listLearningRuns();
  }

  private async appendEvent(
    runId: string,
    type: LearningRunEvent['type'],
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.repository.appendLearningRunEvent({
      runId,
      type,
      payload,
      createdAt: new Date(),
    });
  }

  private async processConnector(
    connector: SourceToolConnector,
    mode: LearningRunMode,
    policies: Awaited<ReturnType<RuntimeStateRepository['listToolPolicies']>>,
    run: LearningRunRecord,
  ): Promise<{
    connectorId: string;
    fetchToolIds: string[];
    learnedFragments: Awaited<ReturnType<typeof runDefaultLearners>>;
    materialsDiscovered: number;
    mode: LearningRunMode;
    scopeCount: number;
    warnings: string[];
  }> {
    if (!connector.learning) {
      const warning = 'Connector has no learning manifest.';
      await this.appendEvent(run.id, 'warning', {
        connectorId: connector.id,
        message: warning,
      });

      return {
        connectorId: connector.id,
        fetchToolIds: [],
        learnedFragments: [],
        materialsDiscovered: 0,
        mode,
        scopeCount: 0,
        warnings: [warning],
      };
    }

    if (!connector.learning.supportedModes.includes(mode)) {
      const warning = `Connector does not support ${mode} runs.`;
      await this.appendEvent(run.id, 'warning', {
        connectorId: connector.id,
        message: warning,
      });

      return {
        connectorId: connector.id,
        fetchToolIds: [],
        learnedFragments: [],
        materialsDiscovered: 0,
        mode,
        scopeCount: 0,
        warnings: [warning],
      };
    }

    const selectedScope = await this.repository.getConnectorScope(connector.id);
    const discoveredScope =
      selectedScope.length > 0
        ? selectedScope
        : await this.discoverScopeFromEnumerate(
            connector,
            connector.learning.enumerateToolIds,
            run.id,
          );
    const enabledFetchToolIds = connector.learning.fetchToolIds.filter((toolId) =>
      this.isLearningToolEnabled(toolId, policies),
    );
    const previousWindows = await this.repository.listCursorWindows(connector.id);
    const warnings: string[] = [];
    const learnedFragments = [];
    let materialsDiscovered = 0;

    if (discoveredScope.length === 0) {
      const warning = 'No learning scope available for connector.';
      warnings.push(warning);
      await this.appendEvent(run.id, 'warning', {
        connectorId: connector.id,
        message: warning,
      });
    }

    for (const fetchToolId of enabledFetchToolIds) {
      for (const selection of discoveredScope) {
        const previousWindow = previousWindows.find((window) => window.cursorKey === fetchToolId);
        const result = await this.registry.invoke(
          fetchToolId,
          buildFetchInput({
            mode,
            selection,
            ...(previousWindow ? { previousWindow } : {}),
          }),
          'learning',
        );
        const materials = resultToLearningMaterials({
          connectorId: connector.id,
          mode,
          result,
          selection,
          toolId: fetchToolId,
        });

        materialsDiscovered += materials.length;
        await this.appendEvent(run.id, 'progress', {
          connectorId: connector.id,
          materialsDiscovered,
          selectionId: selection.id,
          toolId: fetchToolId,
        });

        for (const material of materials) {
          learnedFragments.push(...(await runDefaultLearners(material)));
        }
      }

      await this.saveCursorWindow({
        connectorId: connector.id,
        cursorKey: fetchToolId,
        cursorValue: discoveredScope.at(-1)?.id ?? null,
        metadata: {
          mode,
          processedScopeCount: discoveredScope.length,
          toolId: fetchToolId,
        },
        runId: run.id,
        windowEnd: new Date(),
        windowStart:
          previousWindows.find((window) => window.cursorKey === fetchToolId)?.windowEnd ?? null,
      });
    }

    await this.appendEvent(run.id, 'log', {
      connectorId: connector.id,
      fetchToolIds: enabledFetchToolIds,
      learnedFragments: learnedFragments.length,
      materialsDiscovered,
    });

    return {
      connectorId: connector.id,
      fetchToolIds: enabledFetchToolIds,
      learnedFragments,
      materialsDiscovered,
      mode,
      scopeCount: discoveredScope.length,
      warnings,
    };
  }

  private async discoverScopeFromEnumerate(
    connector: SourceToolConnector,
    enumerateToolIds: readonly string[],
    runId: string,
  ) {
    const discoveredScope = [];

    for (const toolId of enumerateToolIds) {
      const result = await this.registry.invoke(toolId, {}, 'learning');
      const selections = deriveScopeSelections({
        connector,
        result,
        toolId,
      });
      discoveredScope.push(...selections);
      await this.appendEvent(runId, 'log', {
        connectorId: connector.id,
        enumeratedScope: selections.length,
        toolId,
      });
    }

    return discoveredScope;
  }

  private isLearningToolEnabled(
    toolId: string,
    policies: Awaited<ReturnType<RuntimeStateRepository['listToolPolicies']>>,
  ): boolean {
    const toolDefinition = this.registry.getTool(toolId);
    if (!toolDefinition) {
      return false;
    }

    return evaluateToolPhasePolicy({
      capability: toolDefinition.capability,
      config: this.config,
      phase: 'learning',
      policies,
      toolId,
    }).enabled;
  }

  private async saveCursorWindow(record: CursorWindowRecord): Promise<void> {
    await this.repository.saveCursorWindow(record);
  }
}
