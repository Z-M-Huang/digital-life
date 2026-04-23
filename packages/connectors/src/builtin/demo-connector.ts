import { z } from 'zod';

import type {
  ScopeDiscoveryManifest,
  SourceToolConnector,
  SourceToolDefinition,
} from '../contracts';

const demoConnectorConfigSchema = z.object({
  repositories: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
      }),
    )
    .default([]),
  inboxWindows: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
      }),
    )
    .default([]),
});

const emptyInputSchema = z.object({});

const repositoryInputSchema = z.object({
  repositoryId: z.string(),
});

const listOutputSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
    }),
  ),
});

const repositoryOutputSchema = z.object({
  id: z.string(),
  label: z.string(),
  facts: z.array(z.string()),
});

type DemoConnectorConfig = z.infer<typeof demoConnectorConfigSchema>;

const createListTool = (
  connectorId: string,
  toolId: string,
  description: string,
  items: Array<{ id: string; label: string }>,
): SourceToolDefinition<
  Record<string, unknown>,
  { items: Array<{ id: string; label: string }> }
> => ({
  id: `${connectorId}.${toolId}`,
  description,
  capability: 'read',
  role: 'list',
  phases: ['bootstrap', 'learning', 'live'],
  inputSchema: emptyInputSchema,
  outputSchema: listOutputSchema,
  learningHints: {
    pagination: false,
    sinceWindow: false,
  },
  async execute() {
    return { items };
  },
});

export const createDemoConnector = ({
  connectorId,
  config,
}: {
  connectorId: string;
  config: Record<string, unknown>;
}): SourceToolConnector => {
  const parsedConfig: DemoConnectorConfig = demoConnectorConfigSchema.parse(config);

  const scopeDiscovery: ScopeDiscoveryManifest = {
    toolIds: [`${connectorId}.listRepositories`, `${connectorId}.listInboxWindows`],
    mapResult(toolId, result) {
      const parsedResult = listOutputSchema.parse(result);
      const kind = toolId.endsWith('listRepositories') ? 'repository' : 'inbox-window';

      return parsedResult.items.map((item) => ({
        id: item.id,
        label: item.label,
        metadata: {
          kind,
        },
      }));
    },
  };

  return {
    id: connectorId,
    displayName: 'Demo Connector',
    kind: 'builtin',
    configSchema: demoConnectorConfigSchema,
    scopeDiscovery,
    learning: {
      enumerateToolIds: [`${connectorId}.listRepositories`],
      fetchToolIds: [`${connectorId}.fetchRepository`],
      defaultMode: 'baseline',
      supportedModes: ['baseline', 'incremental', 'resync'],
    },
    async startupCheck() {
      return {
        ok: true,
        messages: [
          {
            level: 'info',
            message: `Loaded ${parsedConfig.repositories.length} repositories and ${parsedConfig.inboxWindows.length} inbox windows.`,
          },
        ],
      };
    },
    async listTools() {
      return [
        createListTool(
          connectorId,
          'listRepositories',
          'List repositories available for scope selection.',
          parsedConfig.repositories,
        ),
        createListTool(
          connectorId,
          'listInboxWindows',
          'List inbox windows available for scope selection.',
          parsedConfig.inboxWindows,
        ),
        {
          id: `${connectorId}.fetchRepository`,
          description: 'Fetch repository facts for learning and live lookup.',
          capability: 'read',
          role: 'fetch',
          phases: ['learning', 'live'],
          inputSchema: repositoryInputSchema,
          outputSchema: repositoryOutputSchema,
          learningHints: {
            pagination: false,
            sinceWindow: true,
          },
          async execute(input) {
            const repository = parsedConfig.repositories.find(
              (item) => item.id === input.repositoryId,
            );
            if (!repository) {
              throw new Error(`Unknown repository: ${input.repositoryId}`);
            }

            return {
              id: repository.id,
              label: repository.label,
              facts: [
                `${repository.label} is tracked by digital-life.`,
                `${repository.label} can be used as a baseline learning source.`,
              ],
            };
          },
        },
      ];
    },
  };
};
