import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { generateStrategyDocument } from '../services/ai/generators/index';
import { GenerationResult } from '../services/ai/generators/base-generator';

const router = Router();

/**
 * GET /api/strategy/:jobId
 * Fetch existing strategy document sections
 */
router.get('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    // Fetch all AI analyses for this research job that are document sections
    const analyses = await prisma.aiAnalysis.findMany({
      where: {
        researchJobId: jobId,
        // We'll use analysisType to store document sections
        // analysisType will be like 'business_understanding', 'target_audience', etc.
      },
      orderBy: {
        analyzedAt: 'asc'
      }
    });

    if (analyses.length === 0) {
      return res.status(404).json({
        status: 'NONE',
        message: 'No strategy document found'
      });
    }

    // Transform analyses into sections object
    const sections: any = {};
    const sectionMapping: { [key: string]: string } = {
      'business_understanding': 'businessUnderstanding',
      'target_audience': 'targetAudience',
      'industry_overview': 'industryOverview',
      'priority_competitor': 'priorityCompetitor',
      'content_analysis': 'contentAnalysis',
      'content_pillars': 'contentPillars',
      'format_recommendations': 'formatRecommendations',
      'buyer_journey': 'buyerJourney',
      'platform_strategy': 'platformStrategy'
    };

    for (const analysis of analyses) {
      const sectionKey = sectionMapping[analysis.topic || ''];
      if (sectionKey && analysis.fullResponse) {
        // Convert JSON to string (fullResponse is stored as Json type in Prisma)
        const content = typeof analysis.fullResponse === 'string' 
          ? analysis.fullResponse 
          : JSON.stringify(analysis.fullResponse);
        sections[sectionKey] = content;
      }
    }

    const sectionsCount = Object.keys(sections).length;
    const status = sectionsCount === 9 ? 'COMPLETE' : sectionsCount > 0 ? 'PARTIAL' : 'NONE';

    res.json({
      sections,
      generatedAt: analyses[0]?.analyzedAt,
      status,
      sectionsComplete: sectionsCount,
      totalSections: 9
    });

  } catch (error) {
    console.error('[Strategy API] Error fetching document:', error);
    res.status(500).json({
      error: 'Failed to fetch strategy document',
      message: (error as Error).message
    });
  }
});

/**
 * POST /api/strategy/:jobId/generate
 * Generate strategy document sections
 */
router.post('/:jobId/generate', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { sections = 'all' } = req.body;

    console.log(`[Strategy API] Generating document for job: ${jobId}`);
    console.log(`[Strategy API] Sections requested: ${sections}`);

    // Call the generator service from Phase 2
    const result = await generateStrategyDocument(jobId, sections === 'all' ? ['all'] : sections);

    // CHANGED: Save sections even if validation fails - user paid for generation!
    // Only throw if we got NO sections at all
    if (!result.sections || Object.keys(result.sections).length === 0) {
      throw new Error('Generation failed - no sections generated');
    }

    console.log(`[Strategy API] Generated ${Object.keys(result.sections).length} sections with status: ${result.status}`);
    if (result.status !== 'COMPLETE') {
      console.log(`[Strategy API] ⚠️  Validation failed but saving sections anyway (user paid for this)`);
    }

    // Store results in database as AiAnalysis records
    const sectionMapping: { [key: string]: string } = {
      businessUnderstanding: 'business_understanding',
      targetAudience: 'target_audience',
      industryOverview: 'industry_overview',
      priorityCompetitor: 'priority_competitor',
      contentAnalysis: 'content_analysis',
      contentPillars: 'content_pillars',
      formatRecommendations: 'format_recommendations',
      buyerJourney: 'buyer_journey',
      platformStrategy: 'platform_strategy'
    };

    // Delete existing sections for this job to avoid duplicates
    await prisma.aiAnalysis.deleteMany({
      where: {
        researchJobId: jobId,
        topic: {
          in: Object.values(sectionMapping)
        }
      }
    });

    // Create new analysis records for each section
    const analysisRecords = Object.entries(result.sections).map(([key, content]) => {
      // Extract markdown content from GenerationResult
      const markdownContent = typeof content === 'string' ? content : (content as GenerationResult).markdown || '';
      
      return {
        researchJobId: jobId,
        topic: sectionMapping[key as keyof typeof sectionMapping],
        fullResponse: markdownContent,
        analysisType: 'DOCUMENT' as const,
        modelUsed: 'gpt-4o',
        tokensUsed: 0 // TODO: Track from result
      };
    });

    await prisma.aiAnalysis.createMany({
      data: analysisRecords
    });

    console.log(`[Strategy API] Successfully stored ${analysisRecords.length} sections`);

    res.json({
      success: true,
      sections: result.sections,
      status: result.status,
      overallScore: result.overallScore,
      totalCost: result.totalCost,
      generationTime: result.generationTime,
      sectionsComplete: Object.keys(result.sections).length,
      totalSections: 9
    });

  } catch (error) {
    console.error('[Strategy API] Error generating document:', error);
    res.status(500).json({
      error: 'Failed to generate strategy document',
      message: (error as Error).message
    });
  }
});

