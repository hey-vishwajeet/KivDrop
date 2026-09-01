"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileLedger } from "@/components/file-ledger";
import { ArrowRightIcon, UploadIcon } from "@/components/icons";
import { getDevice } from "@/lib/device";
import { formatBytes } from "@/lib/format";
import { holdFiles } from "@/lib/file-vault";
import { PROTOCOL_VERSION, sanitizeDisplayName, type CreateSessionResult, type ManifestFile } from "@/lib/protocol";
import { emitWithAck, getSignalingSocket, saveCredentials } from "@/lib/session-client";

export default function SendPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

  useEffect(() => {
    getSignalingSocket();
  }, []);

  function addFiles(incoming: FileList | File[]) {
    const next = Array.from(incoming);
    setFiles((current) => [...current, ...next].slice(0, 100));
    setError(null);
  }

  async function createTransfer() {
    if (files.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    const manifest: ManifestFile[] = files.map((file) => ({
      id: crypto.randomUUID(),
      name: sanitizeDisplayName(file.name, "Untitled file"),
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    }));
    const result = await emitWithAck<CreateSessionResult>("session:create", {
      v: PROTOCOL_VERSION,
      device: getDevice(),
      manifest,
    });
    if (!result.ok) {
      setError(result.error.message);
      setCreating(false);
      return;
    }
    const { session, ownerToken, shareToken } = result.data;
    holdFiles(session.id, files);
    saveCredentials(session.id, "sender", ownerToken, shareToken);
    router.push(`/transfer/${session.id}`);
  }

  return (
    <div className="page-shell">
      <div className="page-heading">
        <p className="eyebrow">New transfer</p>
        <h1>Choose what to send.</h1>
        <p>Files stay on this device until a receiver joins and both devices approve.</p>
      </div>

      <div className="send-layout">
        <section aria-labelledby="selection-heading">
          <h2 className="section-title" id="selection-heading">File selection</h2>
          <div
            className={`drop-field${dragging ? " drop-field--active" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
          >
            <UploadIcon size={30} />
            <div><strong>Drop files here</strong><span>or use the file picker on this device</span></div>
            <button className="button button--secondary" onClick={() => inputRef.current?.click()} type="button">Choose files</button>
            <input
              className="sr-only"
              multiple
              onChange={(event) => event.target.files && addFiles(event.target.files)}
              ref={inputRef}
              type="file"
            />
          </div>

          {files.length ? (
            <div className="selected-files">
              <div className="ledger-heading"><span>{files.length} {files.length === 1 ? "file" : "files"}</span><span>{formatBytes(totalBytes)}</span></div>
              <FileLedger files={files} onRemove={(index) => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
              <button className="text-action" onClick={() => inputRef.current?.click()} type="button">Add more files</button>
            </div>
          ) : (
            <p className="empty-line">No files selected. Photos, videos, archives, and general file types are accepted.</p>
          )}
        </section>

        <aside className="transfer-docket" aria-labelledby="docket-heading">
          <p className="eyebrow">Transfer docket</p>
          <h2 id="docket-heading">Ready when you are.</h2>
          <dl>
            <div><dt>Files</dt><dd>{files.length}</dd></div>
            <div><dt>Total size</dt><dd>{formatBytes(totalBytes)}</dd></div>
            <div><dt>Pairing window</dt><dd>10 minutes</dd></div>
          </dl>
          <p className="small muted">Large-file limits depend on both browsers. The sender reads bounded chunks instead of loading the entire selection into memory.</p>
          {error ? <p className="status-note status-note--danger" role="alert">{error}</p> : null}
          <button className="button button--primary docket-action" disabled={!files.length || creating} onClick={() => void createTransfer()} type="button">
            {creating ? "Creating transfer…" : "Create transfer"} {!creating ? <ArrowRightIcon /> : null}
          </button>
        </aside>
      </div>
    </div>
  );
}
