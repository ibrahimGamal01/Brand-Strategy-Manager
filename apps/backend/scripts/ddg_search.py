#!/usr/bin/env python3
"""
DuckDuckGo Search Service for Info Gathering (v2)
Uses the new `ddgs` package for maximum results

Capabilities:
1. Brand Context Search (website, socials, summary)
2. Competitor Discovery (finding similar accounts)
3. Handle Validation (checking if handle is legitimate)
4. Raw Search (get all results for DB storage)
"""

import json
import sys
import re
from typing import List, Dict, Optional
from ddgs import DDGS

# Maximum results per query (DDG practical limit is around 100-200)
MAX_RESULTS_PER_QUERY = 100


def raw_search(queries: List[str], max_per_query: int = MAX_RESULTS_PER_QUERY) -> List[Dict]:
    """
    Execute multiple queries and return ALL raw results
    This is for storing in DB for later processing
    """
    all_results = []
    seen_hrefs = set()  # Dedupe by URL
    
    ddgs = DDGS()
    
    for query in queries:
        try:
            print(f"[DDG] Searching: {query}", file=sys.stderr)
            results = list(ddgs.text(query, max_results=max_per_query))
            
            for r in results:
                href = r.get('href', '')
                if href and href not in seen_hrefs:
                    all_results.append({
                        'query': query,
                        'title': r.get('title', ''),
                        'href': href,
                        'body': r.get('body', ''),
                    })
                    seen_hrefs.add(href)
                    
            print(f"[DDG] Got {len(results)} results, total unique: {len(all_results)}", file=sys.stderr)
            
        except Exception as e:
            print(f"[DDG] Query failed: {query} - {e}", file=sys.stderr)
            continue
    
    return all_results


def search_brand_context(brand_name: str) -> Dict:
    """
    Deep search to gather brand context: website, socials, description
    Returns structured data + raw results for DB storage
    """
    results = {
        'brand_name': brand_name,
        'website_url': None,
        'instagram_handle': None,
        'facebook_url': None,
        'tiktok_handle': None,
        'linkedin_url': None,
        'twitter_handle': None,
        'youtube_channel': None,
        'context_summary': '',
        'raw_results': []
    }
    
    # Multiple queries to maximize coverage
    queries = [
        f'"{brand_name}" official website',
        f'"{brand_name}" instagram',
        f'site:instagram.com "{brand_name}"',
        f'site:facebook.com "{brand_name}"',
        f'site:linkedin.com "{brand_name}"',
        f'site:tiktok.com "{brand_name}"',
        f'"{brand_name}" about us',
        f'"{brand_name}" founder CEO',
    ]
    
    try:
        raw = raw_search(queries, max_per_query=50)
        results['raw_results'] = raw
        
        for r in raw:
            href = r.get('href', '').lower()
            
            # Extract website (first non-social link)
            if not results['website_url']:
                if not any(s in href for s in ['instagram.com', 'facebook.com', 'twitter.com', 'tiktok.com', 'linkedin.com', 'youtube.com', 'wikipedia.org']):
                    results['website_url'] = r.get('href')
            
            # Extract socials
            if 'instagram.com/' in href:
                match = re.search(r'instagram\.com/([a-zA-Z0-9_.]+)', href)
                if match and match.group(1) not in ['p', 'explore', 'reel', 'stories', 'reels']:
                    if not results['instagram_handle']:
                        results['instagram_handle'] = match.group(1)
                        
            if 'facebook.com/' in href and not results['facebook_url']:
                results['facebook_url'] = r.get('href')
                
            if 'tiktok.com/@' in href:
                match = re.search(r'tiktok\.com/@([a-zA-Z0-9_.]+)', href)
                if match and not results['tiktok_handle']:
                    results['tiktok_handle'] = match.group(1)
                    
            if 'linkedin.com/' in href and not results['linkedin_url']:
                results['linkedin_url'] = r.get('href')
                
            if 'twitter.com/' in href or 'x.com/' in href:
                match = re.search(r'(?:twitter|x)\.com/([a-zA-Z0-9_]+)', href)
                if match and not results['twitter_handle']:
                    results['twitter_handle'] = match.group(1)
        
        # Build context summary
        snippets = [r.get('body', '') for r in raw[:10] if r.get('body')]
        results['context_summary'] = ' | '.join(snippets)[:1000]
        
    except Exception as e:
        results['error'] = str(e)
    
    return results


