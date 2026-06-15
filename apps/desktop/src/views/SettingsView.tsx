import {
  Cookie,
  Download,
  FolderOpen,
  Palette,
  Radar as RadarIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "watch"
  | "access"
  | "tools";

type SectionMeta = {
  id: SettingsSectionId;
  label: string;
  subtitle: string;
  icon: LucideIcon;
};

const RAIL_GROUPS: { label: string; sections: SectionMeta[] }[] = [
  {
    label: "Files",
    sections: [
      {
        id: "general",
        label: "General",
        subtitle: "Where finished downloads are saved.",
        icon: FolderOpen,
      },
    ],
  },
  {
    label: "Discovery",
    sections: [
      {
        id: "watch",
        label: "Watch",
        subtitle: "Channels and feeds to monitor.",
        icon: RadarIcon,
      },
    ],
  },
  {
    label: "Network",
    sections: [
      {
        id: "access",
        label: "Access",
        subtitle: "Browser sessions, privacy, and proxies.",
        icon: Cookie,
      },
    ],
  },
  {
    label: "App",
    sections: [
      {
        id: "appearance",
        label: "Appearance",
        subtitle: "Text rendering on this machine.",
        icon: Palette,
      },
      {
        id: "tools",
        label: "Tools",
        subtitle: "Queue workers and local save engines.",
        icon: Download,
      },
    ],
  },
];

const SECTION_BY_ID = Object.fromEntries(
  RAIL_GROUPS.flatMap((group) => group.sections.map((section) => [section.id, section])),
) as Record<SettingsSectionId, SectionMeta>;

type SettingsViewProps = {
  onClose: () => void;
  section: SettingsSectionId;
  setSection: (id: SettingsSectionId) => void;
  children: ReactNode;
};

export function SettingsView({ onClose, section, setSection, children }: SettingsViewProps) {
  const active = SECTION_BY_ID[section];

  return (
    <SettingsShell onClose={onClose} active={active} section={section} setSection={setSection}>
      {children}
    </SettingsShell>
  );
}

function SettingsShell({
  onClose,
  active,
  section,
  setSection,
  children,
}: SettingsViewProps & { active: SectionMeta }) {
  return (
    <div className="settings-fullscreen" role="dialog" aria-label="Settings" aria-modal="true">
      <div className="settings-panel">
        <nav className="settings-rail" aria-label="Settings sections">
          <button type="button" className="settings-back" onClick={onClose}>
            <X size={14} strokeWidth={2} aria-hidden />
            Close settings
          </button>
          {RAIL_GROUPS.map((group) => (
            <div key={group.label} className="settings-rail-group">
              <p className="settings-rail-group-label">{group.label}</p>
              {group.sections.map((item) => {
                const Icon = item.icon;
                const isActive = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`settings-rail-item ${isActive ? "is-active" : ""}`}
                    onClick={() => setSection(item.id)}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <Icon size={14} strokeWidth={2} aria-hidden />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="settings-pane">
          <header className="settings-head">
            <h2 className="settings-title">{active.label}</h2>
            <p className="settings-subtitle">{active.subtitle}</p>
          </header>
          <div className="settings-body">{children}</div>
        </div>
      </div>
    </div>
  );
}

type SettingsCardProps = {
  title: string;
  hint?: string;
  badge?: ReactNode;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
};

export function SettingsCard({ title, hint, badge, icon: Icon, children, className }: SettingsCardProps) {
  return (
    <section className={`settings-card ${className ?? ""}`.trim()}>
      <div className="settings-card-head">
        <div className="settings-card-title-row">
          {Icon ? <Icon size={14} strokeWidth={2} aria-hidden /> : null}
          <h3 className="settings-row-title">{title}</h3>
          {badge ? <span className="settings-version">{badge}</span> : null}
        </div>
        {hint ? <p className="settings-hint">{hint}</p> : null}
      </div>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}

type SettingsToggleProps = {
  label: string;
  hint: string;
  pressed: boolean;
  onToggle: () => void;
};

export function SettingsToggle({ label, hint, pressed, onToggle }: SettingsToggleProps) {
  return (
    <div className="settings-toggle-row">
      <span>
        <b>{label}</b>
        <small>{hint}</small>
      </span>
      <button
        type="button"
        className={`settings-toggle-btn ${pressed ? "is-active" : ""}`}
        onClick={onToggle}
        aria-pressed={pressed}
      >
        {pressed ? "On" : "Off"}
      </button>
    </div>
  );
}

type SettingsEmptyProps = {
  title: string;
  body: string;
  badge?: string;
};

export function SettingsEmpty({ title, body, badge }: SettingsEmptyProps) {
  return (
    <div className="settings-empty">
      {badge ? <span className="settings-empty-badge">{badge}</span> : null}
      <p className="settings-empty-title">{title}</p>
      <p className="settings-empty-body">{body}</p>
    </div>
  );
}
