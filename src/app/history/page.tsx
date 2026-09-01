"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatBytes, formatDuration } from "@/lib/format";
import {
  clearHistory,
  loadHistory,
  type TransferHistoryEntry,
} from "@/lib/storage";
import "../secondary-pages.css";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusLabels: Record<TransferHistoryEntry["status"], string> = {
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
};

function readValidHistory(): TransferHistoryEntry[] {
  return loadHistory()
    .filter(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        Number.isFinite(entry.date) &&
        (entry.direction === "sent" || entry.direction === "received") &&
        typeof entry.peerName === "string" &&
        Number.isFinite(entry.fileCount) &&
        Number.isFinite(entry.totalBytes) &&
        Number.isFinite(entry.durationSeconds) &&
        (entry.status === "completed" ||
          entry.status === "cancelled" ||
          entry.status === "failed"),
    )
    .sort((a, b) => b.date - a.date);
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<TransferHistoryEntry[] | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const refresh = () => setEntries(readValidHistory());
    refresh();
    window.addEventListener("KivDrop:history", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("KivDrop:history", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  function handleClear() {
    try {
      clearHistory();
      setEntries([]);
      setConfirmingClear(false);
      setMessage("Transfer history cleared from this browser.");
    } catch {
      setMessage("This browser would not allow KivDrop to clear local history.");
    }
  }

  const recordedBytes = entries?.reduce((sum, entry) => sum + entry.totalBytes, 0) ?? 0;
  const completedCount = entries?.filter((entry) => entry.status === "completed").length ?? 0;

  return (
    <div className="narrow-shell secondary-shell">
      <header className="page-heading secondary-page-heading">
        <div>
          <p className="eyebrow">On this browser</p>
          <h1>Transfer history</h1>
          <p>
            A local record of what was sent or received. File contents, pairing
            links, and session credentials are never added here.
          </p>
        </div>
        {entries && entries.length > 0 ? (
          <button
            className="button button--danger"
            onClick={() => setConfirmingClear(true)}
            type="button"
          >
            Clear history
          </button>
        ) : null}
      </header>

      {confirmingClear ? (
        <div className="secondary-confirm" role="alert">
          <div>
            <strong>Clear every recorded transfer?</strong>
            <p>This cannot be undone. Downloaded files will not be affected.</p>
          </div>
          <div className="button-row">
            <button className="button button--danger" onClick={handleClear} type="button">
              Clear all
            </button>
            <button
              className="button button--quiet"
              onClick={() => setConfirmingClear(false)}
              type="button"
            >
              Keep history
            </button>
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className={message ? "status-note" : "sr-only"}>
        {message}
      </p>

      {entries === null ? (
        <p className="muted" role="status">Reading local historyâ€¦</p>
      ) : entries.length === 0 ? (
        <section className="history-empty" aria-labelledby="empty-history-heading">
          <p className="eyebrow">No entries yet</p>
          <h2 id="empty-history-heading">Completed and interrupted transfers will appear here.</h2>
          <p>
            History stays in this browser and records metadata only. Start a transfer
            when you have something to move.
          </p>
          <div className="button-row">
            <Link className="button button--primary" href="/send">Choose files</Link>
            <Link className="button button--secondary" href="/receive">Receive files</Link>
          </div>
        </section>
      ) : (
        <>
          <section className="history-summary" aria-label="History summary">
            <div>
              <span className="micro muted">Recorded</span>
              <strong className="metric-value">{entries.length}</strong>
              <span className="small muted">{entries.length === 1 ? "transfer" : "transfers"}</span>
            </div>
            <div>
              <span className="micro muted">Completed</span>
              <strong className="metric-value">{completedCount}</strong>
              <span className="small muted">on this browser</span>
            </div>
            <div>
              <span className="micro muted">Recorded size</span>
              <strong className="metric-value">{formatBytes(recordedBytes)}</strong>
              <span className="small muted">across these entries</span>
            </div>
          </section>

          <ol className="history-list" aria-label="Recorded transfers">
            {entries.map((entry) => {
              const peer = entry.peerName.trim() || "Unnamed device";
              const date = new Date(entry.date);
              return (
                <li className="history-entry" key={entry.id}>
                  <time className="history-entry__date" dateTime={date.toISOString()}>
                    {dateFormatter.format(date)}
                  </time>
                  <div className="history-entry__main">
                    <h2>
                      {entry.direction === "sent" ? "Sent to" : "Received from"} {peer}
                    </h2>
                    <p>
                      {entry.fileCount} {entry.fileCount === 1 ? "file" : "files"}
                      <span aria-hidden="true"> Â· </span>
                      {formatBytes(entry.totalBytes)}
                      {entry.durationSeconds >= 0 ? (
                        <>
                          <span aria-hidden="true"> Â· </span>
                          {formatDuration(entry.durationSeconds)}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <span className={`history-status history-status--${entry.status}`}>
                    {statusLabels[entry.status]}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
