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

// Respect MOCK_AI_CALLS environment variable
export const COST_PROTECTION: CostProtectionConfig = {
  mockMode: process.env.MOCK_AI_CALLS === 'true',
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
  
  // OpenAI pricing (as of 2024)
  private readonly COST_PER_1K_TOKENS = {
    'gpt-4o': 0.005,          // Input
    'gpt-4o-output': 0.015,   // Output
    'gpt-4o-mini': 0.00015,   // Input
    'gpt-4o-mini-output': 0.0006 // Output
  };

  addUsage(model: string, inputTokens: number, outputTokens: number) {
    const baseCost = this.COST_PER_1K_TOKENS[model as keyof typeof this.COST_PER_1K_TOKENS] || 0.005;
    const outputCost = this.COST_PER_1K_TOKENS[`${model}-output` as keyof typeof this.COST_PER_1K_TOKENS] || 0.015;
    
    const cost = (inputTokens / 1000 * baseCost) + (outputTokens / 1000 * outputCost);
    
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
              suggestion: 'Set MOCK_AI_CALLS=false to use real API',
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
