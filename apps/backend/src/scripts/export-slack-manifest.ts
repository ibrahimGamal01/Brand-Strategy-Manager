import fs from 'node:fs';
import path from 'node:path';
import { loadBackendEnv } from '../lib/load-env';
import { buildSlackManifestBundle } from '../services/slack/slack-manifest';

function run(): void {
  loadBackendEnv();
  const bundle = buildSlackManifestBundle();
  const outputPathRaw = String(process.argv[2] || '').trim();

  if (outputPathRaw) {
    const outputPath = path.resolve(process.cwd(), outputPathRaw);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, bundle.yaml, 'utf8');
    console.log(`[SlackManifest] wrote YAML manifest to ${outputPath}`);
  } else {
    process.stdout.write(bundle.yaml);
  }

  if (bundle.warnings.length) {
    console.warn(`[SlackManifest] warnings: ${bundle.warnings.join(' | ')}`);
  }
}

run();
