#!/usr/bin/env python3
"""
Google Trends fetcher using pytrends with improved accuracy.
Returns Interest Over Time, Related Queries, and Related Topics.

Usage: python3 google_trends.py <action> [--region=XX] <keywords...>
Actions: interest_over_time, related_queries, comprehensive

Options:
  --region=XX   Two-letter country code (US, GB, etc.) or empty for worldwide

Examples:
  python3 google_trends.py interest_over_time "vegan leather" "sustainable fashion"
  python3 google_trends.py comprehensive --region=GB "halal business"
"""

import sys
import json
import time
import random
import sys
import json
import time
import random
from pytrends.request import TrendReq

MAX_RETRIES = 5
RETRY_DELAY = 10  # seconds base delay for exponential backoff


def get_interest_over_time(pytrends, keywords, region='', timeframe='today 12-m'):
    """Fetch interest over time for up to 5 keywords."""
    for attempt in range(MAX_RETRIES):
        try:
            pytrends.build_payload(keywords, cat=0, timeframe=timeframe, geo=region, gprop='')
            df = pytrends.interest_over_time()
            
            if df.empty:
                return {"error": "No data returned", "keywords": keywords, "region": region}
                
            # Convert date index to string
            if 'isPartial' in df.columns:
                df = df.drop(columns=['isPartial'])
                
            result = json.loads(df.to_json(orient='index', date_format='iso'))
            return {"data": result, "keywords": keywords, "region": region or "worldwide"}
            
        except Exception as e:
            error_str = str(e)
            if 'Too Many Requests' in error_str or '429' in error_str:
                if attempt < MAX_RETRIES - 1:
                    # Exponential backoff with jitter: base * 2^attempt + random(0-3s)
                    wait = RETRY_DELAY * (2 ** attempt) + random.uniform(0, 3)
                    print(f"[GoogleTrends] Rate limited, waiting {wait:.1f}s (attempt {attempt+1}/{MAX_RETRIES})", file=sys.stderr)
                    time.sleep(wait)
                    continue
            return {"error": error_str}
    return {"error": "Max retries exceeded"}


def get_related_queries(pytrends, keywords, region='', timeframe='today 12-m'):
    """Fetch related queries (rising and top)."""
    for attempt in range(MAX_RETRIES):
        try:
            pytrends.build_payload(keywords, cat=0, timeframe=timeframe, geo=region, gprop='')
            related = pytrends.related_queries()
            
            cleaned_result = {}
            for kw, data in related.items():
                cleaned_result[kw] = {}
                if data.get('top') is not None:
                    cleaned_result[kw]['top'] = json.loads(data['top'].to_json(orient='records'))
                if data.get('rising') is not None:
                    cleaned_result[kw]['rising'] = json.loads(data['rising'].to_json(orient='records'))
                    
            return {"data": cleaned_result, "keywords": keywords, "region": region or "worldwide"}
            
        except Exception as e:
            error_str = str(e)
            if 'Too Many Requests' in error_str or '429' in error_str:
                if attempt < MAX_RETRIES - 1:
                    # Exponential backoff with jitter
                    wait = RETRY_DELAY * (2 ** attempt) + random.uniform(0, 3)
                    print(f"[GoogleTrends] Rate limited, waiting {wait:.1f}s", file=sys.stderr)
                    time.sleep(wait)
                    continue
            return {"error": error_str}
    return {"error": "Max retries exceeded"}


