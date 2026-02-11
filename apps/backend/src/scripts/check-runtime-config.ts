import { loadBackendEnv } from '../lib/load-env';
import { isOpenAiConfiguredForRealMode, validateRuntimePreflight } from '../lib/runtime-preflight';

function asBool(value: boolean): string {
  return value ? 'true' : 'false';
}

function run(): void {
  const envLoad = loadBackendEnv();

  const keyPresent = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
  const fallbackMode = String(process.env.AI_FALLBACK_MODE || 'off').trim().toLowerCase() || 'off';
  const openAiFormatValid = isOpenAiConfiguredForRealMode();

  let preflightPass = true;
  let preflightError = '';
  let providerOpenAi = false;
  let providerApifyApi = false;
  let providerApifyMedia = false;

  try {
    const report = validateRuntimePreflight();
    providerOpenAi = report.providers.openai;
    providerApifyApi = report.providers.apifyApi;
    providerApifyMedia = report.providers.apifyMediaDownloader;
  } catch (error: any) {
    preflightPass = false;
    preflightError = String(error?.message || error);
  }

  console.log(
    `[RuntimeConfig] profile=${envLoad.profile} backendEnvOverride=${asBool(
      envLoad.backendEnvOverride
    )} shellOpenAiPreSet=${asBool(envLoad.hadPreexistingOpenAiKey)}`
  );
  console.log(
    `[RuntimeConfig] fallbackMode=${fallbackMode} openAiKeyPresent=${asBool(
      keyPresent
    )} openAiFormatValid=${asBool(openAiFormatValid)}`
  );
  console.log(
    `[RuntimeConfig] preflightPass=${asBool(preflightPass)} providers(openai=${asBool(
      providerOpenAi
    )}, apifyApi=${asBool(providerApifyApi)}, apifyMedia=${asBool(providerApifyMedia)})`
  );

  if (!preflightPass) {
    console.error(`[RuntimeConfig] preflightError=${preflightError}`);
    process.exit(1);
  }
}

run();

