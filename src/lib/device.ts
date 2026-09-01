import type { DeviceInfo } from "./protocol";

const DEVICE_KEY = "KivDrop:device";

function detectBrowser(): string {
  const agent = navigator.userAgent;
  if (/Edg\//.test(agent)) return "Edge";
  if (/OPR\//.test(agent)) return "Opera";
  if (/Firefox\//.test(agent)) return "Firefox";
  if (/CriOS\//.test(agent)) return "Chrome";
  if (/Chrome\//.test(agent)) return "Chrome";
  if (/Safari\//.test(agent)) return "Safari";
  return "Browser";
}

function detectKind(): DeviceInfo["kind"] {
  const agent = navigator.userAgent;
  if (/iPad|Tablet|PlayBook/i.test(agent)) return "tablet";
  if (/Android|iPhone|iPod|Mobile/i.test(agent)) return "mobile";
  return "desktop";
}

function defaultName(browser: string, kind: DeviceInfo["kind"]): string {
  if (kind === "mobile") return `${browser} on phone`;
  if (kind === "tablet") return `${browser} on tablet`;
  const platform = navigator.platform?.includes("Mac") ? "Mac" : navigator.platform?.includes("Win") ? "Windows" : "computer";
  return `${browser} on ${platform}`;
}

export function getDevice(): DeviceInfo {
  const browser = detectBrowser();
  const kind = detectKind();
  try {
    const saved = window.localStorage.getItem(DEVICE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as DeviceInfo;
      if (parsed.id && parsed.name) return { ...parsed, browser, kind };
    }
  } catch {
    // Storage can be unavailable in private or locked-down browsing contexts.
  }

  const device: DeviceInfo = {
    id: crypto.randomUUID(),
    name: defaultName(browser, kind),
    browser,
    kind,
  };
  saveDevice(device);
  return device;
}

export function saveDevice(device: DeviceInfo): void {
  try {
    window.localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  } catch {
    // The current session can still use the in-memory value.
  }
}
