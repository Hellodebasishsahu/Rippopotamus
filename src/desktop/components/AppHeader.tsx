import { FolderSearch, Loader2, Search, Settings } from "lucide-react";
import type { RefObject } from "react";
import type { IndexStatusResponse, ProviderId, ProviderOption, SourceSearchPack } from "../../../electron/types";

export type SearchScope = "library" | "web";

export type ComposerAction = {
  id: "idle" | "search" | "fetch";
  label: string;
  busyLabel: string;
  hint: string;
  icon: "search" | "none";
  disabled: boolean;
  countSuffix?: string;
};

function indexStatusLine(status: IndexStatusResponse | null): string {
  if (!status) return "Not scanned yet";
  if (!status.assetCount && !status.momentCount) return "No saved footage scanned";
  if (status.momentCount && !status.embeddedMomentCount) return `${status.assetCount} files · scan needed`;
  return `${status.assetCount} files · ${status.momentCount} moments`;
}

function savedFootageBadge(status: IndexStatusResponse | null): string {
  if (!status || !status.assetCount) return "No saved footage";
  if (status.momentCount && !status.embeddedMomentCount) return "Scan needed";
  if (status.momentCount) return `${status.momentCount} moments`;
  return "No moments";
}

export function AppHeader({
  input,
  textareaRef,
  searchScope,
  sourcePacks,
  activeSourcePack,
  detectedCount,
  indexStatus,
  selectedFetchProvider,
  providerOptions,
  composerAction,
  activeSearchBusy,
  setInput,
  clearIndexError,
  runComposerAction,
  chooseSearchScope,
  setActiveSourcePack,
  setFetchProvider,
  openSettings,
}: {
  input: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  searchScope: SearchScope;
  sourcePacks: SourceSearchPack[];
  activeSourcePack: string;
  detectedCount: number;
  indexStatus: IndexStatusResponse | null;
  selectedFetchProvider: ProviderId | "auto";
  providerOptions: ProviderOption[];
  composerAction: ComposerAction;
  activeSearchBusy: boolean;
  setInput: (value: string) => void;
  clearIndexError: () => void;
  runComposerAction: () => void;
  chooseSearchScope: (scope: SearchScope) => void;
  setActiveSourcePack: (pack: string) => void;
  setFetchProvider: (provider: ProviderId | "auto") => void;
  openSettings: () => void;
}) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-titlebar">
          <div className="brand-lockup">
            <img className="brand-logo" src={`${import.meta.env.BASE_URL}brand-logo.png`} alt="" width={44} height={44} decoding="async" />
            <div>
              <h1 className="brand-name">Rippo</h1>
              <p className="brand-subtitle">Find, fetch, and save usable media.</p>
            </div>
          </div>
          <button type="button" className="settings-btn" onClick={openSettings} aria-label="Settings" title="Settings">
            <Settings size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className={`composer ${input ? "has-content" : ""}`}>
          <textarea
            id="url-input"
            ref={textareaRef}
            className="input-multiline"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              clearIndexError();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                runComposerAction();
              }
            }}
            placeholder={searchScope === "library" ? "Paste link(s) or search saved videos..." : "Paste link(s) or search the web..."}
            rows={1}
            aria-label="Links or search text"
          />
          <div className="composer-foot">
            <div className="composer-tools">
              {detectedCount === 0 ? (
                <>
                  <div className="search-scope-switch" role="group" aria-label="Search source">
                    <button type="button" className={`search-scope-btn ${searchScope === "library" ? "is-active" : ""}`} onClick={() => chooseSearchScope("library")} aria-pressed={searchScope === "library"}>
                      <FolderSearch size={13} strokeWidth={2} aria-hidden />
                      Library
                    </button>
                    <button type="button" className={`search-scope-btn ${searchScope === "web" ? "is-active" : ""}`} onClick={() => chooseSearchScope("web")} aria-pressed={searchScope === "web"}>
                      <Search size={13} strokeWidth={2} aria-hidden />
                      Web
                    </button>
                  </div>
                  {searchScope === "web" ? (
                    <div className="pack-select-wrap">
                      <select className="provider-select" value={activeSourcePack} onChange={(event) => setActiveSourcePack(event.target.value)} aria-label="Web search area">
                        {sourcePacks.map((pack) => (
                          <option key={pack.id} value={pack.id}>{pack.label}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <span className="composer-index-status" title={indexStatusLine(indexStatus)}>
                      {savedFootageBadge(indexStatus)}
                    </span>
                  )}
                </>
              ) : (
                <select
                  className="provider-select"
                  value={selectedFetchProvider}
                  onChange={(event) => setFetchProvider(event.target.value as ProviderId | "auto")}
                  disabled={!providerOptions.length}
                  aria-label="Source type"
                >
                  {providerOptions.length === 0 ? <option value="">Loading</option> : null}
                  {providerOptions.length > 0 ? <option value="auto">Auto</option> : null}
                  {providerOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              )}
              {detectedCount > 1 ? <span className="link-count">{detectedCount} links</span> : <span className="composer-hint">Cmd+Enter to {composerAction.hint}</span>}
            </div>
            <button type="button" className="btn btn-primary btn-fetch" onClick={runComposerAction} disabled={composerAction.disabled}>
              {activeSearchBusy ? <Loader2 className="spin" size={15} strokeWidth={2} aria-hidden /> : composerAction.icon === "search" ? <Search size={15} strokeWidth={2} aria-hidden /> : null}
              {activeSearchBusy ? composerAction.busyLabel : `${composerAction.label}${composerAction.countSuffix || ""}`}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
