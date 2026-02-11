# Secrets and AI Mode Runbook

## Purpose
This runbook defines how to run `main` safely:
- no live secrets in tracked files,
- strict runtime validation for AI/scraper credentials,
- explicit AI fallback control.

## Runtime Secret Contract
Set these values in your runtime secret manager (or local untracked env files only):

- `OPENAI_API_KEY`
- `APIFY_API_TOKEN`
- `APIFY_MEDIA_DOWNLOADER_TOKEN`

Do not commit real values in docs, tests, env examples, or source code.

## AI Mode Contract
- `AI_FALLBACK_MODE=off`:
  - required for production profile (`NODE_ENV=production`)
  - real OpenAI credentials required
  - invalid/missing keys fail startup preflight
- `AI_FALLBACK_MODE=mock`:
  - allowed only in non-production
  - used for local/testing flows only

## Startup Validation
Backend startup runs preflight validation from:
- `apps/backend/src/lib/runtime-preflight.ts`

Validation checks:
- `AI_FALLBACK_MODE` is `off|mock`
- `OPENAI_API_KEY` format is valid in real mode
- Apify token formats are valid
- production blocks invalid configuration

## AI Failure Semantics
Deep question generation emits explicit events:
- `ai.config.invalid`
- `ai.auth.failed`
- `ai.fallback.used` (only if fallback is explicitly enabled)

In production strict mode, authentication/config failures do not silently persist mock answers.

## Pre-Deploy Checklist
1. Rotate provider keys if there was any leak risk.
2. Update runtime secret manager values.
3. Confirm old keys are revoked/invalid.
4. Confirm `AI_FALLBACK_MODE=off` for production.
5. Run `npm run security:scan-main`.
6. Ensure CI passes:
   - `Main Hardening Scan`
   - `Gitleaks (Working Tree)`
7. Deploy backend and verify startup preflight logs.

## Post-Deploy Smoke
1. Trigger one research cycle.
2. Confirm no OpenAI 401 errors.
3. Confirm no `ai.fallback.used` events in production.
4. Confirm continuity/scraper/downloader events continue as expected.

## If Key Seems Ignored
1. Fully restart backend process after `.env` edits (do not rely on hot reload only).
2. Verify shell does not export stale values:
   - `echo $OPENAI_API_KEY`
   - `echo $AI_FALLBACK_MODE`
3. Run runtime check:
   - `npm run check:runtime-config --workspace=apps/backend`
4. Expected for local strict mode:
   - `fallbackMode=off`
   - `openAiKeyPresent=true`
   - `openAiFormatValid=true`
   - `preflightPass=true`
