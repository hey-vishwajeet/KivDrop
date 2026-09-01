import type { Metadata } from "next";
import Link from "next/link";
import "../secondary-pages.css";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What KivDrop stores, what the signaling service sees, and how file bytes travel between browsers.",
};

export default function PrivacyPage() {
  return (
    <article className="reading-shell secondary-reading">
      <header className="page-heading">
        <p className="eyebrow">Privacy model</p>
        <h1>What moves, what stays, and who can see it.</h1>
        <p>
          KivDrop avoids an upload-and-download file store. It still needs a
          signaling service to pair browsers, and that service handles metadata
          needed to establish the transfer.
        </p>
      </header>

      <div className="privacy-summary" aria-label="Privacy summary">
        <strong>The short version</strong>
        <ul>
          <li>File bytes use an encrypted WebRTC data channel.</li>
          <li>The signaling service receives transfer metadata, not file contents.</li>
          <li>History and preferences remain in this browser&apos;s local storage.</li>
        </ul>
      </div>

      <div className="prose">
        <section>
          <h2>Data kept in your browser</h2>
          <p>
            KivDrop stores a random device identifier, your editable device name,
            settings, and optional transfer history in local storage. History entries
            contain the date, direction, peer name, file count, total size, duration,
            and final status. They do not contain files, pairing links, or access tokens.
          </p>
          <p>
            Active session credentials stay in session storage for the life of the tab.
            Selected files are held by the sending page in memory. Received files are
            assembled in the receiving page and exposed as browser download URLs; they
            are not added to history.
          </p>
        </section>

        <section>
          <h2>What the signaling service handles</h2>
          <p>
            To create and join a room, the service temporarily holds generated device
            identifiers, labels, browser and device kinds, a file manifest, session
            status, approval state, connection identifiers, and expiry times. A manifest
            includes each file&apos;s name, size, reported type, and last-modified time.
            Secret tokens are stored as hashes in server memory.
          </p>
          <p>
            The service also routes WebRTC offers, answers, and ICE candidates. Those
            connection messages can contain network-address information. The current
            connecting address is also used for short-lived code-entry rate limiting.
            The current single-process server keeps sessions in memory and expires them
            after ten minutes of inactivity by default; a server restart also clears them.
            Deployment infrastructure may retain ordinary network or error logs outside
            this application, so the operator&apos;s hosting policy still matters.
          </p>
        </section>

        <section>
          <h2>How file contents travel</h2>
          <p>
            After both sides approve, file chunks travel through an encrypted WebRTC
            data channel. When a peer-to-peer route is available, the browsers exchange
            those packets directly. On restrictive networks, a configured TURN server
            may relay the encrypted WebRTC traffic. A TURN relay can observe endpoints,
            timing, and traffic volume, but it is not used by KivDrop as file storage.
          </p>
          <p>
            The receiving browser necessarily gets the approved file names and contents.
            Only pair with someone you intend to share with. KivDrop does not scan
            files for malware, add a separate file-encryption layer, verify peer identity,
            or currently compare a cryptographic checksum after transfer. Treat a pairing
            code or link as a secret and confirm the other device before approving.
          </p>
        </section>

        <section>
          <h2>Outside services and network metadata</h2>
          <p>
            The app uses a configurable STUN service to discover a viable WebRTC route
            and can use a configured TURN service when direct routing fails. Those
            services and the signaling host can see normal connection metadata such as
            IP addresses and request timing. Unless a deployer overrides it, the client
            defaults to Google&apos;s public STUN service. The current application does not
            include accounts, advertising, or analytics tracking.
          </p>
        </section>

        <section>
          <h2>Your controls</h2>
          <ul>
            <li>Both browsers approve by default before file bytes move.</li>
            <li>Pairing rooms expire and code-entry attempts are rate-limited.</li>
            <li>You can clear metadata-only transfer history from History or Settings.</li>
            <li>You can remove all remaining local data with your browser&apos;s site-data controls.</li>
          </ul>
          <p>
            Review the local choices in <Link href="/settings">Settings</Link>, including
            the auto-accept option. Leaving auto-accept off provides the clearest chance
            to inspect an incoming manifest before transfer.
          </p>
        </section>
      </div>
    </article>
  );
}
