import { FolderOpen, Loader2, RefreshCcw, Settings } from "lucide-react";
import type { RefObject } from "react";
import type { DesktopClient } from "../client/desktopClient";

export type AppView = "queue" | "library";

export type ComposerAction = {
  id: "idle" | "fetch";
  label: string;
  disabled: boolean;
  countSuffix?: string;
};

export function AppHeader({
  activeView,
  setActiveView,
  input,
  libraryQuery,
  setLibraryQuery,
  libraryLoading,
  activeOutputRoot,
  desktop,
  onRefreshLibrary,
  textareaRef,
  detectedCount,
  composerAction,
  pageProbeBusy,
  setInput,
  runComposerAction,
  sniffPage,
  openSettings,
}: {
  activeView: AppView;
  setActiveView: (view: AppView) => void;
  input: string;
  libraryQuery: string;
  setLibraryQuery: (value: string) => void;
  libraryLoading: boolean;
  activeOutputRoot: string;
  desktop: DesktopClient | null;
  onRefreshLibrary: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  detectedCount: number;
  composerAction: ComposerAction;
  pageProbeBusy: boolean;
  setInput: (value: string) => void;
  runComposerAction: () => void;
  sniffPage: () => void;
  openSettings: () => void;
}) {
  const isLibrary = activeView === "library";
  const composerHasContent = isLibrary ? libraryQuery.length > 0 : input.length > 0;

  return (
    <header className="app-header">
      <div className="app-header-shell">
        <div className="app-header-top">
          <nav className="app-nav" aria-label="Main">
            <button
              type="button"
              className={`app-nav-btn${activeView === "queue" ? " is-active" : ""}`}
              onClick={() => setActiveView("queue")}
            >
              Queue
            </button>
            <button
              type="button"
              className={`app-nav-btn${activeView === "library" ? " is-active" : ""}`}
              onClick={() => setActiveView("library")}
            >
              Lib
            </button>
          </nav>
          <button type="button" className="settings-btn" onClick={openSettings} aria-label="Settings" title="Settings">
            <Settings size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className={`composer${composerHasContent ? " has-content" : ""}`}>
          <div className="composer-row">
            {isLibrary ? (
              <input
                id="library-search"
                type="search"
                className="input-multiline composer-search"
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Search saved files"
                aria-label="Search saved files"
              />
            ) : (
              <textarea
                id="url-input"
                ref={textareaRef}
                className="input-multiline"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    runComposerAction();
                  }
                }}
                placeholder="Paste a link"
                rows={1}
                aria-label="Input"
              />
            )}
            <div className="composer-actions">
              {isLibrary ? (
                <>
                  <button type="button" className="btn btn-ghost btn-fetch" onClick={() => desktop?.openFolder(activeOutputRoot)} disabled={!desktop} title={activeOutputRoot || undefined}>
                    <FolderOpen size={14} strokeWidth={2} aria-hidden />
                  </button>
                  <button type="button" className="btn btn-ghost btn-fetch" onClick={onRefreshLibrary} disabled={!desktop || libraryLoading} title="Refresh library">
                    {libraryLoading ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : <RefreshCcw size={14} strokeWidth={2} aria-hidden />}
                  </button>
                </>
              ) : (
                <>
                  {detectedCount === 1 ? (
                    <button type="button" className="btn btn-ghost btn-fetch" onClick={sniffPage} disabled={pageProbeBusy}>
                      {pageProbeBusy ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : "Sniff"}
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-primary btn-fetch" onClick={runComposerAction} disabled={composerAction.disabled}>
                    {composerAction.label}{composerAction.countSuffix || ""}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
