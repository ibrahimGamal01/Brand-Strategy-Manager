from __future__ import annotations

import os
import re
import threading
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence


def _split_proxy_values(raw: str) -> List[str]:
    return [token.strip() for token in re.split(r"[\s,;]+", raw or "") if token.strip()]


def _normalize_proxy_url(value: str) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = f"http://{raw}"
    return raw


def normalize_proxy_url(value: str) -> Optional[str]:
    return _normalize_proxy_url(value)


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
    if not path or not os.path.exists(path):
        return []

    loaded: List[str] = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            loaded.append(stripped)
    return loaded


def redact_proxy_url(proxy_url: Optional[str]) -> str:
    value = str(proxy_url or "").strip()
    if not value:
        return "direct"
    try:
        scheme, rest = value.split("://", 1)
        if "@" in rest:
            host_part = rest.split("@", 1)[1]
            return f"{scheme}://***:***@{host_part}"
        return value
    except Exception:
        return "proxy://invalid"


def normalize_proxy_strategy(value: str) -> str:
    raw = str(value or "NONE").strip().upper()
    if raw in {"NONE", "FIXED", "ROTATE"}:
        return raw
    return "NONE"


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
        list_env_keys: Sequence[str],
        file_env_key: str = "PROXY_LIST_PATH",
    ) -> "ProxyRotator":
        proxies: List[str] = []
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

    def mark_failed(self, proxy_url: Optional[str]) -> None:
        if not proxy_url:
            return
        with self.lock:
            self.failed_proxies.add(proxy_url)

    def mark_success(self, proxy_url: Optional[str]) -> None:
        if not proxy_url:
            return
        with self.lock:
            if proxy_url in self.failed_proxies:
                self.failed_proxies.remove(proxy_url)


def resolve_fixed_proxy_url() -> Optional[str]:
    for key in ("SCRAPLING_PROXY_URL", "SCRAPER_PROXY_URL", "PROXY_URL"):
        normalized = _normalize_proxy_url(os.environ.get(key, ""))
        if normalized:
            return normalized
    return None


def build_rotate_proxy_rotator() -> ProxyRotator:
    return ProxyRotator.from_env_and_file(
        list_env_keys=("SCRAPLING_PROXY_URLS", "SCRAPER_PROXY_URLS", "PROXY_URLS"),
        file_env_key="PROXY_LIST_PATH",
    )


@dataclass
class ProxySelection:
    requested_strategy: str
    resolved_strategy: str
    proxy_url: Optional[str]

    @property
    def proxy_target(self) -> str:
        return redact_proxy_url(self.proxy_url)


def resolve_proxy_selection(
    strategy: str, rotator: ProxyRotator, explicit_proxy_url: Optional[str] = None
) -> ProxySelection:
    requested = normalize_proxy_strategy(strategy)
    explicit = normalize_proxy_url(explicit_proxy_url or "")
    if explicit:
        return ProxySelection(requested, "EXPLICIT", explicit)

    if requested == "NONE":
        return ProxySelection(requested, "NONE", None)

    if requested == "FIXED":
        proxy_url = resolve_fixed_proxy_url()
        if proxy_url:
            return ProxySelection(requested, "FIXED", proxy_url)
        return ProxySelection(requested, "NONE", None)

    # requested == "ROTATE"
    proxy_url = rotator.get_next_proxy_url()
    if proxy_url:
        return ProxySelection(requested, "ROTATE", proxy_url)
    return ProxySelection(requested, "NONE", None)