def search_competitors(handle: str, niche: str, max_results: int = 100) -> Dict:
    """
    Find competitor Instagram handles based on handle and niche
    Returns raw results + extracted handles
    """
    # Broader queries for maximum coverage
    queries = [
        f'{niche} instagram influencers',
        f'{niche} instagram accounts to follow',
        f'best {niche} instagram creators 2024',
        f'top {niche} instagram accounts',
        f'{niche} instagram bloggers',
        f'instagram accounts like @{handle}',
        f'similar to @{handle} instagram',
        f'{niche} content creators instagram',
        f'{niche} instagram community',
        f'{niche} instagram experts',
    ]
    
    raw = raw_search(queries, max_per_query=MAX_RESULTS_PER_QUERY)
    
    # Extract all handles from results
    handles = set()
    for r in raw:
        text = f"{r.get('title', '')} {r.get('body', '')}"
        
        # Extract @handles from text
        found = re.findall(r'@([a-zA-Z0-9_.]{1,30})', text)
        for h in found:
            if h.lower() != handle.lower() and h not in ['p', 'explore', 'reel', 'stories', 'reels']:
                handles.add(h)
        
        # Extract from Instagram URLs
        href = r.get('href', '')
        match = re.search(r'instagram\.com/([a-zA-Z0-9_.]+)', href)
        if match:
            h = match.group(1)
            if h.lower() != handle.lower() and h not in ['p', 'explore', 'reel', 'stories', 'reels']:
                handles.add(h)
    
    return {
        'competitors': list(handles)[:max_results],
        'raw_results': raw,
        'total_raw': len(raw),
        'total_handles': len(handles)
    }


def validate_handle(handle: str, platform: str = 'instagram') -> Dict:
    """
    Validate if a handle appears to be a real, active account
    """
    result = {
        'handle': handle,
        'platform': platform,
        'is_valid': False,
        'confidence': 0.0,
        'reason': '',
        'found_urls': [],
        'raw_results': []
    }
    
    try:
        if platform == 'instagram':
            queries = [f'site:instagram.com "{handle}"', f'@{handle} instagram']
        else:
            queries = [f'"{handle}" {platform}']
        
        raw = raw_search(queries, max_per_query=20)
        result['raw_results'] = raw
        
        exact_matches = 0
        for r in raw:
            href = r.get('href', '').lower()
            text = f"{r.get('title', '')} {r.get('body', '')}".lower()
            
            if f'instagram.com/{handle.lower()}' in href:
                exact_matches += 1
                result['found_urls'].append(r.get('href'))
            
            if f'@{handle.lower()}' in text:
                exact_matches += 1
        
        if exact_matches >= 3:
            result['is_valid'] = True
            result['confidence'] = min(0.95, 0.3 + (exact_matches * 0.15))
            result['reason'] = f'Found {exact_matches} references to @{handle}'
        elif exact_matches >= 1:
            result['is_valid'] = True
            result['confidence'] = 0.5 + (exact_matches * 0.1)
            result['reason'] = f'Found {exact_matches} reference(s) to @{handle}'
        else:
            result['is_valid'] = False
            result['confidence'] = 0.2
            result['reason'] = f'No clear references found for @{handle}'
            
    except Exception as e:
        result['error'] = str(e)
        result['reason'] = f'Search failed: {e}'
    
    return result


