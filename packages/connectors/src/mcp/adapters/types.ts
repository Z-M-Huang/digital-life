import type { DigitalLifeConfig } from '@digital-life/core';

import type { ScopeDiscoveryManifest, SourceToolConnector } from '../../contracts';

export type McpRegistration = Extract<DigitalLifeConfig['connectors'][string], { kind: 'mcp' }>;

export type McpAdapterContext = {
  connectorId: string;
  registration: McpRegistration;
  baseConnector: SourceToolConnector;
};

export type McpAdapter = {
  name: string;
  augment: (context: McpAdapterContext) => SourceToolConnector;
};

export const buildToolId = (connectorId: string, toolName: string): string =>
  `${connectorId}.${toolName}`;

export const scopeDiscoveryFromConfig = (
  connectorId: string,
  registration: McpRegistration,
  mapResult: ScopeDiscoveryManifest['mapResult'],
): ScopeDiscoveryManifest | undefined => {
  const config = registration.scopeDiscovery;
  if (!config) {
    return undefined;
  }
  return {
    toolIds: config.toolIds.map((toolId) => buildToolId(connectorId, toolId)),
    mapResult,
  };
};
