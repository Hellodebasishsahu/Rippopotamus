from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import parse, request

from rippopotamus.desktop_runtime import qbittorrent_status
from rippopotamus.providers import friendly_error, qbittorrent_nox_base


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True), flush=True)


def parse_aria2_progress(line: str) -> dict[str, Any] | None:
    percent_match = re.search(r"\((\d+)%\)", line)
    if not percent_match:
        return None
    speed_match = re.search(r"DL:([^\s\]]+)", line)
    eta_match = re.search(r"ETA:([^\s\]]+)", line)
    return {
        "percent": float(percent_match.group(1)),
        "speed": speed_match.group(1) if speed_match else None,
        "eta": eta_match.group(1) if eta_match else None,
    }


def snapshot_files(root: Path) -> set[Path]:
    return {path for path in root.rglob("*") if path.is_file() and not any(part.startswith(".") for part in path.relative_to(root).parts)}


@dataclass
class QBitSession:
    base_url: str
    cookie: str | None = None


class QBitUnavailable(RuntimeError):
    pass


def qbt_profile_root() -> Path:
    configured = os.environ.get("RIPPO_QBITTORRENT_PROFILE_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".cache" / "rippopotamus" / "qbittorrent"


def qbt_webui_port() -> int:
    raw = os.environ.get("RIPPO_QBITTORRENT_WEBUI_PORT", "").strip()
    if not raw:
        return 39080
    try:
        port = int(raw)
    except ValueError as exc:
        raise QBitUnavailable("Torrent support has an invalid local port setting.") from exc
    if port < 1024 or port > 65535:
        raise QBitUnavailable("Torrent support has an invalid local port setting.")
    return port


def qbt_config_dir(profile: Path) -> Path:
    return profile / "qBittorrent_rippo" / "config"


def write_qbt_config(profile: Path, port: int, output_root: Path) -> None:
    save_path = (output_root / "Files").resolve()
    temp_path = (profile / "incomplete").resolve()
    config_path = qbt_config_dir(profile) / "qBittorrent.conf"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        "\n".join([
            "[LegalNotice]",
            "Accepted=true",
            "",
            "[Preferences]",
            "Bittorrent\\DHT=true",
            "Bittorrent\\LSD=true",
            "Bittorrent\\PeX=true",
            "Downloads\\SavePath=" + str(save_path),
            "Downloads\\TempPath=" + str(temp_path),
            "Downloads\\TempPathEnabled=true",
            "Queueing\\QueueingEnabled=false",
            "WebUI\\Address=127.0.0.1",
            "WebUI\\AuthSubnetWhitelist=127.0.0.1",
            "WebUI\\AuthSubnetWhitelistEnabled=true",
            "WebUI\\Enabled=true",
            "WebUI\\LocalHostAuth=false",
            "WebUI\\Port=" + str(port),
            "",
        ]),
        encoding="utf-8",
    )


def qbt_request(
    session: QBitSession,
    path: str,
    *,
    data: bytes | None = None,
    content_type: str | None = None,
    timeout: float = 8,
) -> tuple[int, str, dict[str, str]]:
    headers = {
        "Accept": "*/*",
        "Origin": session.base_url,
        "Referer": f"{session.base_url}/",
        "User-Agent": "Rippopotamus",
    }
    if content_type:
        headers["Content-Type"] = content_type
    if session.cookie:
        headers["Cookie"] = session.cookie
    req = request.Request(f"{session.base_url}{path}", data=data, headers=headers, method="POST" if data is not None else "GET")
    with request.urlopen(req, timeout=timeout) as response:
        return response.status, response.read().decode("utf-8", errors="replace"), dict(response.headers)


def qbt_login(session: QBitSession) -> bool:
    payload = parse.urlencode({"username": "admin", "password": "adminadmin"}).encode("utf-8")
    try:
        _status, body, headers = qbt_request(
            session,
            "/api/v2/auth/login",
            data=payload,
            content_type="application/x-www-form-urlencoded",
        )
    except Exception:
        return False
    cookie = headers.get("Set-Cookie")
    if cookie:
        session.cookie = cookie.split(";", 1)[0]
    return body.strip().lower() == "ok."


def qbt_api_ready(session: QBitSession) -> bool:
    try:
        qbt_request(session, "/api/v2/app/version", timeout=2)
        return True
    except urlerror.HTTPError as exc:
        if exc.code in {401, 403} and qbt_login(session):
            try:
                qbt_request(session, "/api/v2/app/version", timeout=2)
                return True
            except Exception:
                return False
        return False
    except Exception:
        return False