def search_news(queries: List[str], max_per_query: int = 50) -> List[Dict]:
    """
    Search for news articles about the brand/topic
    Returns structured news results
    """
    all_results = []
    seen_urls = set()
    
    ddgs = DDGS()
    
    for query in queries:
        try:
            print(f"[DDG] News search: {query}", file=sys.stderr)
            results = list(ddgs.news(query, max_results=max_per_query))
            
            for r in results:
                url = r.get('url', '')
                if url and url not in seen_urls:
                    all_results.append({
                        'query': query,
                        'title': r.get('title', ''),
                        'body': r.get('body', ''),
                        'url': url,
                        'source': r.get('source', ''),
                        'image_url': r.get('image', ''),
                        'published_at': r.get('date', ''),
                    })
                    seen_urls.add(url)
                    
            print(f"[DDG] News: {len(results)} results, total: {len(all_results)}", file=sys.stderr)
            
        except Exception as e:
            print(f"[DDG] News query failed: {query} - {e}", file=sys.stderr)
            continue
    
    return all_results


def search_videos(queries: List[str], max_per_query: int = 30) -> List[Dict]:
    """
    Search for videos about the brand/topic
    Returns structured video results (YouTube, etc.)
    """
    all_results = []
    seen_urls = set()
    
    ddgs = DDGS()
    
    for query in queries:
        try:
            print(f"[DDG] Video search: {query}", file=sys.stderr)
            results = list(ddgs.videos(query, max_results=max_per_query))
            
            for r in results:
                url = r.get('content', '')
                if url and url not in seen_urls:
                    stats = r.get('statistics', {})
                    images = r.get('images', {})
                    all_results.append({
                        'query': query,
                        'title': r.get('title', ''),
                        'description': r.get('description', ''),
                        'url': url,
                        'embed_url': r.get('embed_url', ''),
                        'duration': r.get('duration', ''),
                        'publisher': r.get('publisher', ''),
                        'uploader': r.get('uploader', ''),
                        'view_count': stats.get('viewCount'),
                        'thumbnail_url': images.get('medium', ''),
                        'published_at': r.get('published', ''),
                    })
                    seen_urls.add(url)
                    
            print(f"[DDG] Videos: {len(results)} results, total: {len(all_results)}", file=sys.stderr)
            
        except Exception as e:
            print(f"[DDG] Video query failed: {query} - {e}", file=sys.stderr)
            continue
    
    return all_results


def search_images(queries: List[str], max_per_query: int = 50) -> List[Dict]:
    """
    Search for images related to the brand/topic
    Returns structured image results
    """
    all_results = []
    seen_urls = set()
    
    ddgs = DDGS()
    
    for query in queries:
        try:
            print(f"[DDG] Image search: {query}", file=sys.stderr)
            results = list(ddgs.images(query, max_results=max_per_query))
            
            for r in results:
                image_url = r.get('image', '')
                if image_url and image_url not in seen_urls:
                    all_results.append({
                        'query': query,
                        'title': r.get('title', ''),
                        'image_url': image_url,
                        'thumbnail_url': r.get('thumbnail', ''),
                        'source_url': r.get('url', ''),
                        'width': r.get('width'),
                        'height': r.get('height'),
                    })
                    seen_urls.add(image_url)
                    
            print(f"[DDG] Images: {len(results)} results, total: {len(all_results)}", file=sys.stderr)
            
        except Exception as e:
            print(f"[DDG] Image query failed: {query} - {e}", file=sys.stderr)
            continue
    
    return all_results


