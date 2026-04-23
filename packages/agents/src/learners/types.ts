export type LearningMaterial = {
  id: string;
  text: string;
  source: string;
  metadata?: Record<string, unknown>;
};

export type LearnedFragment = {
  kind: 'factual' | 'style' | 'behavior' | 'reasoning';
  content: string;
  provenance: {
    source: string;
    materialId: string;
    metadata?: Record<string, unknown>;
  };
};

export type LearnerAgent = {
  id: 'factual' | 'style' | 'behavior' | 'reasoning';
  learn: (material: LearningMaterial) => Promise<LearnedFragment[]>;
};
