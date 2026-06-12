#!/usr/bin/env python3
"""Import OCC (On-Campus Content) spreadsheets and download masters from Drive."""
from __future__ import annotations

import argparse
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from rippopotamus.google_drive import download_drive_file, drive_file_id, drive_opener


NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


@dataclass
class OCCRecord:
    row: int
    serial: str
    filename: str
    content_type: str
    nature: str
    content_link: str
    location: str
    topic: str
    duration: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "row": self.row,
            "serial": self.serial,
            "filename": self.filename,
            "contentType": self.content_type,
            "nature": self.nature,
            "contentLink": self.content_link,
            "location": self.location,
            "topic": self.topic,
            "duration": self.duration,
        }


def shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    return ["".join(node.text or "" for node in item.findall(".//a:t", NS)) for item in root.findall("a:si", NS)]


def rels_map(zf: zipfile.ZipFile, path: str) -> dict[str, str]:
    if path not in zf.namelist():
        return {}
    root = ET.fromstring(zf.read(path))
    return {rel.attrib["Id"]: rel.attrib["Target"] for rel in root}


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


def first_sheet_path(zf: zipfile.ZipFile) -> str:
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    wb_rels = rels_map(zf, "xl/_rels/workbook.xml.rels")
    sheets = wb.find("a:sheets", NS)
    if sheets is None or len(sheets) == 0:
        raise SystemExit("Workbook has no sheets.")
    first = sheets[0]
    rel_id = first.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", "")
    target = wb_rels.get(rel_id)
    if target:
        return "xl/" + target
    raise SystemExit("Could not resolve first sheet path.")


def parse_occ_xlsx(path: Path) -> list[OCCRecord]:
    with zipfile.ZipFile(path) as zf:
        strings = shared_strings(zf)
        worksheet_path = first_sheet_path(zf)
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

    records: list[OCCRecord] = []
    for row_index in sorted(rows):
        if row_index <= 1:
            continue
        row = rows[row_index]
        filename = row.get("B", "").strip()
        if not filename:
            continue
        content_link = hyperlinks.get(f"E{row_index}", "") or row.get("E", "")
        records.append(OCCRecord(
            row=row_index,
            serial=row.get("A", ""),
            filename=filename,
            content_type=row.get("C", ""),
            nature=row.get("D", ""),
            content_link=content_link,
            location=row.get("F", ""),
            topic=row.get("G", ""),
            duration=row.get("H", ""),
        ))
    return records


def slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip()).strip("-").lower()
    return cleaned or "untitled"



def main() -> None:
    parser = argparse.ArgumentParser(description="Import OCC spreadsheet and download masters from Drive.")
    parser.add_argument("--xlsx", action="append", required=True, help="Path to a local OCC .xlsx file (repeatable).")
    parser.add_argument("--limit", type=int, default=0, help="Max records to process per file (0 = all).")
    parser.add_argument("--limit-per-type", type=int, default=0, help="Max records per content type per file (0 = all).")
    parser.add_argument("--download", action="store_true", help="Download video files from Drive.")
    parser.add_argument("--output-root", default="", help="Download root (default: ~/Downloads/Rippo/OCC).")
    parser.add_argument("--cookies-browser", default="chrome", help="Browser for cookies.")
    parser.add_argument("--dry-run", action="store_true", help="Print records without downloading.")
    args = parser.parse_args()

    output_root = Path(args.output_root or Path.home() / "Downloads" / "Rippo" / "OCC")
    all_records: list[OCCRecord] = []
    downloaded_paths: list[str] = []

    for xlsx_path in args.xlsx:
        path = Path(xlsx_path).expanduser()
        if not path.exists():
            print(f"SKIP {path}: file not found")
            continue

        records = parse_occ_xlsx(path)
        print(f"\n{path.name}: {len(records)} records")

        if args.limit_per_type:
            type_counts: dict[str, int] = {}
            filtered: list[OCCRecord] = []
            for rec in records:
                ct = rec.content_type.upper()
                type_counts[ct] = type_counts.get(ct, 0) + 1
                if type_counts[ct] <= args.limit_per_type:
                    filtered.append(rec)
            records = filtered

        if args.limit:
            records = records[:args.limit]

        all_records.extend(records)

        for rec in records:
            print(f"  [{rec.content_type:10s}] {rec.filename:30s}  {rec.location}  {rec.content_link[:60] if rec.content_link else '(no link)'}")

        if args.dry_run:
            continue

        if args.download:
            for rec in records:
                if not rec.content_link or not drive_file_id(rec.content_link):
                    print(f"  SKIP {rec.filename}: no Drive link")
                    continue
                dest_dir = output_root / slug(rec.location) / slug(rec.content_type)
                dest_dir.mkdir(parents=True, exist_ok=True)
                print(f"  Downloading {rec.filename} -> {dest_dir}")
                try:
                    files = download_drive_file(
                        rec.content_link,
                        dest_dir,
                        cookie_browser=args.cookies_browser,
                    )
                    downloaded_paths.extend(files)
                    print(f"    OK: {[Path(f).name for f in files]}")
                except SystemExit as exc:
                    print(f"    FAIL: {exc}")

    manifest_dir = Path("scratch") / "occ-intake"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest = manifest_dir / "occ-records.json"
    manifest.write_text(json.dumps([r.as_dict() for r in all_records], indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nManifest: {manifest} ({len(all_records)} records)")


if __name__ == "__main__":
    main()
