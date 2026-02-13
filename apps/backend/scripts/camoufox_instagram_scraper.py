#!/usr/bin/env python3
"""
Camoufox-based Instagram profile scraper.
Outputs JSON matching InstagramProfileData schema for integration with instagram-service.ts.
Run: python3 camoufox_instagram_scraper.py <handle> [posts_limit]
"""

import json
import sys
import time

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    print(json.dumps({"error": "camoufox not installed. pip install camoufox[geoip]"}))
    sys.exit(1)


def extract_profile_js() -> str:
    """Return the page.evaluate JavaScript as a string."""
    return r"""
    () => {
        const result = { profile: null, posts: [] };
        function parseNum(s) {
            if (!s) return 0;
            s = String(s).replace(/,/g,'');
            if (s.endsWith('K')) return Math.floor(parseFloat(s)*1000);
            if (s.endsWith('M')) return Math.floor(parseFloat(s)*1000000);
            if (s.endsWith('B')) return Math.floor(parseFloat(s)*1000000000);
            return parseInt(s,10)||0;
        }
        try {
            if (window._sharedData && window._sharedData.entry_data) {
                const profilePage = Object.values(window._sharedData.entry_data.ProfilePage || {})[0];
                if (profilePage && profilePage.graphql) {
                    const user = profilePage.graphql.user;
                    result.profile = {
                        handle: user.username,
                        follower_count: user.edge_followed_by?.count || 0,
                        following_count: user.edge_follow?.count || 0,
                        bio: user.biography || '',
                        profile_pic: user.profile_pic_url_hd || user.profile_pic_url || '',
                        is_verified: user.is_verified || false,
                        is_private: user.is_private || false,
                        total_posts: user.edge_owner_to_timeline_media?.count || 0
                    };
                    const edges = user.edge_owner_to_timeline_media?.edges || [];
                    result.posts = edges.slice(0, 30).map(e => {
                        const n = e.node;
                        const isVideo = n.is_video || false;
                        const mediaUrls = [];
                        if (n.display_url) mediaUrls.push(n.display_url);
                        if (n.video_url) mediaUrls.push(n.video_url);
                        (n.edge_sidecar_to_children?.edges || []).forEach(c => {
                            if (c.node.display_url) mediaUrls.push(c.node.display_url);
                            if (c.node.video_url) mediaUrls.push(c.node.video_url);
                        });
                        return {
                            external_post_id: n.id || n.shortcode,
                            post_url: 'https://www.instagram.com/p/' + n.shortcode + '/',
                            caption: (n.edge_media_to_caption?.edges?.[0]?.node?.text) || '',
                            likes: n.edge_media_preview_like?.count || 0,
                            comments: n.edge_media_to_comment?.count || 0,
                            timestamp: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString() : '',
                            media_url: n.display_url || n.video_url || '',
                            is_video: isVideo,
                            video_url: isVideo ? (n.video_url || null) : null,
                            typename: n.__typename || 'GraphImage',
                            media_urls: mediaUrls
                        };
                    });
                    return result;
                }
            }
            const scripts = document.querySelectorAll('script[type="application/json"]');
            for (const s of scripts) {
                try {
                    const data = JSON.parse(s.textContent || '{}');
                    let user = null;
                    if (data.required?.sections) {
                        for (const sec of data.required.sections) {
                            const content = sec?.layout?.content;
                            if (content?.usertag?.user) user = content.usertag.user;
                            if (content?.mediaset?.layout_content?.mediaset) {
                                const medias = content.mediaset.layout_content.mediaset;
                                user = user || medias?.metadata?.owner;
                                if (user && medias?.media) {
                                    result.posts = medias.media.slice(0, 30).map(m => ({
                                        external_post_id: m.media_id || m.id,
                                        post_url: (m.permalink || 'https://www.instagram.com/p/' + (m.code || '') + '/'),
                                        caption: m.caption?.text || '',
                                        likes: m.like_count || 0,
                                        comments: m.comment_count || 0,
                                        timestamp: m.taken_at ? new Date(m.taken_at).toISOString() : '',
                                        media_url: m.image_versions2?.candidates?.[0]?.url || m.video_versions?.[0]?.url || '',
                                        is_video: !!m.video_versions?.length,
                                        video_url: m.video_versions?.[0]?.url || null,
                                        typename: m.media_type === 2 ? 'GraphVideo' : 'GraphImage',
                                        media_urls: [m.image_versions2?.candidates?.[0]?.url, m.video_versions?.[0]?.url].filter(Boolean)
                                    }));
                                }
                            }
                            if (user) break;
                        }
                    }
                    if (user) {
                        result.profile = {
                            handle: user.username || '',
                            follower_count: user.follower_count ?? user.edge_followed_by?.count ?? 0,
                            following_count: user.following_count ?? user.edge_follow?.count ?? 0,
                            bio: user.biography || '',
                            profile_pic: user.profile_pic_url_hd || user.profile_pic_url || '',
                            is_verified: user.is_verified || false,
                            is_private: user.is_private || false,
                            total_posts: user.media_count ?? user.edge_owner_to_timeline_media?.count ?? 0
                        };
                        if (result.posts.length === 0 && user.edge_owner_to_timeline_media?.edges) {
                            const edges = user.edge_owner_to_timeline_media.edges;
                            result.posts = edges.slice(0, 30).map(e => {
                                const n = e.node;
                                const isVideo = n.is_video || false;
                                const mediaUrls = [];
                                if (n.display_url) mediaUrls.push(n.display_url);
                                if (n.video_url) mediaUrls.push(n.video_url);
                                return {
                                    external_post_id: n.id || n.shortcode,
                                    post_url: 'https://www.instagram.com/p/' + n.shortcode + '/',
                                    caption: (n.edge_media_to_caption?.edges?.[0]?.node?.text) || '',
                                    likes: n.edge_media_preview_like?.count || 0,
                                    comments: n.edge_media_to_comment?.count || 0,
                                    timestamp: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString() : '',
                                    media_url: n.display_url || n.video_url || '',
                                    is_video: isVideo,
                                    video_url: isVideo ? (n.video_url || null) : null,
                                    typename: n.__typename || 'GraphImage',
                                    media_urls: mediaUrls
                                };
                            });
                        }
                        return result;
                    }
                } catch (_) {}
            }
            const metaDesc = document.querySelector('meta[property="og:description"]');
            if (metaDesc && metaDesc.content) {
                const parts = metaDesc.content.split(' - ');
                const first = parts[0] || '';
                const m = first.match(/([\d,.]+[KMB]?)\s*Followers/);
                const m2 = first.match(/([\d,.]+[KMB]?)\s*Following/);
                const m3 = first.match(/([\d,.]+[KMB]?)\s*Posts/);
                const ogUrl = document.querySelector('meta[property="og:url"]');
                const handle = (ogUrl?.content || '').split('/').filter(Boolean).pop() || '';
                const header = document.querySelector('header');
                const bioEl = header?.querySelector('div span');
                result.profile = {
                    handle: handle,
                    follower_count: parseNum(m?.[1]),
                    following_count: parseNum(m2?.[1]),
                    bio: (bioEl?.textContent || '').trim().slice(0, 500),
                    profile_pic: header?.querySelector('img')?.src || '',
                    is_verified: !!document.querySelector('svg[aria-label="Verified"]'),
                    is_private: metaDesc.content.includes('This Account is Private'),
                    total_posts: parseNum(m3?.[1])
                };
                const links = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
                const seen = new Set();
                result.posts = links.slice(0, 30).map(a => {
                    const href = a.getAttribute('href') || '';
                    const match = href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
                    if (!match || seen.has(match[2])) return null;
                    seen.add(match[2]);
                    const shortcode = match[2];
                    const img = a.querySelector('img');
                    return {
                        external_post_id: shortcode,
                        post_url: 'https://www.instagram.com/' + match[1] + '/' + shortcode + '/',
                        caption: '',
                        likes: 0,
                        comments: 0,
                        timestamp: '',
                        media_url: img?.src || '',
                        is_video: match[1] === 'reel',
                        video_url: null,
                        typename: match[1] === 'reel' ? 'GraphVideo' : 'GraphImage',
                        media_urls: [img?.src].filter(Boolean)
                    };
                }).filter(Boolean);
                return result;
            }
        } catch (e) {
            return { error: String(e) };
        }
        return null;
    }
    """


