import type { LLMClient } from '../llm/client';
import type { PromptBundle } from '../prompts/load';
import { type QueryAgentOutput, queryAgentOutputSchema } from './output-modes';

export type EvidenceItem = {
  id: string;
  content: string;
  score: number;
  kind?: string;
  connectorIds?: string[];
};

export type ConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type QueryAgentInput = {
  query: string;
  evidence: EvidenceItem[];
  conversation: ConversationTurn[];
  personaSlices?: string[];
  signal?: AbortSignal;
};

export type QueryAgent = {
  decide: (input: QueryAgentInput) => Promise<QueryAgentOutput>;
  buildAnswerPrompt: (input: QueryAgentInput) => { system: string; prompt: string };
};

const formatEvidence = (evidence: EvidenceItem[]): string => {
  if (evidence.length === 0) {
    return '(no evidence retrieved)';
  }
  return evidence
    .map(
      (item) =>
        `- id=${item.id} score=${item.score.toFixed(2)} kind=${item.kind ?? 'unknown'}: ${item.content}`,
    )
    .join('\n');
};

const formatConversation = (turns: ConversationTurn[]): string => {
  if (turns.length === 0) {
    return '(no prior turns)';
  }
  return turns.map((turn) => `${turn.role}: ${turn.content}`).join('\n');
};

const buildUserPrompt = (input: QueryAgentInput): string =>
  [
    `Conversation so far:\n${formatConversation(input.conversation)}`,
    '',
    `Latest user message: ${input.query}`,
    '',
    `Retrieved evidence:\n${formatEvidence(input.evidence)}`,
    '',
    input.personaSlices && input.personaSlices.length > 0
      ? `Persona slices:\n${input.personaSlices.map((slice) => `- ${slice}`).join('\n')}`
      : 'Persona slices: (none yet)',
    '',
    'Decide a mode and produce a structured response per the schema. Cite evidence ids you used. If unsure, prefer abstention or clarification over hallucination.',
  ].join('\n');

export const createQueryAgent = ({
  client,
  prompts,
}: {
  client: LLMClient;
  prompts: PromptBundle;
}): QueryAgent => {
  const buildAnswerPrompt = (input: QueryAgentInput) => ({
    system: prompts.query,
    prompt: buildUserPrompt(input),
  });

  const decide = async (input: QueryAgentInput): Promise<QueryAgentOutput> => {
    const { system, prompt } = buildAnswerPrompt(input);
    const result = await client.generateObject({
      system,
      prompt,
      schema: queryAgentOutputSchema,
      context: {
        promptId: 'query',
        promptVersion: prompts.promptVersion,
        ...(input.signal ? { signal: input.signal } : {}),
      },
    });
    return result.object;
  };

  return { decide, buildAnswerPrompt };
};
