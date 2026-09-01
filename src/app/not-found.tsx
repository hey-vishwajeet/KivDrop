import Link from "next/link";

export default function NotFound() {
  return (
    <div className="room-shell terminal-panel">
      <p className="eyebrow">Page not found</p>
      <h1>There is no transfer at this address.</h1>
      <p className="lede">Check the full pairing link, enter its six-digit code, or start a new transfer.</p>
      <div className="button-row">
        <Link className="button button--primary" href="/receive">Enter a pairing code</Link>
        <Link className="button button--secondary" href="/send">Choose files</Link>
      </div>
    </div>
  );
}
