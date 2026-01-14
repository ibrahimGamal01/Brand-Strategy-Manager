import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

export interface ContentMixConfig {
  postsPerWeek: number;
  reelsPercentage: number;
  carouselsPercentage: number;
  imagesPercentage: number;
  storiesPercentage: number;
}

export interface Config {
  openaiKey: string;
  apifyToken: string;
  rateLimitMs: number;
  cacheHours: number;
  client: {
    username: string;
    niche: string;
    audience: string;
  };
  competitors: string[];
  contentMix: ContentMixConfig;
}

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export const config: Config = {
  openaiKey: getEnvOrThrow('OPENAI_API_KEY'),
  apifyToken: getEnvOrThrow('APIFY_TOKEN'),
  rateLimitMs: parseInt(getEnvOrDefault('RATE_LIMIT_MS', '90000'), 10),
  cacheHours: parseInt(getEnvOrDefault('CACHE_HOURS', '24'), 10),
  client: {
    username: getEnvOrDefault('CLIENT_USERNAME', 'ummahpreneur'),
    niche: getEnvOrDefault('CLIENT_NICHE', 'Islamic entrepreneurship'),
    audience: getEnvOrDefault('CLIENT_AUDIENCE', 'Muslim entrepreneurs'),
  },
  competitors: getEnvOrDefault('COMPETITORS', '_amrouz,islam4everyone_,thesunnahguy,taemann__')
    .split(',')
    .map(c => c.trim()),
  contentMix: {
    postsPerWeek: parseInt(getEnvOrDefault('POSTS_PER_WEEK', '14'), 10),
    reelsPercentage: parseInt(getEnvOrDefault('REELS_PERCENTAGE', '40'), 10),
    carouselsPercentage: parseInt(getEnvOrDefault('CAROUSELS_PERCENTAGE', '30'), 10),
    imagesPercentage: parseInt(getEnvOrDefault('IMAGES_PERCENTAGE', '20'), 10),
    storiesPercentage: parseInt(getEnvOrDefault('STORIES_PERCENTAGE', '10'), 10),
  },
};
