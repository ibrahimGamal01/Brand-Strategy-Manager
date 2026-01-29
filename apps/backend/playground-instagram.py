"""
Instagram Scraper Playground - Instaloader
Test script with detailed logging and error handling

Installation:
    pip3 install instaloader

Usage:
    python3 playground-instagram.py <username> [max_posts]
    
Example:
    python3 playground-instagram.py designstudiocairo 10
"""

import instaloader
import json
import sys
import time
from datetime import datetime

def print_header(text):
    print("\n" + "="*60)
    print(f"  {text}")
    print("="*60)

def print_section(text):
    print(f"\n--- {text} ---")

def scrape_instagram_profile(username, max_posts=20):
    """
    Scrape Instagram profile with detailed logging
    """
    print_header(f"INSTAGRAM SCRAPER TEST: @{username}")
    
    # Initialize Instaloader
    print_section("Initializing Instaloader")
    L = instaloader.Instaloader()
    
    # Configure to avoid downloading media files (faster)
    L.download_pictures = False
    L.download_videos = False
    L.download_video_thumbnails = False
    L.download_geotags = False
    L.download_comments = False
    L.save_metadata = False
    
    print("✓ Instaloader initialized")
    print(f"  Target: @{username}")
    print(f"  Max posts: {max_posts}")
    
    try:
        # Get profile
        print_section("Fetching Profile Data")
        start_time = time.time()
        
        profile = instaloader.Profile.from_username(L.context, username)
        
        profile_time = time.time() - start_time
        print(f"✓ Profile loaded in {profile_time:.2f}s")
        
        # Profile metadata
        print_section("Profile Information")
        profile_data = {
            'username': profile.username,
            'full_name': profile.full_name,
            'biography': profile.biography,
            'followers': profile.followers,
            'following': profile.followees,
            'total_posts': profile.mediacount,
            'is_verified': profile.is_verified,
            'is_private': profile.is_private,
            'is_business': profile.is_business_account,
            'profile_pic_url': profile.profile_pic_url
        }
        
        for key, value in profile_data.items():
            if key == 'biography':
                bio_preview = value[:50] + '...' if len(value) > 50 else value
                print(f"  {key}: {bio_preview}")
            else:
                print(f"  {key}: {value}")
        
        # Check if private
        if profile.is_private:
            print("\n⚠️  WARNING: Profile is PRIVATE")
            print("   You need to login and follow this account to see posts")
            return {
                'success': False,
                'error': 'PRIVATE_ACCOUNT',
                'profile': profile_data,
                'posts': []
            }
        
        # Scrape posts
        print_section(f"Scraping Posts (Max: {max_posts})")
        posts_data = []
        post_count = 0
        
        print("\nFetching posts...")
        for post in profile.get_posts():
            if post_count >= max_posts:
                break
            
            post_count += 1
            print(f"\n  Post {post_count}/{max_posts}")
            
            try:
                # Determine post type
                if post.typename == 'GraphSidecar':
                    post_type = 'CAROUSEL'
                    slides = post.get_sidecar_nodes()
                    slide_count = sum(1 for _ in slides)
                    type_detail = f"Carousel ({slide_count} slides)"
                elif post.typename == 'GraphVideo':
                    post_type = 'REEL'
                    type_detail = f"Video ({post.video_duration}s)"
                elif post.typename == 'GraphImage':
                    post_type = 'SINGLE'
                    type_detail = "Image"
                else:
                    post_type = post.typename
                    type_detail = post.typename
                
                # Caption preview
                caption = post.caption or ''
                caption_preview = caption[:50] + '...' if len(caption) > 50 else caption
                
                # Engagement metrics
                engagement_rate = ((post.likes + post.comments) / profile.followers * 100) if profile.followers > 0 else 0
                
                post_data = {
                    'shortcode': post.shortcode,
                    'url': f'https://instagram.com/p/{post.shortcode}',
                    'type': post_type,
                    'typename': post.typename,
                    'caption': caption,
                    'likes': post.likes,
                    'comments': post.comments,
                    'engagement_rate': round(engagement_rate, 2),
                    'date': post.date_utc.isoformat(),
                    'is_video': post.is_video,
                    'video_duration': post.video_duration if post.is_video else None,
                    'hashtags': list(post.caption_hashtags) if post.caption_hashtags else [],
                    'mentions': list(post.caption_mentions) if post.caption_mentions else [],
                    'location': post.location.name if post.location else None
                }
                
                posts_data.append(post_data)
                
                # Log details
                print(f"    ✓ Type: {type_detail}")
                print(f"    ✓ Likes: {post.likes:,}")
                print(f"    ✓ Comments: {post.comments:,}")
                print(f"    ✓ Engagement: {engagement_rate:.2f}%")
                print(f"    ✓ Date: {post.date_utc.strftime('%Y-%m-%d')}")
                print(f"    ✓ Caption: {caption_preview}")
                
                # Small delay to avoid rate limiting
                time.sleep(0.5)
                
            except Exception as e:
                print(f"    ✗ Error scraping post: {str(e)}")
                continue
        
        total_time = time.time() - start_time
        
        # Summary
        print_section("Scraping Summary")
        print(f"  ✓ Total posts scraped: {len(posts_data)}")
        print(f"  ✓ Total time: {total_time:.2f}s")
        print(f"  ✓ Average time per post: {total_time/len(posts_data):.2f}s")
        
        # Post type breakdown
        type_counts = {}
        for post in posts_data:
            post_type = post['type']
            type_counts[post_type] = type_counts.get(post_type, 0) + 1
        
        print("\n  Post Types:")
        for post_type, count in type_counts.items():
            percentage = (count / len(posts_data) * 100)
            print(f"    {post_type}: {count} ({percentage:.1f}%)")
        
        # Engagement stats
        if posts_data:
            avg_likes = sum(p['likes'] for p in posts_data) / len(posts_data)
            avg_comments = sum(p['comments'] for p in posts_data) / len(posts_data)
            avg_engagement = sum(p['engagement_rate'] for p in posts_data) / len(posts_data)
            
            print("\n  Engagement Averages:")
            print(f"    Likes: {avg_likes:,.0f}")
            print(f"    Comments: {avg_comments:,.0f}")
            print(f"    Engagement Rate: {avg_engagement:.2f}%")
        
        # Top performing posts
        if posts_data:
            sorted_posts = sorted(posts_data, key=lambda x: x['engagement_rate'], reverse=True)
            print("\n  Top 3 Posts by Engagement:")
            for i, post in enumerate(sorted_posts[:3], 1):
                print(f"    {i}. {post['engagement_rate']:.1f}% - {post['type']} - {post['likes']:,} likes")
        
        # Save to JSON
        output_file = f"instagram_{username}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        result = {
            'success': True,
            'scraped_at': datetime.now().isoformat(),
            'profile': profile_data,
            'posts': posts_data,
            'stats': {
                'total_posts': len(posts_data),
                'scraping_time': total_time,
                'post_types': type_counts,
                'avg_likes': avg_likes if posts_data else 0,
                'avg_comments': avg_comments if posts_data else 0,
                'avg_engagement_rate': avg_engagement if posts_data else 0
            }
        }
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        
        print_section("Output")
        print(f"  ✓ Data saved to: {output_file}")
        
        return result
        
    except instaloader.exceptions.ProfileNotExistsException:
        print("\n✗ ERROR: Profile does not exist")
        return {
            'success': False,
            'error': 'PROFILE_NOT_FOUND',
            'profile': None,
            'posts': []
        }
        
    except instaloader.exceptions.ConnectionException as e:
        print(f"\n✗ ERROR: Connection error - {str(e)}")
        print("   (Instagram may be blocking requests - try again later or use login)")
        return {
            'success': False,
            'error': 'CONNECTION_ERROR',
            'message': str(e),
            'posts': []
        }
        
    except Exception as e:
        print(f"\n✗ ERROR: {type(e).__name__}: {str(e)}")
        import traceback
        print("\nFull traceback:")
        print(traceback.format_exc())
        return {
            'success': False,
            'error': str(e),
            'posts': []
        }

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 playground-instagram.py <username> [max_posts]")
        print("Example: python3 playground-instagram.py designstudiocairo 10")
        sys.exit(1)
    
    username = sys.argv[1].replace('@', '')
    max_posts = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    
    result = scrape_instagram_profile(username, max_posts)
    
    print_header("TEST COMPLETE")
    
    if result['success']:
        print("✓ SUCCESS - Data scraped and saved to JSON")
    else:
        print(f"✗ FAILED - {result.get('error', 'Unknown error')}")
    
    print("\n")

if __name__ == '__main__':
    main()
