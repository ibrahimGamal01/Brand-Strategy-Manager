#!/usr/bin/env python3
from __future__ import annotations

import os
import random
import re
import sys
import threading
import time
from typing import Callable, Iterable, List, Optional, Sequence, TypeVar

T = TypeVar("T")

DEFAULT_RETRY_ATTEMPTS = 4
_RETRYABLE_TOKENS = (
    "timeout",
    "timed out",
    "temporarily unavailable",
    "too many requests",
    "rate limit",
    "connection reset",
    "connection aborted",
    "connection refused",
    "proxy",
    "tls",
    "ssl",
    "econn",
    "etimedout",
    "ehostunreach",
    "eai_again",
    "429",
    "503",
    "502",
)


def _parse_boolean_env(value: str, fallback: bool = False) -> bool:
    raw = str(value or "").strip().lower()
    if not raw:
        return fallback
    if raw in {"1", "true", "yes", "y", "on"}:
        return True
    if raw in {"0", "false", "no", "n", "off"}:
        return False
    return fallback


def _split_proxy_values(raw: str) -> List[str]:
    return [token.strip() for token in re.split(r"[\s,;]+", raw or "") if token.strip()]


def _normalize_proxy_url(value: str) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = f"http://{raw}"
    return raw


def _dedupe_keep_order(values: Iterable[str]) -> List[str]:
    seen = set()
    deduped: List[str] = []
    for value in values:
        normalized = _normalize_proxy_url(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def _load_proxies_from_file(file_path: str) -> List[str]:
    path = str(file_path or "").strip()
    if not path:
        return []
    if not os.path.exists(path):
        print(f"[Proxy] Proxy file not found: {path}", file=sys.stderr)
        return []

    loaded: List[str] = []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                loaded.append(stripped)
    except Exception as exc:
        print(f"[Proxy] Failed to load proxy file {path}: {exc}", file=sys.stderr)
        return []
    return loaded


def redact_proxy_url(proxy_url: str) -> str:
    value = str(proxy_url or "").strip()
    if not value:
        return "direct"
    try:
        # Keep scheme + host + port, redact credentials if present.
        scheme, rest = value.split("://", 1)
        if "@" in rest:
            host_part = rest.split("@", 1)[1]
            return f"{scheme}://***:***@{host_part}"
        return value
    except Exception:
        return "proxy://invalid"


def get_retry_attempts(default: int = DEFAULT_RETRY_ATTEMPTS) -> int:
    raw = str(os.environ.get("PY_PROXY_MAX_RETRIES", "")).strip()
    if not raw:
        return max(1, int(default))
    try:
        return max(1, int(raw))
    except Exception:
        return max(1, int(default))


def compute_backoff_seconds(
    attempt: int,
    *,
    base_seconds: float = 0.35,
    max_seconds: float = 4.0,
    jitter_seconds: float = 0.25,
) -> float:
    safe_attempt = max(1, int(attempt))
    wait = min(max_seconds, base_seconds * (2 ** (safe_attempt - 1)))
    wait += random.random() * max(0.0, jitter_seconds)
    return max(0.0, wait)


def is_retryable_proxy_error(error: Exception) -> bool:
    message = str(error or "").lower()
    if not message:
        return False
    return any(token in message for token in _RETRYABLE_TOKENS)


class ProxyRotator:
    def __init__(self, proxy_list: Sequence[str] | None = None):
        self.proxies: List[str] = _dedupe_keep_order(proxy_list or [])
        self.current_index = 0
        self.failed_proxies = set()
        self.lock = threading.Lock()

    @classmethod
    def from_env_and_file(
        cls,
        *,
        single_env_keys: Sequence[str] = ("SCRAPER_PROXY_URL", "PROXY_URL"),
        list_env_keys: Sequence[str] = ("SCRAPER_PROXY_URLS", "PROXY_URLS"),
        file_env_key: str = "PROXY_LIST_PATH",
    ) -> "ProxyRotator":
        if _parse_boolean_env(os.environ.get("SCRAPER_PROXY_FORCE_DIRECT", ""), False):
            return cls([])

        if _parse_boolean_env(os.environ.get("SCRAPER_PROXY_DISABLE_SELF_ROTATION", ""), False):
            injected = _normalize_proxy_url(os.environ.get("SCRAPER_PROXY_URL", ""))
            return cls([injected] if injected else [])

        proxies: List[str] = []

        for key in single_env_keys:
            value = str(os.environ.get(key, "")).strip()
            if value:
                proxies.append(value)

        for key in list_env_keys:
            proxies.extend(_split_proxy_values(os.environ.get(key, "")))

        file_path = str(os.environ.get(file_env_key, "")).strip()
        if file_path:
            proxies.extend(_load_proxies_from_file(file_path))

        return cls(proxies)

    def has_proxies(self) -> bool:
        return bool(self.proxies)

    def get_next_proxy_url(self) -> Optional[str]:
        with self.lock:
            if not self.proxies:
                return None

            available = [p for p in self.proxies if p not in self.failed_proxies]
            if not available:
                self.failed_proxies.clear()
                available = list(self.proxies)

            proxy_url = available[self.current_index % len(available)]
            self.current_index += 1
            return proxy_url

    def get_next_requests_proxy(self) -> Optional[dict]:
        proxy_url = self.get_next_proxy_url()
        if not proxy_url:
            return None
        return {"http": proxy_url, "https": proxy_url}

    def mark_failed(self, proxy_url: Optional[str]) -> None:
        if not proxy_url:
            return
        with self.lock:
            self.failed_proxies.add(proxy_url)
            print(f"[Proxy] Marked failed: {redact_proxy_url(proxy_url)}", file=sys.stderr)

    def mark_success(self, proxy_url: Optional[str]) -> None:
        if not proxy_url:
            return
        with self.lock:
            if proxy_url in self.failed_proxies:
                self.failed_proxies.remove(proxy_url)


def run_with_proxy_retry(
    operation: Callable[[Optional[str], int], T],
    *,
    proxy_rotator: Optional[ProxyRotator] = None,
    max_attempts: Optional[int] = None,
    retry_predicate: Callable[[Exception], bool] = is_retryable_proxy_error,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> T:
    rotator = proxy_rotator or ProxyRotator.from_env_and_file()
    attempts = max(1, int(max_attempts or get_retry_attempts()))
    last_error: Optional[Exception] = None

    for attempt in range(1, attempts + 1):
        proxy_url = rotator.get_next_proxy_url()
        try:
            return operation(proxy_url, attempt)
        except Exception as exc:
            last_error = exc
            if proxy_url:
                rotator.mark_failed(proxy_url)

            if attempt >= attempts or not retry_predicate(exc):
                raise

            sleep_fn(compute_backoff_seconds(attempt))

    if last_error:
        raise last_error
    raise RuntimeError("Proxy retry failed without explicit error")
