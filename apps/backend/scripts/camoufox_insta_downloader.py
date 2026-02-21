#!/usr/bin/env python3
"""
Camoufox-based Instagram post-to-media resolver.
Visits each post page, extracts direct image/video URLs (handles carousels).
Output: JSON {success, mediaUrls: string[], thumbnailUrl?: string, error?} to stdout
Run: python3 camoufox_insta_downloader.py <post_url>
"""

import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.request

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = ssl.create_default_context()

PROXY_URL = (
    os.environ.get("SCRAPER_PROXY_URL")
    or os.environ.get("HTTPS_PROXY")
    or os.environ.get("HTTP_PROXY")
    or ""
).strip()

def with_proxy(cmd):
    if PROXY_URL and "--proxy" not in cmd:
        return [*cmd, "--proxy", PROXY_URL]
    return cmd

def open_url(req, timeout):
    if PROXY_URL:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": PROXY_URL, "https": PROXY_URL}),
            urllib.request.HTTPSHandler(context=_SSL_CTX),
        )
        return opener.open(req, timeout=timeout)
    return urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX)

def _get_camoufox():
    try:
        from camoufox.sync_api import Camoufox
        return Camoufox
    except ImportError:
        return None

INSTAGRAM_PAGE_REGEX = re.compile(
    r"^https?://(?:www\.)?instagram\.com/(?:[^/]+/)?(p|reel|tv)/([A-Za-z0-9_-]+)",
    re.I,
)


def extract_media_js():
    """Return JS to extract media URLs from Instagram post page."""
    return r"""
    () => {
        const mediaUrls = [];
        let thumbnailUrl = null;
        const add = (url) => { if (url && (url.includes('cdninstagram') || url.includes('fbcdn')) && !mediaUrls.includes(url)) mediaUrls.push(url); };
        try {
            if (window._sharedData && window._sharedData.entry_data) {
                const keys = Object.keys(window._sharedData.entry_data);
                for (const k of keys) {
                    const postPage = window._sharedData.entry_data[k];
                    const shortcode = postPage?.graphql?.shortcode_media || postPage?.PostPage?.[0]?.graphql?.shortcode_media;
                    if (shortcode) {
                        if (shortcode.display_url) add(shortcode.display_url);
                        if (shortcode.video_url) add(shortcode.video_url);
                        thumbnailUrl = shortcode.display_url || shortcode.video_url;
                        const edges = shortcode.edge_sidecar_to_children?.edges || [];
                        for (const e of edges) {
                            const n = e.node;
                            if (n.display_url) add(n.display_url);
                            if (n.video_url) add(n.video_url);
                        }
                        if (mediaUrls.length) return { mediaUrls, thumbnailUrl };
                    }
                }
            }
            const scripts = document.querySelectorAll('script[type="application/json"]');
            for (const s of scripts) {
                try {
                    const data = JSON.parse(s.textContent || '{}');
                    const items = data.items || data.required?.sections?.flatMap(x =>
                        x?.layout?.content?.mediaset?.layout_content?.mediaset?.media || []
                    ) || [];
                    const media = data.media || data.graphql?.shortcode_media;
                    if (media) {
                        if (media.display_url) add(media.display_url);
                        if (media.video_url) add(media.video_url);
                        thumbnailUrl = media.display_url || media.video_url;
                        const edges = media.edge_sidecar_to_children?.edges || [];
                        for (const e of edges) {
                            const n = e.node;
                            if (n.display_url) add(n.display_url);
                            if (n.video_url) add(n.video_url);
                        }
                        if (mediaUrls.length) return { mediaUrls, thumbnailUrl };
                    }
                    for (const m of items) {
                        const url = m.image_versions2?.candidates?.[0]?.url || m.video_versions?.[0]?.url;
                        if (url) add(url);
                    }
                    if (mediaUrls.length) return { mediaUrls, thumbnailUrl: mediaUrls[0] };
                } catch (_) {}
            }
            document.querySelectorAll('img[src*="cdninstagram"], img[src*="fbcdn"], img[src*="cdn.cstatic"]').forEach(img => {
                const u = img.src || img.getAttribute('src');
                if (u && u.length > 60) add(u);
            });
            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage) {
                const url = ogImage.getAttribute('content') || ogImage.content;
                if (url) {
                    add(url);
                    thumbnailUrl = thumbnailUrl || url;
                }
            }
            if (mediaUrls.length) return { mediaUrls, thumbnailUrl: thumbnailUrl || mediaUrls[0] };
        } catch (e) {
            return { error: String(e) };
        }
        return null;
    }
    """


