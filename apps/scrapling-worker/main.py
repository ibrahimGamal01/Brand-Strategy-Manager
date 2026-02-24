from __future__ import annotations

import hashlib
import time
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

try:
    from scrapling.fetchers import DynamicFetcher, Fetcher
except Exception:  # pragma: no cover - fallback mode when package unavailable
    DynamicFetcher = None
    Fetcher = None

app = FastAPI(title="BAT Scrapling Worker", version="1.0.0")


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok", "service": "scrapling-worker"}


class WaitFor(BaseModel):
    type: str = Field(default="network_idle")
    value: Optional[str | int] = None


class FetchRequest(BaseModel):
    url: str
    mode: str = Field(default="AUTO")
    sessionKey: Optional[str] = None
    timeoutMs: int = Field(default=20000, ge=1000, le=120000)
    proxyStrategy: str = Field(default="NONE")
    returnHtml: bool = True
    returnText: bool = True
    waitFor: Optional[WaitFor] = None


class CrawlRequest(BaseModel):
    startUrls: List[str]
    allowedDomains: Optional[List[str]] = None
    maxPages: int = Field(default=20, ge=1, le=200)
    maxDepth: int = Field(default=1, ge=0, le=5)
    concurrency: int = Field(default=4, ge=1, le=20)
    resumeKey: Optional[str] = None
    mode: str = Field(default="AUTO")


class ExtractRequest(BaseModel):
    url: Optional[str] = None
    snapshotHtml: Optional[str] = None
    recipeSchema: Dict[str, Any]
    adaptiveNamespace: Optional[str] = None


@dataclass
class FetchResult:
    ok: bool
    final_url: str
    status_code: Optional[int]
    html: str
    text: str
    fetcher_used: str
    blocked_suspected: bool


def _normalize_mode(raw: str) -> str:
    value = str(raw or "AUTO").strip().upper()
    if value in {"HTTP", "DYNAMIC", "STEALTH"}:
        return value
    return "AUTO"


def _clean_text(html: str) -> str:
    soup = BeautifulSoup(html or "", "lxml")
    for bad in soup(["script", "style", "noscript"]):
        bad.decompose()
    return " ".join(soup.get_text(" ").split())[:80000]


def _basic_fetch(url: str, timeout_ms: int) -> FetchResult:
    response = requests.get(
        url,
        timeout=max(1, timeout_ms // 1000),
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            )
        },
        allow_redirects=True,
    )
    html = response.text or ""
    return FetchResult(
        ok=200 <= response.status_code < 400,
        final_url=response.url,
        status_code=response.status_code,
        html=html,
        text=_clean_text(html),
        fetcher_used="HTTP",
        blocked_suspected=response.status_code in {401, 403, 429, 503},
    )


