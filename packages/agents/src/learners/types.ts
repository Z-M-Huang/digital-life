import type { LearnerKind } from './output-schemas';

export type LearningMaterial = {
  id: string;
  text: string;
  source: string;
  metadata?: Record<string, unknown>;
};

export type ExtractionMetadata = {
  promptVersion: string;
  extractionModel: string;
  extractionVersion: string;
};

export type FragmentProvenance = {
  source: string;
  materialId: string;
  metadata?: Record<string, unknown>;
  extraction: ExtractionMetadata;
};

export type LearnedFragment = {
  kind: LearnerKind;
  content: string;
  confidence: number;
  evidenceSpan?: string;
  authority: string;
  provenance: FragmentProvenance;
  structured?: Record<string, unknown>;
};

export type LearnerInvocation = {
  signal?: AbortSignal;
};

export type LearnerAgent = {
  id: LearnerKind;
  learn: (material: LearningMaterial, invocation?: LearnerInvocation) => Promise<LearnedFragment[]>;
};

export type { LearnerKind };
