from __future__ import annotations

import json
import os
import time
from typing import Any
from urllib.request import Request, urlopen

from rippopotamus.search_evidence import collect_search_evidence, compact_search_evidence


DEFAULT_OPENROUTER_MODEL = "openrouter/free"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

PACK_LABELS = {
    "all": "All",
    "movies": "Movies and shows",
    "starter": "Best starting points",
    "public": "Public archives",
    "stock": "Free stock media",
    "tools": "Media tools",
}


def build_query_intelligence(query: str, requested_pack: str) -> dict[str, object]:
    normalized_query = " ".join(query.split())[:160]
    normalized_pack = requested_pack if requested_pack in PACK_LABELS else "all"
    if os.environ.get("RIPPO_AI_INTELLIGENCE", "1").strip().lower() in {"0", "false", "off"}:
        return _off_intelligence(normalized_query, normalized_pack, "AI routing is disabled.")

    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        return _off_intelligence(normalized_query, normalized_pack, "Set OPENROUTER_API_KEY to enable AI routing.")

    evidence = collect_search_evidence(normalized_query, normalized_pack)
    try:
        payload = _call_openrouter(normalized_query, normalized_pack, api_key, evidence)
        return _normalize_ai_payload(payload, normalized_query, normalized_pack, evidence)
    except Exception as exc:
        fallback = _off_intelligence(normalized_query, normalized_pack, "AI routing failed; using normal search routing.")
        fallback["error"] = str(exc)[:180]
        fallback["webEvidence"] = evidence
        return fallback


def effective_pack(requested_pack: str, intelligence: dict[str, object]) -> str:
    requested = requested_pack if requested_pack in PACK_LABELS else "all"
    if requested != "all":
        return requested
    if not intelligence.get("enabled"):
        return requested

    pack = str(intelligence.get("pack") or "all")
    confidence = _float(intelligence.get("confidence"), 0.0)
    if pack in PACK_LABELS and pack != "all" and confidence >= 0.62:
        return pack
    return requested


def openrouter_model_catalog(refresh: bool = False, selected_model: str | None = None) -> dict[str, object]:
    cache_path = os.environ.get("RIPPO_OPENROUTER_MODELS_CACHE", "").strip()
    selected = (selected_model or os.environ.get("OPENROUTER_MODEL", "") or DEFAULT_OPENROUTER_MODEL).strip()
    api_key_present = bool(os.environ.get("OPENROUTER_API_KEY", "").strip())
    payload: dict[str, Any] | None = None
    cache_hit = False
    error = None

    if cache_path and not refresh:
        payload = _read_json_file(cache_path)
        cache_hit = payload is not None

    if payload is None:
        try:
            payload = _fetch_models_payload()
            if cache_path:
                _write_json_file(cache_path, payload)
        except Exception as exc:
            error = str(exc)[:180]
            payload = _read_json_file(cache_path) if cache_path else None
            cache_hit = payload is not None

    models = _free_chat_models(payload or {})
    if not any(model["id"] == DEFAULT_OPENROUTER_MODEL for model in models):
        models.insert(0, _model_payload({
            "id": DEFAULT_OPENROUTER_MODEL,
            "name": "Free Models Router",
            "context_length": None,
            "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
        }))
    if selected and not any(model["id"] == selected for model in models):
        selected = DEFAULT_OPENROUTER_MODEL

    return {
        "ok": True,
        "apiKeyPresent": api_key_present,
        "selectedModel": selected or DEFAULT_OPENROUTER_MODEL,
        "defaultModel": DEFAULT_OPENROUTER_MODEL,
        "models": models,
        "cached": cache_hit,
        "cachePath": cache_path,
        "fetchedAt": (payload or {}).get("fetchedAt"),
        "error": error,
    }


