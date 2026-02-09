export interface GenerationResult {
  markdown: string;
  validationScore: number;
  passed: boolean;
  attempts: number;
  warnings: string[];
  costUSD: number;
}

export interface GenerationAttempt {
  attemptNumber: number;
  markdown: string;
  validationScore: number;
  feedback: string[];
}
