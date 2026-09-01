"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") console.error(error);
  }, [error]);

  return (
    <div className="room-shell terminal-panel">
      <p className="eyebrow">Application error</p>
      <h1>This page could not finish loading.</h1>
      <p className="lede">Your selected files have not been uploaded. Try this page again; if the tab was refreshed during a transfer, create a new room.</p>
      <button className="button button--primary" onClick={reset} type="button">Try again</button>
    </div>
  );
}
