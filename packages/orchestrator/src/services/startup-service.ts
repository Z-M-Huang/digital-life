import { type SourceToolConnector, validateConnectorManifest } from '@digital-life/connectors';
import type { DigitalLifeConfig } from '@digital-life/core';

import type {
  RuntimeStateRepository,
  StartupLogRecord,
} from '../repositories/runtime-state-repository';

export type StartupSummary = {
  configPersona: DigitalLifeConfig['persona'];
  connectorCount: number;
  promptOverrides: string[];
  startedAt: string;
};

export class StartupService {
  constructor(
    private readonly config: DigitalLifeConfig,
    private readonly connectors: SourceToolConnector[],
    private readonly repository: RuntimeStateRepository,
    private readonly promptOverrides: Record<string, string> = {},
    private readonly afterValidation?: () => Promise<unknown>,
  ) {}

  async getSummary(): Promise<StartupSummary> {
    return {
      configPersona: this.config.persona,
      connectorCount: this.connectors.length,
      promptOverrides: Object.keys(this.promptOverrides),
      startedAt: new Date().toISOString(),
    };
  }

  async getLogs(): Promise<StartupLogRecord[]> {
    return this.repository.listStartupLogs();
  }

  async validate(): Promise<{
    ok: boolean;
    connectors: Array<{ connectorId: string; ok: boolean; messages: string[] }>;
  }> {
    const connectorResults = await Promise.all(
      this.connectors.map(async (connector) => {
        const startup = await connector.startupCheck();
        const manifest = await validateConnectorManifest(connector);
        const messages = [...startup.messages.map((entry) => entry.message), ...manifest.errors];

        return {
          connectorId: connector.id,
          logs: [
            ...startup.messages.map<StartupLogRecord>((entry) => ({
              connectorId: connector.id,
              createdAt: new Date(),
              level: entry.level,
              message: entry.message,
            })),
            ...manifest.errors.map<StartupLogRecord>((message) => ({
              connectorId: connector.id,
              createdAt: new Date(),
              level: 'error',
              message,
            })),
          ],
          ok: startup.ok && manifest.ok,
          messages,
        };
      }),
    );

    await this.repository.replaceStartupLogs(connectorResults.flatMap((result) => result.logs));
    if (this.afterValidation) {
      await this.afterValidation();
    }

    return {
      ok: connectorResults.every((result) => result.ok),
      connectors: connectorResults.map((result) => ({
        connectorId: result.connectorId,
        ok: result.ok,
        messages: result.messages,
      })),
    };
  }
}
