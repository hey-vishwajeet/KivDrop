import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Transfer history",
  description: "Review transfer metadata stored locally in this browser.",
};

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
