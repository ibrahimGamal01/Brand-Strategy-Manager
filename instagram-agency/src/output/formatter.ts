import fs from 'fs';
import path from 'path';
import { PipelineResult } from '../ai/pipeline';
import { ProcessedData } from '../scrapers/processor';
import { logger } from '../utils/logger';

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'output');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

export interface FinalDeliverable {
  status: string;
  generatedAt: string;
  clientUsername: string;
  executiveSummary: {
    weekOf: string;
    totalBriefs: number;
    qualityScore: number | string;
    topPerformerPrediction: string;
  };
  deliverable: PipelineResult;
  scrapedData: ProcessedData;
}

export function formatOutput(
  pipelineResult: PipelineResult,
  scrapedData: ProcessedData,
  clientUsername: string
): FinalDeliverable {
  const briefs = (pipelineResult.productionBriefs as any)?.weeklyContentPlan || [];
  const qa = pipelineResult.qaCheck as any;
  const calendar = pipelineResult.contentCalendar as any;
  
  return {
    status: 'READY_FOR_PRODUCTION',
    generatedAt: new Date().toISOString(),
    clientUsername,
    executiveSummary: {
      weekOf: calendar?.contentCalendar?.weekOf || 'This Week',
      totalBriefs: briefs.length,
      qualityScore: qa?.overallQualityScore || 'N/A',
      topPerformerPrediction: qa?.topPerformerPrediction || 'See briefs',
    },
    deliverable: pipelineResult,
    scrapedData,
  };
}

export function saveOutputs(deliverable: FinalDeliverable): void {
  const timestamp = new Date().toISOString().split('T')[0];
  
  // Save full JSON
  const jsonPath = path.join(OUTPUT_DIR, `deliverable-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(deliverable, null, 2));
  logger.success(`Saved: ${jsonPath}`);
  
  // Save brief markdown summary
  const mdPath = path.join(OUTPUT_DIR, `briefs-${timestamp}.md`);
  const markdown = generateBriefsMarkdown(deliverable);
  fs.writeFileSync(mdPath, markdown);
  logger.success(`Saved: ${mdPath}`);
  
  // Save calendar markdown
  const calendarPath = path.join(OUTPUT_DIR, `calendar-${timestamp}.md`);
  const calendarMd = generateCalendarMarkdown(deliverable);
  fs.writeFileSync(calendarPath, calendarMd);
  logger.success(`Saved: ${calendarPath}`);
}

function generateBriefsMarkdown(deliverable: FinalDeliverable): string {
  const briefs = (deliverable.deliverable.productionBriefs as any)?.weeklyContentPlan || [];
  
  let md = `# Production Briefs for @${deliverable.clientUsername}\n\n`;
  md += `**Generated:** ${deliverable.generatedAt}\n`;
  md += `**Quality Score:** ${deliverable.executiveSummary.qualityScore}/10\n\n`;
  md += `---\n\n`;
  
  for (const brief of briefs) {
    md += `## Day ${brief.day}: ${brief.brief?.title || 'Untitled'}\n\n`;
    md += `**Type:** ${brief.contentType} | **Time:** ${brief.postingTime || 'TBD'}\n\n`;
    md += `**Concept:** ${brief.brief?.concept || ''}\n\n`;
    md += `**Hook:** ${brief.brief?.hook?.content || ''}\n\n`;
    
    if (brief.captionVariants) {
      md += `### Caption Options\n\n`;
      md += `**Option A:** ${brief.captionVariants.optionA || ''}\n\n`;
      md += `**Option B:** ${brief.captionVariants.optionB || ''}\n\n`;
      md += `**Recommended:** ${brief.captionVariants.recommended || 'A'}\n\n`;
    }
    
    md += `---\n\n`;
  }
  
  return md;
}

function generateCalendarMarkdown(deliverable: FinalDeliverable): string {
  const calendar = (deliverable.deliverable.contentCalendar as any)?.contentCalendar;
  
  let md = `# Content Calendar for @${deliverable.clientUsername}\n\n`;
  md += `**Week Of:** ${calendar?.weekOf || 'This Week'}\n`;
  md += `**Timezone:** ${calendar?.timezone || 'UTC'}\n\n`;
  md += `---\n\n`;
  
  const schedule = calendar?.schedule || [];
  for (const day of schedule) {
    md += `## ${day.dayOfWeek}\n\n`;
    for (const post of day.posts || []) {
      md += `- **${post.time}**: ${post.title || post.type}\n`;
    }
    md += `\n`;
  }
  
  return md;
}
