import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import YAML from 'yaml';

import type { DigitalLifeConfig } from './schema';
import { digitalLifeConfigSchema } from './schema';

const ENV_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

const resolveValue = (value: unknown, env: NodeJS.ProcessEnv): unknown => {
  if (typeof value === 'string') {
    return value.replaceAll(ENV_PATTERN, (_, variableName: string) => {
      const resolved = env[variableName];
      if (resolved === undefined) {
        throw new Error(`Missing environment variable: ${variableName}`);
      }

      return resolved;
    });
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, env));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveValue(entry, env)]),
    );
  }

  return value;
};

export const loadConfigFromText = (
  yamlText: string,
  env: NodeJS.ProcessEnv = process.env,
): DigitalLifeConfig => {
  const rawConfig = YAML.parse(yamlText) as unknown;
  const resolvedConfig = resolveValue(rawConfig, env);
  return digitalLifeConfigSchema.parse(resolvedConfig);
};

const resolveConfigPath = (baseDirectory: string, filePath: string): string =>
  isAbsolute(filePath) ? filePath : resolve(baseDirectory, filePath);

const resolveProcessCommand = (baseDirectory: string, command: string): string =>
  command.startsWith('.') || command.includes('/')
    ? resolveConfigPath(baseDirectory, command)
    : command;

const resolveRelativeConfigPaths = (
  config: DigitalLifeConfig,
  filePath: string,
): DigitalLifeConfig => {
  const baseDirectory = dirname(filePath);

  return {
    ...config,
    ai: {
      ...config.ai,
      promptOverrides: Object.fromEntries(
        Object.entries(config.ai.promptOverrides).map(([promptId, promptPath]) => [
          promptId,
          resolveConfigPath(baseDirectory, promptPath),
        ]),
      ),
    },
    connectors: Object.fromEntries(
      Object.entries(config.connectors).map(([connectorId, connector]) => {
        if (connector.kind === 'extension') {
          return [
            connectorId,
            {
              ...connector,
              path: resolveConfigPath(baseDirectory, connector.path),
            },
          ];
        }

        if (connector.kind === 'mcp' && connector.transport.type === 'process') {
          return [
            connectorId,
            {
              ...connector,
              transport: {
                ...connector.transport,
                command: resolveProcessCommand(baseDirectory, connector.transport.command),
                ...(connector.transport.cwd
                  ? {
                      cwd: resolveConfigPath(baseDirectory, connector.transport.cwd),
                    }
                  : {}),
              },
            },
          ];
        }

        return [connectorId, connector];
      }),
    ),
  };
};

const validateResolvedPaths = async (config: DigitalLifeConfig): Promise<void> => {
  for (const [promptId, promptPath] of Object.entries(config.ai.promptOverrides)) {
    try {
      await access(promptPath);
    } catch (error) {
      throw new Error(
        `Prompt override "${promptId}" could not be loaded from ${promptPath}: ${
          error instanceof Error ? error.message : 'Unknown file error'
        }`,
      );
    }
  }

  for (const [connectorId, connector] of Object.entries(config.connectors)) {
    if (connector.kind === 'extension') {
      try {
        await access(connector.path);
      } catch (error) {
        throw new Error(
          `Extension connector "${connectorId}" could not be loaded from ${connector.path}: ${
            error instanceof Error ? error.message : 'Unknown file error'
          }`,
        );
      }
    }

    if (
      connector.kind === 'mcp' &&
      connector.transport.type === 'process' &&
      connector.transport.cwd
    ) {
      try {
        await access(connector.transport.cwd);
      } catch (error) {
        throw new Error(
          `MCP connector "${connectorId}" has an invalid working directory ${connector.transport.cwd}: ${
            error instanceof Error ? error.message : 'Unknown file error'
          }`,
        );
      }
    }
  }
};

export const loadConfig = async (
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DigitalLifeConfig> => {
  const content = await readFile(filePath, 'utf8');
  const config = resolveRelativeConfigPaths(loadConfigFromText(content, env), filePath);
  await validateResolvedPaths(config);
  return config;
};

export const collectHardDeniedToolIds = (config: DigitalLifeConfig): Set<string> => {
  const deniedToolIds = new Set(config.safety.hardDeny);

  for (const connector of Object.values(config.connectors)) {
    for (const toolId of connector.hardDeny ?? []) {
      deniedToolIds.add(toolId);
    }
  }

  return deniedToolIds;
};
