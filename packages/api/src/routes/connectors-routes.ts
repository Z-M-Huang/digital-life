import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';
import { z } from 'zod';

const scopeSchema = z.array(
  z.object({
    id: z.string(),
    label: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
);

const toolPolicySchema = z.object({
  phase: z.enum(['learning', 'live', 'maintenance']),
  enabled: z.boolean(),
  reason: z.string().optional(),
});

export const createConnectorsRoutes = (runtime: DigitalLifeRuntime) => {
  const app = new Hono();

  app.get('/connectors', async (context) =>
    context.json(await runtime.connectorService.listConnectors()),
  );
  app.get('/connectors/:id', async (context) => {
    const connector = await runtime.connectorService.getConnector(context.req.param('id'));
    const tools = await connector.listTools();
    return context.json({
      displayName: connector.displayName,
      id: connector.id,
      kind: connector.kind,
      scopeDiscovery: connector.scopeDiscovery?.toolIds ?? [],
      toolIds: tools.map((toolDefinition) => toolDefinition.id),
    });
  });
  app.get('/connectors/:id/scope-options', async (context) =>
    context.json(await runtime.connectorService.getScopeOptions(context.req.param('id'))),
  );
  app.get('/connectors/:id/scope', async (context) =>
    context.json(await runtime.connectorService.getScope(context.req.param('id'))),
  );
  app.put('/connectors/:id/scope', async (context) => {
    const parsedScope = scopeSchema.parse(await context.req.json());
    await runtime.connectorService.setScope(
      context.req.param('id'),
      parsedScope.map((item) =>
        item.metadata
          ? {
              id: item.id,
              label: item.label,
              metadata: item.metadata,
            }
          : {
              id: item.id,
              label: item.label,
            },
      ),
    );
    return context.json({ ok: true });
  });

  app.get('/tools', async (context) => context.json(await runtime.connectorService.listTools()));
  app.get('/tools/:toolId', async (context) => {
    const toolDefinition = runtime.registry.getTool(context.req.param('toolId'));
    if (!toolDefinition) {
      return context.json({ error: 'tool not found' }, 404);
    }

    return context.json({
      capability: toolDefinition.capability,
      description: toolDefinition.description,
      id: toolDefinition.id,
      phases: toolDefinition.phases,
      role: toolDefinition.role,
    });
  });
  app.patch('/tools/:toolId/policy', async (context) => {
    try {
      const payload = toolPolicySchema.parse(await context.req.json());
      const policy = await runtime.connectorService.patchToolPolicy(
        context.req.param('toolId'),
        payload.phase,
        payload.enabled,
        payload.reason,
      );
      return context.json(policy);
    } catch (error) {
      return context.json(
        {
          error: error instanceof Error ? error.message : 'Invalid tool policy update',
        },
        400,
      );
    }
  });

  return app;
};
