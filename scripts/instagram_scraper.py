import sys
import json
import instaloader
from datetime import datetime

def scrape_instagram(handle, max_posts):
    L = instaloader.Instaloader(
        download_pictures=False,
        download_videos=False, 
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False
    )

    try:
        profile = instaloader.Profile.from_username(L.context, handle)
    except instaloader.ProfileNotExistsException:
        print(json.dumps({"error": "Profile does not exist"}))
        return
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return

    posts_data = []
    
    count = 0
    for post in profile.get_posts():
        if count >= int(max_posts):
            break
            
        post_data = {
            "external_post_id": post.shortcode,
            "post_url": f"https://www.instagram.com/p/{post.shortcode}/",
            "caption": post.caption if post.caption else "",
            "likes": post.likes,
            "comments": post.comments,
            "timestamp": post.date_utc.isoformat(),
            "media_url": post.url,
            "is_video": post.is_video,
            "video_url": post.video_url if post.is_video else None,
            "typename": post.typename,
            "owner_username": post.owner_username
        }
        posts_data.append(post_data)
        count += 1

    result = {
        "handle": profile.username,
        "follower_count": profile.followers,
        "following_count": profile.followees,
        "total_posts": profile.mediacount,
        "bio": profile.biography,
        "is_verified": profile.is_verified,
        "posts": posts_data,
        "discovered_competitors": [] # Placeholder for now
    }
    
    print(json.dumps(result))

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python instagram_scraper.py <handle> <max_posts>"}))
        sys.exit(1)
        
    handle = sys.argv[1]
    max_posts = sys.argv[2]
    scrape_instagram(handle, max_posts)
