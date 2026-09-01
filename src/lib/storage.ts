export interface KivDropSettings {
  autoAccept: boolean;
  autoDownload: boolean;
  notifications: boolean;
  sounds: boolean;
  theme: "light" | "dark" | "system";
}

export interface TransferHistoryEntry {
  id: string;
  date: number;
  direction: "sent" | "received";
  peerName: string;
  fileCount: number;
  totalBytes: number;
  durationSeconds: number;
  status: "completed" | "cancelled" | "failed";
}

export const DEFAULT_SETTINGS: KivDropSettings = {
  autoAccept: false,
  autoDownload: false,
  notifications: false,
  sounds: true,
  theme: "system",
};

const SETTINGS_KEY = "KivDrop:settings";
const HISTORY_KEY = "KivDrop:history";

export function loadSettings(): KivDropSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<KivDropSettings>),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: KivDropSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent("KivDrop:settings", { detail: settings }));
}

export function loadHistory(): TransferHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as TransferHistoryEntry[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function addHistory(entry: TransferHistoryEntry): void {
  const next = [entry, ...loadHistory().filter((item) => item.id !== entry.id)].slice(0, 100);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("KivDrop:history"));
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
  window.dispatchEvent(new Event("KivDrop:history"));
}

export function applyTheme(theme: KivDropSettings["theme"]): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
}
