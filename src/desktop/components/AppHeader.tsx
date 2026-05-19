import { Loader2, Search, Settings } from "lucide-react";
import type { RefObject } from "react";
import type { IndexStatusResponse, ProviderId, ProviderOption, SourceSearchPack } from "../../../electron/types";
import { AppHero } from "./AppHero";

const logoUrl = `${import.meta.env.BASE_URL}brand-logo.png`;

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

function libraryCount(status: IndexStatusResponse | null): string {
  if (!status?.assetCount) return "0 files";
  return `${status.assetCount} files`;
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
  pageProbeBusy,
  setInput,
  clearIndexError,
  runComposerAction,
  sniffPage,
  chooseSearchScope,
  setActiveSourcePack,
  setFetchProvider,
  openSettings,
  showHero,
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
  pageProbeBusy: boolean;
  setInput: (value: string) => void;
  clearIndexError: () => void;
  runComposerAction: () => void;
  sniffPage: () => void;
  chooseSearchScope: (scope: SearchScope) => void;
  setActiveSourcePack: (pack: string) => void;
  setFetchProvider: (provider: ProviderId | "auto") => void;
  openSettings: () => void;
  showHero: boolean;
}) {
  const showSearchControls = detectedCount === 0;

  return (
    <header className={`app-header ${showHero ? "has-hero" : "is-compact"}`}>
      <button type="button" className="settings-btn settings-btn-header" onClick={openSettings} aria-label="Settings" title="Settings">
        <Settings size={16} strokeWidth={2} aria-hidden />
      </button>

      {showHero ? (
        <AppHero />
      ) : (
        <div className="app-header-bar">
          <img className="brand-logo-sm" src={logoUrl} alt="" width={28} height={28} decoding="async" />
          <span className="brand-name">Rippo</span>
        </div>
      )}

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
          placeholder={showHero ? "Paste a link, or use Sheet import below" : "Paste links, search library, or search the web"}
          rows={1}
          aria-label="Input"
        />
        <div className="composer-foot">
          <div className="composer-tools">
            {showSearchControls ? (
              <>
                <div className="search-scope-switch" role="group" aria-label="Search source">
                  <button
                    type="button"
                    className={`search-scope-btn ${searchScope === "library" ? "is-active" : ""}`}
                    onClick={() => chooseSearchScope("library")}
                    aria-pressed={searchScope === "library"}
                  >
                    Library
                  </button>
                  <button
                    type="button"
                    className={`search-scope-btn ${searchScope === "web" ? "is-active" : ""}`}
                    onClick={() => chooseSearchScope("web")}
                    aria-pressed={searchScope === "web"}
                  >
                    Web
                  </button>
                </div>
                {searchScope === "web" ? (
                  <select className="provider-select" value={activeSourcePack} onChange={(event) => setActiveSourcePack(event.target.value)} aria-label="Web area">
                    {sourcePacks.map((pack) => (
                      <option key={pack.id} value={pack.id}>{pack.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className="composer-index-status">{libraryCount(indexStatus)}</span>
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
                {providerOptions.length === 0 ? <option value="">…</option> : null}
                {providerOptions.length > 0 ? <option value="auto">Auto</option> : null}
                {providerOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            )}
            {detectedCount > 1 ? <span className="link-count">{detectedCount}</span> : null}
          </div>
          <div className="composer-actions">
            {detectedCount === 1 ? (
              <button type="button" className="btn btn-ghost btn-fetch" onClick={sniffPage} disabled={pageProbeBusy}>
                {pageProbeBusy ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : "Sniff"}
              </button>
            ) : null}
            <button type="button" className="btn btn-primary btn-fetch" onClick={runComposerAction} disabled={composerAction.disabled}>
              {activeSearchBusy ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : composerAction.icon === "search" ? <Search size={14} strokeWidth={2} aria-hidden /> : null}
              {activeSearchBusy ? composerAction.busyLabel : `${composerAction.label}${composerAction.countSuffix || ""}`}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
