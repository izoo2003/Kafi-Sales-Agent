"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type EmailTemplate = {
  id: number;
  name: string;
  subject: string;
  body: string;
};

type Props = {
  value: string;
  onChange: (templateId: string, template: EmailTemplate | null) => void;
  /** Shown under the select when templates fail to load (e.g. not logged in on /bulk). */
  hint?: string;
};

export function TemplatePicker({ value, onChange, hint }: Props) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<EmailTemplate[]>("/email-templates");
      setTemplates(rows);
    } catch (e) {
      setTemplates([]);
      setError(e instanceof Error ? e.message : "Could not load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSelect(id: string) {
    if (!id) {
      onChange("", null);
      return;
    }
    const tpl = templates.find((t) => String(t.id) === id) || null;
    onChange(id, tpl);
  }

  return (
    <div className="template-picker">
      <label htmlFor="email-template-select">Email template</label>
      <div className="template-picker-row">
        <select
          id="email-template-select"
          className="template-select"
          value={value}
          disabled={loading || templates.length === 0}
          onChange={(e) => handleSelect(e.target.value)}
        >
          <option value="">
            {loading
              ? "Loading templates…"
              : templates.length === 0
                ? "No templates saved yet"
                : "Select a template (optional)"}
          </option>
          {templates.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn ghost small" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && <p className="bad small">{error}</p>}
      {!error && hint && <p className="muted small">{hint}</p>}
      {!error && !loading && templates.length === 0 && (
        <p className="muted small">
          Create templates under <strong>Email templates</strong> in the sidebar, then refresh.
        </p>
      )}
    </div>
  );
}
