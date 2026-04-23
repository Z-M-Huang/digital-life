import type { DigitalLifeConfig } from '@digital-life/core';
import jiti from 'jiti';

import type {
  ConnectorFactoryContext,
  ExtensionConnectorModule,
  SourceToolConnector,
} from '../contracts';
import { validateLoadedConnector } from './validate-connector';

const runtimeImporter = jiti(import.meta.url, { interopDefault: true });

const isSourceToolConnector = (value: unknown): value is SourceToolConnector =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      'listTools' in value &&
      'startupCheck' in value,
  );

const resolveConnector = async (
  exportedModule: ExtensionConnectorModule,
  context: ConnectorFactoryContext,
): Promise<SourceToolConnector> => {
  if (typeof exportedModule === 'function') {
    const resolvedConnector = await exportedModule(context);
    if (!isSourceToolConnector(resolvedConnector)) {
      throw new Error('Extension connector export must resolve to a connector.');
    }

    return resolvedConnector;
  }

  if (!isSourceToolConnector(exportedModule)) {
    throw new Error('Extension connector export must resolve to a connector.');
  }

  return exportedModule;
};

export const loadExtensionConnectors = async (
  connectors: DigitalLifeConfig['connectors'],
): Promise<SourceToolConnector[]> => {
  const extensionEntries = Object.entries(connectors).filter(
    (
      entry,
    ): entry is [string, Extract<DigitalLifeConfig['connectors'][string], { kind: 'extension' }>] =>
      entry[1].kind === 'extension' && entry[1].enabled,
  );

  const loadedConnectors = await Promise.all(
    extensionEntries.map(async ([connectorId, registration]) => {
      const moduleExports = (await runtimeImporter.import(registration.path)) as Record<
        string,
        ExtensionConnectorModule
      >;

      const exportedModule = moduleExports[registration.exportName] ?? moduleExports.default;
      if (!exportedModule) {
        throw new Error(`Extension connector export not found: ${registration.exportName}`);
      }

      return validateLoadedConnector({
        connector: await resolveConnector(exportedModule, { connectorId, registration }),
        connectorId,
        expectedKind: 'extension',
        registration,
      });
    }),
  );

  return loadedConnectors;
};
