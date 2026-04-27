import type { LearningManifest, SourceToolConnector } from '../../contracts';
import { filesystemAdapter } from './filesystem';
import { buildToolId, type McpAdapter, type McpAdapterContext } from './types';

const adapterRegistry = new Map<string, McpAdapter>();

export const registerMcpAdapter = (adapter: McpAdapter): void => {
  adapterRegistry.set(adapter.name, adapter);
};

export const resolveMcpAdapter = (name: string): McpAdapter | undefined =>
  adapterRegistry.get(name);

registerMcpAdapter(filesystemAdapter);

const buildLearningManifest = (
  connectorId: string,
  registration: McpAdapterContext['registration'],
): LearningManifest | undefined => {
  if (!registration.learning) {
    return undefined;
  }
  return {
    enumerateToolIds: registration.learning.enumerateToolIds.map((toolId) =>
      buildToolId(connectorId, toolId),
    ),
    fetchToolIds: registration.learning.fetchToolIds.map((toolId) =>
      buildToolId(connectorId, toolId),
    ),
    defaultMode: registration.learning.defaultMode,
    supportedModes: registration.learning.supportedModes,
  };
};

export const applyMcpManifests = (context: McpAdapterContext): SourceToolConnector => {
  const learning = buildLearningManifest(context.connectorId, context.registration);
  let connector: SourceToolConnector = learning
    ? { ...context.baseConnector, learning }
    : context.baseConnector;

  if (context.registration.adapter) {
    const adapter = resolveMcpAdapter(context.registration.adapter);
    if (!adapter) {
      throw new Error(`Unknown MCP adapter: ${context.registration.adapter}`);
    }
    connector = adapter.augment({ ...context, baseConnector: connector });
  }

  return connector;
};

export { buildToolId, filesystemAdapter, type McpAdapter, type McpAdapterContext };
