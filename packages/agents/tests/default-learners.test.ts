import { describe, expect, it } from 'vitest';

import {
  createCannedLearnerClient,
  createDefaultLearners,
  LEARNER_KINDS,
  loadBuiltinPrompts,
  runDefaultLearners,
} from '../src';

const buildPrompts = async () => ({
  ...(await loadBuiltinPrompts()),
  promptVersion: '1.test',
});

describe('default learners', () => {
  it('creates one learner per kind', async () => {
    const learners = createDefaultLearners({
      client: createCannedLearnerClient(),
      prompts: await buildPrompts(),
    });
    expect(learners.map((learner) => learner.id)).toEqual([...LEARNER_KINDS]);
  });

  it('produces structured fragments with extraction metadata', async () => {
    const client = createCannedLearnerClient({
      factual: [
        {
          content: 'The repository mirrors personal workflows.',
          confidence: 0.8,
          evidenceSpan: 'lines 1-2',
          entities: ['repository'],
        },
      ],
      style: [
        {
          content: 'Casual tone with technical specifics.',
          confidence: 0.7,
          toneMarkers: ['casual', 'technical'],
        },
      ],
      behavior: [],
      reasoning: [
        {
          content: 'Prefers reversible decisions.',
          confidence: 0.65,
          heuristic: 'reversible-default',
        },
      ],
    });

    const learners = createDefaultLearners({ client, prompts: await buildPrompts() });
    const fragments = await runDefaultLearners(
      {
        id: 'material-1',
        text: 'The repository mirrors personal workflows. It is updated weekly.',
        source: 'demo.fetchRepository',
        metadata: { connectorId: 'demo' },
      },
      learners,
    );

    expect(fragments).toHaveLength(3);
    const factual = fragments.find((fragment) => fragment.kind === 'factual');
    expect(factual?.content).toContain('mirrors personal workflows');
    expect(factual?.authority).toBe('connector:demo');
    expect(factual?.provenance.extraction.extractionModel).toBe('mock-model');
    expect(factual?.provenance.extraction.promptVersion).toBe('1.test');
    expect(factual?.structured).toMatchObject({ entities: ['repository'] });
  });

  it('skips fragments when canned response is empty', async () => {
    const learners = createDefaultLearners({
      client: createCannedLearnerClient(),
      prompts: await buildPrompts(),
    });
    const fragments = await runDefaultLearners(
      { id: 'm', text: 'irrelevant', source: 'demo' },
      learners,
    );
    expect(fragments).toEqual([]);
  });
});
