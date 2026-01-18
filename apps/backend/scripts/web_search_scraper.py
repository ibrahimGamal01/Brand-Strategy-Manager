#!/usr/bin/env python3
"""
Web Search Scraper for Brand Mentions
Searches Google for brand mentions, reviews, articles, etc.

For MVP: Uses basic web scraping
Future: Integrate SerpAPI for better results
"""

import json
import sys
import requests
from bs4 import BeautifulSoup
from typing import List, Dict
from urllib.parse import quote_plus
import time
import random

def generate_search_queries(brand_name: str, keywords: List[str] = None) -> List[str]:
    """Generate search queries for brand research"""
    
    base_queries = [
        f'"{brand_name}" review',
        f'"{brand_name}" about',
        f'{brand_name} social media',
        f'{brand_name} instagram',
        f'{brand_name} customers',
    ]
    
    if keywords:
        for keyword in keywords:
            base_queries.append(f'"{brand_name}" {keyword}')
    
    return base_queries


def google_search(query: str, max_results: int = 10) -> List[Dict]:
    """
    Perform Google search and extract results
    
    Note: This is a basic implementation. For production, use SerpAPI.
    """
    
    results = []
    
    try:
        # Google search URL
        url = f"https://www.google.com/search?q={quote_plus(query)}&num={max_results}"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Extract search results
        for g in soup.find_all('div', class_='g'):
            try:
                # Extract link
                link_tag = g.find('a')
                if not link_tag:
                    continue
                link = link_tag.get('href', '')
                
                # Extract title
                title_tag = g.find('h3')
                title = title_tag.text if title_tag else ''
                
                # Extract snippet
                snippet_tag = g.find('div', class_='VwiC3b')
                snippet = snippet_tag.text if snippet_tag else ''
                
                if link and title:
                    results.append({
                        'url': link,
                        'title': title,
                        'snippet': snippet,
                    })
                    
            except Exception as e:
                continue
        
        print(f"[WebSearch] Found {len(results)} results for: {query}", file=sys.stderr)
        
    except Exception as e:
        print(f"[WebSearch] Error searching: {str(e)}", file=sys.stderr)
    
    return results


def scrape_page_content(url: str) -> str:
    """
    Scrape full text content from a webpage
    """
    
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Remove script and style elements
        for script in soup(["script", "style", "nav", "footer", "header"]):
            script.decompose()
        
        # Get text
        text = soup.get_text(separator=' ', strip=True)
        
        # Clean up whitespace
        text = ' '.join(text.split())
        
        # Limit length (first 5000 chars)
        return text[:5000]
        
    except Exception as e:
        print(f"[WebSearch] Error scraping {url}: {str(e)}", file=sys.stderr)
        return ''


def classify_source(url: str) -> str:
    """Classify the source type based on URL"""
    
    url_lower = url.lower()
    
    if any(x in url_lower for x in ['instagram.com', 'facebook.com', 'twitter.com', 'tiktok.com']):
        return 'social'
    elif any(x in url_lower for x in ['reddit.com', 'quora.com', 'forum']):
        return 'forum'
    elif any(x in url_lower for x in ['review', 'rating', 'yelp', 'trustpilot']):
        return 'review'
    elif any(x in url_lower for x in ['blog', 'article', 'news', 'medium.com']):
        return 'article'
    else:
        return 'other'


def scrape_brand_mentions(
    brand_name: str,
    keywords: List[str] = None,
    max_results_per_query: int = 5
) -> List[Dict]:
    """
    Scrape brand mentions from web search results
    """
    
    queries = generate_search_queries(brand_name, keywords)
    all_mentions = []
    
    for query in queries:
        print(f"[WebSearch] Searching: {query}", file=sys.stderr)
        
        # Search Google
        results = google_search(query, max_results=max_results_per_query)
        
        for result in results:
            # Scrape full page content
            full_text = scrape_page_content(result['url'])
            
            mention = {
                'url': result['url'],
                'title': result['title'],
                'snippet': result['snippet'],
                'full_text': full_text,
                'source_type': classify_source(result['url']),
                'search_query': query,
            }
            
            all_mentions.append(mention)
        
        # Respectful delay between searches
        time.sleep(random.uniform(2, 4))
    
    print(f"[WebSearch] Total mentions found: {len(all_mentions)}", file=sys.stderr)
    
    return all_mentions


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({
            'error': 'Usage: python3 web_search_scraper.py <brand_name> [keyword1,keyword2,...]'
        }))
        sys.exit(1)
    
    brand_name = sys.argv[1]
    keywords = sys.argv[2].split(',') if len(sys.argv) > 2 else None
    
    try:
        mentions = scrape_brand_mentions(brand_name, keywords)
        print(json.dumps({'mentions': mentions}, indent=2))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stdout)
        sys.exit(1)
