import { logger } from './logger';

export class RateLimiter {
  private lastCallTime = 0;
  private callCount = 0;
  
  constructor(private delayMs: number) {}
  
  async wait(): Promise<void> {
    this.callCount++;
    
    // First call - short warm-up
    if (this.callCount === 1) {
      logger.info('First API call - 10s warm-up...');
      await this.sleep(10000);
      this.lastCallTime = Date.now();
      return;
    }
    
    const elapsed = Date.now() - this.lastCallTime;
    
    if (elapsed < this.delayMs) {
      const waitTime = this.delayMs - elapsed;
      const waitMin = (waitTime / 60000).toFixed(1);
      const waitSec = Math.round(waitTime / 1000);
      
      if (waitTime > 60000) {
        logger.info(`⏳ Waiting ${waitMin} minutes before next API call...`);
      } else {
        logger.info(`⏳ Waiting ${waitSec} seconds before next API call...`);
      }
      
      await this.sleep(waitTime);
    }
    
    this.lastCallTime = Date.now();
  }
  
  // Called when a step was cached (no API call made)
  skipWait(): void {
    // Don't update lastCallTime - the wait is only needed between actual API calls
    logger.debug('Skipped rate limit wait (cached response used)');
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  reset(): void {
    this.lastCallTime = 0;
    this.callCount = 0;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
