import fs from 'fs';
import path from 'path';
import { logger } from './logger';

interface CacheEntry<T> {
  timestamp: number;
  expiresAt: number;
  data: T;
}

const CACHE_DIR = path.join(__dirname, '..', '..', 'cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export class Cache {
  constructor(private cacheHours: number) {}
  
  private getCachePath(key: string): string {
    return path.join(CACHE_DIR, `${key}.json`);
  }
  
  get<T>(key: string): T | null {
    const cachePath = this.getCachePath(key);
    
    if (!fs.existsSync(cachePath)) {
      logger.info(`Cache miss: ${key}`);
      return null;
    }
    
    try {
      const content = fs.readFileSync(cachePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);
      
      if (Date.now() > entry.expiresAt) {
        logger.info(`Cache expired: ${key}`);
        fs.unlinkSync(cachePath);
        return null;
      }
      
      const ageHours = ((Date.now() - entry.timestamp) / (1000 * 60 * 60)).toFixed(1);
      logger.success(`Cache hit: ${key} (${ageHours}h old)`);
      return entry.data;
    } catch (error) {
      logger.warn(`Cache read error: ${key}`, error);
      return null;
    }
  }
  
  set<T>(key: string, data: T): void {
    const cachePath = this.getCachePath(key);
    const expiresMs = this.cacheHours * 60 * 60 * 1000;
    
    const entry: CacheEntry<T> = {
      timestamp: Date.now(),
      expiresAt: Date.now() + expiresMs,
      data,
    };
    
    fs.writeFileSync(cachePath, JSON.stringify(entry, null, 2));
    logger.info(`Cache saved: ${key} (expires in ${this.cacheHours}h)`);
  }
  
  clear(key: string): void {
    const cachePath = this.getCachePath(key);
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      logger.info(`Cache cleared: ${key}`);
    }
  }
  
  clearAll(): void {
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(CACHE_DIR, file));
      }
    }
    logger.info('All cache cleared');
  }
}
