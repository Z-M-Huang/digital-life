import { tool } from 'ai';

import type {
  ConnectorPhase,
  SourceToolConnector,
  SourceToolDefinition,
  ToolAccessResolver,
  UnifiedToolRegistry,
} from '../contracts';

export const validateConnectorManifest = async (
  connector: SourceToolConnector,
): Promise<{ ok: boolean; errors: string[] }> => {
  const tools = await connector.listTools();
  const toolIds = new Set(tools.map((toolDefinition) => toolDefinition.id));
  const errors: string[] = [];

  if (connector.scopeDiscovery) {
    for (const toolId of connector.scopeDiscovery.toolIds) {
      if (!toolIds.has(toolId)) {
        errors.push(`Scope discovery references missing tool: ${toolId}`);
      }
    }
  }

  if (connector.learning) {
    for (const toolId of [
      ...connector.learning.enumerateToolIds,
      ...connector.learning.fetchToolIds,
    ]) {
      if (!toolIds.has(toolId)) {
        errors.push(`Learning manifest references missing tool: ${toolId}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
};

export const createUnifiedToolRegistry = ({
  accessResolver = () => ({ enabled: true }),
  connectors,
}: {
  accessResolver?: ToolAccessResolver;
  connectors: SourceToolConnector[];
}): Promise<UnifiedToolRegistry> => {
  const toolMapPromise = Promise.all(
    connectors.map(async (connector) => ({
      connector,
      tools: await connector.listTools(),
    })),
  ).then((entries) => {
    const tools = new Map<string, SourceToolDefinition>();

    for (const entry of entries) {
      for (const toolDefinition of entry.tools) {
        tools.set(toolDefinition.id, toolDefinition);
      }
    }

    return tools;
  });

  return toolMapPromise.then((toolMap) => ({
    aiToolsForPhase(phase: ConnectorPhase) {
      const entries = Array.from(toolMap.values())
        .filter((toolDefinition) => toolDefinition.phases.includes(phase))
        .filter((toolDefinition) => accessResolver(toolDefinition, phase).enabled)
        .map((toolDefinition) => [
          toolDefinition.id,
          tool({
            description: toolDefinition.description,
            inputSchema: toolDefinition.inputSchema,
            execute: async (input) =>
              toolDefinition.execute(input as Record<string, unknown>, {
                connectorId: toolDefinition.id.split('.')[0] ?? 'unknown',
                phase,
              }),
          }),
        ]);

      return Object.fromEntries(entries);
    },
    getTool(toolId) {
      return toolMap.get(toolId);
    },
    async invoke(toolId, input, phase) {
      const toolDefinition = toolMap.get(toolId);
      if (!toolDefinition) {
        throw new Error(`Unknown tool: ${toolId}`);
      }

      const access = accessResolver(toolDefinition, phase);
      if (!access.enabled) {
        throw new Error(access.reason ?? `Tool is disabled for phase ${phase}: ${toolId}`);
      }

      const parsedInput = toolDefinition.inputSchema.parse(input) as Record<string, unknown>;
      return toolDefinition.execute(parsedInput, {
        connectorId: toolDefinition.id.split('.')[0] ?? 'unknown',
        phase,
      });
    },
    listTools() {
      return Array.from(toolMap.values());
    },
  }));
};
