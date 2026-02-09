import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { prisma } from './lib/prisma';
import clientsRouter from './routes/clients';
import researchJobsRouter from './routes/research-jobs';
import mediaRouter from './routes/media';
import competitorsRouter from './routes/competitors';
import analyticsRouter from './routes/analytics';
import aiStrategyRouter from './routes/ai-strategy';
import dataManagementRouter from './routes/data-management';
import monitoringRouter from './routes/monitoring';
import instagramDataRouter from './routes/instagram-data';
import tiktokDataRouter from './routes/tiktok-data';

dotenv.config({ path: '../../.env' });
console.log('[DEBUG] DATABASE_URL loaded:', process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@'));

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static files from storage directory
app.use('/storage', express.static(path.join(__dirname, '../storage')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: 'connected'
  });
});

// API Routes
app.use('/api/clients', clientsRouter);
app.use('/api/research-jobs', dataManagementRouter);
app.use('/api/research-jobs', researchJobsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/competitors', competitorsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/scrapers', require('./routes/scrapers').default);
app.use('/api/strategy', aiStrategyRouter);
app.use('/api/monitoring', monitoringRouter);
app.use('/api/instagram', instagramDataRouter);
app.use('/api/tiktok', tiktokDataRouter);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Server Error]:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    details: process.env.NODE_ENV === 'development' ? err.message : undefined 
  });
});

app.listen(PORT, () => {
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
});

export { app, prisma };
