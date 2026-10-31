import { appShortcutHints } from "../app/keyboardShortcuts";

/** Shown in the main app only — not on sign-in (those shortcuts do not apply there). */
export function ShortcutHintRail() {
  const appHints = appShortcutHints();

  return (
    <aside className="app-shortcut-rail" aria-label="Keyboard shortcuts">
      <p className="app-shortcut-rail-title">In Rippo</p>
      <ul className="app-shortcut-rail-list">
        {appHints.map((hint) => (
          <li key={hint.label}>
            <kbd>{hint.keys}</kbd>
            <span>{hint.label}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
