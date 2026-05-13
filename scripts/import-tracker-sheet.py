#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from rippopotamus.footage_index import ingest_paths
from rippopotamus.google_drive import download_drive_file, drive_opener


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


def app_library_index_root() -> Path:
    return Path.home() / "Library" / "Application Support" / "rippopotamus" / "library-index"


def download_xlsx(sheet_url: str, browser: str, destination: Path) -> Path:
    sheet_id = spreadsheet_id(sheet_url)
    export_url = f"https://docs.google.com/spreadsheets/d/{urllib.parse.quote(sheet_id)}/export?format=xlsx&id={urllib.parse.quote(sheet_id)}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    with drive_opener(browser, None, sheet_url) as opener:
        response = opener.open(urllib.request.Request(export_url, headers={"Referer": sheet_url}), timeout=60)
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


def row_number(cell_ref: str) -> int:
    match = re.search(r"\d+", cell_ref)
    return int(match.group(0)) if match else 0


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
            rel_id = hyperlink.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", "")
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
        records.append(TrackerRecord(
            row=row_index,
            serial=row.get("A", ""),
            state=state,
            vendor=vendor,
            hashtags=hashtags,
            pc_name=pc_name,
            status=row.get("F", ""),
            raw_footage_url=raw_url,
            master_video_url=master_url,
        ))
    return records


def slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip()).strip("-").lower()
    return cleaned or "untitled"


def filtered_records(records: list[TrackerRecord], args: argparse.Namespace) -> list[TrackerRecord]:
    result = records
    if args.state:
        needle = args.state.lower()
        result = [item for item in result if needle in item.state.lower()]
    if args.pc:
        needle = args.pc.lower()
        result = [item for item in result if needle in item.pc_name.lower()]
    if args.status:
        needle = args.status.lower()
        result = [item for item in result if needle in item.status.lower()]
    if args.require_master:
        result = [item for item in result if item.master_video_url]
    if args.limit:
        result = result[:args.limit]
    return result


def write_manifest(path: Path, records: list[TrackerRecord], selected: list[TrackerRecord], sheet_url: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": sheet_url,
        "totalRows": len(records),
        "selectedRows": len(selected),
        "records": [item.as_dict() for item in selected],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Import real tracker sheet links into Rippo.")
    parser.add_argument("sheet_url")
    parser.add_argument("--browser", default="chrome")
    parser.add_argument("--xlsx", default="scratch/sheet-intake/source.xlsx")
    parser.add_argument("--manifest", default="scratch/sheet-intake/tracker-records.json")
    parser.add_argument("--state", default="")
    parser.add_argument("--pc", default="")
    parser.add_argument("--status", default="")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--require-master", action="store_true")
    parser.add_argument("--download-master", action="store_true")
    parser.add_argument("--download-root", default=str(Path.home() / "Downloads" / "Rippo" / "Tracker"))
    parser.add_argument("--index-root", default=str(app_library_index_root()))
    args = parser.parse_args()

    xlsx = download_xlsx(args.sheet_url, args.browser, Path(args.xlsx))
    records = parse_tracker_xlsx(xlsx)
    selected = filtered_records(records, args)
    write_manifest(Path(args.manifest), records, selected, args.sheet_url)

    downloaded: list[str] = []
    if args.download_master:
        for record in selected:
            if not record.master_video_url:
                continue
            output_dir = Path(args.download_root) / slug(record.state) / slug(record.pc_name)
            files = download_drive_file(record.master_video_url, output_dir, cookie_browser=args.browser)
            downloaded.extend(files)
        if downloaded:
            ingest_paths(Path(args.index_root), [Path(item) for item in downloaded])

    print(json.dumps({
        "ok": True,
        "xlsx": str(xlsx),
        "manifest": args.manifest,
        "totalRows": len(records),
        "selectedRows": len(selected),
        "downloaded": len(downloaded),
        "indexedRoot": args.index_root if downloaded else None,
        "sample": [item.as_dict() for item in selected[:5]],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
