import type { ModelMessage } from 'ai';
import { z } from 'zod';
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
  systemPromptAppendix?: string;
  signal?: AbortSignal;
};

export type QueryAgent = {
  decide: (input: QueryAgentInput) => Promise<QueryAgentOutput>;
  buildAnswerPrompt: (input: QueryAgentInput) => {
    messages: ModelMessage[];
    prompt: string;
    system: string;
  };
};

const formatEvidence = (evidence: EvidenceItem[]): string => {
  if (evidence.length === 0) {
    return '(nothing on this topic)';
  }
  return evidence.map((item) => `- [${item.id}] ${item.content}`).join('\n');
};

const formatConversation = (turns: ConversationTurn[]): string => {
  if (turns.length === 0) {
    return '(no prior turns)';
  }
  return turns
    .map((turn) => (turn.role === 'user' ? `Them: ${turn.content}` : `You: ${turn.content}`))
    .join('\n');
};

const systemPrompt = (baseSystem: string, appendix?: string): string => {
  const trimmedAppendix = appendix?.trim();
  if (!trimmedAppendix) {
    return baseSystem;
  }

  return [
    baseSystem,
    '## Operator System Prompt Addendum',
    'The following operator-authored instructions are part of the active system prompt and override learned style/context when they conflict. They cannot authorize unsupported factual claims or override strict truth and grounding rules:',
    trimmedAppendix,
  ].join('\n\n');
};

const buildFinalUserPrompt = (input: QueryAgentInput): string =>
  [
    'Who you are (this is YOU, not external info):',
    input.personaSlices && input.personaSlices.length > 0
      ? input.personaSlices.map((slice) => `- ${slice}`).join('\n')
      : '- (no persona profile yet — speak in a neutral first-person voice)',
    '',
    'Stuff you happen to know (the only retrieved facts you may use as memory; NEVER mention as "evidence" or "records" to them):',
    formatEvidence(input.evidence),
    '',
    `They just said: ${input.query}`,
    '',
    'Reply as yourself. Put the in-character spoken text in `answer`. Pick a mode. If you draw on something from "Stuff you happen to know", put every supporting bracketed id in `citedEvidenceIds` — do NOT mention these ids in the answer text. If you cannot cite the exact factual answer, use clarification or abstention instead of guessing.',
  ].join('\n');

const buildPromptPreview = (input: QueryAgentInput): string =>
  [
    'Recent chat (with the person you are talking to right now):',
    formatConversation(input.conversation),
    '',
    buildFinalUserPrompt(input),
  ].join('\n');

const conversationMessages = (turns: ConversationTurn[]): ModelMessage[] =>
  turns.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

const buildMessages = (system: string, input: QueryAgentInput): ModelMessage[] => [
  { role: 'system', content: system },
  ...conversationMessages(input.conversation),
  { role: 'user', content: buildFinalUserPrompt(input) },
];

const groundingReviewSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  repairedMode: z.enum(['clarification', 'abstention']).nullable(),
  repairedAnswer: z.string(),
  repairedClarificationQuestion: z.string().nullable(),
  repairedCitedEvidenceIds: z.array(z.string()),
});

const buildGroundingReviewMessages = (
  input: QueryAgentInput,
  decision: QueryAgentOutput,
): ModelMessage[] => [
  {
    role: 'system',
    content: [
      'You are a strict grounding reviewer for a persona chat response.',
      'Allow the draft only when every factual claim is directly supported by persona identity, recent chat, or retrieved facts.',
      'Also enforce the operator system prompt addendum exactly, including language, script, dialect, tone, and formatting instructions.',
      'Persona identity lines support identity and name answers. Other style fragments only support voice.',
      'A display name is not evidence that the person is currently doing the literal activity named by the display name.',
      'Do not reject greetings, short clarifying questions, or in-character uncertainty answers.',
      'Clarifying questions must not introduce unsupported concrete options, dates, platforms, or current states.',
      'Any claim that the persona is busy, in a meeting, occupied, unavailable, replying later, or delayed is a factual current-state claim and must be explicitly supported.',
      'Reject unsupported concrete facts, examples, entities, dates, products, games, platforms, places, people, amounts, and past actions.',
      'If rejected, repair it as a short in-character abstention or clarification in the same language as the latest message.',
      'The repair must contain no unsupported concrete facts.',
      'If the repair uses retrieved facts, include every supporting id in repairedCitedEvidenceIds.',
    ].join('\n'),
  },
  {
    role: 'user',
    content: [
      'Persona slices:',
      input.personaSlices && input.personaSlices.length > 0
        ? input.personaSlices.map((slice) => `- ${slice}`).join('\n')
        : '(none)',
      '',
      'Operator system prompt addendum:',
      input.systemPromptAppendix?.trim() || '(none)',
      '',
      'Retrieved facts:',
      formatEvidence(input.evidence),
      '',
      'Recent chat:',
      formatConversation(input.conversation),
      '',
      `Latest message: ${input.query}`,
      '',
      'Draft structured output:',
      JSON.stringify({
        mode: decision.mode,
        answer: decision.answer,
        clarificationQuestion: decision.clarificationQuestion,
        citedEvidenceIds: decision.citedEvidenceIds,
      }),
    ].join('\n'),
  },
];

