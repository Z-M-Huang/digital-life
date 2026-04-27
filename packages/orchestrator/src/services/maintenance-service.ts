import type { SourceToolConnector } from '@digital-life/connectors';
import type { DenseMemClient } from '@digital-life/core';

import type { LearningService } from './learning-service';
import { type PreflightResult, runPreflightChecks } from './preflight-checks';
import type { ReadinessService } from './readiness-service';
import type { ReflectionService } from './reflection-service';

export type MaintenanceCycleStage =
  | 'preflight'
  | 'incremental_sync'
  | 'queue_recovery'
  | 'community_refresh'
  | 'reflection_recompute'
  | 'gap_recompute'
  | 'capability_scan'
  | 'readiness_recompute'
  | 'audit_report';

export type MaintenanceCycleResult = {
  stage: MaintenanceCycleStage;
  ok: boolean;
  detail?: string;
};

export type MaintenanceRunSummary = {
  startedAt: Date;
  finishedAt: Date;
  preflight: PreflightResult;
  results: MaintenanceCycleResult[];
};

export type MaintenanceServiceOptions = {
  connectors: SourceToolConnector[];
  denseMemClient: DenseMemClient;
  learningService: LearningService;
  reflectionService: ReflectionService;
  readinessService: ReadinessService;
  capabilityScan?: () => Promise<MaintenanceCycleResult>;
};

export class MaintenanceService {
  private readonly options: MaintenanceServiceOptions;

  constructor(options: MaintenanceServiceOptions) {
    this.options = options;
  }

  async runCycle(): Promise<MaintenanceRunSummary> {
    const startedAt = new Date();
    const results: MaintenanceCycleResult[] = [];

    const preflight = await runPreflightChecks({
      connectors: this.options.connectors,
      denseMemClient: this.options.denseMemClient,
    });
    if (!preflight.ok) {
      const finishedAt = new Date();
      results.push({
        stage: 'preflight',
        ok: false,
        detail: preflight.checks
          .filter((check) => !check.ok)
          .map((check) => `${check.name}: ${check.detail ?? 'failed'}`)
          .join('; '),
      });
      return { startedAt, finishedAt, preflight, results };
    }
    results.push({ stage: 'preflight', ok: true });

    results.push(await this.stageIncrementalSync());
    results.push({
      stage: 'queue_recovery',
      ok: true,
      detail: 'queue recovery stub (no failed-work queue wired yet)',
    });
    results.push({
      stage: 'community_refresh',
      ok: true,
      detail: 'community refresh stub (dense-mem owns detect_community)',
    });
    results.push(await this.stageReflection());
    results.push({
      stage: 'gap_recompute',
      ok: true,
      detail: 'gap recompute folded into reflection_recompute for now',
    });
    if (this.options.capabilityScan) {
      results.push(await this.options.capabilityScan());
    } else {
      results.push({
        stage: 'capability_scan',
        ok: true,
        detail: 'capability scan stub (Phase 7 wires the real detector)',
      });
    }
    results.push(await this.stageReadiness());
    results.push({
      stage: 'audit_report',
      ok: true,
      detail: 'audit report emitted as scheduler log (no morning-report sink)',
    });

    return {
      startedAt,
      finishedAt: new Date(),
      preflight,
      results,
    };
  }

  private async stageIncrementalSync(): Promise<MaintenanceCycleResult> {
    const learnable = this.options.connectors.filter(
      (connector) => connector.learning?.supportedModes.includes('incremental') ?? false,
    );
    if (learnable.length === 0) {
      return {
        stage: 'incremental_sync',
        ok: true,
        detail: 'no learning-capable connectors',
      };
    }
    try {
      const run = await this.options.learningService.createRun({
        connectorIds: learnable.map((connector) => connector.id),
        details: { reason: 'maintenance.incremental' },
        mode: 'incremental',
      });
      return {
        stage: 'incremental_sync',
        ok: run.status === 'completed',
        detail: `run=${run.id} status=${run.status}`,
      };
    } catch (error) {
      return {
        stage: 'incremental_sync',
        ok: false,
        detail: error instanceof Error ? error.message : 'incremental sync threw',
      };
    }
  }

  private async stageReflection(): Promise<MaintenanceCycleResult> {
    try {
      const items = await this.options.reflectionService.recompute();
      return {
        stage: 'reflection_recompute',
        ok: true,
        detail: `reflection items: ${items.length}`,
      };
    } catch (error) {
      return {
        stage: 'reflection_recompute',
        ok: false,
        detail: error instanceof Error ? error.message : 'reflection recompute threw',
      };
    }
  }

  private async stageReadiness(): Promise<MaintenanceCycleResult> {
    try {
      const readiness = await this.options.readinessService.recompute();
      return {
        stage: 'readiness_recompute',
        ok: true,
        detail: `status=${readiness.status} score=${readiness.score}`,
      };
    } catch (error) {
      return {
        stage: 'readiness_recompute',
        ok: false,
        detail: error instanceof Error ? error.message : 'readiness recompute threw',
      };
    }
  }
}
