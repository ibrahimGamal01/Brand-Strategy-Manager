import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import OpenAI, { toFile } from 'openai';

const execAsync = promisify(exec);

/** Max duration in seconds to extract for Whisper (to control cost). 10 min default. */
const MAX_AUDIO_DURATION_SEC = Number(process.env.MEDIA_ANALYZER_MAX_AUDIO_SEC) || 600;

let openaiClient: OpenAI | null = null;

function getOpenAiClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

export interface TranscribeResult {
  success: boolean;
  transcript?: string;
  error?: string;
}

/**
 * Extract audio from a video file using ffmpeg to a temporary file.
 * Returns path to the temp audio file (caller should unlink when done).
 */
export async function extractAudioFromVideo(videoPath: string): Promise<{ success: boolean; audioPath?: string; error?: string }> {
  if (!fs.existsSync(videoPath)) {
    return { success: false, error: 'Video file not found' };
  }
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  const audioPath = path.join(dir, `${base}_audio_${Date.now()}.m4a`);
  try {
    // -t limits duration to avoid huge files; use max duration for analysis
    const cmd = `ffmpeg -i "${videoPath}" -vn -acodec copy -t ${MAX_AUDIO_DURATION_SEC} -y "${audioPath}"`;
    await execAsync(cmd, { timeout: 120000 });
    if (fs.existsSync(audioPath)) {
      return { success: true, audioPath };
    }
    return { success: false, error: 'ffmpeg did not produce output file' };
  } catch (e: any) {
    if (fs.existsSync(audioPath)) {
      try { fs.unlinkSync(audioPath); } catch (_) {}
    }
    return { success: false, error: e.message || 'ffmpeg failed' };
  }
}

/**
 * Transcribe audio file using OpenAI Whisper API.
 */
export async function transcribeAudio(audioPath: string): Promise<TranscribeResult> {
  const openai = getOpenAiClient();
  if (!openai) {
    return { success: false, error: 'OPENAI_API_KEY not configured' };
  }
  if (!fs.existsSync(audioPath)) {
    return { success: false, error: 'Audio file not found' };
  }
  try {
    const buffer = fs.readFileSync(audioPath);
    const ext = path.extname(audioPath).slice(1) || 'm4a';
    const response = await openai.audio.transcriptions.create({
      file: await toFile(buffer, `audio.${ext}`),
      model: 'whisper-1',
      response_format: 'text',
    });
    const transcript = typeof response === 'string' ? response : (response as { text?: string }).text ?? '';
    return { success: true, transcript: transcript.trim() || '' };
  } catch (e: any) {
    return { success: false, error: e.message || 'Whisper transcription failed' };
  }
}

/** Path to optional local transcription script (e.g. faster-whisper). Script receives audio path as first arg and prints transcript to stdout. */
const LOCAL_TRANSCRIPTION_SCRIPT = process.env.LOCAL_TRANSCRIPTION_SCRIPT || '';

/**
 * Try local transcription first (no OpenAI). If LOCAL_TRANSCRIPTION_SCRIPT is set and the script exists,
 * run it with the audio path and use stdout as transcript. Otherwise fall back to OpenAI Whisper.
 */
export async function transcribeAudioLocalOrWhisper(audioPath: string): Promise<TranscribeResult> {
  if (!fs.existsSync(audioPath)) {
    return { success: false, error: 'Audio file not found' };
  }
  const scriptPath = LOCAL_TRANSCRIPTION_SCRIPT.trim();
  if (scriptPath && fs.existsSync(scriptPath)) {
    try {
      const absPath = path.resolve(audioPath);
      const { stdout, stderr } = await execAsync(`"${scriptPath}" "${absPath}"`, {
        timeout: 300000,
        maxBuffer: 1024 * 1024,
      });
      const transcript = (stdout || '').trim();
      if (transcript) {
        return { success: true, transcript };
      }
      return { success: false, error: stderr || 'Local script produced no transcript' };
    } catch (e: any) {
      console.warn('[AudioTranscription] Local transcription failed, falling back to Whisper:', e?.message);
    }
  }
  return transcribeAudio(audioPath);
}

/**
 * For a video file: extract audio, transcribe, then delete temp audio.
 * For an audio file path: transcribe directly.
 * Uses local transcription script when LOCAL_TRANSCRIPTION_SCRIPT is set, otherwise OpenAI Whisper.
 */
export async function transcribeVideoOrAudio(
  mediaPath: string,
  isVideo: boolean,
  options?: { useLocalFirst?: boolean }
): Promise<TranscribeResult> {
  const useLocalFirst = options?.useLocalFirst !== false;
  let audioPath: string | undefined;
  try {
    if (isVideo) {
      const extracted = await extractAudioFromVideo(mediaPath);
      if (!extracted.success || !extracted.audioPath) {
        return { success: false, error: extracted.error || 'Failed to extract audio' };
      }
      audioPath = extracted.audioPath;
    } else {
      audioPath = mediaPath;
    }
    const result = useLocalFirst
      ? await transcribeAudioLocalOrWhisper(audioPath)
      : await transcribeAudio(audioPath);
    return result;
  } finally {
    if (isVideo && audioPath && fs.existsSync(audioPath)) {
      try {
        fs.unlinkSync(audioPath);
      } catch (_) {}
    }
  }
}
