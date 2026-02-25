import express from 'express';
import http from 'http';
import cors from 'cors';
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

const envLoad = loadBackendEnv();
console.log('[DEBUG] DATABASE_URL loaded:', process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@'));

const preflight = validateRuntimePreflight();
console.log(
  `[Preflight] profile=${preflight.profile} aiFallbackMode=${preflight.aiFallbackMode} providers(openai=${preflight.providers.openai}, apifyApi=${preflight.providers.apifyApi}, apifyMedia=${preflight.providers.apifyMediaDownloader}, scraplingWorker=${preflight.providers.scraplingWorker}) shellOpenAiPreSet=${envLoad.hadPreexistingOpenAiKey} backendEnvOverride=${envLoad.backendEnvOverride}`
);
for (const warning of preflight.warnings) {
  console.warn(`[Preflight] ${warning}`);
}

const app = express();
const PORT = process.env.PORT || process.env.BACKEND_PORT || 3001;
let schemaReport: SchemaReadinessReport | null = null;

app.use(cors());
app.use(express.json());

// Serve static files from storage directory
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

  server.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`📁 Storage: http://localhost:${PORT}/storage/`);

    // Start monitoring scheduler (runs daily at 2 AM)
    const { startMonitoringScheduler } = require('./services/monitoring/monitoring-scheduler');
    startMonitoringScheduler({
      enabled: true,
      cronExpression: '0 2 * * *', // 2 AM daily
      timezone: 'UTC'
    });
    console.log(`📅 Monitoring scheduler started (daily at 2 AM UTC)`);

    // Start research continuity loop (checks due "continue" jobs every minute).
    const { startResearchContinuityLoop } = require('./services/social/research-continuity');
    const continuityPollMs = Number(process.env.RESEARCH_CONTINUITY_POLL_MS || 60000);
    startResearchContinuityLoop(continuityPollMs);
    console.log(`♻️  Research continuity loop started (${continuityPollMs}ms poll)`);

    // Start research event pruning loop (retention + max-per-job constraints).
    const { startResearchJobEventPruning } = require('./services/social/research-job-events');
    startResearchJobEventPruning();
    console.log('🧹 Research event pruning loop started');

    // Start continuous orchestration scheduler (every 15 minutes)
    const { startOrchestrationScheduler } = require('./services/orchestration/orchestration-scheduler');
    startOrchestrationScheduler();
    console.log('🔄 Continuous orchestration scheduler started (15-minute intervals)');
  });
}

void startServer().catch((error) => {
  console.error('[Startup] Failed to boot backend:', error);
  process.exit(1);
});

export { app, prisma };