def _call_openrouter(query: str, requested_pack: str, api_key: str, evidence: dict[str, object] | None = None) -> dict[str, Any]:
    model = os.environ.get("OPENROUTER_MODEL", DEFAULT_OPENROUTER_MODEL).strip() or DEFAULT_OPENROUTER_MODEL
    evidence_results = compact_search_evidence(evidence or {})
    body = {
        "model": model,
        "temperature": 0,
        "max_tokens": 220,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a tiny routing brain for a media search desktop app. "
                    "Classify the user query into exactly one pack id: all, movies, starter, public, stock, tools. "
                    "Use webEvidence snippets and domains first when present; they are search-result context, not final sources. "
                    "Use movies for movie/show/title/person entertainment lookup. "
                    "Use public for NASA/space/history/public archive style media. "
                    "Use stock for generic stock photos, b-roll, SFX, music, or creator assets. "
                    "Use tools only when the user asks for converters, download helpers, editors, or utilities. "
                    "Return compact JSON only: "
                    "{\"pack\":\"movies\",\"confidence\":0.0,\"reason\":\"short\",\"searchTerms\":[\"term\"],\"ui\":\"result-list\"}."
                ),
            },
            {
                "role": "user",
                "content": json.dumps({
                    "query": query,
                    "requestedPack": requested_pack,
                    "packs": PACK_LABELS,
                    "webEvidence": {
                        "enabled": bool((evidence or {}).get("enabled")),
                        "source": (evidence or {}).get("source") or "off",
                        "results": evidence_results,
                    },
                }, ensure_ascii=True),
            },
        ],
    }
    request = Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-Title": "Rippopotamus",
        },
        method="POST",
    )
    with urlopen(request, timeout=8) as response:
        completion = json.loads(response.read().decode("utf-8", errors="replace"))

    content = (((completion.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    return _parse_json_object(content)


def _normalize_ai_payload(payload: dict[str, Any], query: str, requested_pack: str, evidence: dict[str, object] | None = None) -> dict[str, object]:
    pack = str(payload.get("pack") or "all").strip().lower()
    if pack not in PACK_LABELS:
        pack = "all"
    confidence = max(0.0, min(1.0, _float(payload.get("confidence"), 0.0)))
    search_terms = payload.get("searchTerms")
    if not isinstance(search_terms, list):
        search_terms = []

    return {
        "enabled": True,
        "source": "openrouter",
        "requestedPack": requested_pack,
        "pack": pack,
        "packLabel": PACK_LABELS[pack],
        "confidence": confidence,
        "reason": str(payload.get("reason") or "AI routed this query.").strip()[:180],
        "searchTerms": [str(term).strip()[:80] for term in search_terms if str(term).strip()][:5],
        "ui": str(payload.get("ui") or "result-list").strip()[:40],
        "query": query,
        "webEvidence": evidence or {},
    }


def _off_intelligence(query: str, requested_pack: str, reason: str) -> dict[str, object]:
    return {
        "enabled": False,
        "source": "off",
        "requestedPack": requested_pack,
        "pack": requested_pack,
        "packLabel": PACK_LABELS.get(requested_pack, PACK_LABELS["all"]),
        "confidence": 0.0,
        "reason": reason,
        "searchTerms": [],
        "ui": "result-list",
        "query": query,
    }


def _parse_json_object(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            parsed = json.loads(content[start:end + 1])
            return parsed if isinstance(parsed, dict) else {}
        raise


def _float(value: object, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _fetch_models_payload() -> dict[str, Any]:
    request = Request(OPENROUTER_MODELS_URL, headers={"User-Agent": "Rippopotamus/0.1 model-catalog"})
    with urlopen(request, timeout=8) as response:
        payload = json.loads(response.read().decode("utf-8", errors="replace"))
    if isinstance(payload, dict):
        payload["fetchedAt"] = int(time.time())
        return payload
    return {"data": [], "fetchedAt": int(time.time())}


def _free_chat_models(payload: dict[str, Any]) -> list[dict[str, object]]:
    data = payload.get("data") if isinstance(payload, dict) else []
    models = []
    for model in data if isinstance(data, list) else []:
        if not isinstance(model, dict):
            continue
        model_id = str(model.get("id") or "")
        if model_id == DEFAULT_OPENROUTER_MODEL or model_id.endswith(":free") or _pricing_is_free(model.get("pricing")):
            architecture = model.get("architecture") if isinstance(model.get("architecture"), dict) else {}
            output_modalities = architecture.get("output_modalities") if isinstance(architecture, dict) else []
            if not _is_text_only_output(output_modalities):
                continue
            models.append(_model_payload(model))
    models.sort(key=lambda item: (0 if item["id"] == DEFAULT_OPENROUTER_MODEL else 1, item["name"].lower()))
    return models


def _pricing_is_free(pricing: object) -> bool:
    if not isinstance(pricing, dict):
        return False
    keys = ("prompt", "completion", "request", "web_search", "internal_reasoning")
    return all(str(pricing.get(key, "0")).strip() in {"0", "0.0", "0.000000", ""} for key in keys)


def _is_text_only_output(output_modalities: object) -> bool:
    if not isinstance(output_modalities, list):
        return False
    normalized = [str(modality).strip().lower() for modality in output_modalities if str(modality).strip()]
    return normalized == ["text"]


def _model_payload(model: dict[str, Any]) -> dict[str, object]:
    architecture = model.get("architecture") if isinstance(model.get("architecture"), dict) else {}
    return {
        "id": str(model.get("id") or DEFAULT_OPENROUTER_MODEL),
        "name": str(model.get("name") or model.get("id") or DEFAULT_OPENROUTER_MODEL),
        "contextLength": model.get("context_length"),
        "inputModalities": architecture.get("input_modalities") if isinstance(architecture.get("input_modalities"), list) else [],
        "outputModalities": architecture.get("output_modalities") if isinstance(architecture.get("output_modalities"), list) else [],
    }


def _read_json_file(path: str) -> dict[str, Any] | None:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _write_json_file(path: str, payload: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)
