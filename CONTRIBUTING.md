# Contributing to Rippopotamus

Thanks for considering a contribution. This project is small and local-first by design — keep changes focused and avoid adding new services or dependencies unless they're clearly necessary.

## Dev Setup

You need Python >= 3.11, Node.js (CI runs on Node 24), and Rust stable + the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS to build/run the desktop app (the packaged app itself needs none of this for end users — it bundles a frozen engine).

```bash
git clone <your-fork-url>
cd Rippopotamus

python -m venv .venv
. .venv/bin/activate
pip install -e .

npm install
```

Run the desktop app in dev mode (starts Vite and opens the Tauri window against your local Python engine):

```bash
npm run dev
```

Run the CLI:

```bash
rippo init "Client Project" --path .prototype/client-project
```

## Running Tests

```bash
npm test
```

This runs the Python `unittest` suite in `tests/`, a desktop (frontend) build, the Node (`node:test`) suites in `tests/`, and `cargo test --lib` for the Tauri Rust backend (`apps/desktop/src-tauri`). Run it before opening a PR.

To iterate on just the Python side:

```bash
python -m unittest discover -s tests
```

## Branch and PR Conventions

- `main` is the default branch; branch off it for your changes.
- Use short, descriptive branch names (e.g. `fix-aria2c-path-guard`, `add-drive-preset`).
- Keep PRs focused on one change. Unrelated cleanup belongs in a separate PR.
- Write commit messages that explain *why*, not just *what*.
- Make sure `npm test` passes before requesting review.
- Open a PR against `main` with a clear description of the change and any manual testing you did.

## Reporting Issues

Open a GitHub issue with steps to reproduce, expected vs. actual behavior, and your OS/Node/Python versions. For download failures, include the resolver/provider involved (`yt-dlp`, `gallery-dl`, `aria2c`) and any error output from the ledger/log files.
