import type { DigitalLifeConfig } from '@digital-life/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';

import type { SourceToolDefinition, StartupCheckResult } from '../contracts';

const unknownRecordSchema = z.record(z.string(), z.unknown());

const processEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

export type McpToolDescriptor = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
};

export type McpBridgeClient = {
  close: () => Promise<void>;
  startupCheck: () => Promise<StartupCheckResult>;
  callTool: (toolName: string, input: Record<string, unknown>) => Promise<unknown>;
  listTools: () => Promise<McpToolDescriptor[]>;
};

export type McpBridgeFactory = (
  connectorId: string,
  registration: Extract<DigitalLifeConfig['connectors'][string], { kind: 'mcp' }>,
) => Promise<McpBridgeClient>;

const parseTextContent = (text: string): unknown => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return text;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return text;
  }
};

const extractToolResult = (result: Record<string, unknown>): unknown => {
  if (result.isError) {
    const content = Array.isArray(result.content) ? result.content : [];
    const message = content
      .filter(
        (
          entry,
        ): entry is {
          type: 'text';
          text: string;
        } => Boolean(entry && typeof entry === 'object' && 'type' in entry && 'text' in entry),
      )
      .map((entry) => entry.text)
      .join('\n')
      .trim();
    throw new Error(message || 'MCP tool execution failed.');
  }

  if ('structuredContent' in result && result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  const content = Array.isArray(result.content) ? result.content : [];
  if (
    content.length === 1 &&
    content[0] &&
    typeof content[0] === 'object' &&
    'type' in content[0] &&
    content[0].type === 'text' &&
    'text' in content[0] &&
    typeof content[0].text === 'string'
  ) {
    return parseTextContent(content[0].text);
  }

  return result;
};

const createTransport = (
  registration: Extract<DigitalLifeConfig['connectors'][string], { kind: 'mcp' }>,
): Transport => {
  if (registration.transport.type === 'process') {
    return new StdioClientTransport({
      args: registration.transport.args,
      command: registration.transport.command,
      ...(registration.transport.cwd ? { cwd: registration.transport.cwd } : {}),
      ...(Object.keys(registration.transport.env).length === 0
        ? {}
        : {
            env: {
              ...processEnvironment(),
              ...registration.transport.env,
            },
          }),
    });
  }

  const headers = {
    ...registration.headers,
    ...registration.transport.headers,
  };

  if (registration.transport.type === 'streamable-http') {
    return new StreamableHTTPClientTransport(new URL(registration.transport.url), {
      requestInit: {
        headers,
      },
    }) as unknown as Transport;
  }

  return new SSEClientTransport(new URL(registration.transport.url), {
    requestInit: {
      headers,
    },
  });
};

const createConnectedClient = async (
  registration: Extract<DigitalLifeConfig['connectors'][string], { kind: 'mcp' }>,
) => {
  const client = new Client(
    {
      name: 'digital-life',
      version: '0.1.0',
    },
    {
      capabilities: {},
    },
  );
  const transport = createTransport(registration);
  await client.connect(transport);

  return {
    client,
    transport,
  };
};

export const createUnavailableMcpBridgeFactory = (): McpBridgeFactory => async (connectorId) => ({
  async close() {
    return undefined;
  },
  async startupCheck() {
    return {
      ok: false,
      messages: [
        {
          level: 'warning',
          message: `MCP bridge is not configured for connector ${connectorId}.`,
        },
      ],
    };
  },
  async callTool() {
    throw new Error(`MCP bridge is not configured for connector ${connectorId}.`);
  },
  async listTools() {
    return [];
  },
});

export const createSdkMcpBridgeFactory =
  (): McpBridgeFactory => async (_connectorId, registration) => {
    let session:
      | {
          client: Client;
          transport: Transport;
        }
      | undefined;

    const ensureSession = async () => {
      if (session) {
        return session;
      }

      session = await createConnectedClient(registration);
      return session;
    };

    const closeSession = async () => {
      if (!session) {
        return;
      }

      try {
        await session.transport.close();
      } finally {
        session = undefined;
      }
    };

    return {
      async close() {
        await closeSession();
      },
      async startupCheck() {
        try {
          const activeSession = await ensureSession();
          const result = await activeSession.client.listTools();
          return {
            ok: true,
            messages: [
              {
                level: 'info',
                message: `Connected to MCP endpoint with ${result.tools.length} tools.`,
              },
            ],
          };
        } catch (error) {
          await closeSession();
          return {
            ok: false,
            messages: [
              {
                level: 'error',
                message: error instanceof Error ? error.message : 'Unknown MCP startup error',
              },
            ],
          };
        }
      },
      async callTool(toolName, input) {
        const activeSession = await ensureSession();
        const result = (await activeSession.client.callTool({
          arguments: input,
          name: toolName,
        })) as Record<string, unknown>;
        return extractToolResult(result);
      },
      async listTools() {
        const activeSession = await ensureSession();
        const result = await activeSession.client.listTools();
        return result.tools.map((toolDefinition) => ({
          description: toolDefinition.description ?? `MCP tool ${toolDefinition.name}`,
          inputSchema: toolDefinition.inputSchema,
          name: toolDefinition.name,
        }));
      },
    };
  };

const WRITE_MCP_TOOL_NAMES = new Set([
  'detect_community',
  'post_claim',
  'promote_claim',
  'retract_fragment',
  'save_memory',
  'verify_claim',
]);

const inferMcpToolCapability = (toolName: string): SourceToolDefinition['capability'] =>
  WRITE_MCP_TOOL_NAMES.has(toolName) ? 'write' : 'read';

export const mcpDescriptorToSourceTool = ({
  connectorId,
  descriptor,
  invoke,
}: {
  connectorId: string;
  descriptor: McpToolDescriptor;
  invoke: (toolName: string, input: Record<string, unknown>) => Promise<unknown>;
}): SourceToolDefinition => ({
  id: `${connectorId}.${descriptor.name}`,
  description: descriptor.description,
  capability: inferMcpToolCapability(descriptor.name),
  role: 'action',
  phases: ['bootstrap', 'learning', 'live', 'maintenance'],
  inputSchema: unknownRecordSchema,
  outputSchema: z.unknown(),
  learningHints: {
    pagination: false,
    sinceWindow: false,
  },
  async execute(input) {
    return invoke(descriptor.name, input);
  },
});
