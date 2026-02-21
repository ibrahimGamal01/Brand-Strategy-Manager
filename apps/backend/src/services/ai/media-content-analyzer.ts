import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma';
import { generateVideoThumbnail } from '../media/download-helpers';
import { transcribeVideoOrAudio } from '../media/audio-transcription';
import { extractOnScreenTextFromVideo, type OnScreenTextEntry } from '../media/video-text-extraction';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STORAGE_BASE = path.join(process.cwd(), 'storage');

function resolveMediaPath(blobStoragePath: string | null): string | null {
  if (!blobStoragePath) return null;
  if (path.isAbsolute(blobStoragePath) && fs.existsSync(blobStoragePath)) return blobStoragePath;
  const fromCwd = path.join(process.cwd(), blobStoragePath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromStorage = path.join(STORAGE_BASE, blobStoragePath.replace(/^\/*storage\/?/, ''));
  if (fs.existsSync(fromStorage)) return fromStorage;
  return null;
}

export interface AnalyzeMediaResult {
  mediaAssetId: string;
  success: boolean;
  analysisVisual?: boolean;
  analysisTranscript?: boolean;
  analysisOverall?: boolean;
  error?: string;
}

export interface AnalyzeMediaContext {
  brandName?: string;
  niche?: string;
  platform?: string;
  source?: 'client' | 'competitor';
}

/**
 * Analyze a single MediaAsset: run vision and/or transcript analysis, persist to MediaAsset (2-3 JSON fields) and AiAnalysis.
 * Uses extractedTranscript / extractedOnScreenText when present (local handling); otherwise runs extraction and persists to DB, then analyzes with OpenAI.
 * Optional context (brand, niche, platform, client vs competitor) is injected into prompts for agency-relevant recommendations.
 */
export async function analyzeMediaAsset(
  asset: {
    id: string;
    mediaType: string;
    blobStoragePath: string | null;
    socialPostId?: string | null;
    clientPostId?: string | null;
    cleanedPostId?: string | null;
    researchJobId?: string | null;
    extractedTranscript?: string | null;
    extractedOnScreenText?: OnScreenTextEntry[] | null;
  },
  context?: AnalyzeMediaContext
): Promise<AnalyzeMediaResult> {
  const mediaPath = resolveMediaPath(asset.blobStoragePath);
  if (!mediaPath || !fs.existsSync(mediaPath)) {
    return {
      mediaAssetId: asset.id,
      success: false,
      error: 'Media file not found',
    };
  }

  const result: AnalyzeMediaResult = {
    mediaAssetId: asset.id,
    success: false,
  };
  const updates: {
    analysisVisual?: object;
    analysisTranscript?: object;
    analysisOverall?: object;
    extractedTranscript?: string;
    extractedOnScreenText?: OnScreenTextEntry[];
  } = {};
  const researchJobId = asset.researchJobId ?? null;

  try {
    const isImage = asset.mediaType === 'IMAGE';
    const isVideo = asset.mediaType === 'VIDEO';
    const isAudio = asset.mediaType === 'AUDIO';

    if (isImage) {
      const visual = await runVisualAnalysis(mediaPath, context);
      if (visual) {
        result.analysisVisual = true;
        await prisma.aiAnalysis.create({
          data: {
            mediaAssetId: asset.id,
            researchJobId,
            analysisType: 'VISUAL',
            modelUsed: 'gpt-4o',
            fullResponse: visual as any,
            confidenceScore: (visual as any).confidence_score ?? 0.8,
          },
        });
      }
      const overall = await runOverallAnalysis(null, visual as Record<string, unknown>, undefined, context);
      if (overall) {
        result.analysisOverall = true;
        await prisma.aiAnalysis.create({
          data: {
            mediaAssetId: asset.id,
            researchJobId,
            analysisType: 'OVERALL',
            modelUsed: 'gpt-4o',
            fullResponse: overall as any,
            confidenceScore: (overall as any).confidence_score ?? 0.8,
          },
        });
      }
    } else if (isVideo || isAudio) {
      // Use stored transcript when present (local extraction already done); otherwise transcribe (local or Whisper)
      let transcript = (asset.extractedTranscript ?? '').trim();
      if (!transcript) {
        const transcriptResult = await transcribeVideoOrAudio(mediaPath, isVideo, { useLocalFirst: true });
        transcript = transcriptResult.transcript ?? '';
        if (!transcriptResult.success && transcriptResult.error) {
          console.warn(`[MediaContentAnalyzer] No transcript for ${asset.id}: ${transcriptResult.error}`);
        }
      }

      // For video: get on-screen text (local OCR) when not already stored
      let onScreenText: OnScreenTextEntry[] = Array.isArray(asset.extractedOnScreenText) ? asset.extractedOnScreenText : [];
      if (isVideo && onScreenText.length === 0) {
        try {
          onScreenText = await extractOnScreenTextFromVideo(mediaPath);
        } catch (e) {
          console.warn(`[MediaContentAnalyzer] On-screen text extraction skipped for ${asset.id}:`, (e as Error)?.message);
        }
      }

      // For video: run transcript analysis and thumbnail generation in parallel; then visual on thumbnail, then overall
      const [transcriptAnalysis, thumbPath] = await Promise.all([
        transcript
          ? runTranscriptAnalysis(transcript, onScreenText, context)
          : Promise.resolve(null),
        isVideo ? generateVideoThumbnail(mediaPath) : Promise.resolve(null),
      ]);

      if (transcriptAnalysis) {
        result.analysisTranscript = true;
        await prisma.aiAnalysis.create({
          data: {
            mediaAssetId: asset.id,
            researchJobId,
            analysisType: 'AUDIO',
            modelUsed: 'gpt-4o',
            fullResponse: transcriptAnalysis as any,
            confidenceScore: (transcriptAnalysis as any).confidence_score ?? 0.8,
          },
        });
      }

      if (isVideo && thumbPath && fs.existsSync(thumbPath)) {
        const visual = await runVisualAnalysis(thumbPath, context);
        if (visual) {
          result.analysisVisual = true;
          await prisma.aiAnalysis.create({
            data: {
              mediaAssetId: asset.id,
              researchJobId,
              analysisType: 'VISUAL',
              modelUsed: 'gpt-4o',
              fullResponse: visual as any,
              confidenceScore: (visual as any).confidence_score ?? 0.8,
            },
          });
        }
      }

      const overall = await runOverallAnalysis(
        transcript,
        undefined, // Pass visual summary if available, logic simplified here
        onScreenText.length > 0 ? onScreenText : undefined,
        context
      );
      if (overall) {
        result.analysisOverall = true;
        await prisma.aiAnalysis.create({
          data: {
            mediaAssetId: asset.id,
            researchJobId,
            analysisType: 'OVERALL',
            modelUsed: 'gpt-4o',
            fullResponse: overall as any,
            confidenceScore: (overall as any).confidence_score ?? 0.8,
          },
        });
      }
    }

    result.success = true;
  } catch (e: any) {
    result.error = e.message || 'Analysis failed';
    console.error(`[MediaContentAnalyzer] Error for asset ${asset.id}:`, e);
  }

  return result;
}

function buildContextPrefix(context?: AnalyzeMediaContext): string {
  if (!context || (!context.brandName && !context.niche && !context.platform && !context.source))
    return '';
  const parts: string[] = [];
  if (context.brandName || context.niche) parts.push(`Brand/Niche: ${context.brandName ?? '—'} / ${context.niche ?? '—'}`);
  if (context.platform) parts.push(`Platform: ${context.platform}`);
  if (context.source) parts.push(`This asset is from: ${context.source}`);
  return parts.length ? `Context: ${parts.join('. ')}.\n\n` : '';
}

async function runVisualAnalysis(
  imagePath: string,
  context?: AnalyzeMediaContext
): Promise<Record<string, unknown> | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

    const contextPrefix = buildContextPrefix(context);
    const prompt = `${contextPrefix}You are a social media marketing strategist for an agency. Evaluate this asset as you would for a client or competitor audit.

Analyze this social media post visual. Return JSON with:
- platform_format: string (e.g. "Reels", "Feed", "Story", "TikTok").
- hook_strength: number 1-10 (how strong is the visual hook).
- scroll_stopping: object with "yes" or "no" and "why" (short reason).
- on_brand_estimate: string (if brand/niche context was given: does this feel on-brand; otherwise "unknown").
- actionable_visual_fixes: array of 2-4 concrete, specific steps to improve the visual.
- visual_description, brand_elements_present, text_overlay, primary_hook, mood_aesthetic, production_quality, visual_hooks, psychological_triggers,
- composition (balance, rule of thirds, layout), color_use (palette, contrast), typography (readability, hierarchy if text present), visual_hierarchy, cta_clarity, brand_consistency, emotional_appeal, accessibility_notes (contrast/legibility).
- confidence_score: number 0-1.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ] as any,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });
    const raw = (response.choices[0] as any).message?.content;
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch (e) {
    console.error('[MediaContentAnalyzer] Visual analysis failed:', e);
    return null;
  }
}

async function runTranscriptAnalysis(
  transcript: string,
  onScreenText?: OnScreenTextEntry[],
  context?: AnalyzeMediaContext
): Promise<Record<string, unknown> | null> {
  if (!process.env.OPENAI_API_KEY || !transcript.trim()) return null;
  try {
    let body = `Transcript:\n"${transcript.slice(0, 12000)}"`;
    if (onScreenText && onScreenText.length > 0) {
      const lines = onScreenText.map((e) => `[${e.timestampSeconds ?? '?'}s] ${e.text}`).join('\n');
      body += `\n\nOn-screen text seen in the video:\n${lines.slice(0, 4000)}`;
    }
    const contextPrefix = buildContextPrefix(context);
    const prompt = `${contextPrefix}You are a social media marketing strategist for an agency. Analyze this video/audio content (speech and any on-screen text) from a social post.

${body}

Return JSON with:
- hook_in_first_3_seconds: object with "yes" or "no" and "quote" (exact phrase if hook is in first 3 seconds).
- script_structure: string (e.g. "intro/body/CTA", "problem-solution", "story arc").
- platform_native: string (e.g. "sounds like TikTok", "educational Reel", "Instagram Story style").
- suggested_improvements: array of concrete suggestions for the script or delivery.
- main_topic, themes (array), key_points (array), tone, sentiment (positive/negative/neutral), call_to_action, target_audience, hook_pattern, content_pillar (education/entertainment/inspiration/promotion/authority), psychological_triggers, emotional_appeal, cta_clarity.
- confidence_score: number 0-1.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });
    const raw = (response.choices[0] as any).message?.content;
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch (e) {
    console.error('[MediaContentAnalyzer] Transcript analysis failed:', e);
    return null;
  }
}

async function runOverallAnalysis(
  transcript: string | null,
  visualSummary?: Record<string, unknown>,
  onScreenText?: OnScreenTextEntry[],
  jobContext?: AnalyzeMediaContext
): Promise<Record<string, unknown> | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    let contentContext = '';
    if (transcript) contentContext += `Transcript summary: ${transcript.slice(0, 3000)}\n`;
    if (visualSummary) contentContext += `Visual context: ${JSON.stringify(visualSummary).slice(0, 1500)}\n`;
    if (onScreenText && onScreenText.length > 0) {
      contentContext += `On-screen text: ${onScreenText.map((e) => e.text).join(' | ').slice(0, 1000)}\n`;
    }
    if (!contentContext.trim()) return null;

    const contextPrefix = buildContextPrefix(jobContext);
    const prompt = `${contextPrefix}You are a social media marketing strategist for an agency. Based on the following content from a social media post, provide an overall strategy and creative analysis as JSON.

Content:
${contentContext}

Return JSON with:
- performance_estimate: object with "score" (1-10, engagement potential) and "reason" (short explanation).
- one_line_recommendation: string (next post idea or A/B test suggestion—one concrete, actionable line).
- competitor_angle: string (if this is competitor content: what they do well and/or threat to client; otherwise empty or "N/A").
- strategic_recommendations: array of 2-4 specific, actionable bullets (no filler; things to do or test).
- main_topic, content_pillar, target_audience, content_strategy, effectiveness_rating (1-10), creative_and_design_summary (composition, color, hierarchy, cta_clarity, brand_consistency).
- confidence_score: number 0-1.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });
    const raw = (response.choices[0] as any).message?.content;
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch (e) {
    console.error('[MediaContentAnalyzer] Overall analysis failed:', e);
    return null;
  }
}
