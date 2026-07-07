import { useEffect, useState } from "react";
import {
  client,
  type BulkEmailDraftResponse,
  type EmailTemplate,
  type EmailTemplatePreview,
} from "../api/client";

interface BulkEmailModalProps {
  buyerIds: number[];
  sampleBuyerId: number | null;
  onClose: () => void;
  onError: (message: string) => void;
  onCreated: (result: BulkEmailDraftResponse) => void;
}

export function BulkEmailModal({
  buyerIds,
  sampleBuyerId,
  onClose,
  onError,
  onCreated,
}: BulkEmailModalProps) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [preview, setPreview] = useState<EmailTemplatePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    client
      .listEmailTemplates()
      .then((rows) => {
        setTemplates(rows);
        if (rows.length > 0) setTemplateId(String(rows[0].id));
      })
      .catch((e) => onError(e instanceof Error ? e.message : "Failed to load templates"));
  }, [onError]);

  useEffect(() => {
    if (!templateId || !sampleBuyerId) {
      setPreview(null);
      return;
    }
    setLoadingPreview(true);
    client
      .previewEmailTemplate(Number(templateId), sampleBuyerId)
      .then(setPreview)
      .catch(() => setPreview(null))
      .finally(() => setLoadingPreview(false));
  }, [templateId, sampleBuyerId]);

  async function handleCreate() {
    if (!templateId) {
      onError("Select a template first");
      return;
    }
    setCreating(true);
    try {
      const result = await client.createBulkEmailDrafts(Number(templateId), buyerIds);
      onCreated(result);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Bulk draft creation failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-slate-100">Create bulk email drafts</h3>
            <p className="text-sm text-slate-500 mt-1">
              {buyerIds.length} lead{buyerIds.length === 1 ? "" : "s"} selected — one personalized
              draft per company with an email on file.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {templates.length === 0 ? (
            <p className="text-sm text-amber-300/90 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              No templates found. Create one under the <strong>Bulk email</strong> tab first.
            </p>
          ) : (
            <>
              <label className="block">
                <span className="text-sm text-slate-400">Email template</span>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>

              {sampleBuyerId && (
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 space-y-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Preview for first selected lead
                  </p>
                  {loadingPreview ? (
                    <p className="text-sm text-slate-400">Loading preview…</p>
                  ) : preview ? (
                    <>
                      <p className="text-sm font-medium text-slate-200">
                        Subject: {preview.subject}
                      </p>
                      <p className="text-sm text-slate-400">To: {preview.contact_email || "—"}</p>
                      <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans">
                        {preview.body}
                      </pre>
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">
                      No preview — first selected lead may not have an email contact.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          <p className="text-xs text-slate-500">
            Drafts go to the Approval Queue. Review each email, then approve &amp; send individually
            or use bulk send from the queue. Placeholders: [company_name], [contact_name], [country],
            [industry], [designation], [website_url].
          </p>
        </div>

        <div className="p-5 border-t border-slate-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || templates.length === 0}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
          >
            {creating ? "Creating drafts…" : `Create ${buyerIds.length} draft(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