def resolve_post(post_url: str, debug: bool = False) -> dict:
    """Visit Instagram post page and extract direct media URLs."""
    post_url = post_url.strip()
    if not INSTAGRAM_PAGE_REGEX.match(post_url):
        return {"success": False, "mediaUrls": [], "error": "Invalid Instagram post URL"}

    if "/?" in post_url:
        post_url = post_url.split("/?")[0]
    if not post_url.endswith("/"):
        post_url += "/"

    collected_urls: list = []

    try:
        req = urllib.request.Request(
            post_url,
            headers={"User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"},
        )
        with open_url(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
        m = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', html)
        if not m:
            m = re.search(r'content="([^"]+)"[^>]+property="og:image"', html)
        if debug and not m:
            import sys
            print(f"[debug] og:image m={m is not None} html_len={len(html)}", file=sys.stderr)
        if m:
            url = m.group(1).replace("&amp;", "&")
            if url.startswith("http"):
                return {"success": True, "mediaUrls": [url], "thumbnailUrl": url}
    except Exception:
        pass

    def capture_media_response(response):
        try:
            url = response.url
            if not any(x in url for x in ("cdninstagram.com", "fbcdn.net", "cdn.cstaticimages")):
                return
            if "seo" in url or "crawler" in url or "google_widget" in url or "avatar" in url:
                return
            if len(url) < 40:
                return
            if url not in collected_urls:
                collected_urls.append(url)
        except Exception:
            pass

    try:
        Camoufox = _get_camoufox()
        if not Camoufox:
            return {"success": False, "mediaUrls": [], "error": "camoufox not installed. pip install camoufox[geoip]"}
        with Camoufox(headless=True, humanize=True) as browser:
            page = browser.new_page()
            page.on("response", capture_media_response)
            page.goto(post_url, wait_until="domcontentloaded", timeout=60000)
            time.sleep(5)
            try:
                page.wait_for_load_state("networkidle", timeout=25000)
            except Exception:
                pass
            time.sleep(4)

            extracted = page.evaluate(extract_media_js())
            media_urls = list(collected_urls)
            if isinstance(extracted, dict) and not extracted.get("error"):
                media_urls = list(extracted.get("mediaUrls", [])) + media_urls
            media_urls = [u for u in media_urls if u and u.startswith("http") and "/p/" not in u and "/reel/" not in u]
            media_urls = list(dict.fromkeys(media_urls))
            if debug:
                import os
                err_fd = int(os.environ.get("DEBUG_STDERR", 2))
                os.write(err_fd, f"[debug] extracted={type(extracted).__name__} collected={len(collected_urls)} media_urls={len(media_urls)}\n".encode())
                if isinstance(extracted, dict) and extracted.get("error"):
                    os.write(err_fd, f"[debug] extract_error={extracted.get('error')}\n".encode())
            if media_urls:
                thumb = (extracted.get("thumbnailUrl") if isinstance(extracted, dict) else None) or media_urls[0]
                return {"success": True, "mediaUrls": media_urls, "thumbnailUrl": thumb}
    except Exception:
        pass

    try:
        result = subprocess.run(
            with_proxy(["yt-dlp", "-g", "--no-playlist", post_url]),
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            urls = [u.strip() for u in result.stdout.strip().split("\n") if u.strip().startswith("http")]
            if urls:
                return {"success": True, "mediaUrls": urls, "thumbnailUrl": urls[0]}
    except Exception:
        pass

    return {"success": False, "mediaUrls": [], "error": "No media URLs found"}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "mediaUrls": [], "error": "Usage: python3 camoufox_insta_downloader.py <post_url> [--debug]"}))
        sys.exit(1)
    post_url = sys.argv[1]
    debug = "--debug" in sys.argv
    result = resolve_post(post_url, debug=debug)
    print(json.dumps(result))
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
