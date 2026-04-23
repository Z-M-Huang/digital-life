import type { DigitalLifeConfig } from '@digital-life/core';

import type { SourceToolConnector } from '../contracts';
import {
  createSdkMcpBridgeFactory,
  type McpBridgeFactory,
  mcpDescriptorToSourceTool,
} from './bridge';

export const createMcpConnector = async ({
  connectorId,
  registration,
  bridgeFactory = createSdkMcpBridgeFactory(),
}: {
  connectorId: string;
  registration: Extract<DigitalLifeConfig['connectors'][string], { kind: 'mcp' }>;
  bridgeFactory?: McpBridgeFactory;
}): Promise<SourceToolConnector> => {
  const bridge = await bridgeFactory(connectorId, registration);

  return {
    id: connectorId,
    displayName: `MCP Connector (${connectorId})`,
    kind: 'mcp',
    async startupCheck() {
      return bridge.startupCheck();
    },
    async listTools() {
      const descriptors = await bridge.listTools();
      return descriptors.map((descriptor) =>
        mcpDescriptorToSourceTool({
          connectorId,
          descriptor,
          invoke: bridge.callTool,
        }),
      );
    },
  };
};

export const loadMcpConnectors = async ({
  bridgeFactory,
  connectors,
}: {
  bridgeFactory?: McpBridgeFactory;
  connectors: DigitalLifeConfig['connectors'];
}): Promise<SourceToolConnector[]> => {
  const entries = Object.entries(connectors).filter(
    (entry): entry is [string, Extract<DigitalLifeConfig['connectors'][string], { kind: 'mcp' }>] =>
      entry[1].kind === 'mcp' && entry[1].enabled,
  );

  return Promise.all(
    entries.map(([connectorId, registration]) =>
      createMcpConnector(
        bridgeFactory
          ? { connectorId, registration, bridgeFactory }
          : { connectorId, registration, bridgeFactory: createSdkMcpBridgeFactory() },
      ),
    ),
  );
};
