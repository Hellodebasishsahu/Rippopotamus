import { Loader2, Settings } from "lucide-react";
import type { RefObject } from "react";
import type { ProviderId, ProviderOption } from "../../electron/types";
import { AppHero } from "./AppHero";

const logoUrl = `${import.meta.env.BASE_URL}brand-logo.png`;

export type ComposerAction = {
  id: "idle" | "fetch";
  label: string;
  disabled: boolean;
  countSuffix?: string;
};

export function AppHeader({
  input,
  textareaRef,
  detectedCount,
  selectedFetchProvider,
  providerOptions,
  composerAction,
  pageProbeBusy,
  setInput,
  runComposerAction,
  sniffPage,
  setFetchProvider,
  openSettings,
  showHero,
}: {
  input: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  detectedCount: number;
  selectedFetchProvider: ProviderId | "auto";
  providerOptions: ProviderOption[];
  composerAction: ComposerAction;
  pageProbeBusy: boolean;
  setInput: (value: string) => void;
  runComposerAction: () => void;
  sniffPage: () => void;
  setFetchProvider: (provider: ProviderId | "auto") => void;
  openSettings: () => void;
  showHero: boolean;
}) {
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
        <div className="composer-foot">
          <div className="composer-tools">
            {detectedCount > 0 ? (
              <>
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
                {detectedCount > 1 ? <span className="link-count">{detectedCount}</span> : null}
              </>
            ) : null}
          </div>
          <div className="composer-actions">
            {detectedCount === 1 ? (
              <button type="button" className="btn btn-ghost btn-fetch" onClick={sniffPage} disabled={pageProbeBusy}>
                {pageProbeBusy ? <Loader2 className="spin" size={14} strokeWidth={2} aria-hidden /> : "Sniff"}
              </button>
            ) : null}
            <button type="button" className="btn btn-primary btn-fetch" onClick={runComposerAction} disabled={composerAction.disabled}>
              {composerAction.label}{composerAction.countSuffix || ""}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
