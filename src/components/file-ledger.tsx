import { CloseIcon, FileIcon } from "./icons";
import { fileKind, formatBytes } from "@/lib/format";
import type { ManifestFile } from "@/lib/protocol";

interface FileLedgerProps {
  files: Array<File | ManifestFile>;
  onRemove?: (index: number) => void;
  progress?: Record<number, number>;
  receivedIndexes?: Set<number>;
}

export function FileLedger({ files, onRemove, progress, receivedIndexes }: FileLedgerProps) {
  return (
    <div className="file-ledger">
      {files.map((file, index) => {
        const fileProgress = progress?.[index];
        const complete = receivedIndexes?.has(index);
        return (
          <div className="file-row" key={"id" in file ? file.id : `${file.name}-${file.lastModified}-${index}`}>
            <div className="file-glyph"><FileIcon /></div>
            <div className="file-copy">
              <strong title={file.name}>{file.name}</strong>
              <span>{fileKind(file.type, file.name)} · {formatBytes(file.size)}</span>
              {typeof fileProgress === "number" ? (
                <div className="file-progress">
                  <div style={{ width: `${Math.min(100, fileProgress)}%` }} />
                </div>
              ) : null}
            </div>
            {complete ? <span className="file-state file-state--complete">Received</span> : null}
            {onRemove ? (
              <button className="icon-button" onClick={() => onRemove(index)} type="button" aria-label={`Remove ${file.name}`}>
                <CloseIcon />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
