import { describe, expect, it } from 'vitest';

import { createTestRuntime } from '../src/testing/create-test-runtime';

describe('ConnectorService', () => {
  it('maps scope discovery tool output into scope options and persists scope', async () => {
    const runtime = await createTestRuntime();

    const scopeOptions = await runtime.connectorService.getScopeOptions('demo');
    await runtime.connectorService.setScope('demo', scopeOptions);
    const storedScope = await runtime.connectorService.getScope('demo');
    const connectors = await runtime.connectorService.listConnectors();
    const tools = await runtime.connectorService.listTools();

    expect(scopeOptions).toHaveLength(2);
    expect(storedScope[0]?.metadata?.kind).toBe('repository');
    expect(connectors[0]?.scopeCount).toBe(2);
    expect(tools[0]?.learningEnabled).toBe(true);
  });
});