def gather_all(brand_name: str, niche: str = 'business') -> Dict:
    """
    COMPREHENSIVE: Gather ALL possible data for a brand
    Runs text and news searches with multiple queries
    
    NOTE: Image and video searches DISABLED - media should only come from
    site-limited social scraping (scrape_social_content) to avoid unrelated content.
    """
    queries_text = [
        f'"{brand_name}"',
        f'{brand_name} instagram',
        f'{brand_name} website',
        f'{brand_name} about',
        f'{brand_name} founder',
    ]
    
    queries_niche = [
        f'{niche} instagram influencers',
        f'{niche} top accounts',
        f'best {niche} creators',
    ]
    
    queries_news = [
        f'{brand_name}',
        f'{brand_name} {niche}',
    ]
    
    # DISABLED: Generic video/image searches bring unrelated content
    # Media should ONLY come from scrape_social_content() which uses site-limited search
    # queries_videos = [f'{brand_name}', f'{niche} tips']
    # queries_images = [f'{brand_name} instagram', f'{brand_name} logo']
    
    result = {
        'brand_name': brand_name,
        'niche': niche,
        'text_results': raw_search(queries_text + queries_niche, max_per_query=50),
        'news_results': search_news(queries_news, max_per_query=30),
        'video_results': [],  # DISABLED - use scrape_social_content instead
        'image_results': [],  # DISABLED - use scrape_social_content instead
    }
    
    result['totals'] = {
        'text': len(result['text_results']),
        'news': len(result['news_results']),
        'videos': 0,  # Disabled
        'images': 0,  # Disabled
        'total': len(result['text_results']) + len(result['news_results']),
    }
    
    return result


def search_social_profiles(brand_name: str, max_per_query: int = 30) -> Dict:
    """
    Site-limited search for social media profiles.
    Uses site: operator to find profiles on specific platforms.
    Returns structured results with extracted handles/URLs.
    """
    results = {
        'brand_name': brand_name,
        'instagram': [],
        'tiktok': [],
        'youtube': [],
        'twitter': [],
        'linkedin': [],
        'facebook': [],
        'raw_results': []
    }
    
    # Site-limited queries for each platform
    platform_queries = {
        'instagram': [
            f'site:instagram.com "{brand_name}"',
            f'site:instagram.com @{brand_name}',
        ],
        'tiktok': [
            f'site:tiktok.com "{brand_name}"',
            f'site:tiktok.com @{brand_name}',
        ],
        'youtube': [
            f'site:youtube.com/channel "{brand_name}"',
            f'site:youtube.com/c "{brand_name}"',
            f'site:youtube.com/@{brand_name}',
        ],
        'twitter': [
            f'site:twitter.com "{brand_name}"',
            f'site:x.com "{brand_name}"',
        ],
        'linkedin': [
            f'site:linkedin.com/company "{brand_name}"',
            f'site:linkedin.com/in "{brand_name}"',
        ],
        'facebook': [
            f'site:facebook.com "{brand_name}"',
        ],
    }
    
    ddgs = DDGS()
    seen_urls = set()
    
    for platform, queries in platform_queries.items():
        handles = set()
        
        for query in queries:
            try:
                print(f"[DDG] Social search ({platform}): {query}", file=sys.stderr)
                search_results = list(ddgs.text(query, max_results=max_per_query))
                
                for r in search_results:
                    href = r.get('href', '')
                    
                    if href and href not in seen_urls:
                        seen_urls.add(href)
                        results['raw_results'].append({
                            'query': query,
                            'platform': platform,
                            'title': r.get('title', ''),
                            'href': href,
                            'body': r.get('body', ''),
                        })
                    
                    # Extract handles based on platform
                    if platform == 'instagram' and 'instagram.com/' in href:
                        match = re.search(r'instagram\.com/([a-zA-Z0-9_.]+)', href)
                        if match:
                            h = match.group(1)
                            if h not in ['p', 'explore', 'reel', 'stories', 'reels', 'tv', 'accounts']:
                                handles.add(h)
                                
                    elif platform == 'tiktok' and 'tiktok.com/@' in href:
                        match = re.search(r'tiktok\.com/@([a-zA-Z0-9_.]+)', href)
                        if match:
                            handles.add(match.group(1))
                            
                    elif platform == 'youtube':
                        # Handle multiple URL formats
                        for pattern in [r'youtube\.com/@([a-zA-Z0-9_-]+)', r'youtube\.com/c/([a-zA-Z0-9_-]+)', r'youtube\.com/channel/([a-zA-Z0-9_-]+)']:
                            match = re.search(pattern, href)
                            if match:
                                handles.add(match.group(1))
                                break
                                
                    elif platform == 'twitter':
                        match = re.search(r'(?:twitter|x)\.com/([a-zA-Z0-9_]+)', href)
                        if match:
                            h = match.group(1)
                            if h not in ['search', 'hashtag', 'i', 'intent', 'compose']:
                                handles.add(h)
                                
                    elif platform == 'linkedin' and 'linkedin.com/' in href:
                        match = re.search(r'linkedin\.com/(?:company|in)/([a-zA-Z0-9_-]+)', href)
                        if match:
                            handles.add(match.group(1))
                            
                    elif platform == 'facebook' and 'facebook.com/' in href:
                        match = re.search(r'facebook\.com/([a-zA-Z0-9_.]+)', href)
                        if match:
                            h = match.group(1)
                            if h not in ['pages', 'groups', 'events', 'watch', 'marketplace', 'gaming']:
                                handles.add(h)
                
            except Exception as e:
                print(f"[DDG] Social search error ({platform}): {e}", file=sys.stderr)
                continue
        
        results[platform] = list(handles)
        print(f"[DDG] Found {len(handles)} {platform} handles", file=sys.stderr)
    
    results['totals'] = {
        platform: len(results[platform]) 
        for platform in ['instagram', 'tiktok', 'youtube', 'twitter', 'linkedin', 'facebook']
    }
    results['totals']['total'] = sum(results['totals'].values())
    results['totals']['raw'] = len(results['raw_results'])
    
    return results


