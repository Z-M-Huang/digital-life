import type {
  ScopeOption,
  SourceToolConnector,
  UnifiedToolRegistry,
} from '@digital-life/connectors';
import type { GovernedPhase, RuntimeToolPolicyRecord } from '@digital-life/core';
import { evaluateToolPhasePolicy } from '@digital-life/core';

import type {
  ReadinessState,
  RuntimeStateRepository,
  StoredScopeSelection,
} from '../repositories/runtime-state-repository';

export class ConnectorService {
  constructor(
    private readonly config: Parameters<typeof evaluateToolPhasePolicy>[0]['config'],
    private readonly connectors: SourceToolConnector[],
    private readonly registry: UnifiedToolRegistry,
    private readonly repository: RuntimeStateRepository,
    private readonly getReadiness?: () => Promise<ReadinessState>,
    private readonly afterMutation?: () => Promise<unknown>,
  ) {}

  async getConnector(connectorId: string): Promise<SourceToolConnector> {
    const connector = this.connectors.find((entry) => entry.id === connectorId);
    if (!connector) {
      throw new Error(`Unknown connector: ${connectorId}`);
    }

    return connector;
  }

  async getScope(connectorId: string): Promise<StoredScopeSelection> {
    await this.getConnector(connectorId);
    return this.repository.getConnectorScope(connectorId);
  }

  async getScopeOptions(connectorId: string): Promise<ScopeOption[]> {
    const connector = await this.getConnector(connectorId);
    if (!connector.scopeDiscovery) {
      return [];
    }

    const results = await Promise.all(
      connector.scopeDiscovery.toolIds.map(async (toolId) => {
        const result = await this.registry.invoke(toolId, {}, 'bootstrap');
        return connector.scopeDiscovery?.mapResult(toolId, result) ?? [];
      }),
    );

    return results.flat();
  }

  async listConnectors(): Promise<
    Array<{
      id: string;
      displayName: string;
      kind: SourceToolConnector['kind'];
      scopeCount: number;
      toolCount: number;
    }>
  > {
    return Promise.all(
      this.connectors.map(async (connector) => {
        const scope = await this.repository.getConnectorScope(connector.id);
        const tools = await connector.listTools();
        return {
          id: connector.id,
          displayName: connector.displayName,
          kind: connector.kind,
          scopeCount: scope.length,
          toolCount: tools.length,
        };
      }),
    );
  }

  async listTools(): Promise<
    Array<{
      toolId: string;
      capability: string;
      role: string;
      phases: string[];
      learningEnabled: boolean;
      liveEnabled: boolean;
      maintenanceEnabled: boolean;
    }>
  > {
    const policies = await this.repository.listToolPolicies();
    return this.registry.listTools().map((toolDefinition) => ({
      toolId: toolDefinition.id,
      capability: toolDefinition.capability,
      role: toolDefinition.role,
      phases: [...toolDefinition.phases],
      learningEnabled: evaluateToolPhasePolicy({
        capability: toolDefinition.capability,
        config: this.config,
        phase: 'learning',
        policies,
        toolId: toolDefinition.id,
      }).enabled,
      liveEnabled: evaluateToolPhasePolicy({
        capability: toolDefinition.capability,
        config: this.config,
        phase: 'live',
        policies,
        toolId: toolDefinition.id,
      }).enabled,
      maintenanceEnabled: evaluateToolPhasePolicy({
        capability: toolDefinition.capability,
        config: this.config,
        phase: 'maintenance',
        policies,
        toolId: toolDefinition.id,
      }).enabled,
    }));
  }

  async patchToolPolicy(
    toolId: string,
    phase: GovernedPhase,
    enabled: boolean,
    reason?: string,
  ): Promise<RuntimeToolPolicyRecord> {
    const toolDefinition = this.registry.getTool(toolId);
    if (!toolDefinition) {
      throw new Error(`Unknown tool: ${toolId}`);
    }

    if (enabled && phase === 'learning' && toolDefinition.capability !== 'read') {
      throw new Error('Learning phase cannot enable write or execute tools.');
    }

    if (enabled && phase === 'live' && toolDefinition.capability !== 'read') {
      if (!reason?.trim()) {
        throw new Error('Live write or execute tools require an operator reason.');
      }

      if (this.getReadiness) {
        const readiness = await this.getReadiness();
        if (readiness.status !== 'ready') {
          throw new Error('Live write or execute tools require readiness status ready.');
        }
      }
    }

    const policy = await this.repository.upsertToolPolicy({
      toolId,
      phase,
      enabled,
      reason: reason ?? null,
    });
    if (this.afterMutation) {
      await this.afterMutation();
    }

    return policy;
  }

  async setScope(connectorId: string, scope: StoredScopeSelection): Promise<void> {
    await this.getConnector(connectorId);
    await this.repository.saveConnectorScope(connectorId, scope);
    if (this.afterMutation) {
      await this.afterMutation();
    }
  }
}
