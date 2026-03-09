#!/usr/bin/env python3
"""
Camoufox-based TikTok profile scraper.
Outputs JSON matching TikTokScrapeResult for integration with tiktok-service.ts.
Run: python3 camoufox_tiktok_scraper.py profile <handle> [max_videos]
"""

import json
import os
import sys
import time
from urllib.parse import unquote, urlparse

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    print(json.dumps({"error": "camoufox not installed. pip install camoufox[geoip]"}))
    sys.exit(1)


def _env_true(name: str, fallback: bool = False) -> bool:
    raw = str(os.environ.get(name, "")).strip().lower()
    if not raw:
        return fallback
    return raw in {"1", "true", "yes", "y", "on"}


def _resolve_camoufox_proxy_config():
    if _env_true("SCRAPER_PROXY_FORCE_DIRECT", False):
        return None

    raw = str(os.environ.get("SCRAPER_PROXY_URL", "")).strip()
    if not raw:
        return None
    candidate = raw if "://" in raw else f"http://{raw}"
    parsed = urlparse(candidate)
    if not parsed.hostname:
        raise ValueError("Invalid SCRAPER_PROXY_URL: missing hostname")

    scheme = (parsed.scheme or "http").lower()
    if scheme not in {"http", "https", "socks5", "socks4"}:
        raise ValueError(f"Invalid SCRAPER_PROXY_URL: unsupported scheme '{scheme}'")

    try:
        port = parsed.port or (443 if scheme == "https" else 80)
    except Exception as exc:
        raise ValueError("Invalid SCRAPER_PROXY_URL: invalid port") from exc

    proxy = {
        "server": f"{scheme}://{parsed.hostname}:{port}",
    }
    if parsed.username:
        proxy["username"] = unquote(parsed.username)
    if parsed.password:
        proxy["password"] = unquote(parsed.password)
    return proxy


def extract_tiktok_profile_js():
    """Return JS to extract profile and video list from TikTok profile page."""
    return r"""
    () => {
        const result = { profile: null, videos: [] };
        try {
            const scripts = document.querySelectorAll('script[id="SIGI_STATE"]');
            for (const s of scripts) {
                try {
                    const data = JSON.parse(s.textContent || '{}');
                    const itemList = data.ItemList?.user?.post?.itemList || [];
                    const userModule = data.UserModule?.users || {};
                    const userKeys = Object.keys(userModule);
                    const user = userKeys.length ? userModule[userKeys[0]] : null;
                    if (user) {
                        result.profile = {
                            handle: user.uniqueId || user.nickname || '',
                            display_name: user.nickname || user.uniqueId || '',
                            profile_url: 'https://www.tiktok.com/@' + (user.uniqueId || ''),
                            follower_count: user.followerCount || 0,
                            bio: user.signature || ''
                        };
                    }
                    for (const id of itemList.slice(0, 30)) {
                        const item = data.ItemModule?.[id];
                        if (!item) continue;
                        const stat = item.stats || {};
                        result.videos.push({
                            video_id: item.id || '',
                            url: 'https://www.tiktok.com/@' + (item.author || '') + '/video/' + (item.id || ''),
                            title: item.desc || '',
                            description: item.desc || '',
                            duration: item.video?.duration || 0,
                            view_count: stat.playCount || 0,
                            like_count: stat.diggCount || 0,
                            comment_count: stat.commentCount || 0,
                            share_count: stat.shareCount || 0,
                            upload_date: item.createTime ? new Date(item.createTime * 1000).toISOString().slice(0, 10).replace(/-/g, '') : '',
                            timestamp: item.createTime || 0,
                            thumbnail: item.video?.cover || item.video?.dynamicCover || ''
                        });
                    }
                    if (result.profile || result.videos.length) return result;
                } catch (_) {}
            }
            const ogDesc = document.querySelector('meta[property="og:description"]');
            if (ogDesc && ogDesc.content) {
                const m = ogDesc.content.match(/@([a-zA-Z0-9._]+)/);
                const handle = m ? m[1] : '';
                const links = Array.from(document.querySelectorAll('a[href*="/video/"]'));
                const seen = new Set();
                for (const a of links) {
                    const href = a.getAttribute('href') || '';
                    const vidMatch = href.match(/\/video\/(\d+)/);
                    if (vidMatch && !seen.has(vidMatch[1])) {
                        seen.add(vidMatch[1]);
                        const img = a.querySelector('img');
                        result.videos.push({
                            video_id: vidMatch[1],
                            url: href.startsWith('http') ? href : 'https://www.tiktok.com' + (href.startsWith('/') ? href : '/' + href),
                            title: '',
                            description: '',
                            duration: 0,
                            view_count: 0,
                            like_count: 0,
                            comment_count: 0,
                            share_count: 0,
                            upload_date: '',
                            timestamp: 0,
                            thumbnail: img?.src || ''
                        });
                    }
                }
                result.profile = {
                    handle: handle,
                    display_name: handle,
                    profile_url: 'https://www.tiktok.com/@' + handle,
                    follower_count: 0,
                    bio: ''
                };
                return result;
            }
        } catch (e) {
            return { error: String(e) };
        }
        return null;
    }
    """


def scrape_profile(handle: str, max_videos: int = 30) -> dict:
    """Scrape TikTok profile using Camoufox."""
    handle = handle.replace('@', '').strip()
    if not handle:
        return {"success": False, "error": "Handle is required"}

    url = f"https://www.tiktok.com/@{handle}"
    try:
        launch_options = {
            "headless": True,
        }
        proxy_config = _resolve_camoufox_proxy_config()
        if proxy_config:
            launch_options["proxy"] = proxy_config

        with Camoufox(**launch_options) as browser:
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            time.sleep(4)
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
            time.sleep(2)

            extracted = page.evaluate(extract_tiktok_profile_js())
            if not extracted:
                return {"success": False, "error": "Could not extract profile from page"}

            if isinstance(extracted, dict) and extracted.get("error"):
                return {"success": False, "error": extracted["error"]}

            profile = extracted.get("profile") or {
                "handle": handle,
                "display_name": handle,
                "profile_url": url,
                "follower_count": 0,
                "bio": "",
            }
            videos = extracted.get("videos", [])[:max_videos]

            return {
                "success": True,
                "profile": profile,
                "videos": videos,
                "total_videos": len(videos),
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    if len(sys.argv) < 3 or sys.argv[1] != "profile":
        print(json.dumps({"error": "Usage: python3 camoufox_tiktok_scraper.py profile <handle> [max_videos]"}))
        sys.exit(1)
    handle = sys.argv[2]
    max_videos = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    result = scrape_profile(handle, max_videos)
    print(json.dumps(result))
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
