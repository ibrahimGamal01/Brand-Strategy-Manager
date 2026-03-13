import express from 'express';
import http from 'http';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { prisma } from './lib/prisma';
import { validateRuntimePreflight } from './lib/runtime-preflight';
import { loadBackendEnv } from './lib/load-env';
import { assertSchemaReadiness, checkSchemaReadiness, SchemaReadinessReport } from './lib/schema-readiness';
import clientsRouter from './routes/clients';
import researchJobsRouter from './routes/research-jobs';
import mediaRouter from './routes/media';
import competitorsRouter from './routes/competitors';
import analyticsRouter from './routes/analytics';
import aiStrategyRouter from './routes/ai-strategy';
import intelligenceCrudRouter from './routes/research-jobs-intelligence-crud';
import monitoringRouter from './routes/monitoring';
import instagramDataRouter from './routes/instagram-data';
import tiktokDataRouter from './routes/tiktok-data';
import brandIntelligenceRouter from './routes/research-jobs-brand-intelligence';
import recoveryRouter from './routes/recovery';
import orchestrationRouter from './routes/orchestration';
import contentCalendarRouter from './routes/content-calendar';
import chatRouter from './routes/research-jobs-chat';
import screenshotsRouter from './routes/research-jobs-screenshots';
import questionsRouter from './routes/research-jobs-questions';
import documentsRouter from './routes/research-jobs-documents';
import webIntelligenceRouter from './routes/research-jobs-web-intelligence';
import chatRuntimeRouter from './routes/research-jobs-chat-runtime';
import portalRouter from './routes/portal';
import { STORAGE_ROOT } from './services/storage/storage-root';
import { attachChatWebSocketServer } from './services/chat/chat-ws';
import { attachRuntimeWebSocketServer } from './services/chat/runtime/runtime-ws';
import { requirePortalAuth, requireWorkspaceMembership } from './services/portal/portal-auth-middleware';

const envLoad = loadBackendEnv();
console.log('[DEBUG] DATABASE_URL loaded:', process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@'));

const preflight = validateRuntimePreflight();
console.log(
  `[Preflight] profile=${preflight.profile} aiFallbackMode=${preflight.aiFallbackMode} providers(openai=${preflight.providers.openai}, apifyApi=${preflight.providers.apifyApi}, apifyMedia=${preflight.providers.apifyMediaDownloader}, scraplingWorker=${preflight.providers.scraplingWorker}) shellOpenAiPreSet=${envLoad.hadPreexistingOpenAiKey} backendEnvOverride=${envLoad.backendEnvOverride}`
);
for (const warning of preflight.warnings) {
  console.warn(`[Preflight] ${warning}`);
}

function isEnvFlagEnabled(name: string, defaultValue = true): boolean {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(raw);
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || process.env.BACKEND_PORT || 3001;
let schemaReport: SchemaReadinessReport | null = null;

function resolvePortalSignupScanMode(): string {
  const raw = String(process.env.PORTAL_SIGNUP_SCAN_MODE || 'deep').trim().toLowerCase();
  if (raw === 'quick' || raw === 'standard' || raw === 'deep') return raw;
  return 'deep';
}

function resolvePortalDdgEnabled(): boolean {
  const raw = String(process.env.PORTAL_SIGNUP_DDG_ENABLED || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

app.use(cors());
app.use(express.json());

app.use('/storage/documents/:workspaceId', requirePortalAuth, requireWorkspaceMembership, (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const workspaceId = String(req.params.workspaceId || '').trim();
  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  let relativeFilePath = '';
  try {
    relativeFilePath = decodeURIComponent(String(req.path || '').replace(/^\/+/, '').trim());
  } catch {
    return res.status(400).json({ error: 'INVALID_STORAGE_PATH' });
  }

  if (!relativeFilePath) {
    return res.status(404).json({ error: 'FILE_NOT_FOUND' });
  }

  const workspaceStorageRoot = path.resolve(STORAGE_ROOT, 'documents', workspaceId);
  const absoluteFilePath = path.resolve(workspaceStorageRoot, relativeFilePath);
  if (
    absoluteFilePath !== workspaceStorageRoot &&
    !absoluteFilePath.startsWith(`${workspaceStorageRoot}${path.sep}`)
  ) {
    return res.status(400).json({ error: 'INVALID_STORAGE_PATH' });
  }

  fs.stat(absoluteFilePath, (error, stats) => {
    if (error || !stats.isFile()) {
      return res.status(404).json({ error: 'FILE_NOT_FOUND' });
    }

    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.sendFile(absoluteFilePath);
  });
});

// Serve non-document storage assets publicly from storage directory.
app.use('/storage', express.static(STORAGE_ROOT));

// Health check (always available, even if schema is not ready)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: schemaReport?.schemaReady ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: 'connected',
    schemaReady: Boolean(schemaReport?.schemaReady),
    aiMode: preflight.aiFallbackMode,
    connectors: {
      openai: preflight.providers.openai,
      apifyApi: preflight.providers.apifyApi,
      apifyMediaDownloader: preflight.providers.apifyMediaDownloader,
      scraplingWorker: preflight.providers.scraplingWorker,
    },
    schema: schemaReport || {
      schemaReady: false,
      missingTables: [],
      missingColumns: {},
      checkedAt: null,
    },
    portalAuth: {
      verifyCodeConfigured: Boolean(String(process.env.PORTAL_EMAIL_VERIFY_CODE || '00000').trim()),
      verifyMode: 'static',
    },
    portalEnrichment: {
      signupScanMode: resolvePortalSignupScanMode(),
      ddgEnabled: resolvePortalDdgEnabled(),
    },
  });
});

