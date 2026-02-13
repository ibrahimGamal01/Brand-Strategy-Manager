#!/usr/bin/env python3
"""
Camoufox-based TikTok video/photo downloader.
Handles: /video/ URLs (video), /photo/ URLs (image carousel - downloads first image).
Output: JSON {success, path?, error?} to stdout
Run: python3 camoufox_tiktok_downloader.py <tiktok_url> <output_path>
"""

import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.request
import urllib.error

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = ssl.create_default_context()

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    print(json.dumps({"success": False, "error": "camoufox not installed. pip install camoufox[geoip]"}))
    sys.exit(1)

TIKTOK_VIDEO_RE = re.compile(r"/video/(\d+)", re.I)
TIKTOK_PHOTO_RE = re.compile(r"/photo/(\d+)", re.I)


def _is_photo_url(url: str) -> bool:
    return "/photo/" in url


def download_photo(photo_url: str, output_path: str) -> dict:
    """Download first image from TikTok photo post via Camoufox."""
    image_urls = []

    def handle_response(response):
        try:
            url = response.url
            if "website-login" in url or "blob:" in url:
                return
            if "tiktok" not in url and "byteoversea" not in url and "bytedance" not in url and "muscdn" not in url:
                return
            if "mime_type=video" in url or "video_mp4" in url:
                return
            ct = ""
            try:
                headers = response.all_headers() if hasattr(response, "all_headers") else {}
                ct = (headers.get("content-type") or "").lower()
            except Exception:
                pass
            if "image/" in ct or "image" in url or "photo" in url or "p16-sign" in url:
                if url not in image_urls and len(url) > 50:
                    image_urls.append(url)
        except Exception:
            pass

    extract_js = r"""
    () => {
        const urls = [];
        const imgs = document.querySelectorAll('img[src*="tiktok"], img[src*="bytedance"], img[src*="muscdn"]');
        imgs.forEach(i => { const u = i.src || i.getAttribute('src'); if (u && u.length > 60) urls.push(u); });
        try {
            const scripts = document.querySelectorAll('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
            for (const s of scripts) {
                const d = JSON.parse(s.textContent || '{}');
                const root = d?.__DEFAULT_SCOPE__?.['webapp.video-detail'] || d?.__DEFAULT_SCOPE__?.['webapp.photo-detail'];
                const item = root?.itemInfo?.itemStruct;
                const images = item?.imagePost?.images || [];
                for (const im of images) {
                    const u = im?.imageURL?.urlList?.[0] || im?.displayImage?.urlList?.[0];
                    if (u) urls.push(u);
                }
                const single = item?.imagePost?.imageURL?.urlList?.[0];
                if (single) urls.push(single);
            }
        } catch (_) {}
        return [...new Set(urls)];
    }
    """

    try:
        with Camoufox(headless=True, humanize=True) as browser:
            page = browser.new_page()
            page.on("response", handle_response)
            page.goto(photo_url, wait_until="networkidle", timeout=90000)
            time.sleep(6)

            extracted = page.evaluate(extract_js)
            if isinstance(extracted, list):
                image_urls[:0] = extracted
            image_urls = [u for u in image_urls if u and u.startswith("http") and "video" not in u.lower()]
            image_urls = list(dict.fromkeys(image_urls))

            if not image_urls:
                return {"success": False, "error": "No image URLs found (CAPTCHA or login wall?)"}

            img_url = image_urls[0]
            os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

            cookies = page.context.cookies()
            cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
            req = urllib.request.Request(
                img_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Cookie": cookie_str,
                    "Referer": "https://www.tiktok.com/",
                },
            )
            with urllib.request.urlopen(req, timeout=60, context=_SSL_CTX) as resp:
                data = resp.read()
            ext = ".jpg" if ".jpg" in img_url or "jpeg" in img_url else ".png"
            if not output_path.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                output_path = output_path.rstrip("/") + ext
            with open(output_path, "wb") as f:
                f.write(data)
            return {"success": True, "path": output_path}
    except Exception as e:
        return {"success": False, "error": str(e)}


def download_video(video_url: str, output_path: str) -> dict:
    """Download TikTok video using Camoufox to get the stream URL."""
    video_source_url = [None]

    def handle_response(response):
        try:
            url = response.url
            if "website-login" in url or "blob:" in url:
                return
            if "tiktok.com" not in url and "byteoversea" not in url and "musical.ly" not in url:
                return
            if "/video/" not in url and "mime_type=video" not in url and "video_mp4" not in url:
                return
            headers = {}
            try:
                headers = response.all_headers() if hasattr(response, "all_headers") else (getattr(response, "headers", None) or {})
            except Exception:
                pass
            ct = (headers.get("content-type") or "").lower()
            try:
                cl = headers.get("content-length", "0")
                size = int(cl) if cl else 0
            except (ValueError, TypeError):
                size = 0
            is_video = "video/mp4" in ct or "video/webm" in ct or "mime_type=video" in url or "video_mp4" in url
            if is_video:
                current = video_source_url[0]
                if current is None or (size > 0 and size > 50000):
                    if size == 0 or size > 50000:
                        video_source_url[0] = url
        except Exception:
            pass

    try:
        with Camoufox(headless=True, humanize=True) as browser:
            page = browser.new_page()
            page.on("response", handle_response)
            page.goto(video_url, wait_until="networkidle", timeout=90000)
            time.sleep(8)

            url = video_source_url[0]
            if not url:
                try:
                    result = subprocess.run(
                        ["yt-dlp", "-f", "b", "-g", video_url],
                        capture_output=True, text=True, timeout=30,
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        url = result.stdout.strip()
                except Exception:
                    pass
            if not url:
                return {"success": False, "error": "No video stream URL detected (CAPTCHA or login wall?)"}

            os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

            cookies = page.context.cookies()
            cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)

            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Cookie": cookie_str,
                    "Referer": "https://www.tiktok.com/",
                    "Origin": "https://www.tiktok.com",
                },
            )
            with urllib.request.urlopen(req, timeout=120, context=_SSL_CTX) as resp:
                data = resp.read()
            with open(output_path, "wb") as f:
                f.write(data)
            return {"success": True, "path": output_path}
    except Exception as e:
        try:
            result = subprocess.run(
                ["yt-dlp", "-f", "b", "-o", output_path, video_url],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode == 0 and os.path.exists(output_path):
                return {"success": True, "path": output_path}
        except Exception:
            pass
        return {"success": False, "error": str(e)}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: python3 camoufox_tiktok_downloader.py <tiktok_url> <output_path>"}))
        sys.exit(1)
    url = sys.argv[1]
    output_path = sys.argv[2]
    result = download_photo(url, output_path) if _is_photo_url(url) else download_video(url, output_path)
    print(json.dumps(result))
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
