# Media Library MVP Checklist

Status: cleaned active process checklist

## Rule

No fake demo files. No direct embedding layer in the active desktop library. Search is filename/basic metadata only until we rebuild real scene understanding.

## Active Slice

```text
private tracker sheet -> real Drive master video -> local file -> app-level library DB -> filename/basic metadata search -> playable preview
```

## Done

- [x] Clear fake booth/sample rows from the app-level library DB.
- [x] Clear all embedded chunk rows from the app-level library DB.
- [x] Keep the app-level library DB at `/Users/dev/Library/Application Support/rippopotamus/library-index`.
- [x] Keep selected folders as scan paths only, not DB identity.
- [x] Read the private tracker sheet through Chrome cookies.
- [x] Download tracker XLSX, not CSV, so real hyperlinks are preserved.
- [x] Parse real tracker rows into `scratch/sheet-intake/tracker-records.json`.
- [x] Download one real master Drive file from the sheet: Rohtak master video.
- [x] Fix Google Drive virus-scan warning downloads by preserving hidden form params.
- [x] Index the real downloaded Rohtak video into the app-level library DB.
- [x] Remove automatic semantic/Gemini ingest from desktop `Scan/Index folder` flow.
- [x] Make the UI empty state honest: filename/basic metadata only, visual scene search not wired.
- [x] Remove the semantic verifier npm script from the active package scripts.

## Current Real Library State

App-level DB:

```text
/Users/dev/Library/Application Support/rippopotamus/library-index/.rippo/index.sqlite3
```

Indexed real file:

```text
/Users/dev/Downloads/Rippo/Tracker/haryana/rohtak/Rohtak me Modi ne kya kiya hai_Horizontal_V003.mp4
```

Current expected search behavior:

```text
Rohtak Modi -> 1 filename/basic metadata result
women -> 0 results
mic -> 0 results
booth crowd -> 0 results
embeddedMomentCount -> 0
```

## Commands Run

```bash
sqlite3 '/Users/dev/Library/Application Support/rippopotamus/library-index/.rippo/index.sqlite3' \
  "DELETE FROM moments_fts WHERE moment_id IN (SELECT id FROM moments WHERE embedding_json IS NOT NULL); DELETE FROM moments WHERE embedding_json IS NOT NULL;"

PYTHONPATH=src python scripts/import-tracker-sheet.py \
  'https://docs.google.com/spreadsheets/d/1DogfVrUl_gk5AeHJt3ISKI6OCE0PPy5kj6lrMmMUSbc/edit?gid=0#gid=0' \
  --require-master --limit 1 --download-master

PYTHONPATH=src python -m rippopotamus.desktop_engine index-status \
  --index-root '/Users/dev/Library/Application Support/rippopotamus/library-index'

PYTHONPATH=src python -m rippopotamus.desktop_engine index-search \
  --index-root '/Users/dev/Library/Application Support/rippopotamus/library-index' \
  --query 'women' --limit 5

PYTHONPATH=src python -m rippopotamus.desktop_engine index-search \
  --index-root '/Users/dev/Library/Application Support/rippopotamus/library-index' \
  --query 'Rohtak Modi' --limit 5
```

## Current Gap To Rebuild Later

The missing real capability is scene understanding:

```text
video/audio -> chunk -> caption/tags/transcript -> searchable moment rows -> preview at timestamp
```

Do not ship direct video embeddings as the answer. The next rebuild should create inspectable captions/tags/transcripts first, then search those.

## Not Now

- [ ] Direct video embeddings in active desktop search.
- [ ] Generic chunk rows that only say `video moment 00:00 to 00:30`.
- [ ] Fake sample media or fake filenames.
- [ ] Cloud storage.
- [ ] Multi-user/team library.
- [ ] Rights management.
