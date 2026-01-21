import sys
import json
import yt_dlp
import os

def scrape_profile(handle, max_videos):
    url = f"https://www.tiktok.com/@{handle}"
    
    # Use full extraction (not flat) to get all metadata including thumbnails and dates
    ydl_opts = {
        'quiet': True,
        'extract_flat': False,  # Full extraction for complete metadata
        'dump_single_json': True,
        'playlistend': int(max_videos),
        'skip_download': True,  # Don't download, just extract metadata
        'ignoreerrors': True,   # Continue on errors
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # Process profile info from yt-dlp playlist response
            profile = {
                "handle": info.get('uploader_id') or info.get('channel_id') or handle,
                "display_name": info.get('uploader') or info.get('channel') or '',
                "profile_url": info.get('webpage_url') or url,
                "follower_count": info.get('follower_count') or 0,
                "bio": info.get('description') or '',
            }
            
            videos = []
            entries = info.get('entries', [])
            if entries:
                for entry in entries:
                    if entry is None:  # Skip errors
                        continue
                    videos.append({
                        "video_id": entry.get('id'),
                        "url": entry.get('webpage_url') or entry.get('url'),
                        "title": entry.get('title', ''),
                        "description": entry.get('description', ''),
                        "duration": entry.get('duration') or 0,
                        "view_count": entry.get('view_count') or 0,
                        "like_count": entry.get('like_count') or 0,
                        "comment_count": entry.get('comment_count') or 0,
                        "share_count": entry.get('repost_count') or 0,
                        "upload_date": entry.get('upload_date'),  # YYYYMMDD format
                        "timestamp": entry.get('timestamp'),  # Unix timestamp
                        "thumbnail": entry.get('thumbnail'),
                        "thumbnails": entry.get('thumbnails'),  # Array of thumbnail options
                    })
            
            result = {
                "success": True,
                "profile": profile,
                "videos": videos,
                "total_videos": len(videos)
            }
            print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

def download_video(url, output_path):
    # Ensure directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    # TikTok videos are pre-merged (video+audio in one stream)
    # Using 'best' gets the highest quality pre-merged stream
    ydl_opts = {
        'outtmpl': output_path,
        'quiet': True,
        'no_warnings': True,
        'format': 'best',  # Get best pre-merged stream (video+audio)
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            
        print(json.dumps({"success": True, "path": output_path}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python tiktok_scraper.py [profile|download] ..."}))
        sys.exit(1)
        
    mode = sys.argv[1]
    
    if mode == "profile":
        if len(sys.argv) < 4:
             print(json.dumps({"error": "Usage: python tiktok_scraper.py profile <handle> <max_videos>"}))
             sys.exit(1)
        scrape_profile(sys.argv[2], sys.argv[3])
        
    elif mode == "download":
        if len(sys.argv) < 4:
             print(json.dumps({"error": "Usage: python tiktok_scraper.py download <url> <output_path>"}))
             sys.exit(1)
        download_video(sys.argv[2], sys.argv[3])
        
    else:
        print(json.dumps({"error": f"Unknown mode: {mode}"}))
        sys.exit(1)
