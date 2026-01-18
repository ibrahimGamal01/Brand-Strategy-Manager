#!/usr/bin/env python3
"""
Google Trends fetcher using pytrends.
Returns Interest Over Time and Related Queries for given keywords.

Usage: python3 google_trends.py <action> <keywords...>
Actions: interest_over_time, related_queries

Examples:
  python3 google_trends.py interest_over_time "vegan leather" "sustainable fashion"
  python3 google_trends.py related_queries "vegan leather"
"""

import sys
import json
import time
import random
from pytrends.request import TrendReq

def get_interest_over_time(pytrends, keywords):
    """Fetch interest over time for up to 5 keywords."""
    try:
        pytrends.build_payload(keywords, cat=0, timeframe='today 12-m', geo='US', gprop='')
        df = pytrends.interest_over_time()
        
        if df.empty:
            return {"error": "No data returned"}
            
        # Convert date index to string
        if 'isPartial' in df.columns:
            df = df.drop(columns=['isPartial'])
            
        result = json.loads(df.to_json(orient='index', date_format='iso'))
        return result
        
    except Exception as e:
        return {"error": str(e)}

def get_related_queries(pytrends, keywords):
    """Fetch related queries (rising and top)."""
    try:
        pytrends.build_payload(keywords, cat=0, timeframe='today 12-m', geo='US', gprop='')
        related = pytrends.related_queries()
        
        cleaned_result = {}
        for kw, data in related.items():
            cleaned_result[kw] = {}
            if data['top'] is not None:
                cleaned_result[kw]['top'] = json.loads(data['top'].to_json(orient='records'))
            if data['rising'] is not None:
                cleaned_result[kw]['rising'] = json.loads(data['rising'].to_json(orient='records'))
                
        return cleaned_result
        
    except Exception as e:
        return {"error": str(e)}

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: google_trends.py <action> <keywords...>"}))
        sys.exit(1)

    action = sys.argv[1]
    keywords = sys.argv[2:]
    
    # Cap keywords at 5 (Google limitation)
    if len(keywords) > 5:
        keywords = keywords[:5]

    # Initialize pytrends with some backoff/proxy logic potential here
    # For now, standard initialization
    try:
        pytrends = TrendReq(hl='en-US', tz=360, timeout=(10,25))
    except Exception as e:
        print(json.dumps({"error": f"Failed to init pytrends: {str(e)}"}))
        sys.exit(1)

    # Random delay to be nice
    time.sleep(random.uniform(0.5, 1.5))

    result = {}
    if action == 'interest_over_time':
        result = get_interest_over_time(pytrends, keywords)
    elif action == 'related_queries':
        result = get_related_queries(pytrends, keywords)
    else:
        result = {"error": f"Unknown action: {action}"}

    print(json.dumps(result))

if __name__ == "__main__":
    main()
