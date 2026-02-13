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

def check_ytdlp_installed() -> bool:
    """Check if yt-dlp is installed and accessible."""
    try:
        result = subprocess.run(['yt-dlp', '--version'], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            print(f"[TikTok] yt-dlp version: {result.stdout.strip()}", file=sys.stderr)
            return True
        return False
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def search_tiktok_profile_ddg(handle: str) -> dict:
    """
    Fallback: Use DuckDuckGo to find TikTok profile info when yt-dlp fails.
    Returns basic profile info from search results.
    """
    from ddgs import DDGS
    
    handle = handle.replace('@', '')
    print(f"[TikTok] Fallback: Searching DDG for @{handle}...", file=sys.stderr)
    
    try:
        ddgs = DDGS()
        queries = [
            f'site:tiktok.com/@{handle}',
            f'"{handle}" tiktok profile',
        ]
        
        profile_info = {'handle': handle, 'profile_url': f"https://www.tiktok.com/@{handle}"}
        found_data = False
        
        for query in queries:
            results = list(ddgs.text(query, max_results=10))
            for r in results:
                href = r.get('href', '')
                body = r.get('body', '')
                title = r.get('title', '')
                
                # Check if we found the profile
                if f'tiktok.com/@{handle.lower()}' in href.lower():
                    found_data = True
                    
                    # Try to extract follower count from snippet
                    import re
                    follower_match = re.search(r'(\d+(?:\.\d+)?[KMB]?)\s*(?:followers?|fans?)', body, re.IGNORECASE)
                    if follower_match:
                        count_str = follower_match.group(1)
                        # Convert K/M/B to numbers
                        multiplier = 1
                        if 'K' in count_str.upper():
                            multiplier = 1000
                            count_str = count_str.upper().replace('K', '')
                        elif 'M' in count_str.upper():
                            multiplier = 1000000
                            count_str = count_str.upper().replace('M', '')
                        elif 'B' in count_str.upper():
                            multiplier = 1000000000
                            count_str = count_str.upper().replace('B', '')
                        try:
                            profile_info['follower_count'] = int(float(count_str) * multiplier)
                        except:
                            pass
                    
                    # Extract display name from title
                    if ' (@' in title or ' |' in title:
                        profile_info['display_name'] = title.split(' (@')[0].split(' |')[0].strip()
                    
                    break
            if found_data:
                break
        
        return {
            'success': found_data,
            'profile': profile_info,
            'videos': [],  # Cannot get videos from search
            'total_videos': 0,
            'fallback_used': 'ddg_search',
            'note': 'Video data not available via fallback. Only profile info retrieved.'
        }
        
    except ImportError:
        return {"error": "DDG fallback requires 'duckduckgo-search' package"}
    except Exception as e:
        return {"error": f"DDG fallback failed: {str(e)}"}


def get_profile_and_videos(handle: str, max_videos: int = 30) -> dict:
    """
    Scrape TikTok profile and recent videos using yt-dlp.
    Falls back to DDG search if yt-dlp is unavailable or fails.
    """
    handle = handle.replace('@', '')
    profile_url = f"https://www.tiktok.com/@{handle}"
    
    print(f"[TikTok] Scraping @{handle}...", file=sys.stderr)
    
    # Check if yt-dlp is available
    if not check_ytdlp_installed():
        print("[TikTok] yt-dlp not installed, using DDG fallback...", file=sys.stderr)
        return search_tiktok_profile_ddg(handle)
    
    try:
        # Use yt-dlp to get playlist info (user's videos)
        cmd = [
            'yt-dlp',
            '--dump-json',
            '--flat-playlist',
            '--playlist-items', f'1-{max_videos}',
            '--no-warnings',
            '--ignore-errors',
            '--no-check-certificate',  # Avoid SSL issues
            '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
            profile_url
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        if result.returncode != 0 and not result.stdout:
            # yt-dlp failed, try DDG fallback
            print(f"[TikTok] yt-dlp failed (exit {result.returncode}), using DDG fallback...", file=sys.stderr)
            if result.stderr:
                print(f"[TikTok] yt-dlp error: {result.stderr[:200]}", file=sys.stderr)
            return search_tiktok_profile_ddg(handle)
        
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
                        'handle': handle,  # Use original handle parameter, not uploader_id
                        'display_name': data.get('uploader', ''),
                        'profile_url': f"https://www.tiktok.com/@{handle}",
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
        
        if not videos and not profile_info:
            # yt-dlp returned empty, try DDG fallback
            print(f"[TikTok] yt-dlp returned no data, using DDG fallback...", file=sys.stderr)
            return search_tiktok_profile_ddg(handle)
        
        print(f"[TikTok] Found {len(videos)} videos for @{handle}", file=sys.stderr)
        
        # Ensure profile always has follower_count key for tiktok-service.ts
        profile = profile_info if profile_info else {'handle': handle, 'follower_count': 0}
        if 'follower_count' not in profile:
            profile['follower_count'] = profile.get('channel_follower_count', 0)
        return {
            'success': True,
            'profile': profile,
            'videos': videos,
            'total_videos': len(videos),
        }
        
    except subprocess.TimeoutExpired:
        print("[TikTok] yt-dlp timed out, using DDG fallback...", file=sys.stderr)
        return search_tiktok_profile_ddg(handle)
    except Exception as e:
        print(f"[TikTok] Error: {e}, using DDG fallback...", file=sys.stderr)
        return search_tiktok_profile_ddg(handle)


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
