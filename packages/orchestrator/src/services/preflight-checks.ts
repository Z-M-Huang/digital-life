import type { SourceToolConnector } from '@digital-life/connectors';
import type { DenseMemClient } from '@digital-life/core';

export type PreflightResult = {
  ok: boolean;
  checks: PreflightCheck[];
};

export type PreflightCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type PreflightInputs = {
  connectors: SourceToolConnector[];
  denseMemClient: DenseMemClient;
};

export const runPreflightChecks = async ({
  connectors,
  denseMemClient,
}: PreflightInputs): Promise<PreflightResult> => {
  const checks: PreflightCheck[] = [];

  const denseMemHealthy = await denseMemClient.healthCheck();
  checks.push({
    name: 'dense-mem.health',
    ok: denseMemHealthy,
    ...(denseMemHealthy ? {} : { detail: 'dense-mem health check failed' }),
  });

  for (const connector of connectors) {
    try {
      const status = await connector.startupCheck();
      const ok = status.ok;
      const detail = status.messages.find((message) => message.level === 'error')?.message;
      checks.push({
        name: `connector.${connector.id}`,
        ok,
        ...(detail ? { detail } : {}),
      });
    } catch (error) {
      checks.push({
        name: `connector.${connector.id}`,
        ok: false,
        detail: error instanceof Error ? error.message : 'connector startupCheck threw',
      });
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
};