def ensure_qbt_daemon(output_root: Path) -> QBitSession:
    profile = qbt_profile_root()
    port = qbt_webui_port()
    session = QBitSession(f"http://127.0.0.1:{port}")
    if qbt_api_ready(session):
        return session

    write_qbt_config(profile, port, output_root)
    try:
        subprocess.Popen(
            [
                *qbittorrent_nox_base(),
                "--daemon",
                f"--webui-port={port}",
                f"--profile={profile}",
                "--configuration=rippo",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as exc:
        raise QBitUnavailable("Torrent support could not start.") from exc

    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if qbt_api_ready(session):
            return session
        time.sleep(0.5)
    raise QBitUnavailable("Torrent support did not start in time.")


def qbt_json(session: QBitSession, path: str) -> Any:
    _status, body, _headers = qbt_request(session, path)
    return json.loads(body or "null")


def multipart_form(fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = f"----rippo-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
            str(value).encode("utf-8"),
            b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def qbt_post_form(session: QBitSession, path: str, fields: dict[str, str]) -> str:
    data, content_type = multipart_form(fields)
    _status, body, _headers = qbt_request(session, path, data=data, content_type=content_type)
    return body


def qbt_post_urlencoded(session: QBitSession, path: str, fields: dict[str, str]) -> str:
    data = parse.urlencode(fields).encode("utf-8")
    _status, body, _headers = qbt_request(session, path, data=data, content_type="application/x-www-form-urlencoded")
    return body


def qbt_torrents(session: QBitSession) -> list[dict[str, Any]]:
    payload = qbt_json(session, "/api/v2/torrents/info")
    return payload if isinstance(payload, list) else []


def magnet_info_hash(url: str) -> str | None:
    if not url.lower().startswith("magnet:"):
        return None
    params = parse.parse_qs(parse.urlsplit(url).query)
    for xt in params.get("xt", []):
        if not xt.lower().startswith("urn:btih:"):
            continue
        value = xt.rsplit(":", 1)[-1].strip()
        if re.fullmatch(r"[0-9a-fA-F]{40}", value):
            return value.lower()
        if re.fullmatch(r"[A-Z2-7a-z]{32}", value):
            padded = value.upper() + "=" * ((8 - len(value) % 8) % 8)
            return base64.b32decode(padded).hex()
    return None


def qbt_find_torrent(session: QBitSession, target_hash: str | None, before_hashes: set[str], item_id: str) -> dict[str, Any] | None:
    torrents = qbt_torrents(session)
    if target_hash:
        for torrent in torrents:
            if str(torrent.get("hash", "")).lower() == target_hash:
                return torrent
    for torrent in torrents:
        hash_value = str(torrent.get("hash", "")).lower()
        tags = {tag.strip() for tag in str(torrent.get("tags", "")).split(",")}
        if hash_value and hash_value not in before_hashes and (item_id in tags or "rippo" in tags):
            return torrent
    return None


def format_rate(bytes_per_second: Any) -> str | None:
    if not isinstance(bytes_per_second, (int, float)) or bytes_per_second <= 0:
        return None
    units = ["B/s", "KB/s", "MB/s", "GB/s"]
    value = float(bytes_per_second)
    unit = units[0]
    for unit in units:
        if value < 1024 or unit == units[-1]:
            break
        value /= 1024
    return f"{value:.1f}{unit}" if value < 10 and unit != "B/s" else f"{value:.0f}{unit}"


def format_eta(seconds: Any) -> str | None:
    if not isinstance(seconds, (int, float)) or seconds < 0 or seconds >= 86_400_000:
        return None
    seconds = int(seconds)
    if seconds >= 3600:
        return f"{seconds // 3600}h {(seconds % 3600) // 60}m"
    if seconds >= 60:
        return f"{seconds // 60}m {seconds % 60}s"
    return f"{seconds}s"


def command_qbittorrent_download(args: argparse.Namespace, root: Path) -> int:
    before = snapshot_files(root)
    item_id = args.item_id or uuid.uuid4().hex[:10]
    files_dir = root / "Files"
    files_dir.mkdir(parents=True, exist_ok=True)
    emit({"type": "started", "url": args.url, "preset": args.preset})
    emit({"type": "stage", "message": "Finding peers", "finalizing": False})

    session = ensure_qbt_daemon(root)
    before_hashes = {str(torrent.get("hash", "")).lower() for torrent in qbt_torrents(session) if torrent.get("hash")}
    target_hash = magnet_info_hash(args.url)

    try:
        add_result = qbt_post_form(
            session,
            "/api/v2/torrents/add",
            {
                "urls": args.url,
                "savepath": str(files_dir),
                "category": "Rippo",
                "tags": f"rippo,{item_id}",
                "paused": "false",
                "skip_checking": "false",
                "sequentialDownload": "false",
                "firstLastPiecePrio": "false",
                "autoTMM": "false",
            },
        )
        if add_result.strip().lower().startswith("fails"):
            raise QBitUnavailable("Torrent support could not add this link.")
    except Exception as exc:
        raise QBitUnavailable("Torrent support could not add this link.") from exc

    torrent: dict[str, Any] | None = None
    start_deadline = time.monotonic() + 45
    last_stage = "Finding peers"
    last_percent = -1
    while time.monotonic() < start_deadline:
        torrent = qbt_find_torrent(session, target_hash, before_hashes, item_id)
        if torrent:
            break
        time.sleep(1)
    if not torrent:
        emit({"type": "error", "error": "Torrent did not start. Try again or use another link."})
        return 1

    while True:
        torrent_hash = str(torrent.get("hash", "")).lower()
        latest = qbt_find_torrent(session, torrent_hash or target_hash, before_hashes, item_id)
        if latest:
            torrent = latest

        state = str(torrent.get("state", ""))
        progress = max(0.0, min(100.0, float(torrent.get("progress") or 0) * 100))
        speed = format_rate(torrent.get("dlspeed"))
        eta = format_eta(torrent.get("eta"))
        stage = "Finding peers" if state in {"metaDL", "stalledDL"} and progress < 1 else "Downloading"
        if state in {"checkingDL", "checkingUP", "checkingResumeData"}:
            stage = "Checking files"
        if progress >= 99.9:
            stage = "Saving"
        if stage != last_stage:
            last_stage = stage
            emit({"type": "stage", "message": stage, "finalizing": stage == "Saving"})
        rounded = round(progress)
        if rounded != last_percent:
            last_percent = rounded
            emit({"type": "progress", "percent": progress, "speed": speed, "eta": eta})

        if state in {"error", "missingFiles"}:
            emit({"type": "error", "error": "Torrent could not finish. Try again or use another link."})
            return 1
        if progress >= 99.9 and state in {"uploading", "stalledUP", "forcedUP", "pausedUP", "checkingUP"}:
            break
        time.sleep(1)

    torrent_hash = str(torrent.get("hash", "")).lower()
    if torrent_hash:
        try:
            qbt_post_urlencoded(session, "/api/v2/torrents/stop", {"hashes": torrent_hash})
        except Exception:
            try:
                qbt_post_urlencoded(session, "/api/v2/torrents/pause", {"hashes": torrent_hash})
            except Exception:
                pass
        try:
            qbt_post_urlencoded(session, "/api/v2/torrents/delete", {"hashes": torrent_hash, "deleteFiles": "false"})
        except Exception:
            pass

    after = snapshot_files(root)
    files = sorted(str(path.relative_to(root)) for path in after - before)
    emit({"type": "success", "files": files, "outputRoot": str(root), "warnings": []})
    return 0


def command_aria2_download(args: argparse.Namespace, root: Path, cmd: list[str]) -> int:
    before = snapshot_files(root)
    emit({"type": "started", "url": args.url, "preset": args.preset})
    emit({"type": "stage", "message": "Downloading torrent", "finalizing": False})

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    last_line = ""
    notices: list[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        last_line = line
        lower = line.lower()
        if "dht routing table" in lower:
            continue
        if "error" in lower or "failed" in lower or "download aborted" in lower:
            notices.append(line)
            continue
        if "download complete" in lower:
            emit({"type": "stage", "message": "Downloaded file", "finalizing": False})
            continue
        progress = parse_aria2_progress(line)
        if progress:
            emit({"type": "progress", **progress})

    code = process.wait()
    if code != 0:
        detail = next((n for n in reversed(notices) if "status=500" in n.lower()), notices[-1] if notices else last_line)
        emit({"type": "error", "error": friendly_error(detail)})
        return code

    after = snapshot_files(root)
    files = sorted(str(path.relative_to(root)) for path in after - before)
    emit({"type": "success", "files": files, "outputRoot": str(root), "warnings": []})
    return 0


def run_torrent_download(args: argparse.Namespace, root: Path, fallback_cmd: list[str]) -> int:
    if qbittorrent_status()["ok"]:
        try:
            return command_qbittorrent_download(args, root)
        except QBitUnavailable:
            pass
    return command_aria2_download(args, root, fallback_cmd)
