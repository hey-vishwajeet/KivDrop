# KivDrop

KivDrop is a browser-to-browser file transfer application. A sender selects files, opens a short-lived room, pairs with one receiver by code, QR code, or capability link, and approves the receiving device. After the receiver reviews and accepts the manifest, the browsers negotiate an ordered WebRTC data channel and move the real file bytes.

No account or database is required. The signaling service coordinates the room and WebRTC negotiation; it does not carry or persist file contents. A configured TURN server may relay encrypted WebRTC packets when a direct route is unavailable.

## What is implemented

- File selection by picker or drag and drop, with removal and totals
- Pairing by six-digit code, QR code, or private link
- One sender and one receiver per room
- Sender approval before the manifest is revealed to the receiver
- Receiver approval before WebRTC negotiation begins
- Optional receiver auto-accept, off by default and stored only in that browser
- Ordered multi-file transfer over `RTCDataChannel`
- Real received/acknowledged-byte progress, smoothed speed, and ETA
- Sender-side backpressure plus pause, resume, cancel, and connection retry controls
- Browser downloads through temporary object URLs
- Local device name, preferences, and metadata-only completion history
- Light, dark, and system themes; optional completion sound and notification
- A small PWA shell with an offline explanation (active transfers still require connectivity)
- Expiring in-memory sessions, validation, origin controls, limits, and join throttling

