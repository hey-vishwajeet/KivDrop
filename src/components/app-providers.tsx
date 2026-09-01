"use client";

import { useEffect } from "react";
import { applyTheme, loadSettings } from "@/lib/storage";

export function AppProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const updateTheme = () => applyTheme(loadSettings().theme);
    updateTheme();
    window.addEventListener("KivDrop:settings", updateTheme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", updateTheme);

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installation is optional; file transfer remains available in the page.
      });
    }
    return () => {
      window.removeEventListener("KivDrop:settings", updateTheme);
      media.removeEventListener("change", updateTheme);
    };
  }, []);

  return children;
}
