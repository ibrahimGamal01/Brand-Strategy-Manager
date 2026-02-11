import dotenv from 'dotenv';
import path from 'path';

export type EnvLoadReport = {
  profile: 'production' | 'non-production';
  backendEnvOverride: boolean;
  hadPreexistingOpenAiKey: boolean;
  rootEnvPath: string;
  backendEnvPath: string;
};

function getProfile(): 'production' | 'non-production' {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production'
    ? 'production'
    : 'non-production';
}

/**
 * Load env deterministically:
 * 1. Repo root fallback (no override)
 * 2. Backend env (override in non-production)
 */
export function loadBackendEnv(): EnvLoadReport {
  const profile = getProfile();
  const backendEnvOverride = profile !== 'production';
  const hadPreexistingOpenAiKey = Boolean(String(process.env.OPENAI_API_KEY || '').trim());

  const rootEnvPath = path.resolve(__dirname, '../../../../.env');
  const backendEnvPath = path.resolve(__dirname, '../../.env');

  dotenv.config({ path: rootEnvPath, override: false });
  dotenv.config({ path: backendEnvPath, override: backendEnvOverride });

  return {
    profile,
    backendEnvOverride,
    hadPreexistingOpenAiKey,
    rootEnvPath,
    backendEnvPath,
  };
}

