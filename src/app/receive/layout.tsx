import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Receive files",
  description: "Join an KivDrop transfer with a six-digit code or QR pairing link.",
};

export default function ReceiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
