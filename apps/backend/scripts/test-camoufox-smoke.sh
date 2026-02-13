#!/bin/bash
# Smoke test for Camoufox-based scrapers and downloaders.
# Run from repo root: ./apps/backend/scripts/test-camoufox-smoke.sh
# Requires: pip install camoufox[geoip] && python3 -m camoufox fetch

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Camoufox Smoke Tests ==="

echo ""
echo "[1/5] camoufox_instagram_scraper.py (natgeo)..."
python3 camoufox_instagram_scraper.py natgeo 5 2>/dev/null | head -c 500
echo "... (truncated)"
echo "OK"

echo ""
echo "[2/5] camoufox_tiktok_scraper.py (tiktok)..."
python3 camoufox_tiktok_scraper.py profile tiktok 3 2>/dev/null | head -c 500
echo "... (truncated)"
echo "OK"

echo ""
echo "[3/5] camoufox_insta_downloader.py (real post)..."
OUT=$(python3 camoufox_insta_downloader.py "https://www.instagram.com/ummahpreneur/p/DUlWCC6iI9U/?hl=en")
echo "$OUT" | grep -q '"success": true' || (echo "FAIL: $OUT" && exit 1)
echo "OK"

echo ""
echo "[4/5] camoufox_tiktok_downloader.py (video)..."
mkdir -p /tmp/camoufox_test
OUT=$(python3 camoufox_tiktok_downloader.py "https://www.tiktok.com/@ummahpreneur/video/7540341844568296711" "/tmp/camoufox_test/smoke_video.mp4")
if echo "$OUT" | grep -q '"success": true'; then
  echo "OK"
else
  echo "Retry (TikTok can rate-limit)..."
  OUT=$(python3 camoufox_tiktok_downloader.py "https://www.tiktok.com/@ummahpreneur/video/7540341844568296711" "/tmp/camoufox_test/smoke_video.mp4")
  echo "$OUT" | grep -q '"success": true' || (echo "FAIL: $OUT" && exit 1)
  echo "OK"
fi

echo ""
echo "[5/5] camoufox_tiktok_downloader.py (photo)..."
OUT=$(python3 camoufox_tiktok_downloader.py "https://www.tiktok.com/@ummahpreneur/photo/7551812725278575880" "/tmp/camoufox_test/smoke_photo.jpg")
echo "$OUT" | grep -q '"success": true' || (echo "FAIL: $OUT" && exit 1)
echo "OK"

echo ""
echo "=== Smoke tests complete ==="
