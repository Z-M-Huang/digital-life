import { z } from 'zod';

import type { ConnectorFactoryContext, SourceToolConnector } from '../../src/contracts';

export default function createFixtureConnector({
  connectorId,
}: ConnectorFactoryContext): SourceToolConnector {
  return {
    id: connectorId,
    displayName: 'Fixture Extension Connector',
    kind: 'extension',
    async startupCheck() {
      return {
        ok: true,
        messages: [{ level: 'info', message: 'fixture loaded' }],
      };
    },
    async listTools() {
      return [
        {
          id: `${connectorId}.ping`,
          description: 'Return pong.',
          capability: 'read',
          role: 'lookup',
          phases: ['bootstrap', 'learning', 'live'],
          inputSchema: z.object({}),
          outputSchema: z.object({ pong: z.literal(true) }),
          async execute() {
            return { pong: true };
          },
        },
      ];
    },
  };
}
