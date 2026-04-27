import { describe, expect, it } from 'vitest';

import { createBudget, LLMBudgetExceededError } from '../src/llm/budget';

describe('LLM budget', () => {
  it('rejects non-positive limits', () => {
    expect(() => createBudget(0)).toThrow(RangeError);
    expect(() => createBudget(-10)).toThrow(RangeError);
    expect(() => createBudget(Number.NaN)).toThrow(RangeError);
  });

  it('tracks token usage and remaining budget', () => {
    const budget = createBudget(1000);
    budget.charge({ inputTokens: 200, outputTokens: 50 });
    budget.charge({ inputTokens: 100 });

    expect(budget.state()).toEqual({
      promptTokens: 300,
      completionTokens: 50,
      totalTokens: 350,
      callCount: 2,
    });
    expect(budget.remaining()).toBe(650);
    expect(budget.exceeded()).toBe(false);
  });

  it('throws via guard once limit is exceeded', () => {
    const budget = createBudget(100);
    budget.charge({ inputTokens: 50, outputTokens: 60 });
    expect(budget.exceeded()).toBe(true);
    expect(budget.remaining()).toBe(0);
    expect(() => budget.guard()).toThrow(LLMBudgetExceededError);
  });

  it('reset() clears accumulated state', () => {
    const budget = createBudget(50);
    budget.charge({ inputTokens: 40, outputTokens: 20 });
    budget.reset();
    expect(budget.state().totalTokens).toBe(0);
    expect(budget.exceeded()).toBe(false);
  });
});
