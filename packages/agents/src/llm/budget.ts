export type BudgetState = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
};

export type LLMBudget = {
  state: () => BudgetState;
  charge: (usage: { inputTokens?: number; outputTokens?: number }) => void;
  remaining: () => number;
  exceeded: () => boolean;
  reset: () => void;
  guard: () => void;
};

export class LLMBudgetExceededError extends Error {
  constructor(
    public readonly used: number,
    public readonly limit: number,
  ) {
    super(`LLM token budget exceeded: ${used}/${limit}`);
    this.name = 'LLMBudgetExceededError';
  }
}

export const createBudget = (limit: number): LLMBudget => {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new RangeError('Budget limit must be a positive finite number.');
  }

  const state: BudgetState = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    callCount: 0,
  };

  return {
    state: () => ({ ...state }),
    charge({ inputTokens = 0, outputTokens = 0 }) {
      state.promptTokens += inputTokens;
      state.completionTokens += outputTokens;
      state.totalTokens += inputTokens + outputTokens;
      state.callCount += 1;
    },
    remaining() {
      return Math.max(0, limit - state.totalTokens);
    },
    exceeded() {
      return state.totalTokens >= limit;
    },
    reset() {
      state.promptTokens = 0;
      state.completionTokens = 0;
      state.totalTokens = 0;
      state.callCount = 0;
    },
    guard() {
      if (state.totalTokens >= limit) {
        throw new LLMBudgetExceededError(state.totalTokens, limit);
      }
    },
  };
};
