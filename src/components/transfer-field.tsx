import type { CSSProperties } from "react";
import { CheckIcon, FileIcon } from "./icons";

interface TransferFieldProps {
  senderName: string;
  receiverName?: string;
  state: "waiting" | "approval" | "connecting" | "connected" | "transferring" | "paused" | "completed" | "failed";
  progress?: number;
  status: string;
}

export function TransferField({ senderName, receiverName, state, progress = 0, status }: TransferFieldProps) {
  const progressValue = Math.max(0, Math.min(100, progress));
  return (
    <div className={`live-field live-field--${state}`}>
      <div className="live-endpoint">
        <div className="endpoint-frame endpoint-frame--desktop"><span /></div>
        <div><strong>{senderName}</strong><span>Sender</span></div>
      </div>
      <div className="live-route" aria-hidden="true" style={{ "--route-progress": `${progressValue}%` } as CSSProperties}>
        <div className="live-route__track" />
        <div className="live-route__fill" />
        <span className="route-marker">{state === "completed" ? <CheckIcon size={14} /> : <FileIcon size={14} />}</span>
      </div>
      <div className="live-endpoint">
        <div className={`endpoint-frame endpoint-frame--phone${receiverName ? "" : " endpoint-frame--empty"}`}><span /></div>
        <div><strong>{receiverName ?? "No receiver yet"}</strong><span>Receiver</span></div>
      </div>
      <p className="live-status" role="status">{status}</p>
    </div>
  );
}