/**
 * POST /api/strategy/:jobId/regenerate/:section
 * Regenerate a specific section
 */
router.post('/:jobId/regenerate/:section', async (req, res) => {
  try {
    const { jobId, section } = req.params;

    console.log(`[Strategy API] Regenerating section: ${section} for job: ${jobId}`);

    // Map section name to generator key
    const sectionMapping: { [key: string]: string } = {
      'business_understanding': 'businessUnderstanding',
      'target_audience': 'targetAudience',
      'industry_overview': 'industryOverview',
      'priority_competitor': 'priorityCompetitor',
      'content_analysis': 'contentAnalysis',
      'content_pillars': 'contentPillars',
      'format_recommendations': 'formatRecommendations',
      'buyer_journey': 'buyerJourney',
      'platform_strategy': 'platformStrategy'
    };

    const generatorKey = sectionMapping[section];
    if (!generatorKey) {
      return res.status(400).json({
        error: 'Invalid section name'
      });
    }

    // Generate single section
    const result = await generateStrategyDocument(jobId, [generatorKey]);

    const sectionData = result.sections[generatorKey as keyof typeof result.sections];
    if (!sectionData) {
      throw new Error('Section generation failed');
    }

    // Extract markdown content
    const markdownContent = typeof sectionData === 'string' ? sectionData : (sectionData as GenerationResult).markdown || '';

    // Update database
    await prisma.aiAnalysis.deleteMany({
      where: {
        researchJobId: jobId,
        topic: section
      }
    });

    await prisma.aiAnalysis.create({
      data: {
        researchJobId: jobId,
        topic: section,
        fullResponse: markdownContent,
        analysisType: 'DOCUMENT',
        modelUsed: 'gpt-4o',
        tokensUsed: 0
      }
    });

    res.json({
      success: true,
      section: generatorKey,
      content: markdownContent
    });

  } catch (error) {
    console.error('[Strategy API] Error regenerating section:', error);
    res.status(500).json({
      error: 'Failed to regenerate section',
      message: (error as Error).message
    });
  }
});

/**
 * PATCH /api/strategy/:jobId/section/:sectionKey
 * Update a specific section content
 */
router.patch('/:jobId/section/:sectionKey', async (req, res) => {
  try {
    const { jobId, sectionKey } = req.params;
    const { content } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({
        error: 'Content is required and must be a string'
      });
    }

    console.log(`[Strategy API] Updating section: ${sectionKey} for job: ${jobId}`);

    // Map frontend section key to database topic
    const sectionMapping: { [key: string]: string } = {
      'businessUnderstanding': 'business_understanding',
      'targetAudience': 'target_audience',
      'industryOverview': 'industry_overview',
      'priorityCompetitor': 'priority_competitor',
      'contentAnalysis': 'content_analysis',
      'contentPillars': 'content_pillars',
      'formatRecommendations': 'format_recommendations',
      'buyerJourney': 'buyer_journey',
      'platformStrategy': 'platform_strategy'
    };

    const topic = sectionMapping[sectionKey];
    if (!topic) {
      return res.status(400).json({
        error: 'Invalid section key'
      });
    }

    // Update the section in database
    const updated = await prisma.aiAnalysis.updateMany({
      where: {
        researchJobId: jobId,
        topic: topic
      },
      data: {
        fullResponse: content
      }
    });

    if (updated.count === 0) {
      return res.status(404).json({
        error: 'Section not found'
      });
    }

    console.log(`[Strategy API] Section ${sectionKey} updated successfully`);

    res.json({
      success: true,
      sectionKey,
      content
    });

  } catch (error) {
    console.error('[Strategy API] Error updating section:', error);
    res.status(500).json({
      error: 'Failed to update section',
      message: (error as Error).message
    });
  }
});

/**
 * GET /api/strategy/:jobId/export
 * Generate and download PDF of strategy document
 */
