import type { DigitalLifeConfig } from '@digital-life/core';
import { createDemoConnector } from '../builtin/demo-connector';
import type { BuiltinConnectorFactory, SourceToolConnector } from '../contracts';
import { validateLoadedConnector } from './validate-connector';

const builtinFactories: Record<string, BuiltinConnectorFactory> = {
  demo: ({ connectorId, registration }) =>
    createDemoConnector({
      connectorId,
      config: registration.kind === 'builtin' ? registration.config : {},
    }),
};

export const loadBuiltinConnectors = (
  connectors: DigitalLifeConfig['connectors'],
): SourceToolConnector[] =>
  Object.entries(connectors)
    .filter(
      (
        entry,
      ): entry is [string, Extract<DigitalLifeConfig['connectors'][string], { kind: 'builtin' }>] =>
        entry[1].kind === 'builtin' && entry[1].enabled,
    )
    .map(([connectorId, registration]) => {
      const factory = builtinFactories[registration.source];
      if (!factory) {
        throw new Error(`Unknown builtin connector source: ${registration.source}`);
      }

      return validateLoadedConnector({
        connector: factory({ connectorId, registration }),
        connectorId,
        expectedKind: 'builtin',
        registration,
      });
    });