def scrape_profile(handle: str, posts_limit: int = 30) -> dict:
    """Scrape Instagram profile using Camoufox."""
    handle = handle.replace('@', '').strip()
    if not handle:
        return {"error": "Handle is required"}

    url = f"https://www.instagram.com/{handle}/"
    try:
        with Camoufox(headless=True) as browser:
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            time.sleep(3)
            page.wait_for_load_state("networkidle", timeout=15000)
            time.sleep(2)

            extracted = page.evaluate(extract_profile_js())
            if not extracted:
                return {"error": "Could not extract profile data from page"}

            if isinstance(extracted, dict) and extracted.get("error"):
                return {"error": extracted["error"]}

            profile = extracted.get("profile")
            posts = extracted.get("posts", [])[:posts_limit]

            if not profile:
                return {"error": "Profile data not found (login wall or private?)"}

            result = {
                "handle": profile.get("handle", handle),
                "follower_count": profile.get("follower_count", 0),
                "following_count": profile.get("following_count", 0),
                "bio": profile.get("bio", ""),
                "profile_pic": profile.get("profile_pic", ""),
                "is_verified": profile.get("is_verified", False),
                "is_private": profile.get("is_private", False),
                "total_posts": profile.get("total_posts", len(posts)),
                "posts": posts,
                "discovered_competitors": [],
            }
            return result
    except Exception as e:
        return {"error": str(e)}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python3 camoufox_instagram_scraper.py <handle> [posts_limit]"}))
        sys.exit(1)
    handle = sys.argv[1]
    posts_limit = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    result = scrape_profile(handle, posts_limit)
    print(json.dumps(result, indent=2))
    if "error" in result:
        sys.exit(1)


if __name__ == "__main__":
    main()
