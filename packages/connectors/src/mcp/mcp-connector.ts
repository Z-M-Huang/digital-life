import type { DigitalLifeConfig } from '@digital-life/core';

import type { SourceToolConnector } from '../contracts';
import { applyMcpManifests } from './adapters';
import {
  createSdkMcpBridgeFactory,
  type McpBridgeClient,
  type McpBridgeFactory,
  mcpDescriptorToSourceTool,
} from './bridge';

type McpRegistration = Extract<DigitalLifeConfig['connectors'][string], { kind: 'mcp' }>;

const bridgeRegistry = new WeakMap<SourceToolConnector, McpBridgeClient>();

export const getMcpBridge = (connector: SourceToolConnector): McpBridgeClient | undefined =>
  bridgeRegistry.get(connector);

export const createMcpConnector = async ({
  connectorId,
  registration,
  bridgeFactory = createSdkMcpBridgeFactory(),
}: {
  connectorId: string;
  registration: McpRegistration;
  bridgeFactory?: McpBridgeFactory;
}): Promise<SourceToolConnector> => {
  const bridge = await bridgeFactory(connectorId, registration);

  const baseConnector: SourceToolConnector = {
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

  const connector = applyMcpManifests({ connectorId, registration, baseConnector });
  bridgeRegistry.set(connector, bridge);
  return connector;
};

export const closeMcpConnector = async (connector: SourceToolConnector): Promise<void> => {
  const bridge = bridgeRegistry.get(connector);
  if (!bridge) {
    return;
  }
  bridgeRegistry.delete(connector);
  await bridge.close();
};

export const closeMcpConnectors = async (
  connectors: readonly SourceToolConnector[],
): Promise<void> => {
  await Promise.all(
    connectors.filter((connector) => connector.kind === 'mcp').map(closeMcpConnector),
  );
};

export const loadMcpConnectors = async ({
  bridgeFactory,
  connectors,
}: {
  bridgeFactory?: McpBridgeFactory;
  connectors: DigitalLifeConfig['connectors'];
}): Promise<SourceToolConnector[]> => {
  const entries = Object.entries(connectors).filter(
    (entry): entry is [string, McpRegistration] => entry[1].kind === 'mcp' && entry[1].enabled,
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
