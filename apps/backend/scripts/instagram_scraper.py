#!/usr/bin/env python3
"""
Advanced Instagram Scraper using Instaloader (Part 3.5 Hardening)
Features: 
- Smart H/D Rate Limiting
- Cool Down Logic (429/403 Handling)
- Competitor Discovery (OASP)
- Top Comment Scraping
- Session Persistence & User Agent Rotation
"""

import instaloader
import json
import sys
import random
import time
import os
import datetime
from itertools import islice
from typing import Dict, List, Optional

# --- CONFIGURATION (Safe Limits) ---
MAX_REQUESTS_PER_HOUR = 150 # Safety buffer below 200
MAX_REQUESTS_PER_DAY = 1000
RATE_LIMIT_FILE = 'rate_limit_stats.json'

# Robust User Agent List (Mobile + Desktop)
USER_AGENTS = [
    'Instagram 219.0.0.12.117 Android (26/8.0.0; 480dpi; 1080x1920; Xiaomi; Redmi Note 7; lavender; qcom; en_US; 343285741)',
    'Instagram 219.0.0.12.117 Android (26/8.0.0; 320dpi; 720x1280; Xiaomi; Redmi 5A; riva; qcom; en_US; 343285741)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 206.1.0.34.120',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
]

class RateLimitExceeded(Exception):
    pass

class RateLimiter:
    """Persistent Rate Limiter to protect the burner account"""
    def __init__(self, stats_file):
        self.stats_file = stats_file
        self.stats = self._load_stats()

    def _load_stats(self):
        if os.path.exists(self.stats_file):
            try:
                with open(self.stats_file, 'r') as f:
                    return json.load(f)
            except:
                pass
        return {'hourly': {}, 'daily': {}}

    def _save_stats(self):
        try:
             # Ensure directory exists for stats file if it includes a path
            stats_dir = os.path.dirname(self.stats_file)
            if stats_dir:
                 os.makedirs(stats_dir, exist_ok=True)
                 
            with open(self.stats_file, 'w') as f:
                json.dump(self.stats, f)
        except Exception as e:
            print(f"[RateLimiter] Error saving stats: {e}", file=sys.stderr)

    def check_limit(self):
        now = datetime.datetime.now()
        current_hour = now.strftime('%Y-%m-%d-%H')
        current_day = now.strftime('%Y-%m-%d')
        
        # Reset if new hour/day
        if current_hour not in self.stats['hourly']:
            self.stats['hourly'] = {current_hour: 0} # Reset hourly
        if current_day not in self.stats['daily']:
             self.stats['daily'] = {current_day: 0}   # Reset daily

        # Check limits
        req_hour = self.stats['hourly'].get(current_hour, 0)
        req_day = self.stats['daily'].get(current_day, 0)

        if req_hour >= MAX_REQUESTS_PER_HOUR:
            raise RateLimitExceeded(f"Hourly limit reached ({req_hour}/{MAX_REQUESTS_PER_HOUR}). Cooling down.")
        
        if req_day >= MAX_REQUESTS_PER_DAY:
             raise RateLimitExceeded(f"Daily limit reached ({req_day}/{MAX_REQUESTS_PER_DAY}). Stop for today.")

    def increment(self, count=1):
        now = datetime.datetime.now()
        current_hour = now.strftime('%Y-%m-%d-%H')
        current_day = now.strftime('%Y-%m-%d')
        
        # Initialize if missing (safety)
        if current_hour not in self.stats['hourly']: self.stats['hourly'][current_hour] = 0
        if current_day not in self.stats['daily']: self.stats['daily'][current_day] = 0

        self.stats['hourly'][current_hour] += count
        self.stats['daily'][current_day] += count
        self._save_stats()


