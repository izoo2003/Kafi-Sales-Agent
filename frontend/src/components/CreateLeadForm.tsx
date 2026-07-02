import { useState, type FormEvent } from "react";
import { client } from "../api/client";

interface CreateLeadFormProps {
  onSuccess: (leadId: number) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

const emptyForm = {
  company_name: "",
  website_url: "",
  country: "",
  industry: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  contact_designation: "",
};

export function CreateLeadForm({ onSuccess, onCancel, onError }: CreateLeadFormProps) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.company_name.trim()) {
      onError("Company or buyer name is required");
      return;
    }

    setSubmitting(true);
    try {
      const lead = await client.createLead({
        company_name: form.company_name.trim(),
        website_url: form.website_url.trim() || undefined,
        country: form.country.trim() || undefined,
        industry: form.industry.trim() || undefined,
        source: "manual",
      });

      if (form.contact_name.trim()) {
        await client.createContact({
          buyer_id: lead.id,
          full_name: form.contact_name.trim(),
          email: form.contact_email.trim() || undefined,
          phone: form.contact_phone.trim() || undefined,
          designation: form.contact_designation.trim() || undefined,
        });
      }

      setForm(emptyForm);
      onSuccess(lead.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to create lead");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-emerald-500/30 bg-slate-900 p-5 space-y-5"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-slate-200">Add new lead</h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          Cancel
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-sm text-slate-400">Company / buyer name *</span>
          <input
            type="text"
            required
            value={form.company_name}
            onChange={(e) => updateField("company_name", e.target.value)}
            placeholder="e.g. Al Noor Food Trading"
            className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
          />
        </label>

        <label className="block">
          <span className="text-sm text-slate-400">Country</span>
          <input
            type="text"
            value={form.country}
            onChange={(e) => updateField("country", e.target.value)}
            placeholder="e.g. UAE"
            className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
          />
        </label>

        <label className="block">
          <span className="text-sm text-slate-400">Industry</span>
          <input
            type="text"
            value={form.industry}
            onChange={(e) => updateField("industry", e.target.value)}
            placeholder="e.g. Food distribution"
            className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-sm text-slate-400">Website URL</span>
          <input
            type="url"
            value={form.website_url}
            onChange={(e) => updateField("website_url", e.target.value)}
            placeholder="https://..."
            className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
          />
          <p className="text-xs text-slate-500 mt-1">
            Used for research — add a real company website for best results.
          </p>
        </label>
      </div>

      <fieldset className="border-t border-slate-800 pt-4">
        <legend className="text-sm font-medium text-slate-300 px-1">
          Primary contact (optional)
        </legend>
        <div className="grid gap-4 sm:grid-cols-2 mt-3">
          <label className="block sm:col-span-2">
            <span className="text-sm text-slate-400">Full name</span>
            <input
              type="text"
              value={form.contact_name}
              onChange={(e) => updateField("contact_name", e.target.value)}
              placeholder="e.g. Ahmed Al-Rashid"
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
            />
          </label>

          <label className="block">
            <span className="text-sm text-slate-400">Email</span>
            <input
              type="email"
              value={form.contact_email}
              onChange={(e) => updateField("contact_email", e.target.value)}
              placeholder="name@company.com"
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
            />
          </label>

          <label className="block">
            <span className="text-sm text-slate-400">Phone</span>
            <input
              type="tel"
              value={form.contact_phone}
              onChange={(e) => updateField("contact_phone", e.target.value)}
              placeholder="+971..."
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-sm text-slate-400">Designation</span>
            <input
              type="text"
              value={form.contact_designation}
              onChange={(e) => updateField("contact_designation", e.target.value)}
              placeholder="e.g. Procurement Manager"
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
            />
          </label>
        </div>
      </fieldset>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create lead"}
        </button>
      </div>
    </form>
  );
}
