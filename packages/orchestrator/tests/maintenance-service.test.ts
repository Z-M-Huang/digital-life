import { describe, expect, it } from 'vitest';

import { createTestRuntime } from '../src/testing/create-test-runtime';

describe('MaintenanceService', () => {
  it('runs preflight, incremental sync, reflection, readiness, and capability stages', async () => {
    const runtime = await createTestRuntime();

    await runtime.connectorService.setScope('demo', [
      { id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } },
    ]);

    const summary = await runtime.maintenanceService.runCycle();

    expect(summary.preflight.ok).toBe(true);
    expect(summary.results.map((stage) => stage.stage)).toEqual([
      'preflight',
      'incremental_sync',
      'queue_recovery',
      'community_refresh',
      'reflection_recompute',
      'gap_recompute',
      'capability_scan',
      'readiness_recompute',
      'audit_report',
    ]);
    expect(summary.results.every((stage) => stage.ok)).toBe(true);
  });

  it('aborts when preflight fails', async () => {
    const runtime = await createTestRuntime();
    runtime.connectors.push({
      id: 'broken',
      displayName: 'Broken',
      kind: 'builtin',
      async startupCheck() {
        return {
          ok: false,
          messages: [{ level: 'error', message: 'auth missing' }],
        };
      },
      async listTools() {
        return [];
      },
    });

    const summary = await runtime.maintenanceService.runCycle();
    expect(summary.preflight.ok).toBe(false);
    expect(summary.results).toEqual([
      {
        stage: 'preflight',
        ok: false,
        detail: expect.stringContaining('connector.broken'),
      },
    ]);
  });
});