def scrape_social_content(handles: Dict[str, str], max_items: int = 30) -> Dict:
    """
    Scrape images and videos for given social handles using site-limited search.
    This is a workaround for direct API access when rate-limited.
    
    Args:
        handles: Dict mapping platform to handle, e.g., {'instagram': 'ummahpreneur', 'tiktok': 'ummahpreneur'}
        max_items: Max images/videos to retrieve per platform
    
    Returns:
        Dict with images, videos, and captions extracted from search results
    """
    result = {
        'handles': handles,
        'images': [],
        'videos': [],
        'posts': [],  # Extracted post info from snippets
        'platforms_searched': [],
        'totals': {}
    }
    
    ddgs = DDGS()
    seen_images = set()
    seen_videos = set()
    
    for platform, handle in handles.items():
        if not handle:
            continue
            
        result['platforms_searched'].append(platform)
        print(f"[DDG] Scraping {platform} content for @{handle}...", file=sys.stderr)
        
        # Build platform-specific queries
        # Custom limits as requested
        limit_images = 20
        limit_videos = 10
        
        # Build platform-specific queries
        if platform == 'instagram':
            # User requested: site:instagram.com "{handler}" images
            # We strip "images" from the query passed to ddgs.images() because implied, 
            # but we keep the site and handle strictness.
            queries_images = [
                f'site:instagram.com "{handle}"',
                f'site:instagram.com @{handle}',
            ]
            queries_videos = [
                f'site:instagram.com "{handle}"', # General video search
                f'site:instagram.com/reel "{handle}"',
            ]
        elif platform == 'tiktok':
            queries_images = [
                f'site:tiktok.com "@{handle}"',
            ]
            # User requested: matching behavior for tiktok
            queries_videos = [
                f'site:tiktok.com "@{handle}"',
                f'tiktok.com/@{handle}',
            ]
        elif platform == 'youtube':
            queries_images = [f'site:youtube.com "{handle}"']
            queries_videos = [f'site:youtube.com "@{handle}"']
        else:
            continue
        
        # Search images (Limit 20)
        for query in queries_images:
            try:
                print(f"[DDG] Image search: {query}", file=sys.stderr)
                images = list(ddgs.images(query, max_results=limit_images))
                
                for img in images:
                    image_url = img.get('image', '')
                    source_url = img.get('url', '')
                    
                    if len([i for i in result['images'] if i['platform'] == platform]) >= limit_images:
                        break
                        
                    # Filter for platform relevance
                    if platform in source_url.lower() and image_url not in seen_images:
                        seen_images.add(image_url)
                        result['images'].append({
                            'platform': platform,
                            'handle': handle,
                            'image_url': image_url,
                            'thumbnail_url': img.get('thumbnail', ''),
                            'source_url': source_url,
                            'title': img.get('title', ''),
                            'width': img.get('width'),
                            'height': img.get('height'),
                        })
                        
                        # Try to extract caption/post info from title
                        title = img.get('title', '')
                        if title:
                            result['posts'].append({
                                'platform': platform,
                                'handle': handle,
                                'caption_snippet': title,
                                'source_url': source_url,
                                'has_media': True,
                            })
                            
                            # Parse Profile Stats from typical title/snippet format
                            # E.g. "Name (@handle) • Instagram photos and videos" - usually no stats here
                            # But sometimes snippet has it. DDG Image search result doesn't always have 'body'.
                            # Let's rely on the body check if available or title if it contains stats.
                            
                            # Regex for generic follower counts
                            # "20K Followers, 500 Following"
                            follower_match = re.search(r'([\d.,]+[KkMmBb]?)\s+Followers', title, re.IGNORECASE)
                            following_match = re.search(r'([\d.,]+[KkMmBb]?)\s+Following', title, re.IGNORECASE)
                            
                            if follower_match or following_match:
                                if 'profile_stats' not in result: result['profile_stats'] = {}
                                if platform not in result['profile_stats']: result['profile_stats'][platform] = {}
                                
                                if follower_match:
                                     result['profile_stats'][platform]['followers'] = parse_count(follower_match.group(1))
                                if following_match:
                                     result['profile_stats'][platform]['following'] = parse_count(following_match.group(1))
                            
            except Exception as e:
                print(f"[DDG] Image search error: {e}", file=sys.stderr)
                continue
        
        # Search videos (Limit 10)
        for query in queries_videos:
            try:
                print(f"[DDG] Video search: {query}", file=sys.stderr)
                videos = list(ddgs.videos(query, max_results=limit_videos))
                
                for vid in videos:
                    if len([v for v in result['videos'] if v['platform'] == platform]) >= limit_videos:
                        break
                        
                    video_url = vid.get('content', '')
                    
                    if video_url and video_url not in seen_videos:
                        is_relevant = (
                            platform in video_url.lower() or
                            handle.lower() in vid.get('title', '').lower()
                        )
                        
                        if is_relevant:
                            seen_videos.add(video_url)
                            images_obj = vid.get('images', {})
                            result['videos'].append({
                                'platform': platform,
                                'handle': handle,
                                'video_url': video_url,
                                'embed_url': vid.get('embed_url', ''),
                                'thumbnail_url': images_obj.get('medium', '') if isinstance(images_obj, dict) else '',
                                'title': vid.get('title', ''),
                                'description': vid.get('description', ''),
                                'duration': vid.get('duration', ''),
                                'publisher': vid.get('publisher', ''),
                            })
                            
                            desc = vid.get('description', '')
                            if desc:
                                result['posts'].append({
                                    'platform': platform,
                                    'handle': handle,
                                    'caption_snippet': desc[:500],
                                    'source_url': video_url,
                                    'has_media': True,
                                    'is_video': True,
                                })
                                
            except Exception as e:
                print(f"[DDG] Video search error: {e}", file=sys.stderr)
                continue

        print(f"[DDG] {platform}: {len([i for i in result['images'] if i['platform'] == platform])} images, "
              f"{len([v for v in result['videos'] if v['platform'] == platform])} videos", file=sys.stderr)
    
    result['totals'] = {
        'images': len(result['images']),
        'videos': len(result['videos']),
        'posts': len(result['posts']),
        'platforms': len(result['platforms_searched']),
    }
    
    return result

