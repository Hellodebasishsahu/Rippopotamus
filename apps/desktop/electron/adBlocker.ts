import { ElectronBlocker } from "@ghostery/adblocker-electron";

let instance: ElectronBlocker | null = null;
let pending: Promise<ElectronBlocker | null> | null = null;

export function initAdBlocker(): Promise<ElectronBlocker | null> {
  if (instance) return Promise.resolve(instance);
  if (pending) return pending;
  pending = ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
    .then((blocker) => {
      instance = blocker;
      return blocker;
    })
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

export function getAdBlocker(): ElectronBlocker | null {
  return instance;
}
