export type AppView = "queue" | "library";

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/u.test(navigator.platform);

export function modKeyLabel(): string {
  return IS_MAC ? "⌘" : "Ctrl";
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export type AppShortcutHandlers = {
  setActiveView: (view: AppView) => void;
  openSettings: () => void;
  closeSettings: () => void;
  runComposerAction: () => void;
  settingsOpen: boolean;
  activeView: AppView;
  composerDisabled: boolean;
};

export function appShortcutHints(): ReadonlyArray<{ keys: string; label: string }> {
  const mod = modKeyLabel();
  return [
    { keys: "1", label: "Queue" },
    { keys: "2", label: "Lib" },
    { keys: `${mod}+↵`, label: "Fetch" },
    { keys: `${mod}+,`, label: "Settings" },
  ];
}

export function handleAppShortcut(event: KeyboardEvent, handlers: AppShortcutHandlers): boolean {
  if (event.defaultPrevented || event.altKey) return false;

  const typing = isTypingTarget(event.target);

  if (event.key === "Escape" && handlers.settingsOpen) {
    event.preventDefault();
    handlers.closeSettings();
    return true;
  }

  if (typing) return false;

  const mod = IS_MAC ? event.metaKey : event.ctrlKey;

  if (mod && event.key === ",") {
    event.preventDefault();
    handlers.openSettings();
    return true;
  }

  if (mod && event.key === "Enter" && handlers.activeView === "queue" && !handlers.composerDisabled) {
    event.preventDefault();
    void handlers.runComposerAction();
    return true;
  }

  if (!mod && !event.shiftKey && event.key === "1") {
    event.preventDefault();
    handlers.setActiveView("queue");
    return true;
  }

  if (!mod && !event.shiftKey && event.key === "2") {
    event.preventDefault();
    handlers.setActiveView("library");
    return true;
  }

  return false;
}
