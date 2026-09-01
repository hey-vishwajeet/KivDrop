import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Send files",
  description: "Choose files and create a private, short-lived KivDrop transfer.",
};

export default function SendLayout({ children }: { children: React.ReactNode }) {
  return children;
}
