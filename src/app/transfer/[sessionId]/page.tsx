import type { Metadata } from "next";
import { TransferRoom } from "@/components/transfer-room";

export const metadata: Metadata = {
  title: "Transfer room",
  robots: { index: false, follow: false },
};

export default async function TransferPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <TransferRoom sessionId={sessionId} />;
}
