import type { LearnedFragment, LearnerAgent, LearningMaterial } from './types';

const prefixForKind: Record<LearnerAgent['id'], string> = {
  factual: 'Fact',
  style: 'Style',
  behavior: 'Behavior',
  reasoning: 'Reasoning',
};

const createLearner = (id: LearnerAgent['id']): LearnerAgent => ({
  id,
  async learn(material: LearningMaterial): Promise<LearnedFragment[]> {
    const firstSentence =
      material.text.split(/[.!?]/).find(Boolean)?.trim() ?? material.text.trim();
    if (firstSentence.length === 0) {
      return [];
    }

    return [
      {
        kind: id,
        content: `${prefixForKind[id]}: ${firstSentence}`,
        provenance: {
          source: material.source,
          materialId: material.id,
          ...(material.metadata ? { metadata: material.metadata } : {}),
        },
      },
    ];
  },
});

export const defaultLearners: LearnerAgent[] = [
  createLearner('factual'),
  createLearner('style'),
  createLearner('behavior'),
  createLearner('reasoning'),
];

export const runDefaultLearners = async (
  material: LearningMaterial,
): Promise<LearnedFragment[]> => {
  const results = await Promise.all(defaultLearners.map((learner) => learner.learn(material)));
  return results.flat();
};
