from __future__ import annotations

import asyncio
from html.parser import HTMLParser
import importlib.util
import json
import os
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen


GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1"
SERPER_URL = "https://google.serper.dev/search"
GOOGLE_SEARCH_URL = "https://www.google.com/search"


def search_evidence_status() -> dict[str, object]:
    providers = _configured_providers()
    if providers:
        available = any(_provider_available(provider) for provider in providers)
        return {
            "configured": True,
            "available": available,
            "provider": providers[0],
            "providers": providers,
            "label": ", ".join(_provider_label(provider) for provider in providers),
            "reason": _providers_reason(providers, available),
        }
    return {
        "configured": False,
        "available": False,
        "provider": "off",
        "label": "No web evidence provider",
        "reason": "Set GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID, SERPER_API_KEY, or pass RIPPO_SEARCH_EVIDENCE_JSON from Electron to route with search-result context.",
    }


def collect_search_evidence(query: str, requested_pack: str = "all", limit: int = 5) -> dict[str, object]:
    normalized_query = " ".join(query.split())[:160]
    if os.environ.get("RIPPO_SEARCH_EVIDENCE", "1").strip().lower() in {"0", "false", "off"}:
        return _off_evidence(normalized_query, "Search evidence is disabled.")
    if not normalized_query:
        return _off_evidence(normalized_query, "Search evidence needs a query.")

    renderer_evidence = _renderer_evidence(normalized_query, requested_pack)
    if renderer_evidence is not None:
        return renderer_evidence

    providers = _configured_providers()
    if not providers:
        status = search_evidence_status()
        return {
            "enabled": False,
            "source": "off",
            "provider": "off",
            "query": normalized_query,
            "requestedPack": requested_pack,
            "results": [],
            "resultCount": 0,
            "reason": status["reason"],
        }

    errors: list[dict[str, str]] = []
    for provider in providers:
        try:
            results = _provider_search(provider, normalized_query, limit)
            return {
                "enabled": True,
                "source": provider,
                "provider": provider,
                "providers": providers,
                "label": _provider_label(provider),
                "query": normalized_query,
                "requestedPack": requested_pack,
                "results": results,
                "resultCount": len(results),
                "reason": "Read search-result context before routing.",
                "fallbackErrors": errors,
            }
        except Exception as exc:
            errors.append({"provider": provider, "error": str(exc)[:180]})

    return {
        "enabled": False,
        "source": providers[0],
        "provider": providers[0],
        "providers": providers,
        "label": _provider_label(providers[0]),
        "query": normalized_query,
        "requestedPack": requested_pack,
        "results": [],
        "resultCount": 0,
        "reason": "Search evidence failed; falling back to text-only routing.",
        "error": errors[-1]["error"] if errors else "No search evidence provider returned results.",
        "fallbackErrors": errors,
    }


def compact_search_evidence(evidence: dict[str, object], limit: int = 5) -> list[dict[str, object]]:
    results = evidence.get("results") if isinstance(evidence, dict) else []
    compact: list[dict[str, object]] = []
    for result in results if isinstance(results, list) else []:
        if not isinstance(result, dict):
            continue
        compact.append({
            "title": str(result.get("title") or "")[:120],
            "url": str(result.get("url") or "")[:240],
            "displayUrl": str(result.get("displayUrl") or "")[:120],
            "snippet": str(result.get("snippet") or "")[:260],
        })
        if len(compact) >= limit:
            break
    return compact


def _configured_providers() -> list[str]:
    forced = _env("RIPPO_SEARCH_PROVIDER").lower()
    if forced in {"google_cse", "serper", "crawl4ai_google"}:
        return [forced]
    providers: list[str] = []
    google_key = _env("GOOGLE_CSE_API_KEY", "GOOGLE_API_KEY")
    google_cx = _env("GOOGLE_CSE_ID", "GOOGLE_CX", "GOOGLE_SEARCH_ENGINE_ID")
    if google_key and google_cx:
        providers.append("google_cse")
    if _env("SERPER_API_KEY"):
        providers.append("serper")
    return providers


def _renderer_evidence(query: str, requested_pack: str) -> dict[str, object] | None:
    raw = os.environ.get("RIPPO_SEARCH_EVIDENCE_JSON", "").strip()
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {
            "enabled": False,
            "source": "electron",
            "provider": "electron",
            "query": query,
            "requestedPack": requested_pack,
            "results": [],
            "resultCount": 0,
            "reason": "Renderer search evidence was invalid JSON.",
        }
    if not isinstance(payload, dict):
        return None
    results = payload.get("results") if isinstance(payload.get("results"), list) else []
    return {
        "enabled": bool(payload.get("enabled")),
        "source": str(payload.get("source") or "electron_google")[:60],
        "provider": str(payload.get("provider") or payload.get("source") or "electron_google")[:60],
        "label": str(payload.get("label") or "Electron Google")[:80],
        "query": str(payload.get("query") or query)[:160],
        "requestedPack": str(payload.get("requestedPack") or requested_pack)[:40],
        "results": [result for result in results if isinstance(result, dict)][:10],
        "resultCount": int(payload.get("resultCount") or len(results)),
        "reason": str(payload.get("reason") or "Read search-result context in the desktop browser.")[:180],
    }


