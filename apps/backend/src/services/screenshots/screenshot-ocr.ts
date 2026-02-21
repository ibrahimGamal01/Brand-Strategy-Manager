import OpenAI from 'openai';
import fs from 'fs';
import { openai } from '../ai/openai-client';

export type OcrResult = {
  ocrText: string | null;
  aiSummary: string | null;
};

export async function runScreenshotOcr(absPath: string): Promise<OcrResult> {
  if (!fs.existsSync(absPath)) return { ocrText: null, aiSummary: null };
  try {
    const file = fs.readFileSync(absPath);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an OCR + summarizer. Extract text and produce one-sentence summary.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract the visible text and summarize in one sentence.',
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${file.toString('base64')}` },
            },
          ] as OpenAI.Chat.ChatCompletionContentPart[]
        }
      ],
      max_tokens: 200,
      temperature: 0.2,
    });
    const completion = response as OpenAI.Chat.Completions.ChatCompletion;
    const content = completion.choices[0]?.message?.content || '';
    const [summary, ...rest] = content.split('\n');
    return {
      aiSummary: summary?.trim() || null,
      ocrText: rest.join('\n').trim() || summary?.trim() || null,
    };
  } catch (error) {
    console.warn('[Screenshot OCR] failed', (error as Error)?.message);
    return { ocrText: null, aiSummary: null };
  }
}
