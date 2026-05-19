import { Cookie, Download, FolderOpen, FolderSearch, Radar as RadarIcon, Search, X } from "lucide-react";
import type { ReactNode } from "react";

export type SettingsSectionId = "general" | "search" | "ingest" | "watch" | "access" | "tools" | "appearance";

type SettingsViewProps = {
  onClose: () => void;
  section: SettingsSectionId;
  setSection: (id: SettingsSectionId) => void;
  children: ReactNode;
};

export function SettingsView({ onClose, section, setSection, children }: SettingsViewProps) {
  return (
    <div className="settings-fullscreen" role="dialog" aria-label="Settings" aria-modal="true">
      <div className="settings-panel">
        <nav className="settings-rail" aria-label="Settings sections">
          <button type="button" className="settings-back" onClick={onClose} aria-label="Back to app">
            <X size={14} strokeWidth={2} aria-hidden /> Back to app
          </button>
          {([
            { id: "general" as const, label: "General", icon: FolderOpen },
            { id: "search" as const, label: "Search", icon: Search },
            { id: "ingest" as const, label: "Ingest", icon: FolderSearch },
            { id: "watch" as const, label: "Watch", icon: RadarIcon },
            { id: "access" as const, label: "Access", icon: Cookie },
            { id: "tools" as const, label: "Tools", icon: Download },
          ]).map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`settings-rail-item ${active ? "is-active" : ""}`}
                onClick={() => setSection(item.id)}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={14} strokeWidth={2} aria-hidden />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="settings-pane">
          <div className="settings-head">
            <h2 className="settings-title">
              {section === "general" ? "General" :
                section === "search" ? "Search" :
                  section === "ingest" ? "Ingest" :
                    section === "watch" ? "Watch" :
                      section === "access" ? "Access" :
                        section === "appearance" ? "Appearance" : "Tools"}
            </h2>
            <p className="settings-subtitle">
              {section === "general" ? "Where Rippo saves what you download." :
                section === "search" ? "How Rippo finds links across the web." :
                  section === "ingest" ? "How saved footage is indexed." :
                    section === "watch" ? "Channels and feeds Rippo monitors for new finds." :
                      section === "access" ? "Use your browser session for video links that need it." :
                        section === "appearance" ? "Fonts, cursors, and display preferences." :
                          "Engines Rippo uses to save and prepare files."}
            </p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
