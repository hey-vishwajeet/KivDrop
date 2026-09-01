import type { Metadata } from "next";
import Link from "next/link";
import "../secondary-pages.css";

export const metadata: Metadata = {
  title: "About",
  description: "Why KivDrop exists and how its browser-to-browser transfer path works.",
};

export default function AboutPage() {
  return (
    <article className="page-shell secondary-shell about-page">
      <header className="about-intro">
        <p className="eyebrow">About KivDrop</p>
        <h1>A short route between the devices already in your hands.</h1>
        <p className="lede">
          KivDrop is for the ordinary handoff that should not require an account,
          a cloud folder, or sending a file to yourself. One browser creates a room;
          another joins and decides whether to receive.
        </p>
        <div className="button-row">
          <Link className="button button--primary" href="/send">Choose files</Link>
          <Link className="button button--secondary" href="/receive">Enter a pairing code</Link>
        </div>
      </header>

      <section className="about-path" aria-labelledby="path-heading">
        <div className="about-section-heading">
          <p className="eyebrow">The route</p>
          <h2 id="path-heading">The server introduces. The browsers transfer.</h2>
        </div>
        <ol className="architecture-path">
          <li>
            <span className="step-number">01</span>
            <div><h3>Describe</h3><p>The sender shares a temporary manifest and creates a ten-minute pairing room.</p></div>
          </li>
          <li>
            <span className="step-number">02</span>
            <div><h3>Approve</h3><p>A code, QR code, or private link joins one receiver. Both sides see who is present before approving.</p></div>
          </li>
          <li>
            <span className="step-number">03</span>
            <div><h3>Transfer</h3><p>WebRTC carries bounded file chunks with backpressure and progress derived from acknowledged bytes.</p></div>
          </li>
        </ol>
      </section>

      <section className="about-details" aria-labelledby="approach-heading">
        <div className="about-section-heading">
          <p className="eyebrow">Technical approach</p>
          <h2 id="approach-heading">Small pieces with explicit jobs.</h2>
        </div>
        <dl className="approach-list">
          <div>
            <dt>Pairing</dt>
            <dd>Socket.IO routes room events, approvals, WebRTC descriptions, and network candidates.</dd>
          </div>
          <div>
            <dt>File path</dt>
            <dd>An ordered RTCDataChannel carries binary frames. TURN can relay encrypted packets when configured.</dd>
          </div>
          <div>
            <dt>Progress</dt>
            <dd>The interface counts bytes received or acknowledged; it does not animate a timer and call that progress.</dd>
          </div>
          <div>
            <dt>Local state</dt>
            <dd>Browser storage keeps device preferences and metadata-only history. The signaling room lives in server memory.</dd>
          </div>
        </dl>
      </section>

      <section className="about-limits" aria-labelledby="limits-heading">
        <div>
          <p className="eyebrow">Current boundaries</p>
          <h2 id="limits-heading">Network conditions still have a vote.</h2>
        </div>
        <div>
          <p>
            Direct routing is not possible on every office, carrier, or mobile network.
            A production deployment should configure TURN for those cases. Without it,
            connection setup can fail even when both browsers support WebRTC.
          </p>
          <p>
            Rooms are held by one signaling process, so restarting it ends active rooms
            and running multiple instances requires shared session coordination. An
            interrupted transfer can retry its connection, but it does not resume from a
            byte checkpoint after the tab or room is lost.
          </p>
          <p>
            The sender reads bounded slices, while the receiver currently assembles each
            whole file in memory before download. Device memory therefore sets a practical
            limit. The server admits at most 100 files and 10 GiB by default, but those
            ceilings are not a promise that every browser can handle that selection.
          </p>
          <Link href="/privacy">Read the exact privacy model</Link>
        </div>
      </section>
    </article>
  );
}
