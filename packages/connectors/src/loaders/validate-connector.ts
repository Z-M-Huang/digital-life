import type { DigitalLifeConfig } from '@digital-life/core';

import type { SourceToolConnector } from '../contracts';

const getConfigErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown connector configuration error';

export const validateLoadedConnector = ({
  connector,
  connectorId,
  expectedKind,
  registration,
}: {
  connector: SourceToolConnector;
  connectorId: string;
  expectedKind: SourceToolConnector['kind'];
  registration: Extract<
    DigitalLifeConfig['connectors'][string],
    { config?: Record<string, unknown> } | { kind: 'extension' }
  >;
}): SourceToolConnector => {
  if (connector.id !== connectorId) {
    throw new Error(
      `Connector id mismatch for ${connectorId}: received "${connector.id}" from module export.`,
    );
  }

  if (connector.kind !== expectedKind) {
    throw new Error(
      `Connector kind mismatch for ${connectorId}: expected "${expectedKind}" but received "${connector.kind}".`,
    );
  }

  if ('config' in registration && connector.configSchema) {
    try {
      connector.configSchema.parse(registration.config);
    } catch (error) {
      throw new Error(
        `Invalid configuration for connector ${connectorId}: ${getConfigErrorMessage(error)}`,
      );
    }
  }

  return connector;
};