def _provider_search(provider: str, query: str, limit: int) -> list[dict[str, object]]:
    if provider == "google_cse":
        return _google_cse_search(query, limit)
    if provider == "serper":
        return _serper_search(query, limit)
    if provider == "crawl4ai_google":
        return _crawl4ai_google_search(query, limit)
    return []


def _google_cse_search(query: str, limit: int) -> list[dict[str, object]]:
    api_key = _env("GOOGLE_CSE_API_KEY", "GOOGLE_API_KEY")
    cx = _env("GOOGLE_CSE_ID", "GOOGLE_CX", "GOOGLE_SEARCH_ENGINE_ID")
    if not api_key or not cx:
        return []
    params = urlencode({
        "key": api_key,
        "cx": cx,
        "q": query,
        "num": str(max(1, min(limit, 10))),
    })
    payload = _fetch_json(f"{GOOGLE_CSE_URL}?{params}")
    items = payload.get("items") if isinstance(payload, dict) else []
    results: list[dict[str, object]] = []
    for index, item in enumerate(items if isinstance(items, list) else [], start=1):
        if not isinstance(item, dict):
            continue
        url = str(item.get("link") or "").strip()
        if not url:
            continue
        results.append({
            "title": str(item.get("title") or "").strip()[:180],
            "url": url[:500],
            "displayUrl": str(item.get("displayLink") or "").strip()[:180],
            "snippet": str(item.get("snippet") or "").strip()[:500],
            "position": index,
        })
    return results


def _serper_search(query: str, limit: int) -> list[dict[str, object]]:
    api_key = _env("SERPER_API_KEY")
    if not api_key:
        return []
    request = Request(
        SERPER_URL,
        data=json.dumps({"q": query, "num": max(1, min(limit, 10))}).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-API-KEY": api_key,
            "User-Agent": "Rippopotamus/0.1 query-scout",
        },
        method="POST",
    )
    with urlopen(request, timeout=8) as response:
        payload = json.loads(response.read().decode("utf-8", errors="replace"))
    organic = payload.get("organic") if isinstance(payload, dict) else []
    results: list[dict[str, object]] = []
    for index, item in enumerate(organic if isinstance(organic, list) else [], start=1):
        if not isinstance(item, dict):
            continue
        url = str(item.get("link") or "").strip()
        if not url:
            continue
        results.append({
            "title": str(item.get("title") or "").strip()[:180],
            "url": url[:500],
            "displayUrl": str(item.get("source") or "").strip()[:180],
            "snippet": str(item.get("snippet") or "").strip()[:500],
            "position": index,
        })
    return results


def _crawl4ai_google_search(query: str, limit: int) -> list[dict[str, object]]:
    try:
        return asyncio.run(_crawl4ai_google_search_async(query, limit))
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(_crawl4ai_google_search_async(query, limit))
        finally:
            loop.close()


async def _crawl4ai_google_search_async(query: str, limit: int) -> list[dict[str, object]]:
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
    except Exception as exc:
        raise RuntimeError("Install crawl4ai to use RIPPO_SEARCH_PROVIDER=crawl4ai_google.") from exc

    params = urlencode({
        "q": query,
        "num": str(max(1, min(limit + 4, 10))),
        "hl": os.environ.get("RIPPO_SEARCH_LANG", "en"),
        "safe": os.environ.get("RIPPO_GOOGLE_SAFE", "active"),
        "pws": "0",
    })
    url = f"{GOOGLE_SEARCH_URL}?{params}"

    browser_config = BrowserConfig(headless=True, verbose=False)
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=20000,
        wait_for="css:body",
        simulate_user=True,
        magic=True,
    )
    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(url=url, config=run_config)

    if not getattr(result, "success", False):
        raise RuntimeError(str(getattr(result, "error_message", "Google SERP crawl failed."))[:180])
    html = str(getattr(result, "html", "") or getattr(result, "cleaned_html", "") or "")
    if _looks_blocked_serp(html):
        raise RuntimeError("Google returned a consent, CAPTCHA, or unusual-traffic page.")
    return _parse_google_serp_html(html, limit)


def _parse_google_serp_html(html: str, limit: int) -> list[dict[str, object]]:
    parser = _GoogleSerpParser(limit)
    parser.feed(html)
    return parser.results


