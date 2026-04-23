import { z } from 'zod';

import type { ConnectorFactoryContext, SourceToolConnector } from '../../src/contracts';

export default function createSchemaFixtureConnector({
  connectorId,
}: ConnectorFactoryContext): SourceToolConnector {
  return {
    id: connectorId,
    displayName: 'Schema Fixture Extension Connector',
    kind: 'extension',
    configSchema: z.object({
      token: z.string().min(1),
    }),
    async startupCheck() {
      return {
        ok: true,
        messages: [{ level: 'info', message: 'schema fixture loaded' }],
      };
    },
    async listTools() {
      return [];
    },
  };
}