def _scrapling_fetch(url: str, mode: str, timeout_ms: int) -> FetchResult:
    if Fetcher is None:
        return _basic_fetch(url, timeout_ms)

    selected = _normalize_mode(mode)
    blockers = {"captcha", "access denied", "please verify", "cloudflare"}

    def run_http() -> FetchResult:
        start = time.time()
        fetcher = Fetcher(timeout=max(1, timeout_ms // 1000))
        response = fetcher.get(url)
        html = getattr(response, "html", "") or ""
        status = getattr(response, "status", None)
        text = _clean_text(html)
        blocked = bool(status in {401, 403, 429, 503}) or any(token in text.lower() for token in blockers)
        _ = time.time() - start
        return FetchResult(
            ok=bool(getattr(response, "ok", status is not None and 200 <= int(status) < 400)),
            final_url=str(getattr(response, "url", url) or url),
            status_code=int(status) if status is not None else None,
            html=html,
            text=text,
            fetcher_used="HTTP",
            blocked_suspected=blocked,
        )

    def run_dynamic() -> FetchResult:
        if DynamicFetcher is None:
            return _basic_fetch(url, timeout_ms)
        fetcher = DynamicFetcher(timeout=max(1, timeout_ms // 1000))
        response = fetcher.get(url)
        html = getattr(response, "html", "") or ""
        status = getattr(response, "status", None)
        text = _clean_text(html)
        blocked = bool(status in {401, 403, 429, 503})
        return FetchResult(
            ok=bool(getattr(response, "ok", status is not None and 200 <= int(status) < 400)),
            final_url=str(getattr(response, "url", url) or url),
            status_code=int(status) if status is not None else None,
            html=html,
            text=text,
            fetcher_used="DYNAMIC",
            blocked_suspected=blocked,
        )

    if selected == "HTTP":
        return run_http()
    if selected == "DYNAMIC" or selected == "STEALTH":
        return run_dynamic()

    # AUTO mode: HTTP first, then dynamic if suspicious/blocked
    http_result = run_http()
    if http_result.blocked_suspected or not http_result.text.strip():
        try:
            return run_dynamic()
        except Exception:
            return http_result
    return http_result


def _extract_fields(html: str, recipe: Dict[str, Any]) -> Dict[str, Any]:
    soup = BeautifulSoup(html or "", "lxml")
    fields = recipe.get("fields") if isinstance(recipe, dict) else None
    if not isinstance(fields, dict):
        return {"text": _clean_text(html)}

    extracted: Dict[str, Any] = {}
    for key, spec in fields.items():
        if isinstance(spec, str):
            selector = spec
            attr = None
            many = False
        elif isinstance(spec, dict):
            selector = str(spec.get("selector") or "")
            attr = spec.get("attr")
            many = bool(spec.get("many", False))
        else:
            continue

        if not selector:
            continue

        nodes = soup.select(selector)
        if many:
            values = []
            for node in nodes:
                if attr:
                    value = node.get(attr)
                else:
                    value = " ".join(node.get_text(" ").split())
                if value:
                    values.append(value)
            extracted[key] = values
            continue

        node = nodes[0] if nodes else None
        if node is None:
            extracted[key] = None
            continue
        if attr:
            extracted[key] = node.get(attr)
        else:
            extracted[key] = " ".join(node.get_text(" ").split())

    return extracted


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "scraplingAvailable": Fetcher is not None,
        "dynamicFetcherAvailable": DynamicFetcher is not None,
    }


@app.post("/v1/fetch")
def fetch(payload: FetchRequest) -> Dict[str, Any]:
    try:
        result = _scrapling_fetch(payload.url, payload.mode, payload.timeoutMs)
        return {
            "ok": result.ok,
            "finalUrl": result.final_url,
            "statusCode": result.status_code,
            "fetcherUsed": result.fetcher_used,
            "blockedSuspected": result.blocked_suspected,
            "html": result.html if payload.returnHtml else None,
            "text": result.text if payload.returnText else None,
            "timings": {},
            "metadata": {
                "sessionKey": payload.sessionKey,
                "proxyStrategy": payload.proxyStrategy,
                "workerMode": _normalize_mode(payload.mode),
            },
        }
    except Exception as exc:  # pragma: no cover - runtime handling
        raise HTTPException(status_code=500, detail=f"fetch_failed: {exc}")


@app.post("/v1/crawl")
def crawl(payload: CrawlRequest) -> Dict[str, Any]:
    allowed = {urlparse(domain).hostname or domain for domain in (payload.allowedDomains or [])}
    allowed = {d.lower().replace("www.", "") for d in allowed if d}

    run_id = f"crawl-{uuid.uuid4()}"
    visited: set[str] = set()
    queued = deque([(url, 0) for url in payload.startUrls])
    pages: List[Dict[str, Any]] = []
    failed = 0

    while queued and len(pages) < payload.maxPages:
        current_url, depth = queued.popleft()
        normalized = current_url.strip()
        if not normalized or normalized in visited:
            continue
        visited.add(normalized)

        try:
            fetched = _scrapling_fetch(normalized, payload.mode, 20000)
        except Exception:
            failed += 1
            continue

        host = (urlparse(fetched.final_url or normalized).hostname or "").lower().replace("www.", "")
        if allowed and host and host not in allowed:
            continue

        pages.append(
            {
                "url": normalized,
                "finalUrl": fetched.final_url,
                "statusCode": fetched.status_code,
                "fetcherUsed": fetched.fetcher_used,
                "text": fetched.text,
                "html": fetched.html,
            }
        )

        if depth >= payload.maxDepth:
            continue

        soup = BeautifulSoup(fetched.html or "", "lxml")
        for anchor in soup.select("a[href]"):
            href = str(anchor.get("href") or "").strip()
            if not href:
                continue
            next_url = urljoin(fetched.final_url or normalized, href)
            parsed = urlparse(next_url)
            if parsed.scheme not in {"http", "https"}:
                continue
            next_host = (parsed.hostname or "").lower().replace("www.", "")
            if allowed and next_host not in allowed:
                continue
            if next_url in visited:
                continue
            queued.append((next_url, depth + 1))

    return {
        "ok": True,
        "runId": run_id,
        "summary": {
            "queued": len(payload.startUrls),
            "fetched": len(pages),
            "failed": failed,
        },
        "pages": pages,
    }


@app.post("/v1/extract")
def extract(payload: ExtractRequest) -> Dict[str, Any]:
    html = payload.snapshotHtml
    if not html and payload.url:
        fetched = _scrapling_fetch(payload.url, "AUTO", 20000)
        html = fetched.html

    if not html:
        raise HTTPException(status_code=400, detail="Either snapshotHtml or url is required")

    extracted = _extract_fields(html, payload.recipeSchema)
    confidence = 0.8 if extracted and any(v for v in extracted.values()) else 0.35
    signature = hashlib.sha256(str(extracted).encode("utf-8")).hexdigest()[:12]

    return {
        "ok": True,
        "extracted": extracted,
        "confidence": confidence,
        "warnings": [],
        "adaptiveUpdates": [
            {
                "key": f"extraction:{signature}",
                "element": {"signature": signature, "namespace": payload.adaptiveNamespace or "default"},
            }
        ],
    }
