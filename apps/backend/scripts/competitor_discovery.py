#!/usr/bin/env python3
"""
Competitor Discovery Script
Uses AI + web search to find relevant competitors

Methods:
1. Google Search for similar accounts
2. OpenAI to filter and rank by relevance
3. Returns structured JSON
"""

import json
import sys
import os
from typing import List, Dict
import openai

# Setup OpenAI
openai.api_key = os.getenv('OPENAI_API_KEY')

def discover_competitors(
    client_handle: str,
    client_bio: str,
    client_niche: str,
    platform: str = 'instagram',
    count: int = 10
) -> List[Dict]:
    """
    Discover competitors using AI analysis
    
    For now: Pure AI-based discovery (no web scraping)
    Future: Add SerpAPI/Google Search integration
    """
    
    prompt = f"""You are an expert social media strategist. Find {count} competitor accounts for this client.

Client Information:
- Handle: @{client_handle}
- Platform: {platform.title()}
- Bio: {client_bio}
- Niche: {client_niche}

Task:
Find {count} REAL {platform.title()} accounts that are:
1. In the same niche as the client
2. Have similar or larger audience size
3. Create similar content
4. Are active (post regularly)
5. Are direct or indirect competitors

IMPORTANT: 
- Return REAL accounts that actually exist
- Use specific, well-known accounts in this niche
- Include a mix of:
  * Direct competitors (exact same niche)
  * Indirect competitors (adjacent niche)
  * Aspirational accounts (larger, client wants to emulate)

Return JSON array:
[
  {{
    "handle": "account_name",
    "platform": "{platform}",
    "discovery_reason": "Why this is a relevant competitor",
    "relevance_score": 0.0-1.0,
    "competitor_type": "direct/indirect/aspirational"
  }}
]

Return ONLY valid JSON, no other text."""

    try:
        client = openai.OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
        
        response = client.chat.completions.create(
            model='gpt-4o',
            messages=[{'role': 'user', 'content': prompt}],
            response_format={'type': 'json_object'},
            temperature=0.7,
        )
        
        content = response.choices[0].message.content
        if not content:
            print("[CompetitorDiscovery] Empty response from OpenAI", file=sys.stderr)
            return []
            
        result = json.loads(content)
        
        # Extract array from result (handle different response formats)
        competitors = []
        if 'competitors' in result:
            competitors = result['competitors']
        elif isinstance(result, list):
            competitors = result
        else:
            # Try to find the first array in the response
            for value in result.values():
                if isinstance(value, list):
                    competitors = value
                    break
        
        print(f"[CompetitorDiscovery] Found {len(competitors)} competitors", file=sys.stderr)
        
        return competitors[:count]  # Limit to requested count
        
    except Exception as e:
        print(f"[CompetitorDiscovery] Error: {str(e)}", file=sys.stderr)
        return []


def discover_with_web_search(client_handle: str, client_niche: str, count: int = 10):
    """
    TODO: Implement web search using SerpAPI
    
    Queries:
    - "{client_niche} instagram accounts"
    - "best {client_niche} influencers"
    - "top {client_niche} creators"
    
    Then use AI to filter and rank results
    """
    pass


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(json.dumps({
            'error': 'Usage: python3 competitor_discovery.py <handle> <bio> <niche> [count] [platform]'
        }))
        sys.exit(1)
    
    handle = sys.argv[1].replace('@', '')
    bio = sys.argv[2]
    niche = sys.argv[3]
    count = int(sys.argv[4]) if len(sys.argv) > 4 else 10
    platform = sys.argv[5] if len(sys.argv) > 5 else 'instagram'
    
    try:
        competitors = discover_competitors(handle, bio, niche, platform, count)
        print(json.dumps({'competitors': competitors}, indent=2))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stdout)
        sys.exit(1)