The current boundaries are documented in [Limitations](#limitations). In particular, transfers do not resume from a saved byte checkpoint, the receiver assembles files in browser memory, and the signaling service is single-process and ephemeral.

## Architecture

```text
 Sender browser                 Signaling service                 Receiver browser
 (Next.js client)              (Node + Socket.IO)                (Next.js client)
       |                              |                                  |
       +-- room, approval, SDP/ICE -->+<-- room, approval, SDP/ICE ------+
       |                              |                                  |
       +========== ordered WebRTC RTCDataChannel (direct) ===============+
       +====== encrypted WebRTC packets through TURN when selected ======+
```

The signaling path handles temporary metadata and connection setup. The WebRTC path handles control messages and binary file frames. There is no application-level file upload endpoint or fallback file store.

Important modules:

| Path | Responsibility |
| --- | --- |
| `src/app` | Next.js App Router pages for home, send, receive, transfer, history, settings, privacy, and about |
| `src/components/transfer-room.tsx` | Room bootstrap, pairing/approval UI, signaling events, history, and downloads |
| `src/hooks/use-peer-transfer.ts` | Peer negotiation, data-channel lifecycle, queueing, progress, pause/cancel, and retry |
| `src/lib/protocol.ts` | Shared Zod schemas, protocol types, limits, and metadata sanitization |
| `src/lib/transfer-wire.ts` | Binary frame encoding/decoding and data-channel backpressure |
| `src/lib/session-client.ts` | Socket.IO client plus tab-scoped session credentials |
| `src/lib/file-vault.ts` | In-memory references to the sender's selected `File` objects |
| `src/lib/storage.ts` | Local settings and metadata-only history |
| `server/signaling-server.ts` | HTTP health endpoint, Socket.IO events, validation, CORS, and join throttling |
| `server/session-store.ts` | In-memory lifecycle, capability-token hashes, approval state, and expiry |
| `public/sw.js` | Production-only shell caching; transfer-room requests are excluded |

## Requirements

- Node.js 20.9 or newer (required by the installed Next.js version)
- npm
- Two modern browsers with WebRTC data-channel support
- HTTPS for production and for reliable testing from a second physical device
- A TURN service for dependable operation across restrictive NAT, carrier, office, or guest networks

## Local setup

The defaults work for two tabs or two browsers on one computer:

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. The combined development command starts:

- the Next.js app at `http://localhost:3000`;
- the signaling service at `http://localhost:3001`.

The signaling health check is available at <http://localhost:3001/health>.

Useful individual commands:

```bash
npm run dev:web
npm run dev:signal
npm run build
npm run start
npm run start:signal
```

Copy `.env.example` to `.env.local` when browser-visible values need local overrides. Next.js loads `.env.local`, but `server/index.ts` reads `process.env` directly and does **not** load dotenv files. Export signaling variables in the parent shell, container, or process manager. Variables exported before `npm run dev` are inherited by both child processes.

All `NEXT_PUBLIC_*` values are included in browser code. Set them before `npm run build`; changing them only at runtime does not update an existing web build.

## Environment variables

| Variable | Used by | Default | Meaning |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SIGNALING_URL` | Web build | `http://localhost:3001` | Public Socket.IO signaling origin. Use `https://` in production; Socket.IO will use secure WebSocket/polling transports. It is also added to the web CSP. |
| `NEXT_PUBLIC_STUN_URLS` | Web build | `stun:stun.l.google.com:19302` | Comma-separated STUN URLs used as one ICE server entry. Set an empty value to omit STUN. |
| `NEXT_PUBLIC_TURN_URL` | Web build | unset | Optional `turn:` or `turns:` URL. The current client accepts one TURN URL. |
| `NEXT_PUBLIC_TURN_USERNAME` | Web build | unset | Username sent to the configured TURN server. |
| `NEXT_PUBLIC_TURN_CREDENTIAL` | Web build | unset | TURN credential sent to every client. It is not a server-side secret because it is a public build variable; prefer short-lived TURN credentials for an internet deployment. |
| `SIGNALING_PORT` | Signaling process | `3001` | TCP port for the signaling HTTP/Socket.IO server. |
| `WEB_ORIGIN` | Signaling process | `http://localhost:3000` | Comma-separated, exact browser origins allowed by Socket.IO CORS. Include every production web origin intentionally. |
| `SESSION_TTL_MS` | Signaling process | `600000` | Inactivity lifetime in milliseconds. Authorized activity and the one-minute heartbeat extend it. |
| `MAX_FILES_PER_TRANSFER` | Signaling process | `100` | Admission limit. The shared protocol and sender UI also impose a hard maximum of 100 files. |
| `MAX_TRANSFER_BYTES` | Signaling process | `10737418240` | Maximum declared manifest total in bytes (10 GiB by default). This is an admission ceiling, not a browser-capability guarantee. |

If `SESSION_TTL_MS` is changed, update user-facing ten-minute copy as well; that copy is currently static.

## Pairing and signaling flow

1. The sender creates a manifest containing each sanitized name, size, reported MIME type, and last-modified timestamp. The original `File` objects stay in that tab's in-memory file vault.
2. The signaling service creates a random 24-byte base64url session ID, sender token, and share capability, plus a unique six-digit code. It stores hashes of the secret tokens, not their plaintext values.
3. The receiver joins with the code or with the session ID and share capability from a URL fragment such as `#join=...`. A fragment is not sent in the initial HTTP request; client code reads it and submits the capability to signaling.
4. The sender sees the receiver's temporary device label and approves or rejects it. Until approval, the receiver snapshot does not include the file manifest.
5. The receiver reviews the revealed manifest and accepts or declines its current revision. If that browser's user has deliberately enabled auto-accept, it submits acceptance as soon as the approved manifest arrives.
6. Only in the `READY` state may either peer relay SDP descriptions and ICE candidates. The sender creates the ordered `KivDrop-v1` data channel and WebRTC offer; the receiver answers.
7. Socket.IO credentials in `sessionStorage` let the same tab rebind to an active signaling room after a signaling reconnect. They are not durable transfer checkpoints.

The room store is memory-only. Heartbeats run once per minute while a room is active, and an expiry sweep removes inactive sessions. A signaling restart immediately loses all rooms and codes.

## WebRTC transfer, framing, and backpressure

The sender reads each file sequentially with `File.slice()` in 256 KiB logical chunks. Each logical chunk is split into data-channel payloads of up to 48 KiB, reduced when the browser reports a smaller SCTP `maxMessageSize`. A 20-byte binary header records:

- protocol version and frame type;
- file index and monotonically increasing chunk index;
- exact byte offset;
- payload length.

The receiver requires frames to match the approved manifest, arrive at the expected file/chunk/offset, and remain within the declared file size. It acknowledges every accepted binary frame with the per-file and total received byte counts. Receiver progress comes from bytes it has accepted; sender progress comes from those acknowledgements. Speed uses a smoothed measurement of actual progress, and ETA is derived from remaining bytes rather than a timer animation.

Before enqueuing more binary data, the sender checks `RTCDataChannel.bufferedAmount`. Once the queue exceeds 4 MiB, it waits for `bufferedamountlow` (or a poll) to report 1 MiB or less. Cancellation aborts this wait. This bounds sender-side queued data in addition to the 256 KiB read size.

The receiver retains the current file's parts, builds a `Blob` after the declared size arrives, and creates a temporary object URL. Completed files are offered as individual downloads. Automatic download currently applies only to a completed single-file transfer; browser download policies still control the final behavior.

### Pause, retry, and reconnect semantics

- **Pause** stops the sender from reading or enqueuing the next piece and tells the peer to show a paused state. Bytes already buffered in WebRTC may still arrive, so it is not an instantaneous network freeze.
- **Resume** continues only in the current page, room, and peer connection.
- **Signaling reconnect** can re-authorize the same tab with its session token. It does not restore lost file bytes or force an ICE restart.
- **Connection retry** closes and renegotiates WebRTC. It is not offset-based resume and is not reliable after a partial file has arrived. Creating a fresh room is the safe recovery after an interrupted transfer.
- **Reload or tab loss** discards the sender's in-memory `File` references and all partial receiver buffers. Session credentials may survive a reload in `sessionStorage`, but the transfer payload does not.

## Testing locally

### Two tabs on one computer

1. Run `npm run dev` and open `http://localhost:3000/send` in tab A.
2. Select a small, non-sensitive file and create the room. Keep tab A open; reloading loses its selected `File` references.
3. Open `http://localhost:3000/receive` in tab B and enter the displayed code. Alternatively, open the full capability link in a new tab.
4. Approve tab B in tab A.
5. Review the exact manifest in tab B and accept it.
6. Watch the connection state and byte counts. Download the completed file in tab B and compare its size and contents with the source.
7. Repeat with several files, then exercise pause/resume and cancel. Create a new room to test rejection, an invalid code, and expiry.

Use two different browsers to exercise isolated browser storage and a more realistic WebRTC connection. The two contexts must both remain open during transfer.

For an integrity check outside the app, compare a source and downloaded file with `Get-FileHash` on PowerShell or `shasum -a 256` on macOS/Linux. KivDrop itself does not currently exchange or verify file hashes.

### Two physical devices

1. Put the web app behind a trusted HTTPS origin that both devices can reach. Raw `http://<LAN-IP>` is not a reliable test because camera and other secure-context APIs can be unavailable.
2. Expose the signaling service over HTTPS/WSS with WebSocket upgrade support.
3. Build the web app with `NEXT_PUBLIC_SIGNALING_URL` set to that reachable signaling origin. Do not use `localhost`; on the second device it points back to that device.
4. Set signaling `WEB_ORIGIN` to the exact HTTPS web origin. If multiple origins are intentional, separate them with commas.
5. Configure STUN and production TURN credentials. TURN is especially important when the devices are on different Wi-Fi/mobile networks or behind restrictive NAT.
6. Open `/send` on one device and `/receive` on the other. Test the numeric code first, then QR scanning after granting camera permission.
7. Confirm whether the room reports a direct or relay-selected candidate. Merely configuring TURN does not force the browser to choose it.

Test at least one same-network case and one different-network case. Safari/iOS download handling, background-tab suspension, camera access, large files, and TURN behavior should be verified on the actual target devices; there is no automated browser end-to-end suite in this repository.

## Production deployment

Deploy the web app and signaling service as two processes, even if they use the same repository.

### Web application

1. Set `NEXT_PUBLIC_SIGNALING_URL`, STUN, and optional TURN values in the **build** environment.
2. Run `npm ci` and `npm run build`.
3. Serve the Next.js application with `npm run start` on a Node-compatible host.
4. Terminate TLS at the platform or reverse proxy and keep the generated security headers enabled.

The web origin must be HTTPS. The service worker caches only the public shell/offline assets and same-origin static assets. It skips transfer-room navigation and does not cache files, room credentials, signaling responses, or transferred payloads. Offline mode cannot create, join, or continue a transfer.

### Signaling service

1. Run a long-lived Node process with all server environment variables supplied by the process manager.
2. Start it with `npm run start:signal`.
3. Put it behind TLS so browsers reach it through HTTPS/WSS, and configure the proxy for Socket.IO WebSocket upgrades, long-lived connections, and polling fallback.
4. Restrict `WEB_ORIGIN`, expose only the required port/origin, and monitor `GET /health`.
5. Deploy TURN separately and allow its required UDP/TCP/TLS ports.

The current `start:signal` command executes TypeScript with `tsx`, which is a development dependency. A signaling host therefore needs a full `npm ci` install. There is no compiled signaling artifact yet; do not use `npm ci --omit=dev` unless a separate server build step is added.

Run exactly one signaling instance for the current implementation. Horizontal replicas do not share the session store, rate buckets, or Socket.IO peer locations. Production scaling requires a shared session store, a Socket.IO adapter/pub-sub layer, coordinated expiry, and usually sticky routing. A serverless request/response function is not a suitable drop-in host for this stateful Socket.IO process.

## Security and privacy controls

- WebRTC encrypts the data channel in transit. TURN may relay those encrypted packets but is not an KivDrop file store.
- The signaling service receives device metadata, the full file manifest, approval/session state, SDP, and ICE candidates. Infrastructure, STUN, TURN, and signaling operators can observe normal network metadata such as IP addresses, timing, and traffic volume.
- File contents are never sent through the application signaling handlers and are not persisted by the signaling service.
- Session IDs and capability tokens use Node cryptographic randomness. Secret session tokens are SHA-256 hashed in server memory and compared with timing-safe equality.
- Shared Zod schemas validate signaling payload shape and size. File/device display names remove control, bidi-control, slash, and backslash characters before display.
- A room admits one receiver, hides the manifest until sender approval, and requires receiver approval before negotiation.
- Code-join attempts are limited to 12 per source address per minute, per signaling process. Socket.IO messages are capped at 192,000 bytes.
- Browser origins are checked against `WEB_ORIGIN`; origin-less clients are currently allowed, so CORS is not an authentication boundary.
- The web app sends CSP, frame, MIME-sniffing, referrer, permissions, and opener policy headers. The QR scanner accepts only same-origin `/transfer/` links.
- The share capability remains in the URL fragment until client code consumes it, then the visible URL is cleaned. Treat the full link and six-digit code as temporary secrets.
- Device identity, preferences, and up to 100 local history entries live in browser local storage. Role credentials live in session storage. History can be cleared in the UI and does not contain file contents or capability tokens.
- There are no accounts, analytics, ads, malware scanning, or server-side content inspection in the current repository.

WebRTC provides transport encryption, but KivDrop does not add an application-level encryption key, authenticate a person's real-world identity, or protect a file after the receiver downloads it. Review the displayed peer and manifest before approving.

## Limitations

- **NAT traversal:** the default configuration has public STUN but no TURN. Some networks will fail to connect until TURN is supplied.
- **Receiver memory:** the sender reads bounded slices, but the receiver assembles files in memory and retains completed blobs until the page is closed. Practical limits can be far below the server's 10 GiB admission limit, especially on mobile Safari.
- **No durable resume:** partial bytes, object URLs, and sender file handles are not persisted. Pause is same-connection flow control; retry is renegotiation, not checkpoint recovery.
- **Single signaling process:** rooms and rate limits are in memory. Restarts lose active sessions, and multiple instances are unsafe without shared coordination.
- **No independent integrity proof:** framing checks order, offsets, and declared lengths, but there is no cryptographic file checksum, malware scan, or content-type verification.
- **Metadata exposure:** the signaling service sees filenames, sizes, reported types/timestamps, device labels, and ICE negotiation data even though it does not see file bytes.
- **One receiver:** rooms do not support groups, broadcasting, or multiple simultaneous receivers.
- **History is local:** completed, cancelled, and failed room outcomes are recorded only in the current browser. Clearing site data removes them, and another device has a separate history.
- **Downloads vary by browser:** automatic download is limited to one file. Multiple received files use individual links, and browsers may prompt, rename duplicates, or restrict background downloads.
- **TURN credentials are public:** static `NEXT_PUBLIC_TURN_*` values are visible to clients and can be abused. Production deployments should issue limited, short-lived credentials; that issuance flow is not included.
- **Expiry copy assumes defaults:** changing `SESSION_TTL_MS` does not update hard-coded ten-minute text in the UI.
- **Offline scope is narrow:** the PWA shell can show an offline page, but pairing, signaling, WebRTC setup, and transfer continuation require live connectivity.
- **Browser verification is manual:** there is no automated two-browser end-to-end coverage, and target-browser/network behavior must be exercised before release.

## Checks

Available project checks are:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Existing Vitest files cover formatting helpers, transfer-frame validation/backpressure, the in-memory session store, and Socket.IO pairing/approval/signaling authorization flows. They do not establish that two real browsers can negotiate, transfer, download, reconnect, or traverse TURN. This README lists the commands and coverage; it does not assert that a particular checkout or deployment has passed them. Record actual command results and manual browser/network cases in the release handoff after running them.

## Design standard

Interface work should continue to follow `DESIGN_GUIDELINES.md`: concrete writing, purposeful layout, working controls, responsive behavior, consistent code, and privacy claims that match the deployed system. Do not simulate nearby devices, progress, security, or completed transfers.
