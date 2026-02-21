#!/usr/bin/env python3
"""
YouTube Downloader using yt-dlp

Capabilities:
1. Download individual videos
2. Extract video metadata
3. Download audio only (for podcasts/interviews)

Usage:
  python3 youtube_downloader.py info <url>
  python3 youtube_downloader.py download <url> <output_path>
  python3 youtube_downloader.py audio <url> <output_path>

Output: JSON to stdout
"""

import sys
import json
import os
import subprocess

PROXY_URL = (
    os.environ.get('SCRAPER_PROXY_URL')
    or os.environ.get('HTTPS_PROXY')
    or os.environ.get('HTTP_PROXY')
    or ''
).strip()

def with_proxy(cmd):
    if PROXY_URL and '--proxy' not in cmd:
        return [*cmd, '--proxy', PROXY_URL]
    return cmd

def get_video_info(url: str) -> dict:
    """
    Get video metadata without downloading.
    """
    print(f"[YouTube] Getting info for: {url}", file=sys.stderr)
    
    try:
        cmd = [
            'yt-dlp',
            '--dump-json',
            '--no-warnings',
            '--no-download',
            url
        ]
        
        result = subprocess.run(with_proxy(cmd), capture_output=True, text=True, timeout=60)
        
        if result.returncode != 0:
            return {"error": result.stderr or "Failed to get video info"}
        
        data = json.loads(result.stdout)
        
        return {
            'success': True,
            'video_id': data.get('id', ''),
            'title': data.get('title', ''),
            'description': data.get('description', ''),
            'duration': data.get('duration', 0),
            'view_count': data.get('view_count', 0),
            'like_count': data.get('like_count', 0),
            'comment_count': data.get('comment_count', 0),
            'channel': data.get('channel', ''),
            'channel_id': data.get('channel_id', ''),
            'channel_url': data.get('channel_url', ''),
            'upload_date': data.get('upload_date', ''),
            'thumbnail': data.get('thumbnail', ''),
            'categories': data.get('categories', []),
            'tags': data.get('tags', []),
        }
        
    except subprocess.TimeoutExpired:
        return {"error": "Info extraction timed out"}
    except json.JSONDecodeError:
        return {"error": "Failed to parse video info"}
    except Exception as e:
        return {"error": str(e)}


def download_video(url: str, output_path: str, audio_only: bool = False) -> dict:
    """
    Download video or audio from YouTube.
    """
    print(f"[YouTube] Downloading {'audio' if audio_only else 'video'}: {url}", file=sys.stderr)
    
    try:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        if audio_only:
            cmd = [
                'yt-dlp',
                '-f', 'bestaudio',
                '-x',  # Extract audio
                '--audio-format', 'mp3',
                '-o', output_path,
                '--no-warnings',
                url
            ]
        else:
            cmd = [
                'yt-dlp',
                '-f', 'best[height<=720]',  # Cap at 720p for storage efficiency
                '-o', output_path,
                '--no-warnings',
                url
            ]
        
        result = subprocess.run(with_proxy(cmd), capture_output=True, text=True, timeout=300)  # 5 min timeout
        
        if result.returncode == 0:
            # Find the actual file (yt-dlp adds extension)
            base_path = output_path.rsplit('.', 1)[0] if '.' in output_path else output_path
            
            for ext in ['.mp4', '.webm', '.mkv', '.mp3', '.m4a']:
                check_path = base_path + ext
                if os.path.exists(check_path):
                    return {
                        'success': True,
                        'path': check_path,
                        'size_bytes': os.path.getsize(check_path)
                    }
            
            # Check exact path
            if os.path.exists(output_path):
                return {
                    'success': True,
                    'path': output_path,
                    'size_bytes': os.path.getsize(output_path)
                }
            
            return {'success': True, 'path': output_path, 'note': 'Download completed'}
        else:
            return {'success': False, 'error': result.stderr}
            
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Download timed out (5 min limit)"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: youtube_downloader.py <action> <url> [output_path]"}))
        sys.exit(1)
    
    action = sys.argv[1]
    url = sys.argv[2]
    
    if action == 'info':
        result = get_video_info(url)
        print(json.dumps(result))
        
    elif action == 'download':
        if len(sys.argv) < 4:
            print(json.dumps({"error": "Usage: youtube_downloader.py download <url> <output_path>"}))
            sys.exit(1)
        output_path = sys.argv[3]
        result = download_video(url, output_path, audio_only=False)
        print(json.dumps(result))
        
    elif action == 'audio':
        if len(sys.argv) < 4:
            print(json.dumps({"error": "Usage: youtube_downloader.py audio <url> <output_path>"}))
            sys.exit(1)
        output_path = sys.argv[3]
        result = download_video(url, output_path, audio_only=True)
        print(json.dumps(result))
        
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
