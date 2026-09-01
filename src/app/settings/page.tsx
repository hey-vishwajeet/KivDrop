"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { getDevice, saveDevice } from "@/lib/device";
import {
  MAX_DEVICE_NAME_LENGTH,
  sanitizeDisplayName,
  type DeviceInfo,
} from "@/lib/protocol";
import {
  clearHistory,
  loadSettings,
  saveSettings,
  type KivDropSettings,
} from "@/lib/storage";
import "../secondary-pages.css";

interface PreferenceRowProps {
  checked: boolean;
  description: string;
  disabled?: boolean;
  id: string;
  label: string;
  onChange: (checked: boolean) => void;
}

function PreferenceRow({
  checked,
  description,
  disabled,
  id,
  label,
  onChange,
}: PreferenceRowProps) {
  return (
    <div className="preference-row">
      <div>
        <label htmlFor={id}>{label}</label>
        <p>{description}</p>
      </div>
      <input
        checked={checked}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<KivDropSettings | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"info" | "error">("info");
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const nextSettings = loadSettings();
      const nextDevice = getDevice();
      setSettings(nextSettings);
      setDevice(nextDevice);
      setDeviceName(nextDevice.name);
    };
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  function showMessage(value: string, kind: "info" | "error" = "info") {
    setMessage(value);
    setMessageKind(kind);
  }

  function persist(next: KivDropSettings, confirmation: string) {
    try {
      saveSettings(next);
      setSettings(next);
      showMessage(confirmation);
    } catch {
      showMessage("This browser would not allow KivDrop to save that setting.", "error");
    }
  }

  function update<K extends keyof KivDropSettings>(
    key: K,
    value: KivDropSettings[K],
    confirmation: string,
  ) {
    if (!settings) return;
    persist({ ...settings, [key]: value }, confirmation);
  }

  function handleDeviceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!device) return;
    const safeName = sanitizeDisplayName(deviceName, "").slice(0, MAX_DEVICE_NAME_LENGTH);
    if (!safeName) {
      showMessage("Enter a device name with at least one visible character.", "error");
      return;
    }
    const nextDevice = { ...device, name: safeName };
    saveDevice(nextDevice);
    setDevice(nextDevice);
    setDeviceName(safeName);
    showMessage("Device name saved in this browser.");
  }

  async function handleNotifications(checked: boolean) {
    if (!settings) return;
    if (!checked) {
      persist({ ...settings, notifications: false }, "Completion notifications turned off.");
      return;
    }
    if (!("Notification" in window)) {
      showMessage("This browser does not support desktop notifications.", "error");
      return;
    }
    try {
      const permission =
        Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
      if (permission !== "granted") {
        showMessage("Notification permission was not granted. The setting remains off.", "error");
        return;
      }
      persist({ ...settings, notifications: true }, "Completion notifications turned on.");
    } catch {
      showMessage("Notification permission could not be requested.", "error");
    }
  }

  function handleClearHistory() {
    try {
      clearHistory();
      setConfirmingClear(false);
      showMessage("Transfer history cleared from this browser.");
    } catch {
      showMessage("This browser would not allow KivDrop to clear local history.", "error");
    }
  }

  return (
    <div className="page-shell secondary-shell settings-shell">
      <header className="page-heading">
        <p className="eyebrow">This browser</p>
        <h1>Settings</h1>
        <p>
          Device identity and preferences are stored locally. They do not follow you
          to another browser or device.
        </p>
      </header>

      <p
        aria-live="polite"
        className={
          message
            ? `status-note${messageKind === "error" ? " status-note--danger" : ""}`
            : "sr-only"
        }
      >
        {message}
      </p>

      {settings && device ? (
        <div className="settings-sections">
          <section className="settings-section" aria-labelledby="device-heading">
            <div className="settings-section__intro">
              <p className="eyebrow">Identity</p>
              <h2 id="device-heading">Device name</h2>
              <p>Shown to the other browser before either side approves a transfer.</p>
            </div>
            <form className="settings-section__body device-form" onSubmit={handleDeviceSubmit}>
              <div className="field">
                <label htmlFor="device-name">Name shown to peers</label>
                <input
                  autoComplete="off"
                  id="device-name"
                  maxLength={MAX_DEVICE_NAME_LENGTH}
                  onChange={(event) => setDeviceName(event.target.value)}
                  required
                  value={deviceName}
                />
                <span className="field-help">
                  {device.browser} Â· {device.kind} Â· {deviceName.length}/{MAX_DEVICE_NAME_LENGTH}
                </span>
              </div>
              <button className="button button--secondary" type="submit">Save device name</button>
            </form>
          </section>

          <section className="settings-section" aria-labelledby="appearance-heading">
            <div className="settings-section__intro">
              <p className="eyebrow">Appearance</p>
              <h2 id="appearance-heading">Theme</h2>
              <p>System follows the light or dark preference of this device.</p>
            </div>
            <fieldset className="settings-section__body theme-options">
              <legend className="sr-only">Color theme</legend>
              {(["system", "light", "dark"] as const).map((theme) => (
                <label key={theme}>
                  <input
                    checked={settings.theme === theme}
                    name="theme"
                    onChange={() => update("theme", theme, `${theme[0].toUpperCase()}${theme.slice(1)} theme selected.`)}
                    type="radio"
                    value={theme}
                  />
                  <span>{theme[0].toUpperCase()}{theme.slice(1)}</span>
                </label>
              ))}
            </fieldset>
          </section>

          <section className="settings-section" aria-labelledby="transfer-heading">
            <div className="settings-section__intro">
              <p className="eyebrow">Transfer behavior</p>
              <h2 id="transfer-heading">Receiving</h2>
              <p>These choices apply when this browser is the receiving device.</p>
            </div>
            <div className="settings-section__body preference-list">
              <PreferenceRow
                checked={settings.autoAccept}
                description="Skip the final receiver confirmation after the sender approves. Keep this off on shared devices."
                id="auto-accept"
                label="Auto-accept incoming transfers"
                onChange={(checked) => update("autoAccept", checked, `Auto-accept turned ${checked ? "on" : "off"}.`)}
              />
              <PreferenceRow
                checked={settings.autoDownload}
                description="Save a completed single-file transfer automatically. Multiple files remain available as individual downloads."
                id="auto-download"
                label="Download completed files automatically"
                onChange={(checked) => update("autoDownload", checked, `Automatic downloads turned ${checked ? "on" : "off"}.`)}
              />
            </div>
          </section>

          <section className="settings-section" aria-labelledby="alerts-heading">
            <div className="settings-section__intro">
              <p className="eyebrow">Attention</p>
              <h2 id="alerts-heading">Alerts</h2>
              <p>Useful when a transfer is running in a background tab.</p>
            </div>
            <div className="settings-section__body preference-list">
              <PreferenceRow
                checked={settings.notifications}
                description="Show a browser notification when a transfer completes. Browser permission is required."
                id="notifications"
                label="Completion notifications"
                onChange={(checked) => void handleNotifications(checked)}
              />
              <PreferenceRow
                checked={settings.sounds}
                description="Play a short cue when a transfer completes."
                id="sounds"
                label="Transfer sounds"
                onChange={(checked) => update("sounds", checked, `Transfer sounds turned ${checked ? "on" : "off"}.`)}
              />
            </div>
          </section>

          <section className="settings-section" aria-labelledby="privacy-heading">
            <div className="settings-section__intro">
              <p className="eyebrow">Local data</p>
              <h2 id="privacy-heading">Privacy controls</h2>
              <p>History contains transfer metadata only and stays in this browser.</p>
            </div>
            <div className="settings-section__body local-data-actions">
              {confirmingClear ? (
                <div className="secondary-confirm secondary-confirm--compact" role="alert">
                  <div>
                    <strong>Clear every history entry?</strong>
                    <p>Downloaded files and current settings will not be affected.</p>
                  </div>
                  <div className="button-row">
                    <button className="button button--danger" onClick={handleClearHistory} type="button">Clear all</button>
                    <button className="button button--quiet" onClick={() => setConfirmingClear(false)} type="button">Cancel</button>
                  </div>
                </div>
              ) : (
                <button className="button button--danger" onClick={() => setConfirmingClear(true)} type="button">
                  Clear transfer history
                </button>
              )}
              <Link href="/privacy">Read what KivDrop stores and sends</Link>
            </div>
          </section>
        </div>
      ) : (
        <p className="muted" role="status">Reading settings from this browserâ€¦</p>
      )}
    </div>
  );
}
