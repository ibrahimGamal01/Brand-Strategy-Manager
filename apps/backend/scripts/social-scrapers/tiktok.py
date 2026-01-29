"""
TikTok Scraper (Production Version)
Uses yt-dlp + fake-useragent
Outputs pure JSON to stdout for integration with Node.js backend

Usage:
    python3 tiktok.py <username> [max_posts]
"""

import sys
import json
import time
import yt_dlp
import random

# Configure standard output to handle UTF-8
sys.stdout.reconfigure(encoding='utf-8')

try:
    from fake_useragent import UserAgent
    ua = UserAgent()
except ImportError:
    class UserAgent:
        def random(self):
            return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36"
    ua = UserAgent()

def scrape_tiktok(username, max_posts=5):
    url = f"https://www.tiktok.com/@{username}"
    
    ydl_opts = {
        'quiet': True,
        'extract_flat': 'in_playlist',
        'playlistend': max_posts,
        'ignoreerrors': True,
        'no_warnings': True,
        'user_agent': ua.random,
        'sleep_interval': 1,
        'max_sleep_interval': 3,
    }

    posts_data = []
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(url, download=False)
                entries = info.get('entries', []) if info else []
            except Exception:
                entries = []
            
            for i, entry in enumerate(entries):
                if i >= max_posts:
                    break
                
                post_id = entry.get('id')
                title = entry.get('title', '')
                video_url = entry.get('url') or f"https://www.tiktok.com/@{username}/video/{post_id}"
                
                post = {
                    'id': post_id,
                    'url': video_url,
                    'description': title,
                    'views': entry.get('view_count', 0),
                    'likes': entry.get('like_count', 0),
                    'comments': entry.get('comment_count', 0),
                    'shares': entry.get('repost_count', 0),
                    'duration': entry.get('duration', 0),
                    'date': entry.get('upload_date'),
                    'type': 'VIDEO'
                }
                
                # Try lightweight detail fetch if metrics missing
                if post['likes'] == 0 and post['views'] == 0:
                    try:
                        time.sleep(random.uniform(0.5, 1.5))
                        detail_opts = {
                            'quiet': True,
                            'ignoreerrors': True,
                            'no_warnings': True,
                            'user_agent': ua.random
                        }
                        with yt_dlp.YoutubeDL(detail_opts) as detail_ydl:
                            vid_info = detail_ydl.extract_info(video_url, download=False)
                            if vid_info:
                                post['likes'] = vid_info.get('like_count', post['likes'])
                                post['views'] = vid_info.get('view_count', post['views'])
                                post['comments'] = vid_info.get('comment_count', post['comments'])
                                post['shares'] = vid_info.get('repost_count', post['shares'])
                    except Exception:
                        pass
                
                posts_data.append(post)
    
        result = {
            'success': True,
            'username': username,
            'posts': posts_data,
        }
        
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e),
            'posts': []
        }
        print(json.dumps(error_result, ensure_ascii=False))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No username provided'}))
        sys.exit(1)
        
    username = sys.argv[1].replace('@', '')
    max_posts = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    
    scrape_tiktok(username, max_posts)
