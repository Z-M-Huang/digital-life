import { describe, expect, it } from 'vitest';

import { defaultLearners, runDefaultLearners } from '../src/learners/default-learners';

describe('default learners', () => {
  it('creates one learner per category', () => {
    expect(defaultLearners.map((learner) => learner.id)).toEqual([
      'factual',
      'style',
      'behavior',
      'reasoning',
    ]);
  });

  it('derives fragments with provenance from learning material', async () => {
    const fragments = await runDefaultLearners({
      id: 'material-1',
      text: 'The repository mirrors personal workflows. It is updated weekly.',
      source: 'demo.fetchRepository',
    });

    expect(fragments).toHaveLength(4);
    expect(fragments[0]?.provenance.materialId).toBe('material-1');
    expect(fragments[0]?.content).toContain('The repository mirrors personal workflows');
  });
});