def get_related_topics(pytrends, keywords, region='', timeframe='today 12-m'):
    """Fetch related topics (rising and top)."""
    for attempt in range(MAX_RETRIES):
        try:
            pytrends.build_payload(keywords, cat=0, timeframe=timeframe, geo=region, gprop='')
            topics = pytrends.related_topics()
            
            cleaned_result = {}
            for kw, data in topics.items():
                cleaned_result[kw] = {}
                if data.get('top') is not None:
                    cleaned_result[kw]['top'] = json.loads(data['top'].to_json(orient='records'))
                if data.get('rising') is not None:
                    cleaned_result[kw]['rising'] = json.loads(data['rising'].to_json(orient='records'))
                    
            return {"data": cleaned_result, "keywords": keywords, "region": region or "worldwide"}
            
        except Exception as e:
            error_str = str(e)
            if 'Too Many Requests' in error_str or '429' in error_str:
                if attempt < MAX_RETRIES - 1:
                    # Exponential backoff with jitter
                    wait = RETRY_DELAY * (2 ** attempt) + random.uniform(0, 3)
                    time.sleep(wait)
                    continue
            return {"error": error_str}
    return {"error": "Max retries exceeded"}


def comprehensive_trends(pytrends, keywords, region='', timeframe='today 12-m'):
    """Get all trend data in one call (interest, queries, topics)."""
    result = {
        "keywords": keywords,
        "region": region or "worldwide",
        "timeframe": timeframe,
        "interest_over_time": {},
        "related_queries": {},
        "related_topics": {}
    }
    
    # Interest over time
    interest = get_interest_over_time(pytrends, keywords, region, timeframe)
    if "data" in interest:
        result["interest_over_time"] = interest["data"]
    elif "error" in interest:
        result["interest_over_time"] = {"error": interest["error"]}
    
    # Related queries
    time.sleep(random.uniform(3, 7))
    queries = get_related_queries(pytrends, keywords, region, timeframe)
    if "data" in queries:
        result["related_queries"] = queries["data"]
    elif "error" in queries:
        result["related_queries"] = {"error": queries["error"]}
    
    # Related topics
    time.sleep(random.uniform(3, 7))
    topics = get_related_topics(pytrends, keywords, region, timeframe)
    if "data" in topics:
        result["related_topics"] = topics["data"]
    elif "error" in topics:
        result["related_topics"] = {"error": topics["error"]}
    
    return result


def main():
    if len(sys.argv) < 3:
        print(json.dumps({
            "error": "Usage: google_trends.py <action> [--region=XX] <keywords...>",
            "actions": ["interest_over_time", "related_queries", "related_topics", "comprehensive"]
        }))
        sys.exit(1)

    action = sys.argv[1]
    
    # Parse region option and keywords
    region = ''
    keywords = []
    for arg in sys.argv[2:]:
        if arg.startswith('--region='):
            region = arg.split('=')[1].upper()
        else:
            keywords.append(arg)
    
    if not keywords:
        print(json.dumps({"error": "No keywords provided"}))
        sys.exit(1)
    
    # Cap keywords at 5 (Google limitation)
    if len(keywords) > 5:
        keywords = keywords[:5]
        print(f"[GoogleTrends] Warning: Limited to first 5 keywords", file=sys.stderr)

    # Initialize pytrends without internal retry (we handle it manually to avoid urllib3 issues)
    try:
        pytrends = TrendReq(hl='en-US', tz=360, timeout=(10, 30))
    except Exception as e:
        print(json.dumps({"error": f"Failed to init pytrends: {str(e)}"}))
        sys.exit(1)

    # Random delay to avoid rate limiting
    time.sleep(random.uniform(2, 5))

    print(f"[GoogleTrends] Action: {action}, Region: {region or 'worldwide'}, Keywords: {keywords}", file=sys.stderr)

    result = {}
    if action == 'interest_over_time':
        result = get_interest_over_time(pytrends, keywords, region)
    elif action == 'related_queries':
        result = get_related_queries(pytrends, keywords, region)
    elif action == 'related_topics':
        result = get_related_topics(pytrends, keywords, region)
    elif action == 'comprehensive':
        result = comprehensive_trends(pytrends, keywords, region)
    else:
        result = {"error": f"Unknown action: {action}"}

    print(json.dumps(result))


if __name__ == "__main__":
    main()
