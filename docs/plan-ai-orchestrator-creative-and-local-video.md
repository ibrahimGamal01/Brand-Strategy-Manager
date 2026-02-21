# AI Orchestrator: Creative/Design Metrics and Local Video Pipeline

## Goals

1. **Top-level AI orchestrator** reads saved analysis and ensures coverage of **creative** and **official design metrics** (composition, color, typography, hierarchy, CTA, brand consistency, etc.). Enrich or re-run when coverage is missing.
2. **Local video handling**: Do **transcription** and **on-screen text extraction** **locally** (no OpenAI for extraction), persist to DB, then run **OpenAI analysis** using that data plus the video (thumbnail + transcript + on-screen text).

---

## Part 1: Local video processing and persistence

- **Schema:** Add `extractedTranscript` (String?) and `extractedOnScreenText` (Json?) to MediaAsset.
- **Local transcription:** Use local STT (e.g. faster-whisper) or fallback to Whisper; always persist to `extractedTranscript` before OpenAI analysis.
- **Local on-screen text:** ffmpeg frames + OCR (Tesseract) → JSON; persist to `extractedOnScreenText`.
- **Pipeline:** For each video: extract audio → transcribe locally → save transcript; extract frames → OCR → save on-screen text; then run OpenAI analysis using transcript + on-screen text + thumbnail.

## Part 2: OpenAI analysis using local extractions

- In media-content-analyzer for VIDEO: use `extractedTranscript` when present (else run extraction and save). Include `extractedOnScreenText` in GPT prompt. Send transcript + on-screen text + thumbnail to OpenAI; save to analysisTranscript, analysisOverall, analysisVisual.

## Part 3: Top-level AI orchestrator (creative/design metrics)

- **Dimensions:** composition, color_use, typography, visual_hierarchy, cta_clarity, brand_consistency, psychological_triggers, emotional_appeal, production_quality, accessibility.
- **Step:** After runAiAnalysisForJob (e.g. Step 5c): read analysis for job assets; check which dimensions are present; if missing, enrich via OpenAI (add missing dimensions to existing JSON) or re-run with design-focused prompt; update MediaAsset; log and emit events (e.g. creative_validation.completed).

## Part 4: Design-focused prompts in analyzer

- Update visual/overall/transcript prompts to explicitly request the same creative/design dimensions so new analyses are complete by default; top-level step only enriches older or incomplete analyses.

## Files

- Schema: `prisma/schema.prisma` (MediaAsset: extractedTranscript, extractedOnScreenText).
- New: `services/media/video-text-extraction.ts` (ffmpeg + Tesseract OCR). Optional local transcription: set `LOCAL_TRANSCRIPTION_SCRIPT` to e.g. `scripts/local_transcribe.py` (uses faster-whisper; see `scripts/local_transcribe.py`).
- Modify: `services/media/audio-transcription.ts` (transcribeAudioLocalOrWhisper, transcribeVideoOrAudio useLocalFirst).
- Modify: `services/ai/media-content-analyzer.ts` (use/persist extractedTranscript and extractedOnScreenText; design prompts).
- New: `services/orchestration/creative-design-coverage.ts` (ensure creative/design dimensions; enrich when missing).
- Modify: `services/orchestration/continuous-orchestrator.ts` (Step 5c: ensureCreativeAndDesignCoverage).
- Routes: `research-jobs.ts`, `media.ts` (pass extractedTranscript, extractedOnScreenText to analyzer).
