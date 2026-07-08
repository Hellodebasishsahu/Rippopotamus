from __future__ import annotations

import html
import http.cookiejar
import mimetypes
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable


DRIVE_HOSTS = {"drive.google.com", "drive.usercontent.google.com", "docs.google.com"}


def drive_file_id(url: str) -> str | None:
    parsed = urllib.parse.urlsplit(url)
    host = parsed.netloc.lower().split(":", 1)[0]
    if host not in DRIVE_HOSTS:
        return None

    match = re.search(r"/(?:file/)?d/([^/?#]+)", parsed.path)
    if match:
        return match.group(1)

    params = urllib.parse.parse_qs(parsed.query)
    for key in ("id", "fileid"):
        value = params.get(key, [""])[0].strip()
        if value:
            return value
    return None


def is_drive_file_url(url: str) -> bool:
    return drive_file_id(url) is not None


def drive_download_url(file_id: str) -> str:
    return f"https://drive.google.com/uc?export=download&id={urllib.parse.quote(file_id)}"


def drive_view_url(file_id: str) -> str:
    return f"https://drive.google.com/file/d/{urllib.parse.quote(file_id)}/view"


def drive_metadata(url: str, cookie_browser: str | None = None, yt_dlp_base: list[str] | None = None) -> dict[str, Any]:
    file_id = require_drive_file_id(url)
    with drive_opener(cookie_browser, yt_dlp_base, drive_view_url(file_id)) as opener:
        response = open_drive_response(opener, drive_download_url(file_id), method="HEAD")
        ensure_download_response(response.headers)
        return metadata_from_response(file_id, url, response.headers)


def download_drive_file(
    url: str,
    output_dir: Path,
    *,
    cookie_browser: str | None = None,
    yt_dlp_base: list[str] | None = None,
    emit: Callable[[dict[str, Any]], None] | None = None,
) -> list[str]:
    file_id = require_drive_file_id(url)
    output_dir.mkdir(parents=True, exist_ok=True)

    with drive_opener(cookie_browser, yt_dlp_base, drive_view_url(file_id)) as opener:
        response = open_drive_response(opener, drive_download_url(file_id))
        headers = response.headers
        disposition = headers.get("Content-Disposition", "")
        content_type = headers.get("Content-Type", "")
        if "attachment" not in disposition.lower() and "text/html" in content_type.lower():
            response.close()
            response = open_drive_confirmed_response(opener, file_id)
            headers = response.headers
            disposition = headers.get("Content-Disposition", "")
            content_type = headers.get("Content-Type", "")

        if "attachment" not in disposition.lower() and "text/html" in content_type.lower():
            raise SystemExit("Google Drive returned the file viewer instead of a downloadable file.")

        filename = safe_drive_filename(headers, file_id)
        destination = unique_path(output_dir / filename)
        total = int(headers.get("Content-Length") or 0)
        done = 0
        if emit:
            emit({"type": "phase", "kind": destination.suffix.lstrip(".") or "file", "destination": str(destination)})

        with response, destination.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                done += len(chunk)
                if emit and total > 0:
                    emit({"type": "progress", "percent": round(done * 100 / total, 2), "eta": None, "speed": None})

    return [str(destination)]


class DriveOpener:
    def __init__(self, opener: urllib.request.OpenerDirector, cookie_file: Path | None) -> None:
        self.opener = opener
        self.cookie_file = cookie_file

    def __enter__(self) -> urllib.request.OpenerDirector:
        return self.opener

    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        if self.cookie_file:
            self.cookie_file.unlink(missing_ok=True)


def drive_opener(cookie_browser: str | None, yt_dlp_base: list[str] | None, seed_url: str) -> DriveOpener:
    jar = http.cookiejar.MozillaCookieJar()
    cookie_file: Path | None = None
    if cookie_browser:
        cookie_file = export_browser_cookie_file(cookie_browser, yt_dlp_base, seed_url)
        jar.load(str(cookie_file), ignore_discard=True, ignore_expires=True)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [
        ("User-Agent", "Mozilla/5.0 Rippopotamus/0.1"),
        ("Accept", "*/*"),
    ]
    return DriveOpener(opener, cookie_file)


