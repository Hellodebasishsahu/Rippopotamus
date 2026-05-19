"""Google Sheets tracker intake: XLSX export, hyperlink preservation, optional Drive masters.

Ported from ``scripts/import-tracker-sheet.py`` for use by the desktop engine and CLI.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from xml.etree import ElementTree as ET

from rippopotamus.cli import slugify
from rippopotamus.google_drive import download_drive_file, drive_opener

EmitFn = Callable[[dict[str, Any]], None]

NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


@dataclass
class TrackerRecord:
    row: int
    serial: str
    state: str
    vendor: str
    hashtags: str
    pc_name: str
    status: str
    raw_footage_url: str
    master_video_url: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "row": self.row,
            "serial": self.serial,
            "state": self.state,
            "vendor": self.vendor,
            "hashtags": self.hashtags,
            "pcName": self.pc_name,
            "status": self.status,
            "rawFootageUrl": self.raw_footage_url,
            "masterVideoUrl": self.master_video_url,
        }


def spreadsheet_id(url: str) -> str:
    match = re.search(r"/spreadsheets/d/([^/?#]+)", url)
    if not match:
        raise SystemExit("Google Sheets URL does not contain a spreadsheet id.")
    return match.group(1)


def download_xlsx(
    sheet_url: str,
    browser: str,
    destination: Path,
    *,
    yt_dlp_base: list[str] | None,
    network_proxy: str | None,
) -> Path:
    sheet_id = spreadsheet_id(sheet_url)
    export_url = (
        f"https://docs.google.com/spreadsheets/d/{urllib.parse.quote(sheet_id)}"
        f"/export?format=xlsx&id={urllib.parse.quote(sheet_id)}"
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    with drive_opener(browser or None, yt_dlp_base, sheet_url, network_proxy) as opener:
        response = opener.open(urllib.request.Request(export_url, headers={"Referer": sheet_url}), timeout=120)
        destination.write_bytes(response.read())
    return destination


def rels_map(zf: zipfile.ZipFile, path: str) -> dict[str, str]:
    if path not in zf.namelist():
        return {}
    root = ET.fromstring(zf.read(path))
    return {rel.attrib["Id"]: rel.attrib["Target"] for rel in root}


def shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    strings: list[str] = []
    for item in root.findall("a:si", NS):
        strings.append("".join(node.text or "" for node in item.findall(".//a:t", NS)))
    return strings


def cell_text(cell: ET.Element, strings: list[str]) -> str:
    value = cell.find("a:v", NS)
    if value is None:
        return ""
    text = value.text or ""
    if cell.attrib.get("t") == "s" and text.isdigit():
        index = int(text)
        return strings[index] if index < len(strings) else text
    return text


def column_name(cell_ref: str) -> str:
    return re.sub(r"\d+", "", cell_ref)


def sheet_path(zf: zipfile.ZipFile, sheet_name: str) -> str:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    workbook_rels = rels_map(zf, "xl/_rels/workbook.xml.rels")
    sheets = workbook.find("a:sheets", NS)
    if sheets is None:
        raise SystemExit("Workbook has no sheets.")
    for sheet in sheets:
        if sheet.attrib.get("name") == sheet_name:
            rel_id = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", "")
            target = workbook_rels.get(rel_id)
            if target:
                return "xl/" + target
    raise SystemExit(f"Sheet `{sheet_name}` not found.")


def parse_tracker_xlsx(path: Path, sheet_name: str = "Tracker") -> list[TrackerRecord]:
    with zipfile.ZipFile(path) as zf:
        strings = shared_strings(zf)
        worksheet_path = sheet_path(zf, sheet_name)
        worksheet = ET.fromstring(zf.read(worksheet_path))
        worksheet_name = Path(worksheet_path).name
        hyperlink_rels = rels_map(zf, f"xl/worksheets/_rels/{worksheet_name}.rels")
        hyperlinks: dict[str, str] = {}
        for hyperlink in worksheet.findall(".//a:hyperlinks/a:hyperlink", NS):
            ref = hyperlink.attrib.get("ref", "")
            rel_id = hyperlink.attrib.get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", ""
            )
            url = hyperlink_rels.get(rel_id, "")
            if ref and url:
                hyperlinks[ref] = url

        rows: dict[int, dict[str, str]] = {}
        for row in worksheet.findall(".//a:sheetData/a:row", NS):
            row_index = int(row.attrib.get("r", "0") or 0)
            values: dict[str, str] = {}
            for cell in row.findall("a:c", NS):
                ref = cell.attrib.get("r", "")
                if ref:
                    values[column_name(ref)] = cell_text(cell, strings).strip()
            rows[row_index] = values

    records: list[TrackerRecord] = []
    state = ""
    vendor = ""
    hashtags = ""
    for row_index in sorted(rows):
        if row_index <= 2:
            continue
        row = rows[row_index]
        state = row.get("B") or state
        vendor = row.get("C") or vendor
        hashtags = row.get("D") or hashtags
        pc_name = row.get("E", "").strip()
        if not pc_name:
            continue
        raw_url = hyperlinks.get(f"G{row_index}", "")
        master_url = hyperlinks.get(f"H{row_index}", "")
        records.append(
            TrackerRecord(
                row=row_index,
                serial=row.get("A", ""),
                state=state,
                vendor=vendor,
                hashtags=hashtags,
                pc_name=pc_name,
                status=row.get("F", ""),
                raw_footage_url=raw_url,
                master_video_url=master_url,
            )
        )
    return records


def filtered_records(
    records: list[TrackerRecord],
    *,
    state: str = "",
    pc: str = "",
    status: str = "",
    require_master: bool = False,
    limit: int = 0,
) -> list[TrackerRecord]:
    result = records
    if state:
        needle = state.lower()
        result = [item for item in result if needle in item.state.lower()]
    if pc:
        needle = pc.lower()
        result = [item for item in result if needle in item.pc_name.lower()]
    if status:
        needle = status.lower()
        result = [item for item in result if needle in item.status.lower()]
    if require_master:
        result = [item for item in result if item.master_video_url]
    if limit and limit > 0:
        result = result[:limit]
    return result


def ensure_project_layout(project_root: Path) -> None:
    for name in ("Source", "Audio", "Images", "Thumbnails", "Clips", "Exports"):
        (project_root / name).mkdir(parents=True, exist_ok=True)
    (project_root / ".rippo").mkdir(parents=True, exist_ok=True)


def write_sheet_manifest(
    path: Path,
    *,
    sheet_url: str,
    project_name: str,
    records: list[TrackerRecord],
    selected: list[TrackerRecord],
    row_jobs: list[dict[str, Any]],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "kind": "sheet-import",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": sheet_url,
        "projectName": project_name,
        "totalRows": len(records),
        "selectedRows": len(selected),
        "records": [item.as_dict() for item in selected],
        "rowJobs": row_jobs,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def run_sheet_import_pipeline(
    *,
    sheet_url: str,
    output_root: Path,
    project_name: str,
    sheet_name: str,
    browser: str,
    yt_dlp_base: list[str],
    network_proxy: str | None,
    state_filter: str,
    pc_filter: str,
    status_filter: str,
    limit: int,
    require_master: bool,
    download_master: bool,
    index_root: Path | None,
    emit: EmitFn,
    ingest_paths_fn: Callable[[Path, list[Path]], Any],
) -> dict[str, Any]:
    """Execute sheet download, parse, optional Drive downloads, optional library ingest."""
    slug = slugify(project_name)
    project_root = (output_root / slug).resolve()
    ensure_project_layout(project_root)
    xlsx_path = project_root / ".rippo" / "source.xlsx"

    emit({"phase": "resolving", "message": "Downloading sheet export"})
    download_xlsx(sheet_url, browser, xlsx_path, yt_dlp_base=yt_dlp_base, network_proxy=network_proxy)
    emit({"phase": "resolved", "xlsxPath": str(xlsx_path)})

    records = parse_tracker_xlsx(xlsx_path, sheet_name)
    selected = filtered_records(
        records,
        state=state_filter,
        pc=pc_filter,
        status=status_filter,
        require_master=require_master,
        limit=limit,
    )
    emit({"phase": "parsed", "totalRows": len(records), "selectedRows": len(selected)})

    downloaded: list[Path] = []
    row_jobs: list[dict[str, Any]] = []

    for record in selected:
        job: dict[str, Any] = {
            "row": record.row,
            "pcName": record.pc_name,
            "stage": "queued",
            "jobStatus": "pending",
        }
        if not download_master:
            job["jobStatus"] = "skipped"
            job["stage"] = "skipped"
            job["reason"] = "download_master not requested"
            row_jobs.append(job)
            continue
        if not record.master_video_url:
            job["jobStatus"] = "skipped"
            job["stage"] = "skipped"
            job["reason"] = "no master URL"
            row_jobs.append(job)
            continue

        output_dir = project_root / "Source" / slugify(record.state) / slugify(record.pc_name)
        output_dir.mkdir(parents=True, exist_ok=True)
        emit({"phase": "downloading", "row": record.row, "pcName": record.pc_name})
        job["stage"] = "downloading"
        try:
            files = download_drive_file(
                record.master_video_url,
                output_dir,
                cookie_browser=browser or None,
                yt_dlp_base=yt_dlp_base,
                network_proxy=network_proxy,
                emit=lambda payload: emit({"phase": "drive", "row": record.row, **payload}),
            )
            paths = [Path(p).resolve() for p in files]
            downloaded.extend(paths)
            job["jobStatus"] = "done"
            job["stage"] = "done"
            job["files"] = [str(p) for p in paths]
        except SystemExit as exc:
            job["jobStatus"] = "failed"
            job["stage"] = "failed"
            job["error"] = str(exc)
        row_jobs.append(job)

    manifest_path = project_root / "manifest.json"
    write_sheet_manifest(
        manifest_path,
        sheet_url=sheet_url,
        project_name=project_name,
        records=records,
        selected=selected,
        row_jobs=row_jobs,
    )

    indexed: list[str] = []
    if index_root and downloaded:
        emit({"phase": "indexing", "fileCount": len(downloaded)})
        ingest_paths_fn(index_root, downloaded)
        indexed = [str(p) for p in downloaded]

    summary = {
        "ok": True,
        "projectRoot": str(project_root),
        "manifestPath": str(manifest_path),
        "xlsxPath": str(xlsx_path),
        "totalRows": len(records),
        "selectedRows": len(selected),
        "downloadedFiles": len(downloaded),
        "indexedPaths": indexed,
        "rowJobs": row_jobs,
    }
    emit({"phase": "complete", **summary})
    return summary
