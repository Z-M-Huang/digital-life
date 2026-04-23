import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callTool: vi.fn(),
  close: vi.fn(),
  connect: vi.fn(),
  listTools: vi.fn(),
  sseTransport: vi.fn(),
  stdioTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function MockClient() {
    return {
      callTool: mocks.callTool,
      connect: mocks.connect,
      listTools: mocks.listTools,
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(function MockStdioTransport(params: unknown) {
    mocks.stdioTransport(params);
    return {
      close: mocks.close,
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn(function MockSseTransport(url: URL, options: unknown) {
    mocks.sseTransport(url, options);
    return {
      close: mocks.close,
    };
  }),
}));

import { createSdkMcpBridgeFactory } from '../src/mcp/bridge';

describe('createSdkMcpBridgeFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue(undefined);
    mocks.listTools.mockResolvedValue({
      tools: [
        {
          description: 'Search files',
          inputSchema: { type: 'object' },
          name: 'search',
        },
      ],
    });
  });

  it('connects process transports, lists tools, and returns structured tool content', async () => {
    mocks.callTool.mockResolvedValue({
      structuredContent: { matches: 2 },
    });
    const bridge = await createSdkMcpBridgeFactory()('filesystem', {
      enabled: true,
      hardDeny: [],
      headers: {},
      kind: 'mcp',
      transport: {
        args: ['server'],
        command: 'bunx',
        cwd: '/tmp',
        env: { TOKEN: 'secret' },
        type: 'process',
      },
    });

    const startup = await bridge.startupCheck();
    const tools = await bridge.listTools();
    const result = await bridge.callTool('search', { query: 'docs' });
    await bridge.close();

    expect(startup.ok).toBe(true);
    expect(startup.messages[0]?.message).toContain('1 tools');
    expect(tools).toEqual([
      {
        description: 'Search files',
        inputSchema: { type: 'object' },
        name: 'search',
      },
    ]);
    expect(result).toEqual({ matches: 2 });
    expect(mocks.stdioTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['server'],
        command: 'bunx',
        cwd: '/tmp',
      }),
    );
    expect(mocks.close).toHaveBeenCalled();
  });

  it('connects SSE transports and returns text tool content', async () => {
    mocks.callTool.mockResolvedValue({
      content: [{ text: 'hello', type: 'text' }],
    });
    const bridge = await createSdkMcpBridgeFactory()('remote', {
      enabled: true,
      hardDeny: [],
      headers: { authorization: 'Bearer token' },
      kind: 'mcp',
      transport: {
        headers: { 'x-custom': '1' },
        type: 'sse',
        url: 'http://localhost:9000/sse',
      },
    });

    expect(await bridge.callTool('read', {})).toBe('hello');
    expect(mocks.sseTransport).toHaveBeenCalledWith(
      new URL('http://localhost:9000/sse'),
      expect.objectContaining({
        requestInit: {
          headers: {
            authorization: 'Bearer token',
            'x-custom': '1',
          },
        },
      }),
    );
  });

  it('surfaces startup and tool execution errors', async () => {
    mocks.connect.mockRejectedValueOnce(new Error('connection refused'));
    const failedBridge = await createSdkMcpBridgeFactory()('broken', {
      enabled: true,
      hardDeny: [],
      headers: {},
      kind: 'mcp',
      transport: {
        args: [],
        command: 'missing',
        env: {},
        type: 'process',
      },
    });

    await expect(failedBridge.startupCheck()).resolves.toMatchObject({
      ok: false,
    });

    mocks.callTool.mockResolvedValue({
      content: [{ text: 'boom', type: 'text' }],
      isError: true,
    });
    const bridge = await createSdkMcpBridgeFactory()('filesystem', {
      enabled: true,
      hardDeny: [],
      headers: {},
      kind: 'mcp',
      transport: {
        args: [],
        command: 'bunx',
        env: {},
        type: 'process',
      },
    });

    await expect(bridge.callTool('search', {})).rejects.toThrow('boom');
  });
});
