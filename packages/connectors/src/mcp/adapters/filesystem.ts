import { posix as path } from 'node:path';

import { z } from 'zod';

import type { ScopeOption, SourceToolDefinition } from '../../contracts';
import { buildToolId, type McpAdapter, type McpAdapterContext } from './types';

const FILESYSTEM_FILE_KIND = 'filesystem-file';
const FILE_MARKER = /^\s*\[FILE\]\s*/;
const DIR_MARKER = /^\s*\[DIR\]\s*/;

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const collectStrings = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
  }
  return [];
};

type SanitizedEntry = { kind: 'file' | 'unknown'; path: string };

const sanitizeRelativePath = (rawPath: string): SanitizedEntry | null => {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }
  if (DIR_MARKER.test(trimmed)) {
    return null;
  }
  const fileMatch = FILE_MARKER.test(trimmed);
  const stripped = trimmed.replace(FILE_MARKER, '');
  if (!stripped) {
    return null;
  }
  if (stripped.includes('..')) {
    return null;
  }
  if (stripped.startsWith('/')) {
    return null;
  }
  return { kind: fileMatch ? 'file' : 'unknown', path: stripped };
};

const labelFor = (relativePath: string): string => {
  const segments = relativePath.split('/');
  return segments[segments.length - 1] ?? relativePath;
};

const mapFilesystemListResult = (_toolId: string, result: unknown): ScopeOption[] => {
  const stringPayloads = collectStrings(result);
  const candidates = stringPayloads.flatMap((payload) => {
    const parsed = safeJsonParse(payload);
    if (parsed === payload) {
      return payload.split(/\r?\n/);
    }
    return collectStrings(parsed);
  });

  const seen = new Set<string>();
  const options: ScopeOption[] = [];
  for (const candidate of candidates) {
    const sanitized = sanitizeRelativePath(candidate);
    if (!sanitized || sanitized.kind !== 'file' || seen.has(sanitized.path)) {
      continue;
    }
    seen.add(sanitized.path);
    options.push({
      id: sanitized.path,
      label: labelFor(sanitized.path),
      metadata: { kind: FILESYSTEM_FILE_KIND, relativePath: sanitized.path },
    });
  }
  return options;
};

const resolveRootPath = (registration: McpAdapterContext['registration']): string | undefined => {
  if (registration.transport.type !== 'process') {
    return undefined;
  }
  const args = registration.transport.args;
  return args.length > 0 ? args[args.length - 1] : undefined;
};

const joinPath = (root: string, relative: string): string => {
  const normalizedRoot = path.resolve('/', root.replace(/\/+$/, ''));
  const candidate = path.resolve(normalizedRoot, relative.replace(/^\/+/, ''));
  return candidate;
};

const isWithinRoot = (root: string, candidate: string): boolean => {
  const normalizedRoot = path.resolve('/', root.replace(/\/+$/, ''));
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`);
};

const listDirectoryInputSchema = z.object({}).passthrough();
const readFileInputSchema = z.object({ id: z.string().optional() }).passthrough();

const wrapTool = (
  tool: SourceToolDefinition,
  rootPath: string,
  toolNameSuffix: 'list_directory' | 'read_file',
): SourceToolDefinition => {
  const originalExecute = tool.execute.bind(tool);
  const wrapped: SourceToolDefinition = {
    ...tool,
    inputSchema:
      toolNameSuffix === 'list_directory' ? listDirectoryInputSchema : readFileInputSchema,
    async execute(input, context) {
      if (toolNameSuffix === 'list_directory') {
        return originalExecute({ path: rootPath }, context);
      }
      const id = typeof input.id === 'string' ? input.id : '';
      if (!id) {
        throw new Error('mcp-filesystem read_file requires a scope id (relative file path).');
      }
      const target = joinPath(rootPath, id);
      if (!isWithinRoot(rootPath, target)) {
        throw new Error(`mcp-filesystem rejected path outside root: ${id}`);
      }
      return originalExecute({ path: target }, context);
    },
  };
  return wrapped;
};

export const filesystemAdapter: McpAdapter = {
  name: 'mcp-filesystem',
  augment(context: McpAdapterContext) {
    const { baseConnector, connectorId, registration } = context;
    const rootPath = resolveRootPath(registration);
    const config = registration.scopeDiscovery;
    if (!config || !rootPath) {
      return baseConnector;
    }
    const listToolId = buildToolId(connectorId, 'list_directory');
    const readToolId = buildToolId(connectorId, 'read_file');
    return {
      ...baseConnector,
      async listTools() {
        const tools = await baseConnector.listTools();
        return tools.map((tool) => {
          if (tool.id === listToolId) {
            return wrapTool(tool, rootPath, 'list_directory');
          }
          if (tool.id === readToolId) {
            return wrapTool(tool, rootPath, 'read_file');
          }
          return tool;
        });
      },
      scopeDiscovery: {
        toolIds: config.toolIds.map((toolId) => buildToolId(connectorId, toolId)),
        mapResult: mapFilesystemListResult,
      },
    };
  },
};
