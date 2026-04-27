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
    return '(nothing on this topic)';
  }
  return evidence
    .map((item) => `- [${item.id}] ${item.content}`)
    .join('\n');
};

const formatConversation = (turns: ConversationTurn[]): string => {
  if (turns.length === 0) {
    return '(no prior turns)';
  }
  return turns
    .map((turn) => (turn.role === 'user' ? `Them: ${turn.content}` : `You: ${turn.content}`))
    .join('\n');
};

const buildUserPrompt = (input: QueryAgentInput): string =>
  [
    'Who you are (this is YOU, not external info):',
    input.personaSlices && input.personaSlices.length > 0
      ? input.personaSlices.map((slice) => `- ${slice}`).join('\n')
      : '- (no persona profile yet — speak in a neutral first-person voice)',
    '',
    'Recent chat (with the person you are talking to right now):',
    formatConversation(input.conversation),
    '',
    'Stuff you happen to know (treat as your own memory, NEVER mention as "evidence" or "records" to them):',
    formatEvidence(input.evidence),
    '',
    `They just said: ${input.query}`,
    '',
    'Reply as yourself. Put the in-character spoken text in `answer`. Pick a mode. If you draw on something from "Stuff you happen to know", put its bracketed id in `citedEvidenceIds` — do NOT mention these ids in the answer text.',
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