def parse_count(count_str: str) -> int:
    """Helper to parse counts like '1.2K', '1M', '10,500'"""
    if not count_str:
        return 0
    
    s = count_str.upper().replace(',', '').strip()
    multiplier = 1
    
    if 'K' in s:
        multiplier = 1000
        s = s.replace('K', '')
    elif 'M' in s:
        multiplier = 1000000
        s = s.replace('M', '')
    elif 'B' in s:
        multiplier = 1000000000
        s = s.replace('B', '')
        
    try:
        return int(float(s) * multiplier)
    except:
        return 0

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({
            'error': 'Usage: python3 ddg_search.py <action> <args...>',
            'actions': [
                'brand_context <brand_name>',
                'competitors <handle> <niche> [max_results]',
                'validate <handle> [platform]',
                'news <query1> [query2] ...',
                'videos <query1> [query2] ...',
                'images <query1> [query2] ...',
                'gather_all <brand_name> [niche]',
                'social_search <brand_name>',
                'raw <query1> [query2] ...'
            ]
        }))
        sys.exit(1)
    
    action = sys.argv[1]
    
    if action == 'brand_context':
        brand_name = sys.argv[2]
        result = search_brand_context(brand_name)
        print(json.dumps(result, indent=2))
        
    elif action == 'competitors':
        handle = sys.argv[2]
        niche = sys.argv[3] if len(sys.argv) > 3 else 'business'
        max_results = int(sys.argv[4]) if len(sys.argv) > 4 else 100
        result = search_competitors(handle, niche, max_results)
        print(json.dumps(result, indent=2))
        
    elif action == 'validate':
        handle = sys.argv[2]
        platform = sys.argv[3] if len(sys.argv) > 3 else 'instagram'
        result = validate_handle(handle, platform)
        print(json.dumps(result, indent=2))
        
    elif action == 'news':
        queries = sys.argv[2:]
        result = search_news(queries)
        print(json.dumps({'news': result, 'total': len(result)}, indent=2))
        
    elif action == 'videos':
        queries = sys.argv[2:]
        result = search_videos(queries)
        print(json.dumps({'videos': result, 'total': len(result)}, indent=2))
        
    elif action == 'images':
        queries = sys.argv[2:]
        result = search_images(queries)
        print(json.dumps({'images': result, 'total': len(result)}, indent=2))
        
    elif action == 'gather_all':
        brand_name = sys.argv[2]
        niche = sys.argv[3] if len(sys.argv) > 3 else 'business'
        result = gather_all(brand_name, niche)
        print(json.dumps(result, indent=2))
        
    elif action == 'raw':
        queries = sys.argv[2:]
        result = raw_search(queries)
        print(json.dumps({'results': result, 'total': len(result)}, indent=2))
        
    elif action == 'social_search':
        brand_name = sys.argv[2]
        result = search_social_profiles(brand_name)
        print(json.dumps(result, indent=2))
        
    elif action == 'scrape_content':
        # Usage: scrape_content instagram:handle tiktok:handle [max_items]
        # Example: scrape_content instagram:ummahpreneur tiktok:ummahpreneur 30
        handles = {}
        max_items = 30
        for arg in sys.argv[2:]:
            if ':' in arg:
                platform, handle = arg.split(':', 1)
                handles[platform.lower()] = handle
            else:
                try:
                    max_items = int(arg)
                except:
                    pass
        result = scrape_social_content(handles, max_items)
        print(json.dumps(result, indent=2))
        
    else:
        print(json.dumps({'error': f'Unknown action: {action}'}))
        sys.exit(1)

