import { useRef, useState } from "react";
import { client, type EmailAttachment } from "../api/client";

interface EmailAttachmentsFieldProps {
  attachments: EmailAttachment[];
  onChange: (attachments: EmailAttachment[]) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmailAttachmentsField({
  attachments,
  onChange,
  disabled = false,
  label = "Attachments",
  hint = "Images, PDF, Word, Excel, TXT, CSV — up to 10 MB each, max 8 files.",
}: EmailAttachmentsFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length || disabled) return;
    setError(null);
    setUploading(true);
    const next = [...attachments];
    try {
      for (const file of Array.from(fileList)) {
        if (next.length >= 8) {
          setError("Maximum 8 attachments per email.");
          break;
        }
        const uploaded = await client.uploadEmailAttachment(file);
        next.push(uploaded);
      }
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeAttachment(id: string) {
    onChange(attachments.filter((a) => a.id !== id));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm text-slate-400">{label}</span>
        <button
          type="button"
          disabled={disabled || uploading || attachments.length >= 8}
          onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "+ Add files"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*,application/pdf"
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}
      {attachments.length > 0 && (
        <ul className="space-y-1.5">
          {attachments.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate text-slate-200" title={file.filename}>
                {file.filename}
              </span>
              <span className="shrink-0 text-xs text-slate-500">{formatSize(file.size)}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeAttachment(file.id)}
                  className="shrink-0 text-xs text-red-300 hover:text-red-200"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
