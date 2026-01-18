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
    Runs text, news, videos, images searches with multiple queries
    Returns everything for DB storage
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
    
    queries_videos = [
        f'{brand_name}',
        f'{niche} tips',
    ]
    
    queries_images = [
        f'{brand_name} instagram',
        f'{brand_name} logo',
    ]
    
    result = {
        'brand_name': brand_name,
        'niche': niche,
        'text_results': raw_search(queries_text + queries_niche, max_per_query=50),
        'news_results': search_news(queries_news, max_per_query=30),
        'video_results': search_videos(queries_videos, max_per_query=20),
        'image_results': search_images(queries_images, max_per_query=30),
    }
    
    result['totals'] = {
        'text': len(result['text_results']),
        'news': len(result['news_results']),
        'videos': len(result['video_results']),
        'images': len(result['image_results']),
        'total': sum([
            len(result['text_results']),
            len(result['news_results']),
            len(result['video_results']),
            len(result['image_results']),
        ])
    }
    
    return result


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
        
    else:
        print(json.dumps({'error': f'Unknown action: {action}'}))
        sys.exit(1)