def import_session_from_browser(L: instaloader.Instaloader, session_path: str) -> bool:
    """
    Import Instagram session cookies from user's browser.
    This is MORE RELIABLE than password login because:
    1. No login challenges (already trusted)
    2. No 2FA prompts
    3. Session is pre-authenticated
    
    Returns True if import succeeded, False otherwise.
    """
    try:
        import browser_cookie3
    except ImportError:
        print("[Scraper] browser_cookie3 not installed. Skipping browser import.", file=sys.stderr)
        return False
    
    print("[Scraper] Attempting to import session from browser...", file=sys.stderr)
    
    # Try different browsers in order of preference
    browsers = [
        ('Firefox', browser_cookie3.firefox),
        ('Chrome', browser_cookie3.chrome),
        ('Safari', browser_cookie3.safari),
    ]
    
    for browser_name, browser_fn in browsers:
        try:
            print(f"[Scraper] Trying {browser_name}...", file=sys.stderr)
            cj = browser_fn(domain_name='.instagram.com')
            
            # Check if we got the critical session cookies
            session_id = None
            csrf_token = None
            
            for cookie in cj:
                if cookie.name == 'sessionid':
                    session_id = cookie.value
                elif cookie.name == 'csrftoken':
                    csrf_token = cookie.value
            
            if session_id and csrf_token:
                print(f"[Scraper] Found Instagram session in {browser_name}!", file=sys.stderr)
                
                # Inject cookies into Instaloader's session
                L.context._session.cookies.set('sessionid', session_id, domain='.instagram.com')
                L.context._session.cookies.set('csrftoken', csrf_token, domain='.instagram.com')
                
                # Set other cookies if available
                for cookie in cj:
                    if cookie.name not in ['sessionid', 'csrftoken']:
                        try:
                            L.context._session.cookies.set(cookie.name, cookie.value, domain=cookie.domain)
                        except:
                            pass
                
                # Save session for future use
                username = os.environ.get('INSTAGRAM_USERNAME', 'browser_user')
                L.save_session_to_file(filename=session_path)
                print(f"[Scraper] Browser session imported and saved!", file=sys.stderr)
                return True
            else:
                print(f"[Scraper] No valid Instagram session in {browser_name}", file=sys.stderr)
                
        except Exception as e:
            print(f"[Scraper] {browser_name} import failed: {e}", file=sys.stderr)
            continue
    
    return False


