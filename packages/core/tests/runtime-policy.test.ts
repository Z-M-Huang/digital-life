import { describe, expect, it } from 'vitest';

import type { DigitalLifeConfig } from '../src/config/schema';
import { evaluateToolPhasePolicy, runtimePolicyKey } from '../src/policy/runtime-policy';
import type { RuntimeToolPolicyRecord } from '../src/types';

const baseConfig: DigitalLifeConfig = {
  persona: {
    id: 'primary',
    displayName: 'Digital Life',
  },
  ai: {
    model: 'gpt-test',
    temperature: 0.2,
    promptOverrides: {},
  },
  safety: {
    defaults: {
      read: 'allow',
      write: 'deny',
      execute: 'deny',
    },
    hardDeny: ['demo.blocked'],
  },
  denseMem: {
    baseUrl: 'http://localhost:8081',
    namespace: 'digital-life',
    timeoutMs: 5000,
  },
  connectors: {
    demo: {
      kind: 'builtin',
      enabled: true,
      source: 'demo',
      config: {},
      headers: {},
      hardDeny: [],
    },
  },
};

describe('evaluateToolPhasePolicy', () => {
  it('applies hard deny before runtime overrides', () => {
    const policies: RuntimeToolPolicyRecord[] = [
      { toolId: 'demo.blocked', phase: 'live', enabled: true },
    ];

    const evaluation = evaluateToolPhasePolicy({
      capability: 'read',
      config: baseConfig,
      phase: 'live',
      policies,
      toolId: 'demo.blocked',
    });

    expect(evaluation).toEqual({ enabled: false, source: 'hard-deny' });
  });

  it('keeps learning read-only even with an enabling override', () => {
    const policies: RuntimeToolPolicyRecord[] = [
      { toolId: 'demo.write', phase: 'learning', enabled: true },
    ];

    const evaluation = evaluateToolPhasePolicy({
      capability: 'write',
      config: baseConfig,
      phase: 'learning',
      policies,
      toolId: 'demo.write',
    });

    expect(evaluation).toEqual({ enabled: false, source: 'phase-guard' });
  });

  it('allows runtime overrides to tighten or enable governed phases', () => {
    const policies: RuntimeToolPolicyRecord[] = [
      { toolId: 'demo.search', phase: 'live', enabled: false, reason: 'operator choice' },
      { toolId: 'demo.write', phase: 'maintenance', enabled: true },
    ];

    const disabledLive = evaluateToolPhasePolicy({
      capability: 'read',
      config: baseConfig,
      phase: 'live',
      policies,
      toolId: 'demo.search',
    });

    const enabledMaintenance = evaluateToolPhasePolicy({
      capability: 'write',
      config: baseConfig,
      phase: 'maintenance',
      policies,
      toolId: 'demo.write',
    });

    expect(runtimePolicyKey('demo.search', 'live')).toBe('demo.search:live');
    expect(disabledLive).toEqual({ enabled: false, source: 'runtime' });
    expect(enabledMaintenance).toEqual({ enabled: true, source: 'runtime' });
  });

  it('uses default capability policy during bootstrap', () => {
    const readPolicy = evaluateToolPhasePolicy({
      capability: 'read',
      config: baseConfig,
      phase: 'bootstrap',
      policies: [],
      toolId: 'demo.read',
    });

    const executePolicy = evaluateToolPhasePolicy({
      capability: 'execute',
      config: baseConfig,
      phase: 'bootstrap',
      policies: [],
      toolId: 'demo.exec',
    });

    expect(readPolicy).toEqual({ enabled: true, source: 'default' });
    expect(executePolicy).toEqual({ enabled: false, source: 'default' });
  });
});
