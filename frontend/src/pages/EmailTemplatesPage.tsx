import { useCallback, useEffect, useState, type FormEvent } from "react";
import { client, type EmailTemplate } from "../api/client";
import { EmailAttachmentsField } from "../components/EmailAttachmentsField";
import {
  emptyTemplateForm,
  PLACEHOLDER_HINTS,
} from "../utils/emailTemplateDefaults";

interface EmailTemplatesPageProps {
  onError: (message: string) => void;
  onCountChange?: (count: number) => void;
}

export function EmailTemplatesPage({ onError, onCountChange }: EmailTemplatesPageProps) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await client.listEmailTemplates();
      setTemplates(rows);
      onCountChange?.(rows.length);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [onCountChange, onError]);

  useEffect(() => {
    void refreshTemplates();
  }, [refreshTemplates]);

  function startCreate() {
    setEditingId(null);
    setTemplateForm(emptyTemplateForm());
    setShowEditor(true);
    setNotice(null);
  }

  function startEdit(template: EmailTemplate) {
    setEditingId(template.id);
    setTemplateForm({
      name: template.name,
      subject: template.subject,
      body: template.body,
      attachments: template.attachments ?? [],
    });
    setShowEditor(true);
    setNotice(null);
  }

  function cancelEditor() {
    setShowEditor(false);
    setEditingId(null);
    setTemplateForm(emptyTemplateForm());
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      if (editingId) {
        await client.updateEmailTemplate(editingId, templateForm);
        setNotice("Template updated.");
      } else {
        await client.createEmailTemplate(templateForm);
        setNotice("Template created.");
      }
      setShowEditor(false);
      setEditingId(null);
      setTemplateForm(emptyTemplateForm());
      await refreshTemplates();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(template: EmailTemplate) {
    if (!window.confirm(`Delete template "${template.name}"?`)) return;
    try {
      await client.deleteEmailTemplate(template.id);
      if (editingId === template.id) cancelEditor();
      setNotice("Template deleted.");
      await refreshTemplates();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to delete template");
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium text-slate-100">Email templates</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Create and manage reusable outreach templates here. Use placeholders like{" "}
            <code className="text-slate-400">[company_name]</code> and{" "}
            <code className="text-slate-400">[contact_name]</code> — they are filled in per lead
            when you send from the Leads table.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
        >
          + New template
        </button>
      </div>

      {notice && (
        <p className="text-sm text-emerald-300/90 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          {notice}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-300">Saved templates</h3>
            <span className="text-xs text-slate-500">{templates.length} total</span>
          </div>
          <div className="p-4 space-y-2 max-h-[70vh] overflow-y-auto">
            {loading ? (
              <p className="text-sm text-slate-400">Loading templates…</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-slate-500 rounded-lg border border-dashed border-slate-700 p-4">
                No templates yet. Click <strong className="text-slate-300">New template</strong> to
                create your first one.
              </p>
            ) : (
              templates.map((template) => {
                const isActive = editingId === template.id && showEditor;
                return (
                  <div
                    key={template.id}
                    className={`rounded-lg border p-3 flex items-start justify-between gap-3 ${
                      isActive
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : "border-slate-800 bg-slate-950"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => startEdit(template)}
                      className="min-w-0 text-left flex-1"
                    >
                      <p className="font-medium text-slate-100">{template.name}</p>
                      <p className="text-sm text-slate-400 truncate mt-0.5">{template.subject}</p>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2 whitespace-pre-wrap">
                        {template.body}
                      </p>
                      {template.attachments?.length ? (
                        <p className="text-xs text-slate-500 mt-1">
                          {template.attachments.length} attachment
                          {template.attachments.length === 1 ? "" : "s"}
                        </p>
                      ) : null}
                    </button>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(template)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(template)}
                        className="px-2 py-1 rounded bg-red-900/50 hover:bg-red-800 text-xs text-red-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          {showEditor ? (
            <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
              <h3 className="text-sm font-medium text-slate-300">
                {editingId ? "Edit template" : "New template"}
              </h3>
              <label className="block">
                <span className="text-sm text-slate-400">Name</span>
                <input
                  required
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Kafi Introduction"
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-400">Subject</span>
                <input
                  required
                  value={templateForm.subject}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, subject: e.target.value }))}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
                />
              </label>
              <div>
                <span className="text-sm text-slate-400">Body</span>
                <div className="flex flex-wrap gap-1.5 mt-2 mb-2">
                  {PLACEHOLDER_HINTS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() =>
                        setTemplateForm((p) => ({
                          ...p,
                          body: `${p.body}${p.body.endsWith("\n") ? "" : "\n"}${token}`,
                        }))
                      }
                      className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800 text-xs text-slate-300 hover:bg-slate-700"
                    >
                      {token}
                    </button>
                  ))}
                </div>
                <textarea
                  required
                  rows={12}
                  value={templateForm.body}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, body: e.target.value }))}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm font-mono"
                />
              </div>
              <EmailAttachmentsField
                attachments={templateForm.attachments}
                onChange={(attachments) => setTemplateForm((p) => ({ ...p, attachments }))}
                label="Default attachments"
                hint="Included whenever this template is used for outreach."
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={cancelEditor}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
                >
                  {saving ? "Saving…" : editingId ? "Update template" : "Save template"}
                </button>
              </div>
            </form>
          ) : (
            <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center px-4">
              <p className="text-sm text-slate-400">
                Select a template to edit, or create a new one.
              </p>
              <p className="text-xs text-slate-500 mt-2 max-w-sm">
                Templates created here appear in the compose window when sending email from the
                Leads table — preview there, then send.
              </p>
              <button
                type="button"
                onClick={startCreate}
                className="mt-4 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
              >
                + New template
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
