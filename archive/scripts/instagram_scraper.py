#!/usr/bin/env python3
"""
Instagram Scraper for n8n Workflow
Uses Instaloader (free, open-source) - NO API COSTS!

Usage: python instagram_scraper.py <username> [--posts 12] [--output cache/]
"""

import instaloader
import json
import os
import sys
import argparse
from datetime import datetime
from pathlib import Path


def scrape_instagram_profile(username: str, max_posts: int = 12, output_dir: str = "cache") -> dict:
    """
    Scrape Instagram profile and posts using Instaloader (FREE).
    
    Args:
        username: Instagram username (without @)
        max_posts: Maximum number of posts to fetch
        output_dir: Directory to save cached data
    
    Returns:
        dict with profile and posts data
    """
    L = instaloader.Instaloader(
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        post_metadata_txt_pattern=""
    )
    
    try:
        # Get profile
        profile = instaloader.Profile.from_username(L.context, username)
        
        # Collect profile data
        profile_data = {
            "username": profile.username,
            "full_name": profile.full_name,
            "biography": profile.biography,
            "followers": profile.followers,
            "following": profile.followees,
            "post_count": profile.mediacount,
            "is_verified": profile.is_verified,
            "is_business": profile.is_business_account,
            "external_url": profile.external_url,
            "profile_pic_url": profile.profile_pic_url,
        }
        
        # Collect posts
        posts = []
        for i, post in enumerate(profile.get_posts()):
            if i >= max_posts:
                break
            
            # Determine post type
            if post.is_video:
                post_type = "video"
            elif post.typename == "GraphSidecar":
                post_type = "carousel"
            else:
                post_type = "single_image"
            
            # Calculate engagement rate
            engagement_rate = 0
            if profile.followers > 0:
                engagement_rate = round(
                    (post.likes + post.comments) / profile.followers * 100, 2
                )
            
            post_data = {
                "postId": post.shortcode,
                "postType": post_type,
                "caption": post.caption or "",
                "hashtags": list(post.caption_hashtags) if post.caption_hashtags else [],
                "mentions": list(post.caption_mentions) if post.caption_mentions else [],
                "likesCount": post.likes,
                "commentsCount": post.comments,
                "engagementRate": engagement_rate,
                "timestamp": post.date_utc.isoformat(),
                "displayUrl": post.url,
                "videoUrl": post.video_url if post.is_video else None,
                "mediaCount": post.mediacount if hasattr(post, 'mediacount') else 1,
                "isSponsored": post.is_sponsored,
            }
            posts.append(post_data)
        
        # Combine data
        result = {
            "source": "instaloader",
            "scrapedAt": datetime.utcnow().isoformat(),
            "username": username,
            "profile": profile_data,
            "posts": posts,
            "totalPosts": len(posts)
        }
        
        # Save to cache
        cache_path = Path(output_dir)
        cache_path.mkdir(parents=True, exist_ok=True)
        
        cache_file = cache_path / f"{username}_cache.json"
        with open(cache_file, "w") as f:
            json.dump(result, f, indent=2, default=str)
        
        print(f"✅ Scraped {len(posts)} posts from @{username}", file=sys.stderr)
        print(f"📁 Cached to {cache_file}", file=sys.stderr)
        
        return result
        
    except instaloader.exceptions.ProfileNotExistsException:
        print(f"❌ Profile @{username} not found", file=sys.stderr)
        return {"error": f"Profile @{username} not found"}
    except instaloader.exceptions.ConnectionException as e:
        print(f"❌ Connection error: {e}", file=sys.stderr)
        return {"error": str(e)}
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        return {"error": str(e)}


def scrape_multiple_profiles(usernames: list, max_posts: int = 12, output_dir: str = "cache") -> dict:
    """Scrape multiple profiles and combine results."""
    all_results = {
        "clientPosts": [],
        "competitorPosts": [],
        "profiles": {},
        "scrapedAt": datetime.utcnow().isoformat()
    }
    
    for i, username in enumerate(usernames):
        result = scrape_instagram_profile(username, max_posts, output_dir)
        
        if "error" not in result:
            all_results["profiles"][username] = result["profile"]
            
            # First username is client, rest are competitors
            source = "client" if i == 0 else "competitor"
            for post in result["posts"]:
                post["source"] = source
                post["username"] = username
                
                if source == "client":
                    all_results["clientPosts"].append(post)
                else:
                    all_results["competitorPosts"].append(post)
    
    # Sort competitors by engagement
    all_results["competitorPosts"].sort(
        key=lambda x: x.get("engagementRate", 0), 
        reverse=True
    )
    
    # Save combined cache
    cache_path = Path(output_dir)
    combined_file = cache_path / "combined_cache.json"
    with open(combined_file, "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    
    return all_results


def main():
    parser = argparse.ArgumentParser(description="Instagram Scraper (FREE - uses Instaloader)")
    parser.add_argument("usernames", nargs="+", help="Instagram usernames to scrape")
    parser.add_argument("--posts", type=int, default=12, help="Max posts per account (default: 12)")
    parser.add_argument("--output", type=str, default="cache", help="Output directory for cache")
    
    args = parser.parse_args()
    
    if len(args.usernames) == 1:
        result = scrape_instagram_profile(args.usernames[0], args.posts, args.output)
    else:
        result = scrape_multiple_profiles(args.usernames, args.posts, args.output)
    
    # Output JSON to stdout for n8n
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
