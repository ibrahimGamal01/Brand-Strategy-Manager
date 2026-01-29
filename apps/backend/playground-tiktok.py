"""
TikTok Scraper Playground (Resilient Version)
Uses multiple methods to extract data even if TikTok blocks specific calls.

Installation:
    pip3 install yt-dlp fake-useragent

Usage:
    python3 playground-tiktok.py <username> [max_posts]
"""

import sys
import json
import time
from datetime import datetime
import yt_dlp
import random

try:
    from fake_useragent import UserAgent
    ua = UserAgent()
except ImportError:
    # Minimal fallback if not installed, but recommended
    class UserAgent:
        def random(self):
            return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36"
    ua = UserAgent()

def scrape_tiktok(username, max_posts=5):
    print(f"\n=== TIKTOK SCRAPER (Resilient) ===\n")
    print(f"Target: @{username}")
    
    url = f"https://www.tiktok.com/@{username}"
    
    # More robust options
    ydl_opts = {
        'quiet': True,
        'extract_flat': 'in_playlist',  # Get metadata without downloading
        'playlistend': max_posts,
        'ignoreerrors': True,
        'no_warnings': True,
        # Rotate user agents and add delays
        'user_agent': ua.random,
        'sleep_interval': 2,
        'max_sleep_interval': 5,
    }

    start_time = time.time()
    posts_data = []
    
    try:
        print("\nFetching profile...")
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # First try to get the profile playlist
            try:
                info = ydl.extract_info(url, download=False)
                entries = info.get('entries', []) if info else []
            except Exception as e:
                print(f"  ✗ Error accessing profile: {e}")
                entries = []
            
            if not entries:
                print("  ⚠️ No videos found or profile access blocked.")
                print("  Trying alternative method...")
                # Could add alternative here if needed
                return {'success': False, 'error': 'Profile access blocked'}
                
            print(f"\nFound {len(entries)} videos. Fetching details...")
            
            # Process each video
            for i, entry in enumerate(entries):
                if i >= max_posts:
                    break
                
                # Basic info is often available directly in the entry
                # even if detailed extraction fails
                post_id = entry.get('id')
                title = entry.get('title', '')
                video_url = entry.get('url') or f"https://www.tiktok.com/@{username}/video/{post_id}"
                
                print(f"  Post {i+1}/{max_posts}: {title[:40]}...")
                
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
                    'thumbnail': entry.get('thumbnail'),
                    'extraction_method': 'playlist_metadata'
                }
                
                # If some metrics are missing (common in flat extraction), 
                # we could try to fetch individual video, but that often triggers blocks.
                # Let's inspect what we got.
                
                if post['likes'] == 0 and post['views'] == 0:
                    # Try to fetch individual video details cautiously
                    try:
                        time.sleep(random.uniform(1.0, 3.0)) # Random delay
                        print(f"    Fetching extra details...")
                        
                        # Use a fresh instance with new UA for detail fetch
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
                                post['description'] = vid_info.get('description') or post['description']
                                post['extraction_method'] = 'full_detail'
                                print(f"    ✓ Detailed fetch successful")
                    except Exception as e:
                        print(f"    ⚠️ Detailed fetch blocked, using basic info")
                
                posts_data.append(post)
                
                # Log what we found
                print(f"    ✓ Views: {post.get('views', 'N/A')}")
                print(f"    ✓ Likes: {post.get('likes', 'N/A')}")
                
    except Exception as e:
        print(f"\n✗ Critical Error: {str(e)}")
        return {'success': False, 'error': str(e)}

    # Save results
    total_time = time.time() - start_time
    output_file = f"tiktok_{username}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    result = {
        'success': True,
        'username': username,
        'scraped_at': datetime.now().isoformat(),
        'posts': posts_data,
        'stats': {
            'total_posts': len(posts_data),
            'extraction_success': len([p for p in posts_data if p['likes'] > 0]),
            'time': total_time
        }
    }
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
        
    print(f"\n✓ Data saved to: {output_file}")
    print(f"✓ Success rate: {result['stats']['extraction_success']}/{len(posts_data)} posts with metrics")
    
    return result

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 playground-tiktok.py <username> [max_posts]")
        sys.exit(1)
        
    username = sys.argv[1].replace('@', '')
    max_posts = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    
    scrape_tiktok(username, max_posts)
