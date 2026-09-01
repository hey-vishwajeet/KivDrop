import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";

export default function HomePage() {
  return (
    <div className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Browser-to-browser file transfer</p>
          <h1>Move files from this device to another.</h1>
          <p className="lede">
            Pair two browsers with a short code or private link. KivDrop sends the bytes over a direct, encrypted WebRTC connection whenever the network allows it.
          </p>
          <div className="hero-actions">
            <Link className="button button--primary" href="/send">Choose files <ArrowRightIcon /></Link>
            <Link className="button button--secondary" href="/receive">Receive files</Link>
          </div>
          <div className="trust-line" aria-label="Product facts">
            <span>No account</span><span>Sender approval</span><span>10-minute pairing</span>
          </div>
        </div>

        <div className="transfer-demo" aria-label="A file moving directly from a laptop browser to a phone browser">
          <div className="demo-grid" aria-hidden="true" />
          <div className="demo-field">
            <div className="demo-device">
              <div className="device-frame"><div className="device-screen" /></div>
              <strong>This laptop</strong><span>Sender</span>
            </div>
            <div className="demo-route">
              <div className="file-ticket"><b>field-notes.pdf</b><span>8.4 MB</span></div>
            </div>
            <div className="demo-device">
              <div className="device-frame device-frame--phone"><div className="device-screen" /></div>
              <strong>Your phone</strong><span>Receiver</span>
            </div>
          </div>
          <p className="demo-caption">The signaling server introduces the browsers. File contents use the peer connection.</p>
        </div>
      </section>

      <section aria-labelledby="how-heading">
        <h2 className="sr-only" id="how-heading">How KivDrop works</h2>
        <div className="steps-band">
          <div className="step"><span className="step-number">01</span><h3>Choose</h3><p>Select one file or a batch. Nothing leaves yet.</p></div>
          <div className="step"><span className="step-number">02</span><h3>Pair</h3><p>Open the private link or enter its six-digit code.</p></div>
          <div className="step"><span className="step-number">03</span><h3>Send</h3><p>Both devices approve, then real transfer progress begins.</p></div>
        </div>
      </section>

      <section className="facts">
        <div className="fact-block">
          <p className="eyebrow">What stays private</p>
          <h2>The signaling service does not store your files.</h2>
          <p>It temporarily holds the pairing session and routes connection setup messages. File contents travel inside the encrypted WebRTC connection.</p>
          <Link href="/privacy">Read the exact privacy model</Link>
        </div>
        <div className="fact-block">
          <p className="eyebrow">What networks decide</p>
          <h2>Direct transfer depends on a route between peers.</h2>
          <p>Some office, mobile, and carrier networks require a configured TURN relay. The interface reports the actual connection instead of promising one it cannot make.</p>
          <Link href="/about">See how the connection works</Link>
        </div>
      </section>
    </div>
  );
}