def scrape_profile(handle: str, posts_limit: int = 30, use_proxy: bool = False, proxy_url: Optional[str] = None) -> Dict:
    """Scrape Instagram profile with full OASP capabilities and anti-ban protection."""
    
    # 1. Initialize Rate Limiter
    # Store stats in specific dir relative to script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    sessions_dir = os.path.join(script_dir, '..', 'sessions') # Go up one level from scripts/ to backend/sessions/
    os.makedirs(sessions_dir, exist_ok=True)
    stats_path = os.path.join(sessions_dir, RATE_LIMIT_FILE)
    
    limiter = RateLimiter(stats_path)
    
    try:
        limiter.check_limit()
    except RateLimitExceeded as e:
        print(f"[Scraper] Safety Stop: {e}", file=sys.stderr)
        # Return special error code so backend knows to pause
        return {'error': 'RATE_LIMIT_EXCEEDED', 'message': str(e)}

    # 2. Initialize Instaloader
    L = instaloader.Instaloader(
        download_videos=False, 
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False, 
        save_metadata=False,
        compress_json=False,
        max_connection_attempts=3,
        request_timeout=30
    )
    
    # Rotate UA
    ua = random.choice(USER_AGENTS)
    L.context._session.headers['User-Agent'] = ua
    print(f"[Scraper] Using UA: {ua[:30]}...", file=sys.stderr)

    # 3. Session Management
    # Use same directory as rate limits for consistency
    session_file = f"session-{os.environ.get('INSTAGRAM_USERNAME', 'default')}"
    session_path = os.path.join(sessions_dir, session_file)
    
    is_logged_in = False
    
    # Load Login
    if os.path.exists(session_path):
        try:
            print(f"[Scraper] Loading session from: {session_path}", file=sys.stderr)
            L.load_session_from_file(os.environ.get('INSTAGRAM_USERNAME'), filename=session_path)
            is_logged_in = True
            print(f"[Scraper] Session loaded.", file=sys.stderr)
        except Exception as e:
            print(f"[Scraper] Session load failed: {e}", file=sys.stderr)

    if not is_logged_in:
        # Priority 1: Try importing from browser (MOST RELIABLE)
        print("[Scraper] No saved session. Trying browser import...", file=sys.stderr)
        is_logged_in = import_session_from_browser(L, session_path)
        
    if not is_logged_in:
        # Priority 2: Password login (fallback)
        username = os.environ.get('INSTAGRAM_USERNAME')
        password = os.environ.get('INSTAGRAM_PASSWORD')
        
        if username and password:
            print(f"[Scraper] Trying password login as: {username}", file=sys.stderr)
            try:
                # Add extra delay before login attempts
                time.sleep(random.uniform(3, 8)) 
                L.login(username, password)
                L.save_session_to_file(filename=session_path)
                print(f"[Scraper] Login success.", file=sys.stderr)
                is_logged_in = True
                
                # Charge "cost" for login
                limiter.increment(5) 
                
            except Exception as e:
                print(f"[Scraper] Login failed: {e}", file=sys.stderr)
                # Continue with public scraping if possible
        else:
            print("[Scraper] No credentials available. Running in anonymous mode.", file=sys.stderr)
    
    if use_proxy and proxy_url:
        L.context._session.proxies = {'http': proxy_url, 'https': proxy_url}

    # 4. Get Profile
    try:
        profile = instaloader.Profile.from_username(L.context, handle)
        print(f"[Scraper] Found profile: @{handle} ({profile.followers} followers)", file=sys.stderr)
        limiter.increment(1) # Profile fetch cost
    except instaloader.exceptions.ConnectionException as e:
         # COOL DOWN LOGIC
        if '429' in str(e) or '403' in str(e):
             print(f"[Scraper] CRITICAL: 429/403 detected. Backing off.", file=sys.stderr)
             # Signal Backend to Cool Down
             raise Exception("INSTAGRAM_RATELIMIT_429")
        raise e

    # 5. OASP Feature: Find Competitors (Similar Accounts)
    competitors = []
    if is_logged_in:
        try:
            print(f"[Scraper] Discovering similar accounts (OASP)...", file=sys.stderr)
            # Iterate similar accounts (limit to 5 to be safe)
            sim_iter = profile.get_similar_accounts()
            for sim_profile in islice(sim_iter, 5):
                competitors.append({
                    'username': sim_profile.username,
                    'full_name': sim_profile.full_name,
                    'followers': sim_profile.followers
                })
                time.sleep(random.uniform(1, 3)) # Delay between competitor fetches
            limiter.increment(len(competitors))
            print(f"[Scraper] Found {len(competitors)} competitors.", file=sys.stderr)
        except Exception as e:
            print(f"[Scraper] Competitor discovery warning: {e}", file=sys.stderr)

    # 6. Scrape Posts & Top Comments
    posts = []
    try:
        current_count = 0
        for post in profile.get_posts():
             if current_count >= posts_limit: break
             
             # Random pause every 5 posts to mimic reading
             if current_count > 0 and current_count % 5 == 0:
                 pause = random.uniform(10, 20)
                 print(f"[Scraper] 'Reading' pause for {pause:.1f}s...", file=sys.stderr)
                 time.sleep(pause)
             
             # Extract comments (Top 5 only)
             post_comments = []
             if is_logged_in:
                 try:
                     for comment in islice(post.get_comments(), 5):
                         post_comments.append({
                             'text': comment.text,
                             'owner': comment.owner.username,
                             'likes': comment.likes_count
                         })
                 except Exception:
                     pass # Ignore comment errors

             posts.append({
                'external_post_id': post.shortcode,
                'post_url': f'https://instagram.com/p/{post.shortcode}/',
                'caption': post.caption if post.caption else '',
                'likes': post.likes,
                'comments': post.comments,
                'timestamp': post.date_utc.isoformat(),
                'media_url': post.url,
                'is_video': post.is_video,
                'video_url': post.video_url if post.is_video else None,
                'typename': post.typename,
                'top_comments': post_comments # New OASP Field
            })
             
             current_count += 1
             limiter.increment(1) # Post fetch cost
             print(f"[Scraper] Scraped post {current_count}/{posts_limit}", file=sys.stderr)
             
             # Standard delay
             time.sleep(random.uniform(3, 7))

    except instaloader.exceptions.TooManyRequestsException:
        print("[Scraper] Rate limit hit during posts!", file=sys.stderr)
        # Don't crash, just return what we have
    except Exception as e:
        error_msg = str(e)
        if any(code in error_msg for code in ['429', '403', '401', 'wait a few minutes']):
             print(f"[Scraper] CRITICAL during posts: 401/403/429. Stopping.", file=sys.stderr)
             # Signal backend? We return what we have.
        else:
             print(f"[Scraper] Error scraping posts: {error_msg}", file=sys.stderr)

    result = {
        'handle': handle,
        'follower_count': profile.followers,
        'following_count': profile.followees,
        'bio': profile.biography,
        'profile_pic': profile.profile_pic_url,
        'is_verified': profile.is_verified,
        'total_posts': profile.mediacount,
        'posts': posts,
        'discovered_competitors': competitors # New OASP Field
    }
    
    return result

if __name__ == '__main__':
    # Robust Env Loader
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Try multiple .env locations
    possible_env_paths = [
        os.path.join(script_dir, '..', '.env'), # apps/backend/.env
        os.path.join(script_dir, '..', '..', '..', '.env') # root .env
    ]
    
    for env_path in possible_env_paths:
        print(f"[Scraper] Checking .env at: {env_path}", file=sys.stderr)
        if os.path.exists(env_path):
            print(f"[Scraper] Found .env, parsing...", file=sys.stderr)
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and 'INSTAGRAM_' in line and '=' in line:
                         key, val = line.split('=', 1)
                         print(f"[Scraper] Loaded env var: {key}", file=sys.stderr)
                         if key not in os.environ: 
                            os.environ[key] = val.strip('"').strip("'")
            break

    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: python3 instagram_scraper.py <handle> [posts_limit]'}))
        sys.exit(1)
    
    handle = sys.argv[1].replace('@', '')
    posts_limit = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    
    try:
        data = scrape_profile(handle, posts_limit)
        print(json.dumps(data, indent=2))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stdout)
        sys.exit(1)
