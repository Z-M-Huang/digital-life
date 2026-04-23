import { describe, expect, it } from 'vitest';

import { createTestRuntime } from '../src/testing/create-test-runtime';

describe('bootstrap and readiness services', () => {
  it('persists persona/manual context, starts a baseline run, and recomputes readiness', async () => {
    const runtime = await createTestRuntime();

    await runtime.startupService.validate();
    await runtime.bootstrapService.savePersona({ name: 'Digital Life', tone: 'precise' });
    await runtime.bootstrapService.saveManualContext([
      { source: 'operator', text: 'Prefer GitHub.' },
    ]);
    await runtime.connectorService.setScope('demo', [
      { id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } },
    ]);
    const baseline = await runtime.bootstrapService.startBaselineRun();
    const readiness = await runtime.readinessService.getReadiness();
    const events = await runtime.learningService.getRunEvents(baseline.runId);
    const run = await runtime.learningService.getRun(baseline.runId);
    const dashboard = await runtime.readinessService.getDashboard();

    expect(baseline.bootstrap.baselineRunId).toBe(baseline.runId);
    expect(events.some((event) => event.type === 'done')).toBe(true);
    expect(run?.status).toBe('completed');
    expect((run?.details.totals as { fragmentsWritten: number }).fragmentsWritten).toBeGreaterThan(
      0,
    );
    expect(readiness.status).toBe('ready');
    expect(dashboard.latestRunId).toBe(baseline.runId);
  });
});