app.use((req, res, next) => {
  if (!schemaReport?.schemaReady) {
    return res.status(503).json({
      error: 'BACKEND_NOT_READY',
      details: 'Schema readiness check has not passed yet',
    });
  }
  return next();
});

// API Routes
app.use('/api/clients', clientsRouter);
app.use('/api/research-jobs', intelligenceCrudRouter);
app.use('/api/research-jobs', brandIntelligenceRouter);
app.use('/api/research-jobs', contentCalendarRouter);
app.use('/api/research-jobs', researchJobsRouter);
app.use('/api/research-jobs', chatRouter);
app.use('/api/research-jobs', chatRuntimeRouter);
app.use('/api/research-jobs', screenshotsRouter);
app.use('/api/research-jobs', questionsRouter);
app.use('/api/research-jobs', documentsRouter);
app.use('/api/research-jobs', webIntelligenceRouter);
app.use('/api/portal', portalRouter);
app.use('/api/media', mediaRouter);
app.use('/api/competitors', competitorsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/scrapers', require('./routes/scrapers').default);
app.use('/api/strategy', aiStrategyRouter);
app.use('/api/monitoring', monitoringRouter);
app.use('/api/instagram', instagramDataRouter);
app.use('/api/tiktok', tiktokDataRouter);
app.use('/api/recovery', recoveryRouter);
app.use('/api/research-jobs', orchestrationRouter);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Server Error]:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    details: process.env.NODE_ENV === 'development' ? err.message : undefined 
  });
});

async function startServer(): Promise<void> {
  schemaReport = await checkSchemaReadiness();
  assertSchemaReadiness(schemaReport);

  const server = http.createServer(app);
  attachChatWebSocketServer(server, () => Boolean(schemaReport?.schemaReady));
  attachRuntimeWebSocketServer(server, () => Boolean(schemaReport?.schemaReady));

  server.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`📁 Storage: http://localhost:${PORT}/storage/`);

    if (isEnvFlagEnabled('MONITORING_SCHEDULER_ENABLED', true)) {
      const { startMonitoringScheduler } = require('./services/monitoring/monitoring-scheduler');
      startMonitoringScheduler({
        enabled: true,
        cronExpression: '0 2 * * *',
        timezone: 'UTC',
      });
      console.log(`📅 Monitoring scheduler started (daily at 2 AM UTC)`);
    } else {
      console.log('📅 Monitoring scheduler disabled on this instance');
    }

    if (isEnvFlagEnabled('RESEARCH_CONTINUITY_ENABLED', true)) {
      const { startResearchContinuityLoop } = require('./services/social/research-continuity');
      const continuityPollMs = Number(process.env.RESEARCH_CONTINUITY_POLL_MS || 60000);
      startResearchContinuityLoop(continuityPollMs);
      console.log(`♻️  Research continuity loop started (${continuityPollMs}ms poll)`);
    } else {
      console.log('♻️  Research continuity loop disabled on this instance');
    }

    if (isEnvFlagEnabled('RESEARCH_EVENT_PRUNER_ENABLED', true)) {
      const { startResearchJobEventPruning } = require('./services/social/research-job-events');
      startResearchJobEventPruning();
      console.log('🧹 Research event pruning loop started');
    } else {
      console.log('🧹 Research event pruning loop disabled on this instance');
    }

    if (isEnvFlagEnabled('ORCHESTRATION_ENABLED', true)) {
      const { startOrchestrationScheduler } = require('./services/orchestration/orchestration-scheduler');
      startOrchestrationScheduler();
      console.log('🔄 Continuous orchestration scheduler started (15-minute intervals)');
    } else {
      console.log('🔄 Continuous orchestration scheduler disabled on this instance');
    }

    if (isEnvFlagEnabled('LINKEDIN_SYNC_ENABLED', true)) {
      const { startLinkedInSyncScheduler } = require('./services/portal/portal-linkedin-scheduler');
      startLinkedInSyncScheduler();
      console.log('🔗 LinkedIn sync scheduler started');
    } else {
      console.log('🔗 LinkedIn sync scheduler disabled on this instance');
    }
  });
}

void startServer().catch((error) => {
  console.error('[Startup] Failed to boot backend:', error);
  process.exit(1);
});

export { app, prisma };