router.get('/:jobId/export', async (req, res) => {
  try {
    const { jobId } = req.params;

    console.log(`[Strategy API] Generating PDF for job: ${jobId}`);

    // Fetch document sections
    const analyses = await prisma.aiAnalysis.findMany({
      where: {
        researchJobId: jobId,
        analysisType: 'DOCUMENT'
      },
      orderBy: {
        analyzedAt: 'asc'
      }
    });

    if (analyses.length === 0) {
      return res.status(404).json({
        error: 'No document found for this job'
      });
    }

    // Map sections
    const sectionMapping: { [key: string]: string } = {
      'business_understanding': 'Business Understanding',
      'target_audience': 'Target Audience',
      'industry_overview': 'Industry Overview',
      'priority_competitor': 'Priority Competitor Analysis',
      'content_analysis': 'Content Analysis',
      'content_pillars': 'Strategic Content Pillars',
      'format_recommendations': 'Format Recommendations',
      'buyer_journey': 'Buyer Journey Mapping',
      'platform_strategy': 'Platform Strategy'
    };

    // Build HTML for PDF
    const sections = analyses.map(analysis => {
      const title = sectionMapping[analysis.topic || ''] || analysis.topic;
      const content = typeof analysis.fullResponse === 'string' 
        ? analysis.fullResponse 
        : JSON.stringify(analysis.fullResponse);
      
      return `
        <section class="document-section">
          <h2 class="section-title">${title}</h2>
          <div class="section-content">
            ${renderMarkdownToHTML(content)}
          </div>
        </section>
      `;
    }).join('');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            @page {
              margin: 0.75in;
              size: letter;
            }
            
            body {
              font-family: Georgia, 'Times New Roman', serif;
              line-height: 1.6;
              color: #1a1a1a;
              font-size: 11pt;
            }
            
            .document-header {
              border-bottom: 3px solid #1a1a1a;
              padding-bottom: 20px;
              margin-bottom: 40px;
            }
            
            .document-header h1 {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe' UI', sans-serif;
              font-size: 28pt;
              margin: 0 0 10px 0;
              font-weight: bold;
            }
            
            .document-meta {
              font-size: 10pt;
              color: #666;
            }
            
            .document-section {
              page-break-inside: avoid;
              margin-bottom: 40px;
            }
            
            .section-title {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              font-size: 18pt;
              font-weight: bold;
              margin: 0 0 16px 0;
              padding-bottom: 8px;
              border-bottom: 2px solid #2563eb;
            }
            
            .section-content {
              margin-left: 0;
            }
            
            .section-content p {
              margin: 0 0 12pt 0;
            }
            
            .section-content h3 {
              font-size: 14pt;
              margin: 16pt 0 8pt 0;
              font-weight: 600;
            }
            
            .section-content ul, .section-content ol {
              margin: 8pt 0;
              padding-left: 24pt;
            }
            
            .section-content li {
              margin-bottom: 4pt;
            }
            
            .section-content strong {
              font-weight: 600;
              color: #000;
            }
            
            .section-content blockquote {
              border-left: 4px solid #2563eb;
              padding-left: 16px;
              margin: 12pt 0;
              font-style: italic;
              background: #f8f9fa;
              padding: 12px 16px;
            }
            
            .section-content code {
              background: #f3f4f6;
              padding: 2px 6px;
              border-radius: 3px;
              font-family: 'Courier New', monospace;
              font-size: 9pt;
            }
          </style>
        </head>
        <body>
          <div class="document-header">
            <h1>Brand Strategy Document</h1>
            <div class="document-meta">
              Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>
          
          ${sections}
        </body>
      </html>
    `;

    // Generate PDF with puppeteer
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.75in',
        right: '0.75in',
        bottom: '0.75in',
        left: '0.75in'
      }
    });

    await browser.close();

    console.log(`[Strategy API] PDF generated successfully`);

    // Send PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="brand-strategy-${jobId}.pdf"`);
    res.send(Buffer.from(pdf));

  } catch (error) {
    console.error('[Strategy API] Error generating PDF:', error);
    res.status(500).json({
      error: 'Failed to generate PDF',
      message: (error as Error).message
    });
  }
});

/**
 * Simple markdown to HTML converter (basic implementation)
 * For production, consider using a library like marked or remark
 */
function renderMarkdownToHTML(markdown: string): string {
  return markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h4>$1</h4>')
    .replace(/^## (.*$)/gim, '<h3>$1</h3>')
    .replace(/^# (.*$)/gim, '<h2>$1</h2>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Lists
    .replace(/^\* (.+)$/gim, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, (match) => `<ul>${match}</ul>`)
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (line) => {
      if (!line.startsWith('<') && !line.endsWith('>')) {
        return `<p>${line}</p>`;
      }
      return line;
    });
}

export default router;
