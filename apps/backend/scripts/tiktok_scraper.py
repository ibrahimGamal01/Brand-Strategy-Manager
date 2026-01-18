#!/usr/bin/env python3
"""
TikTok Scraper using yt-dlp

Capabilities:
1. Scrape profile info (followers, following, bio, etc.)
2. Scrape recent videos with metadata (views, likes, comments, shares)
3. Download videos to storage

Usage:
  python3 tiktok_scraper.py profile <handle> [max_videos]
  python3 tiktok_scraper.py download <video_url> <output_path>

Output: JSON to stdout
"""

import sys
import json
import os
import subprocess
import re
from datetime import datetime

def get_profile_and_videos(handle: str, max_videos: int = 30) -> dict:
    """
    Scrape TikTok profile and recent videos using yt-dlp.
    yt-dlp can extract playlist info from TikTok user pages.
    """
    handle = handle.replace('@', '')
    profile_url = f"https://www.tiktok.com/@{handle}"
    
    print(f"[TikTok] Scraping @{handle}...", file=sys.stderr)
    
    try:
        # Use yt-dlp to get playlist info (user's videos)
        cmd = [
            'yt-dlp',
            '--dump-json',
            '--flat-playlist',
            '--playlist-items', f'1-{max_videos}',
            '--no-warnings',
            '--ignore-errors',
            profile_url
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        if result.returncode != 0 and not result.stdout:
            # Try alternative approach - get single video info to at least get channel info
            print(f"[TikTok] Playlist extraction failed, trying single video approach...", file=sys.stderr)
            return {"error": "Could not extract TikTok data. Account may be private or rate-limited."}
        
        # Parse the JSON lines output
        videos = []
        profile_info = {}
        
        for line in result.stdout.strip().split('\n'):
            if not line:
                continue
            try:
                data = json.loads(line)
                
                # Extract profile info from first video
                if not profile_info and 'uploader' in data:
                    profile_info = {
                        'handle': data.get('uploader_id', handle),
                        'display_name': data.get('uploader', ''),
                        'profile_url': f"https://www.tiktok.com/@{data.get('uploader_id', handle)}",
                        # Note: yt-dlp doesn't always give follower counts from playlist
                        'follower_count': data.get('channel_follower_count', 0),
                    }
                
                # Extract video info
                video = {
                    'video_id': data.get('id', ''),
                    'url': data.get('url', data.get('webpage_url', '')),
                    'title': data.get('title', ''),
                    'description': data.get('description', ''),
                    'duration': data.get('duration', 0),
                    'view_count': data.get('view_count', 0),
                    'like_count': data.get('like_count', 0),
                    'comment_count': data.get('comment_count', 0),
                    'share_count': data.get('repost_count', 0),
                    'upload_date': data.get('upload_date', ''),
                    'thumbnail': data.get('thumbnail', ''),
                }
                videos.append(video)
                
            except json.JSONDecodeError:
                continue
        
        print(f"[TikTok] Found {len(videos)} videos for @{handle}", file=sys.stderr)
        
        return {
            'success': True,
            'profile': profile_info if profile_info else {'handle': handle},
            'videos': videos,
            'total_videos': len(videos),
        }
        
    except subprocess.TimeoutExpired:
        return {"error": "TikTok scraping timed out"}
    except Exception as e:
        return {"error": str(e)}


def download_video(video_url: str, output_path: str) -> dict:
    """
    Download a single TikTok video using yt-dlp.
    """
    print(f"[TikTok] Downloading: {video_url}", file=sys.stderr)
    
    try:
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        cmd = [
            'yt-dlp',
            '-f', 'best',
            '-o', output_path,
            '--no-warnings',
            video_url
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        if result.returncode == 0:
            # Get the actual file path (yt-dlp might add extension)
            # Check for common extensions
            for ext in ['.mp4', '.webm', '.mkv']:
                full_path = output_path if output_path.endswith(ext) else output_path + ext
                if os.path.exists(full_path):
                    return {
                        'success': True,
                        'path': full_path,
                        'size_bytes': os.path.getsize(full_path)
                    }
            
            # Fallback - check if original path exists
            if os.path.exists(output_path):
                return {
                    'success': True,
                    'path': output_path,
                    'size_bytes': os.path.getsize(output_path)
                }
            
            return {'success': True, 'path': output_path, 'note': 'File created'}
        else:
            return {'success': False, 'error': result.stderr}
            
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Download timed out"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: tiktok_scraper.py <action> <args>"}))
        sys.exit(1)
    
    action = sys.argv[1]
    
    if action == 'profile':
        handle = sys.argv[2]
        max_videos = int(sys.argv[3]) if len(sys.argv) > 3 else 30
        result = get_profile_and_videos(handle, max_videos)
        print(json.dumps(result))
        
    elif action == 'download':
        if len(sys.argv) < 4:
            print(json.dumps({"error": "Usage: tiktok_scraper.py download <url> <output_path>"}))
            sys.exit(1)
        video_url = sys.argv[2]
        output_path = sys.argv[3]
        result = download_video(video_url, output_path)
        print(json.dumps(result))
        
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
