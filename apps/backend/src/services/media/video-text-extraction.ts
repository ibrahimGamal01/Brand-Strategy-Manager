import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** Extract one frame every N seconds for OCR. */
const FRAME_INTERVAL_SEC = 5;
/** Max frames to process per video (cap cost). */
const MAX_FRAMES = 20;

export interface OnScreenTextEntry {
  text: string;
  timestampSeconds?: number;
  confidence?: number;
}

/**
 * Extract on-screen text from a video using ffmpeg (frames) and Tesseract OCR.
 * If ffmpeg or tesseract is not available, returns empty array.
 * Frames are written to a temp dir and deleted after.
 */
export async function extractOnScreenTextFromVideo(
  videoPath: string
): Promise<OnScreenTextEntry[]> {
  if (!fs.existsSync(videoPath)) {
    return [];
  }
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  const framesDir = path.join(dir, `${base}_frames_${Date.now()}`);
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }
  const results: OnScreenTextEntry[] = [];
  try {
    // Extract one frame every FRAME_INTERVAL_SEC, up to MAX_FRAMES
    const outPattern = path.join(framesDir, 'frame_%03d.png');
    const cmd = `ffmpeg -i "${videoPath}" -vf "fps=1/${FRAME_INTERVAL_SEC}" -vframes ${MAX_FRAMES} -y "${outPattern}"`;
    await execAsync(cmd, { timeout: 60000 }).catch(() => null);
    const files = fs.readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort();
    const toProcess = files.slice(0, MAX_FRAMES);
    for (let i = 0; i < toProcess.length; i++) {
      const framePath = path.join(framesDir, toProcess[i]);
      const timestampSec = i * FRAME_INTERVAL_SEC;
      try {
        const text = await runTesseract(framePath);
        if (text && text.trim()) {
          results.push({ text: text.trim(), timestampSeconds: timestampSec });
        }
      } catch (_) {
        // skip frame
      }
    }
    return results;
  } finally {
    if (fs.existsSync(framesDir)) {
      try {
        for (const f of fs.readdirSync(framesDir)) {
          fs.unlinkSync(path.join(framesDir, f));
        }
        fs.rmdirSync(framesDir);
      } catch (_) {}
    }
  }
}

async function runTesseract(imagePath: string): Promise<string> {
  const outBase = imagePath.replace(/\.(png|jpg|jpeg)$/i, '') + '_ocr';
  try {
    await execAsync(`tesseract "${imagePath}" "${outBase}"`, { timeout: 15000 });
    const txtPath = `${outBase}.txt`;
    if (fs.existsSync(txtPath)) {
      const text = fs.readFileSync(txtPath, 'utf8');
      fs.unlinkSync(txtPath);
      return text;
    }
  } catch (_) {
    // tesseract not installed or failed
  }
  return '';
}