def export_browser_cookie_file(browser: str, yt_dlp_base: list[str] | None, seed_url: str) -> Path:
    base = yt_dlp_base or [shutil.which("yt-dlp") or "yt-dlp"]
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False)
    path = Path(handle.name)
    with handle:
        handle.write("# Netscape HTTP Cookie File\n\n")

    command = [
        *base,
        "--ignore-config",
        "--cookies-from-browser",
        browser,
        "--cookies",
        str(path),
        "--simulate",
        "--skip-download",
        "--no-playlist",
        "--ignore-no-formats-error",
        seed_url,
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    except Exception:
        path.unlink(missing_ok=True)
        raise

    if not has_cookie_rows(path):
        path.unlink(missing_ok=True)
        detail = "\n".join(part for part in [result.stdout, result.stderr] if part).strip()
        raise SystemExit(detail or "Browser cookies are unavailable.")
    return path


def has_cookie_rows(path: Path) -> bool:
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            return True
    return False


def open_drive_response(opener: urllib.request.OpenerDirector, url: str, method: str = "GET") -> Any:
    request = urllib.request.Request(url, method=method, headers={"Referer": "https://drive.google.com/"})
    try:
        return opener.open(request, timeout=30)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"Google Drive returned HTTP {exc.code}.") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Google Drive request failed: {exc.reason}") from exc


def open_drive_confirmed_response(opener: urllib.request.OpenerDirector, file_id: str) -> Any:
    response = open_drive_response(opener, drive_download_url(file_id))
    page = response.read(2 * 1024 * 1024).decode("utf-8", errors="ignore")
    response.close()
    warning_form_url = confirmed_download_url_from_warning_page(page)
    if warning_form_url:
        return open_drive_response(opener, warning_form_url)
    match = re.search(r'href="([^"]*(?:confirm=|download_warning)[^"]*)"', page)
    if not match:
        match = re.search(r'action="([^"]+)"', page)
    if not match:
        raise SystemExit("Google Drive needs a browser confirmation that Rippo could not resolve.")
    confirmed = html.unescape(match.group(1))
    confirmed_url = urllib.parse.urljoin("https://drive.google.com/", confirmed)
    return open_drive_response(opener, confirmed_url)


def confirmed_download_url_from_warning_page(page: str) -> str | None:
    form_match = re.search(r'<form[^>]+id="download-form"[^>]*action="([^"]+)"[^>]*>(.*?)</form>', page, flags=re.IGNORECASE | re.DOTALL)
    if not form_match:
        return None
    action = html.unescape(form_match.group(1))
    body = form_match.group(2)
    params: list[tuple[str, str]] = []
    for name, value in re.findall(r'<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"', body, flags=re.IGNORECASE):
        params.append((html.unescape(name), html.unescape(value)))
    if not params:
        return None
    separator = "&" if urllib.parse.urlsplit(action).query else "?"
    return urllib.parse.urljoin("https://drive.google.com/", action) + separator + urllib.parse.urlencode(params)


def ensure_download_response(headers: Any) -> None:
    disposition = headers.get("Content-Disposition", "")
    content_type = headers.get("Content-Type", "")
    if "attachment" not in disposition.lower() and "text/html" in content_type.lower():
        raise SystemExit("Google Drive returned the file viewer instead of a downloadable file.")


def metadata_from_response(file_id: str, source_url: str, headers: Any) -> dict[str, Any]:
    filename = safe_drive_filename(headers, file_id)
    content_length = headers.get("Content-Length")
    content_type = headers.get("Content-Type")
    return {
        "id": file_id,
        "title": Path(filename).stem or filename,
        "extractor": "GoogleDrive",
        "webpage_url": source_url,
        "duration": None,
        "uploader": None,
        "upload_date": None,
        "thumbnail": None,
        "thumbnails": [],
        "description": content_type,
        "provider": "google-drive",
        "filename": filename,
        "filesize": int(content_length) if content_length and content_length.isdigit() else None,
    }


def safe_drive_filename(headers: Any, file_id: str) -> str:
    name = filename_from_content_disposition(headers.get("Content-Disposition", ""))
    if not name:
        extension = mimetypes.guess_extension((headers.get("Content-Type") or "").split(";", 1)[0].strip()) or ""
        name = f"google-drive-{file_id}{extension}"
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "-", name).strip(". ")
    return cleaned or f"google-drive-{file_id}"


def filename_from_content_disposition(disposition: str) -> str | None:
    match = re.search(r"filename\*=UTF-8''([^;]+)", disposition, flags=re.IGNORECASE)
    if match:
        return urllib.parse.unquote(match.group(1).strip().strip('"'))
    match = re.search(r'filename="([^"]+)"', disposition, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()
    match = re.search(r"filename=([^;]+)", disposition, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip().strip('"')
    return None


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    for index in range(2, 10_000):
        candidate = path.with_name(f"{stem}-{index}{suffix}")
        if not candidate.exists():
            return candidate
    raise SystemExit("Could not choose an output filename for the Drive file.")


def require_drive_file_id(url: str) -> str:
    file_id = drive_file_id(url)
    if not file_id:
        raise SystemExit("Google Drive link does not contain a file id.")
    return file_id
