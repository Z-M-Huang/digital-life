import { collectHardDeniedToolIds } from '../config/load-config';
import type { DigitalLifeConfig } from '../config/schema';
import type {
  GovernedPhase,
  RuntimePhase,
  RuntimeToolPolicyRecord,
  ToolCapability,
} from '../types';
import { TOOL_CAPABILITIES } from '../types';

export type EvaluatedToolPolicy = {
  enabled: boolean;
  source: 'default' | 'runtime' | 'hard-deny' | 'phase-guard';
};

export const defaultCapabilityPolicy = (
  capability: ToolCapability,
  config: DigitalLifeConfig,
): boolean => config.safety.defaults[capability] === 'allow';

export const runtimePolicyKey = (toolId: string, phase: GovernedPhase): string =>
  `${toolId}:${phase}`;

export const indexRuntimePolicies = (
  policies: RuntimeToolPolicyRecord[],
): Map<string, RuntimeToolPolicyRecord> =>
  new Map(policies.map((policy) => [runtimePolicyKey(policy.toolId, policy.phase), policy]));

export const evaluateToolPhasePolicy = ({
  capability,
  config,
  phase,
  policies,
  toolId,
}: {
  capability: ToolCapability;
  config: DigitalLifeConfig;
  phase: RuntimePhase;
  policies: RuntimeToolPolicyRecord[];
  toolId: string;
}): EvaluatedToolPolicy => {
  const hardDenied = collectHardDeniedToolIds(config);
  if (hardDenied.has(toolId)) {
    return { enabled: false, source: 'hard-deny' };
  }

  if (phase === 'learning' && capability !== 'read') {
    return { enabled: false, source: 'phase-guard' };
  }

  const defaults = defaultCapabilityPolicy(capability, config);
  if (phase === 'bootstrap') {
    return { enabled: defaults, source: 'default' };
  }

  const runtimeIndex = indexRuntimePolicies(policies);
  const override = runtimeIndex.get(runtimePolicyKey(toolId, phase));
  if (override) {
    if (override.enabled && capability !== 'read' && phase === 'learning') {
      return { enabled: false, source: 'phase-guard' };
    }

    if (override.enabled && capability !== 'read' && !TOOL_CAPABILITIES.includes(capability)) {
      return { enabled: false, source: 'runtime' };
    }

    return { enabled: override.enabled, source: 'runtime' };
  }

  return { enabled: defaults, source: 'default' };
};
