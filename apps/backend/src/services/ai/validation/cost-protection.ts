/**
 * Cost Protection Configuration
 * 
 * Prevents accidental expensive API calls during testing/development
 */

export interface CostProtectionConfig {
  mockMode: boolean;           // If true, use mock responses instead of real API calls
  maxTokensPerCall: number;    // Maximum tokens allowed per API call
  monthlyBudgetUSD: number;    // Monthly budget limit
  alertThresholdUSD: number;   // Alert when costs exceed this threshold
  requireConfirmation: boolean; // Require explicit confirmation for expensive operations
}

// AI fallback mode is explicitly controlled through AI_FALLBACK_MODE.
export const COST_PROTECTION: CostProtectionConfig = {
  mockMode: String(process.env.AI_FALLBACK_MODE || '').toLowerCase() === 'mock',
  maxTokensPerCall: parseInt(process.env.MAX_TOKENS_PER_CALL || '2000'),
  monthlyBudgetUSD: parseFloat(process.env.MONTHLY_AI_BUDGET || '100'),
  alertThresholdUSD: parseFloat(process.env.COST_ALERT_THRESHOLD || '50'),
  requireConfirmation: process.env.NODE_ENV !== 'production'
};

/**
 * Cost tracker for monitoring API usage
 */
class CostTracker {
  private totalTokens = 0;
  private estimatedCostUSD = 0;

  // Fallback pricing map; can be overridden with AI_MODEL_PRICING_JSON.
  // JSON shape: { "model-name": { "input": 0.001, "output": 0.004 } }
  private readonly COST_PER_1K_TOKENS = this.buildPricingMap();

  private buildPricingMap(): Record<string, { input: number; output: number }> {
    const defaults: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 0.005, output: 0.015 },
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    };

    const raw = process.env.AI_MODEL_PRICING_JSON;
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(raw) as Record<string, { input?: unknown; output?: unknown }>;
      for (const [model, value] of Object.entries(parsed || {})) {
        const input = Number(value?.input);
        const output = Number(value?.output);
        if (Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) {
          defaults[model] = { input, output };
        }
      }
    } catch (error) {
      console.warn('[Cost] Failed to parse AI_MODEL_PRICING_JSON, using defaults');
    }
    return defaults;
  }

  private getModelPricing(model: string): { input: number; output: number } {
    const direct = this.COST_PER_1K_TOKENS[model];
    if (direct) return direct;
    if (model.includes('mini') && this.COST_PER_1K_TOKENS['gpt-4o-mini']) {
      return this.COST_PER_1K_TOKENS['gpt-4o-mini'];
    }
    return this.COST_PER_1K_TOKENS['gpt-4o'] || { input: 0.005, output: 0.015 };
  }

  addUsage(model: string, inputTokens: number, outputTokens: number) {
    const pricing = this.getModelPricing(model);
    
    const cost = (inputTokens / 1000 * pricing.input) + (outputTokens / 1000 * pricing.output);
    
    this.totalTokens += (inputTokens + outputTokens);
    this.estimatedCostUSD += cost;
    
    console.log(`[Cost] +$${cost.toFixed(4)} | Total: $${this.estimatedCostUSD.toFixed(2)} (${this.totalTokens.toLocaleString()} tokens)`);
    
    if (this.estimatedCostUSD > COST_PROTECTION.alertThresholdUSD) {
      console.warn(`⚠️  [Cost Alert] Exceeded threshold: $${this.estimatedCostUSD.toFixed(2)} / $${COST_PROTECTION.alertThresholdUSD}`);
    }
  }

  getStats() {
    return {
      totalTokens: this.totalTokens,
      estimatedCostUSD: this.estimatedCostUSD,
      remainingBudget: COST_PROTECTION.monthlyBudgetUSD - this.estimatedCostUSD
    };
  }

  reset() {
    this.totalTokens = 0;
    this.estimatedCostUSD = 0;
  }
}

export const costTracker = new CostTracker();

/**
 * Mock AI response for testing (zero cost)
 */
export function getMockAIResponse(prompt: string): any {
  return {
    choices: [{
      message: {
        content: JSON.stringify({
          score: 75,
          strengths: ['Mock response - testing mode'],
          improvements: [
            {
              issue: 'This is a mock response',
              suggestion: 'Set AI_FALLBACK_MODE=off to use real API',
              example: 'Real data will be used in production'
            }
          ]
        })
      }
    }],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  };
}

/**
 * Check if operation should be blocked due to cost limits
 */
export function checkCostLimit(): { allowed: boolean; reason?: string } {
  const stats = costTracker.getStats();
  
  if (stats.estimatedCostUSD >= COST_PROTECTION.monthlyBudgetUSD) {
    return {
      allowed: false,
      reason: `Monthly budget exceeded: $${stats.estimatedCostUSD.toFixed(2)} / $${COST_PROTECTION.monthlyBudgetUSD}`
    };
  }
  
  return { allowed: true };
}
