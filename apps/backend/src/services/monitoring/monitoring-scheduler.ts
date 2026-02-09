/**
 * Monitoring Scheduler
 * 
 * Schedules daily monitoring jobs for all active clients
 * Uses node-cron for scheduling
 * 
 * Default: Runs at 2:00 AM daily
 */

import cron, { ScheduledTask } from 'node-cron';
import { monitorAllClients } from './monitoring-service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SchedulerConfig {
  enabled: boolean;
  cronExpression: string; // Default: '0 2 * * *' (2 AM daily)
  timezone: string;       // Default: 'UTC'
}

const DEFAULT_CONFIG: SchedulerConfig = {
  enabled: true,
  cronExpression: '0 2 * * *', // 2 AM daily
  timezone: 'UTC'
};

let scheduledTask: ScheduledTask | null = null;

/**
 * Start the monitoring scheduler
 */
export function startMonitoringScheduler(config: Partial<SchedulerConfig> = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  if (!finalConfig.enabled) {
    console.log(`[MonitoringScheduler] Scheduler is disabled`);
    return;
  }
  
  console.log(`[MonitoringScheduler] Starting scheduler: ${finalConfig.cronExpression} (${finalConfig.timezone})`);
  
  // Stop existing task if running
  if (scheduledTask) {
    scheduledTask.stop();
  }
  
  // Schedule the monitoring task
  scheduledTask = cron.schedule(
    finalConfig.cronExpression,
    async () => {
      console.log(`[MonitoringScheduler] ========== DAILY MONITORING STARTED ==========`);
      const startTime = Date.now();
      
      try {
        // Run monitoring for all clients
        const results = await monitorAllClients();
        
        // Create monitoring log
        const totalProfiles = results.reduce((sum, r) => sum + r.profilesScraped, 0);
        const totalPosts = results.reduce((sum, r) => sum + r.postsDiscovered, 0);
        const allErrors = results.flatMap(r => r.errors);
        
        const overallStatus = results.every(r => r.status === 'SUCCESS') ? 'SUCCESS' :
                              results.some(r => r.status !== 'FAILED') ? 'PARTIAL' :
                              'FAILED';
        
        // Save monitoring summary for each client
        for (const result of results) {
          try {
            await prisma.monitoringLog.create({
              data: {
                clientId: result.clientId,
                lastMonitoredAt: new Date(),
                profilesScraped: result.profilesScraped,
                postsDiscovered: result.postsDiscovered,
                errors: result.errors,
                status: result.status
              }
            });
          } catch (error: any) {
            console.error(`[MonitoringScheduler] Failed to save monitoring log:`, error.message);
          }
        }
        
        const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        
        console.log(`[MonitoringScheduler] ========== DAILY MONITORING COMPLETED ==========`);
        console.log(`[MonitoringScheduler] Duration: ${duration} minutes`);
        console.log(`[MonitoringScheduler] Profiles scraped: ${totalProfiles}`);
        console.log(`[MonitoringScheduler] Posts discovered: ${totalPosts}`);
        console.log(`[MonitoringScheduler] Status: ${overallStatus}`);
        if (allErrors.length > 0) {
          console.log(`[MonitoringScheduler] Errors: ${allErrors.length}`);
          console.log(`[MonitoringScheduler] First 5 errors:`, allErrors.slice(0, 5));
        }
        
      } catch (error: any) {
        console.error(`[MonitoringScheduler] ========== DAILY MONITORING FAILED ==========`);
        console.error(`[MonitoringScheduler] Error:`, error.message);
      }
    },
    {
      timezone: finalConfig.timezone
    }
  );
  
  console.log(`[MonitoringScheduler] Scheduler started successfully`);
  // Note: nextDates() is not available in node-cron, scheduler will run at configured time
  // console.log(`[MonitoringScheduler] Next run: ${scheduledTask.nextDates().format('YYYY-MM-DD HH:mm:ss')}`);
}

/**
 * Stop the monitoring scheduler
 */
export function stopMonitoringScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    console.log(`[MonitoringScheduler] Scheduler stopped`);
    scheduledTask = null;
  } else {
    console.log(`[MonitoringScheduler] No scheduler running`);
  }
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus() {
  if (!scheduledTask) {
    return {
      running: false,
      nextRun: null
    };
  }
  
  return {
    running: true,
    nextRun: 'Scheduled (check cron expression for timing)'
  };
}

/**
 * Run monitoring immediately (manual trigger)
 */
export async function runMonitoringNow() {
  console.log(`[MonitoringScheduler] Manual monitoring triggered`);
  const results = await monitorAllClients();
  
  const summary = {
    totalClients: results.length,
    totalProfiles: results.reduce((sum, r) => sum + r.profilesScraped, 0),
    totalPosts: results.reduce((sum, r) => sum + r.postsDiscovered, 0),
    success: results.filter(r => r.status === 'SUCCESS').length,
    partial: results.filter(r => r.status === 'PARTIAL').length,
    failed: results.filter(r => r.status === 'FAILED').length
  };
  
  console.log(`[MonitoringScheduler] Manual monitoring complete:`, summary);
  return { results, summary };
}
