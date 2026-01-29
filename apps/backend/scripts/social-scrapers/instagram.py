"""
Instagram Scraper (Production Version)
Outputs pure JSON to stdout for integration with Node.js backend

Usage:
    python3 instagram.py <username> [max_posts]
"""

import instaloader
import json
import sys
import time
from datetime import datetime

# Configure standard output to handle UTF-8
sys.stdout.reconfigure(encoding='utf-8')

def scrape_instagram_profile(username, max_posts=20):
    try:
        # Initialize Instaloader (Quiet mode)
        L = instaloader.Instaloader(quiet=True)
        
        # Configure to avoid downloading media files
        L.download_pictures = False
        L.download_videos = False
        L.download_video_thumbnails = False
        L.download_geotags = False
        L.download_comments = False
        L.save_metadata = False
        
        # Get profile
        profile = instaloader.Profile.from_username(L.context, username)
        
        profile_data = {
            'username': profile.username,
            'full_name': profile.full_name,
            'biography': profile.biography,
            'followers': profile.followers,
            'following': profile.followees,
            'total_posts': profile.mediacount,
            'is_verified': profile.is_verified,
            'is_private': profile.is_private,
            'is_business': profile.is_business_account,
        }
        
        if profile.is_private:
            return {
                'success': False,
                'error': 'PRIVATE_ACCOUNT',
                'profile': profile_data,
                'posts': []
            }
        
        # Scrape posts
        posts_data = []
        post_count = 0
        
        for post in profile.get_posts():
            if post_count >= max_posts:
                break
            
            post_count += 1
            
            try:
                # Determine post type
                if post.typename == 'GraphSidecar':
                    post_type = 'CAROUSEL'
                elif post.typename == 'GraphVideo':
                    post_type = 'REEL'
                elif post.typename == 'GraphImage':
                    post_type = 'SINGLE'
                else:
                    post_type = post.typename
                
                # Engagement metrics
                engagement_rate = ((post.likes + post.comments) / profile.followers * 100) if profile.followers > 0 else 0
                
                post_data = {
                    'shortcode': post.shortcode,
                    'url': f'https://instagram.com/p/{post.shortcode}',
                    'type': post_type,
                    'caption': post.caption or '',
                    'likes': post.likes,
                    'comments': post.comments,
                    'engagement_rate': round(engagement_rate, 2),
                    'date': post.date_utc.isoformat(),
                    'is_video': post.is_video,
                }
                
                posts_data.append(post_data)
                time.sleep(0.5) # Slight delay
                
            except Exception:
                continue
        
        result = {
            'success': True,
            'profile': profile_data,
            'posts': posts_data,
        }
        
        # Output ONLY JSON to stdout
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e),
            'posts': []
        }
        print(json.dumps(error_result, ensure_ascii=False))

if __name__ == '__main__':
    if len(sys.argv) < 2:
        # Default empty output if no args
        print(json.dumps({'success': False, 'error': 'No username provided'}))
        sys.exit(1)
    
    username = sys.argv[1].replace('@', '')
    max_posts = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    
    scrape_instagram_profile(username, max_posts)
