import { useCallback, useEffect, useState, type FormEvent } from "react";
import { client, type EmailAttachment, type EmailTemplate } from "../api/client";
import { EmailAttachmentsField } from "../components/EmailAttachmentsField";

interface BulkEmailPageProps {
  onError: (message: string) => void;
}

const PLACEHOLDER_HINTS = [
  "[company_name]",
  "[contact_name]",
  "[country]",
  "[industry]",
  "[designation]",
  "[website_url]",
];

function emptyForm() {
  return {
    name: "",
    subject: "Kafi Commodities — for [company_name]",
    body: `Dear [contact_name],

I hope this message finds you well. We at Kafi Commodities would like to connect with [company_name] regarding our ESSENCE product range.

Please let us know if you would like specifications or pricing.

Best regards,
Kafi Commodities Export Team`,
    attachments: [] as EmailAttachment[],
  };
}

export function BulkEmailPage({ onError }: BulkEmailPageProps) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await client.listEmailTemplates());
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setNotice(null);
  }

  function startEdit(template: EmailTemplate) {
    setEditingId(template.id);
    setForm({
      name: template.name,
      subject: template.subject,
      body: template.body,
      attachments: template.attachments ?? [],
    });
    setNotice(null);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      if (editingId) {
        await client.updateEmailTemplate(editingId, form);
        setNotice("Template updated.");
      } else {
        await client.createEmailTemplate(form);
        setNotice("Template created.");
      }
      setEditingId(null);
      setForm(emptyForm());
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(templateId: number) {
    if (!window.confirm("Delete this template?")) return;
    try {
      await client.deleteEmailTemplate(templateId);
      if (editingId === templateId) {
        setEditingId(null);
        setForm(emptyForm());
      }
      await refresh();
      setNotice("Template deleted.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function insertPlaceholder(token: string) {
    setForm((prev) => ({ ...prev, body: `${prev.body}${prev.body.endsWith("\n") ? "" : "\n"}${token}` }));
  }

  if (loading) return <p className="text-slate-400">Loading email templates…</p>;

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-slate-100">Bulk email templates</h2>
        <p className="text-sm text-slate-500 mt-1">
          Create reusable templates with placeholders like{" "}
          <code className="text-slate-400">[company_name]</code>. Then select leads in{" "}
          <strong className="text-slate-300">Leads table</strong> →{" "}
          <strong className="text-slate-300">Create email drafts</strong>. Review and send from{" "}
          <strong className="text-slate-300">Approval Queue</strong>.
        </p>
      </div>

      {notice && (
        <p className="text-sm text-emerald-300/90 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          {notice}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-300">Saved templates</h3>
            <button
              type="button"
              onClick={startCreate}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
            >
              + New template
            </button>
          </div>

          {templates.length === 0 ? (
            <p className="text-sm text-slate-500 rounded-xl border border-dashed border-slate-700 p-6">
              No templates yet. A default template is created on first backend migration.
            </p>
          ) : (
            <ul className="space-y-2">
              {templates.map((template) => (
                <li
                  key={template.id}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-100">{template.name}</p>
                    <p className="text-sm text-slate-400 truncate">{template.subject}</p>
                    {(template.attachments?.length ?? 0) > 0 && (
                      <p className="text-xs text-slate-500 mt-1">
                        {template.attachments!.length} attachment
                        {template.attachments!.length === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEdit(template)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(template.id)}
                      className="px-2 py-1 rounded bg-red-900/50 hover:bg-red-800 text-xs text-red-200"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          onSubmit={(e) => void handleSave(e)}
          className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4"
        >
          <h3 className="text-sm font-medium text-slate-300">
            {editingId ? "Edit template" : "New template"}
          </h3>

          <label className="block">
            <span className="text-sm text-slate-400">Template name</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
              placeholder="ESSENCE introduction"
            />
          </label>

          <label className="block">
            <span className="text-sm text-slate-400">Email subject</span>
            <input
              required
              value={form.subject}
              onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
            />
          </label>

          <div>
            <span className="text-sm text-slate-400">Email body</span>
            <div className="flex flex-wrap gap-1.5 mt-2 mb-2">
              {PLACEHOLDER_HINTS.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => insertPlaceholder(token)}
                  className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800 text-xs text-slate-300 hover:bg-slate-700"
                >
                  {token}
                </button>
              ))}
            </div>
            <textarea
              required
              rows={12}
              value={form.body}
              onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm font-mono"
            />
          </div>

          <EmailAttachmentsField
            attachments={form.attachments}
            onChange={(attachments) => setForm((p) => ({ ...p, attachments }))}
            label="Default attachments for this template"
            hint="Included on every bulk email draft created from this template. Images, PDF, Word, Excel — up to 10 MB each."
          />

          <p className="text-xs text-slate-500">
            Each lead gets its own draft with placeholders replaced — e.g. Dear Acme Trading
            becomes Dear [contact_name] filled with the contact on file. Sends from your Outlook mailbox in{" "}
            <code className="text-slate-400">backend/.env</code> after approval.
          </p>

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : editingId ? "Update template" : "Save template"}
          </button>
        </form>
      </div>
    </section>
  );
}