class _GoogleSerpParser(HTMLParser):
    def __init__(self, limit: int) -> None:
        super().__init__(convert_charrefs=True)
        self.limit = max(1, min(limit, 10))
        self.results: list[dict[str, object]] = []
        self._stack: list[str] = []
        self._noise_depth = 0
        self._current: dict[str, object] | None = None
        self._current_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {name.lower(): value or "" for name, value in attrs}
        if self._noise_depth or _is_noise_element(tag, attrs_dict):
            self._noise_depth += 1
        self._stack.append(tag)

        if tag != "a" or self._noise_depth or len(self.results) >= self.limit:
            return
        url = _extract_google_target(attrs_dict.get("href", ""))
        if not url or _is_noise_url(url):
            return
        self._current = {
            "title": "",
            "url": url[:500],
            "displayUrl": _display_url(url),
            "snippet": "",
            "position": len(self.results) + 1,
        }
        self._current_text = []

    def handle_endtag(self, tag: str) -> None:
        if self._current and tag == "a":
            title = _clean_text(" ".join(self._current_text))
            if title and not _looks_like_noise_text(title) and not _seen_url(self.results, str(self._current["url"])):
                self._current["title"] = title[:180]
                self.results.append(self._current)
            self._current = None
            self._current_text = []

        if self._stack:
            self._stack.pop()
        if self._noise_depth:
            self._noise_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._current is not None:
            self._current_text.append(data)


def _extract_google_target(href: str) -> str | None:
    href = (href or "").strip()
    if not href or href.startswith("#"):
        return None
    if href.startswith("/url?") or href.startswith("https://www.google.com/url?"):
        query = urlparse(href).query
        target = (parse_qs(query).get("q") or [""])[0].strip()
        return target or None
    if href.startswith("/search?") or href.startswith("/preferences?") or href.startswith("/support?"):
        return None
    if href.startswith("//"):
        return f"https:{href}"
    if href.startswith("http://") or href.startswith("https://"):
        return href
    return None


def _is_noise_element(tag: str, attrs: dict[str, str]) -> bool:
    haystack = " ".join([
        tag,
        " ".join(attrs.keys()),
        attrs.get("id", ""),
        attrs.get("class", ""),
        attrs.get("aria-label", ""),
        attrs.get("role", ""),
        attrs.get("data-text-ad", ""),
    ]).lower()
    markers = (
        "sponsored",
        "ads-ad",
        "commercial-unit",
        "pla-unit",
        "shopping",
        "kp-blk",
        "knowledge-panel",
        "related-question",
        "people also ask",
        "data-text-ad",
    )
    return any(marker in haystack for marker in markers)


def _is_noise_url(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    path = parsed.path.lower()
    if not parsed.scheme.startswith("http"):
        return True
    blocked_hosts = (
        "google.com",
        "www.google.com",
        "accounts.google.com",
        "support.google.com",
        "policies.google.com",
        "maps.google.",
        "webcache.googleusercontent.com",
        "googleadservices.com",
        "doubleclick.net",
    )
    if host in blocked_hosts or any(host.endswith(f".{blocked}") for blocked in blocked_hosts):
        return True
    blocked_parts = ("/aclk", "/shopping", "/preferences", "/setprefs")
    return any(part in path for part in blocked_parts)


def _looks_blocked_serp(html: str) -> bool:
    lower = html.lower()
    markers = (
        "our systems have detected unusual traffic",
        "sorry/index",
        "recaptcha",
        "consent.google.com",
        "before you continue to google",
    )
    return any(marker in lower for marker in markers)


def _looks_like_noise_text(text: str) -> bool:
    lower = text.lower()
    if lower in {"cached", "similar", "translate this page", "sponsored", "ad"}:
        return True
    return len(text) < 2


def _seen_url(results: list[dict[str, object]], url: str) -> bool:
    return any(result.get("url") == url for result in results)


def _clean_text(text: str) -> str:
    return " ".join(text.split())


def _display_url(url: str) -> str:
    parsed = urlparse(url)
    return parsed.netloc.removeprefix("www.")[:180]


def _fetch_json(url: str) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": "Rippopotamus/0.1 query-scout"})
    with urlopen(request, timeout=8) as response:
        payload = json.loads(response.read().decode("utf-8", errors="replace"))
    return payload if isinstance(payload, dict) else {}


def _off_evidence(query: str, reason: str) -> dict[str, object]:
    return {
        "enabled": False,
        "source": "off",
        "provider": "off",
        "query": query,
        "requestedPack": "all",
        "results": [],
        "resultCount": 0,
        "reason": reason,
    }


def _provider_label(provider: str) -> str:
    if provider == "google_cse":
        return "Google Programmable Search"
    if provider == "serper":
        return "Serper Google Search"
    if provider == "crawl4ai_google":
        return "Crawl4AI Google"
    return provider


def _provider_available(provider: str) -> bool:
    if provider == "crawl4ai_google":
        return importlib.util.find_spec("crawl4ai") is not None
    return True


def _provider_reason(provider: str, available: bool) -> str:
    if provider == "crawl4ai_google" and not available:
        return "RIPPO_SEARCH_PROVIDER=crawl4ai_google is set, but crawl4ai is not installed."
    if provider == "crawl4ai_google":
        return "Crawl4AI Google fallback is enabled; Google may still block or vary results."
    return "Search evidence is available for query routing."


def _providers_reason(providers: list[str], available: bool) -> str:
    if not available:
        return _provider_reason(providers[0], available)
    if len(providers) > 1:
        return "Search evidence will try configured providers in order and fall through on provider errors."
    return _provider_reason(providers[0], available)


def _env(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""
