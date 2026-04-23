import type { LearningMaterial } from '@digital-life/agents';
import type { ScopeOption, SourceToolConnector } from '@digital-life/connectors';
import type { LearningRunMode } from '@digital-life/core';

import type {
  CursorWindowRecord,
  StoredScopeSelection,
} from '../repositories/runtime-state-repository';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isScopeItem = (value: unknown): value is { id: string; label: string } =>
  isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string';

export const deriveScopeSelections = ({
  connector,
  result,
  toolId,
}: {
  connector: SourceToolConnector;
  result: unknown;
  toolId: string;
}): StoredScopeSelection => {
  if (connector.scopeDiscovery?.toolIds.includes(toolId)) {
    return connector.scopeDiscovery.mapResult(toolId, result);
  }

  if (isRecord(result) && Array.isArray(result.items)) {
    return result.items.filter(isScopeItem).map((item) => ({
      id: item.id,
      label: item.label,
      metadata: { kind: 'enumerated' },
    }));
  }

  if (Array.isArray(result)) {
    return result.filter(isScopeItem).map((item) => ({
      id: item.id,
      label: item.label,
      metadata: { kind: 'enumerated' },
    }));
  }

  return [];
};

export const buildFetchInput = ({
  mode,
  previousWindow,
  selection,
}: {
  mode: LearningRunMode;
  previousWindow?: CursorWindowRecord;
  selection: ScopeOption;
}): Record<string, unknown> => {
  const kind = selection.metadata?.kind;
  const input: Record<string, unknown> = {};

  if (kind === 'repository') {
    input.repositoryId = selection.id;
  } else if (kind === 'project') {
    input.projectId = selection.id;
  } else if (kind === 'space') {
    input.spaceId = selection.id;
  } else if (kind === 'channel') {
    input.channelId = selection.id;
  } else if (kind === 'inbox-window') {
    input.windowId = selection.id;
  } else {
    input.id = selection.id;
  }

  if (mode === 'incremental') {
    if (previousWindow?.cursorValue) {
      input.cursor = previousWindow.cursorValue;
    }
    if (previousWindow?.windowEnd) {
      input.since = previousWindow.windowEnd.toISOString();
    }
  }

  if (mode === 'resync') {
    input.resync = true;
  }

  return input;
};

const resultTextEntries = (result: unknown): string[] => {
  if (typeof result === 'string') {
    return [result];
  }

  if (Array.isArray(result)) {
    return result.flatMap((entry) => resultTextEntries(entry));
  }

  if (!isRecord(result)) {
    return [];
  }

  if (Array.isArray(result.facts)) {
    return result.facts.filter((entry): entry is string => typeof entry === 'string');
  }

  if (typeof result.content === 'string') {
    return [result.content];
  }

  if (typeof result.label === 'string' && typeof result.id === 'string') {
    return [`${result.label} (${result.id}) ${JSON.stringify(result)}`];
  }

  return [JSON.stringify(result)];
};

export const resultToLearningMaterials = ({
  connectorId,
  mode,
  result,
  selection,
  toolId,
}: {
  connectorId: string;
  mode: LearningRunMode;
  result: unknown;
  selection: ScopeOption;
  toolId: string;
}): LearningMaterial[] =>
  resultTextEntries(result)
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text, index) => ({
      id: `${connectorId}:${toolId}:${selection.id}:${mode}:${index}`,
      text,
      source: toolId,
      metadata: {
        connectorId,
        mode,
        scopeId: selection.id,
        scopeKind: selection.metadata?.kind ?? 'unknown',
        toolId,
      },
    }));
