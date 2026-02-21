#!/usr/bin/env python3
"""
Local transcription using faster-whisper (no OpenAI). Usage: python local_transcribe.py <audio_path>
Prints transcript to stdout. Install: pip install faster-whisper
"""
import sys

def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: local_transcribe.py <audio_path>\n")
        sys.exit(1)
    path = sys.argv[1]
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel("base", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(path)
        transcript = " ".join(s.text for s in segments if s.text).strip()
        print(transcript)
    except ImportError:
        sys.stderr.write("faster_whisper not installed. pip install faster-whisper\n")
        sys.exit(2)
    except Exception as e:
        sys.stderr.write(str(e) + "\n")
        sys.exit(3)

if __name__ == "__main__":
    main()