const blockedDecision = (
  decision: QueryAgentOutput,
  review: z.infer<typeof groundingReviewSchema>,
  validEvidenceIds: Set<string>,
): QueryAgentOutput => {
  const repairedMode = review.repairedMode ?? 'abstention';
  const repairedAnswer = review.repairedAnswer.trim();
  const repairedClarificationQuestion = review.repairedClarificationQuestion?.trim() ?? null;
  const repairedCitedEvidenceIds = review.repairedCitedEvidenceIds.filter((id) =>
    validEvidenceIds.has(id),
  );

  if (repairedMode === 'clarification' && repairedClarificationQuestion) {
    return {
      mode: 'clarification',
      answer: '',
      clarificationQuestion: repairedClarificationQuestion,
      citedEvidenceIds: repairedCitedEvidenceIds,
      reflectionSignals: [
        ...decision.reflectionSignals,
        { category: 'missing_context', detail: review.reason },
      ],
    };
  }

  return {
    mode: 'abstention',
    answer: repairedAnswer || 'I do not know.',
    clarificationQuestion: null,
    citedEvidenceIds: repairedCitedEvidenceIds,
    reflectionSignals: [
      ...decision.reflectionSignals,
      { category: 'missing_context', detail: review.reason },
    ],
  };
};

const enforceGroundedDecision = async (
  client: LLMClient,
  decision: QueryAgentOutput,
  input: QueryAgentInput,
  promptVersion: string,
): Promise<QueryAgentOutput> => {
  const evidenceIds = new Set(input.evidence.map((item) => item.id));
  const citedEvidenceIds = decision.citedEvidenceIds.filter((id) => evidenceIds.has(id));
  const sanitized: QueryAgentOutput = {
    ...decision,
    answer: decision.answer.trim(),
    clarificationQuestion: decision.clarificationQuestion ?? null,
    citedEvidenceIds,
    reflectionSignals: decision.reflectionSignals,
  };

  const hasSpokenText =
    sanitized.answer.length > 0 || (sanitized.clarificationQuestion?.trim().length ?? 0) > 0;

  if (!hasSpokenText) {
    return sanitized;
  }

  const review = await client.generateObjectFromMessages({
    messages: buildGroundingReviewMessages(input, sanitized),
    schema: groundingReviewSchema,
    context: {
      promptId: 'query-grounding-review',
      promptVersion,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  });

  return review.object.allowed ? sanitized : blockedDecision(sanitized, review.object, evidenceIds);
};

export const createQueryAgent = ({
  client,
  prompts,
}: {
  client: LLMClient;
  prompts: PromptBundle;
}): QueryAgent => {
  const buildAnswerPrompt = (input: QueryAgentInput) => {
    const system = systemPrompt(prompts.query, input.systemPromptAppendix);
    return {
      system,
      prompt: buildPromptPreview(input),
      messages: buildMessages(system, input),
    };
  };

  const decide = async (input: QueryAgentInput): Promise<QueryAgentOutput> => {
    const { messages } = buildAnswerPrompt(input);
    const result = await client.generateObjectFromMessages({
      messages,
      schema: queryAgentOutputSchema,
      context: {
        promptId: 'query',
        promptVersion: prompts.promptVersion,
        ...(input.signal ? { signal: input.signal } : {}),
      },
    });
    return enforceGroundedDecision(client, result.object, input, prompts.promptVersion);
  };

  return { decide, buildAnswerPrompt };
};
