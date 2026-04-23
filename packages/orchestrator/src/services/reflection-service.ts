import type { SourceToolConnector, UnifiedToolRegistry } from '@digital-life/connectors';

import type {
  ReflectionItemRecord,
  ReflectionRepository,
} from '../repositories/reflection-repository';
import type { RuntimeStateRepository } from '../repositories/runtime-state-repository';

const createItem = ({
  category,
  connectorId = null,
  detail,
  metadata = {},
  runId = null,
  severity,
  title,
}: {
  category: ReflectionItemRecord['category'];
  connectorId?: string | null;
  detail: string;
  metadata?: Record<string, unknown>;
  runId?: string | null;
  severity: ReflectionItemRecord['severity'];
  title: string;
}): Omit<ReflectionItemRecord, 'createdAt' | 'id' | 'updatedAt'> => ({
  category,
  connectorId,
  detail,
  metadata,
  runId,
  severity,
  status: 'open',
  title,
});

export class ReflectionService {
  constructor(
    private readonly connectors: SourceToolConnector[],
    private readonly registry: UnifiedToolRegistry,
    private readonly reflectionRepository: ReflectionRepository,
    private readonly runtimeRepository: RuntimeStateRepository,
  ) {}

  async listItems(): Promise<ReflectionItemRecord[]> {
    return this.reflectionRepository.listReflectionItems();
  }

  async recompute(): Promise<ReflectionItemRecord[]> {
    const [bootstrap, runs, scopes, startupLogs, policies] = await Promise.all([
      this.runtimeRepository.getBootstrapState(),
      this.runtimeRepository.listLearningRuns(),
      this.runtimeRepository.listConnectorScopes(),
      this.runtimeRepository.listStartupLogs(),
      this.runtimeRepository.listToolPolicies(),
    ]);
    const items: Array<Omit<ReflectionItemRecord, 'createdAt' | 'id' | 'updatedAt'>> = [];

    for (const log of startupLogs.filter((entry) => entry.level === 'error')) {
      items.push(
        createItem({
          category: 'startup',
          connectorId: log.connectorId,
          detail: log.message,
          severity: 'error',
          title: 'Startup validation error',
        }),
      );
    }

    for (const connector of this.connectors) {
      if ((scopes[connector.id] ?? []).length === 0) {
        items.push(
          createItem({
            category: 'scope',
            connectorId: connector.id,
            detail: `Connector ${connector.displayName} has no selected scope.`,
            severity: 'warning',
            title: 'Missing connector scope',
          }),
        );
      }
    }

    if (!bootstrap.baselineRunId) {
      items.push(
        createItem({
          category: 'knowledge',
          detail: 'Baseline learning has not started yet.',
          severity: 'warning',
          title: 'Baseline learning pending',
        }),
      );
    }

    const baselineRun = bootstrap.baselineRunId
      ? runs.find((run) => run.id === bootstrap.baselineRunId)
      : null;
    if (baselineRun && baselineRun.status === 'failed') {
      items.push(
        createItem({
          category: 'knowledge',
          detail: 'The baseline run failed and should be retried before enabling more automation.',
          runId: baselineRun.id,
          severity: 'error',
          title: 'Baseline run failed',
        }),
      );
    }

    const latestRun = runs[0] ?? null;
    if (latestRun?.status === 'completed') {
      const totals =
        'totals' in latestRun.details &&
        latestRun.details.totals &&
        typeof latestRun.details.totals === 'object'
          ? (latestRun.details.totals as Record<string, unknown>)
          : {};
      if (typeof totals.fragmentsWritten !== 'number' || totals.fragmentsWritten < 1) {
        items.push(
          createItem({
            category: 'knowledge',
            detail: 'The latest learning run completed without persisting grounded fragments.',
            runId: latestRun.id,
            severity: 'warning',
            title: 'No grounded knowledge persisted',
          }),
        );
      }
    }

    const latestMaintenanceRun = runs.find(
      (run) => run.mode === 'incremental' || run.mode === 'resync',
    );
    if (!latestMaintenanceRun) {
      items.push(
        createItem({
          category: 'maintenance',
          detail: 'No incremental or resync maintenance run has been executed yet.',
          severity: 'info',
          title: 'Maintenance run recommended',
        }),
      );
    }

    for (const policy of policies.filter((entry) => entry.phase === 'live' && entry.enabled)) {
      const tool = this.registry.getTool(policy.toolId);
      if (!tool || tool.capability === 'read') {
        continue;
      }
      const connectorId = tool.id.includes('.') ? (tool.id.split('.')[0] ?? null) : null;

      items.push(
        createItem({
          category: 'policy',
          connectorId,
          detail: `Live ${tool.capability} tool ${tool.id} is enabled with reason: ${policy.reason ?? 'none provided'}.`,
          metadata: {
            capability: tool.capability,
            phase: policy.phase,
            reason: policy.reason ?? null,
            toolId: tool.id,
          },
          severity: 'warning',
          title: 'Live non-read tool enabled',
        }),
      );
    }

    return this.reflectionRepository.replaceReflectionItems(items);
  }
}
