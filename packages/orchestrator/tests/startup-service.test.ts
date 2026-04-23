import { describe, expect, it } from 'vitest';

import { createTestRuntime } from '../src/testing/create-test-runtime';

describe('StartupService', () => {
  it('validates connectors and stores startup logs', async () => {
    const runtime = await createTestRuntime();

    const result = await runtime.startupService.validate();
    const logs = await runtime.startupService.getLogs();

    expect(result.ok).toBe(true);
    expect(result.connectors[0]?.connectorId).toBe('demo');
    expect(logs[0]?.message).toContain('Loaded 1 repositories');
  });
});
