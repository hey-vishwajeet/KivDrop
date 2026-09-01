import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage this browser's KivDrop identity, transfer behavior, theme, and local data.",
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
