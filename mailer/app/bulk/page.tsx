"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getStoredToken, loginFromHandoff } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { TemplatePicker } from "@/components/TemplatePicker";

type Lead = {
  buyer_id: number;
  company_name: string;
  contact_name?: string | null;
  contact_email: string;
};

type HandoffPreview = {
  username: string;
  mailbox_email: string;
  display_name?: string | null;
  buyer_ids: number[];
  leads: Lead[];
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function BulkInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const { refresh, user } = useAuth();

  const preview = useMemo(() => {
    try {
      const mid = token.split(".")[1];
      if (!mid) return null;
      const json = JSON.parse(atob(mid.replace(/-/g, "+").replace(/_/g, "/")));
      return {
        username: String(json.username || ""),
        mailbox_email: String(json.mailbox_email || ""),
        display_name: json.display_name || null,
        buyer_ids: Array.isArray(json.buyer_ids) ? json.buyer_ids : [],
        leads: Array.isArray(json.leads) ? json.leads : [],
      } as HandoffPreview;
    } catch {
      return null;
    }
  }, [token]);

  useEffect(() => {
    if (!token || getStoredToken()) return;
    void loginFromHandoff(token)
      .then(() => refresh())
      .catch(() => null);
  }, [token, refresh]);

  const [subject, setSubject] = useState(
    "Introduction — Kafi Commodities ({{company_name}})",
  );
  const [body, setBody] = useState(
    "Dear {{contact_name}},\n\nI hope you are well. I am reaching out from Kafi Commodities regarding our export range (rice, spices, Essence Himalayan salt, sauces & pickles).\n\nI would welcome a short call at your convenience.\n\nBest regards",
  );
  const [batchSize, setBatchSize] = useState(10);
  const [messageDelay, setMessageDelay] = useState(2);
  const [batchPause, setBatchPause] = useState(45);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [tplNotice, setTplNotice] = useState<string | null>(null);

  const leads: Lead[] = (preview?.leads || []).filter((l) =>
    (l.contact_email || "").includes("@"),
  );

  function pushLog(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function runSend() {
    if (!token) {
      pushLog("Missing token — open from Sales Agent Send emails.");
      return;
    }
    if (!leads.length) {
      pushLog("No leads with email in this handoff.");
      return;
    }
    setRunning(true);
    setLog([]);
    const batches = chunk(leads, Math.max(1, Math.min(15, batchSize)));
    let sentTotal = 0;
    let failTotal = 0;
    pushLog(
      `Starting ${leads.length} emails in ${batches.length} batch(es) as ${preview?.mailbox_email}`,
    );

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      pushLog(`Batch ${b + 1}/${batches.length} — ${batch.length} message(s)…`);
      try {
        const res = await fetch("/api/send-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            subject,
            body,
            leads: batch,
            message_delay_seconds: messageDelay,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          pushLog(`Batch failed: ${data.error || res.statusText}`);
          failTotal += batch.length;
        } else {
          sentTotal += data.sent || 0;
          failTotal += data.failed || 0;
          for (const r of data.results || []) {
            pushLog(`${r.ok ? "OK" : "FAIL"}  ${r.email}  ${r.ok ? "" : r.message}`);
          }
        }
      } catch (e) {
        pushLog(`Batch error: ${e instanceof Error ? e.message : String(e)}`);
        failTotal += batch.length;
      }
      if (b < batches.length - 1 && batchPause > 0) {
        pushLog(`Waiting ${batchPause}s before next batch…`);
        await sleep(batchPause * 1000);
      }
    }
    pushLog(`Done. Sent ${sentTotal}, failed ${failTotal}.`);
    setRunning(false);
  }

  if (!token) {
    return (
      <div className="wrap">
        <div className="card">
          <h1>Bulk send</h1>
          <p className="muted">
            Open this page from Sales Agent using <strong>Send emails</strong>.
          </p>
          <Link className="btn" href="/inbox">
            Go to inbox
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="card">
        <div className="folder-list-head">
          <h1>Bulk send</h1>
          {user && (
            <Link className="btn ghost small" href="/inbox">
              Open inbox
            </Link>
          )}
        </div>
        <p className="muted">
          Sends via SMTP on Vercel. Placeholders:{" "}
          <code>{"{{company_name}}"}</code>, <code>{"{{contact_name}}"}</code>,{" "}
          <code>{"{{contact_email}}"}</code>
        </p>
        <div className="chips">
          <span className="chip">From: {preview?.mailbox_email || "—"}</span>
          <span className="chip">User: {preview?.username || "—"}</span>
          <span className="chip">Recipients: {leads.length}</span>
        </div>

        {tplNotice && <p className="ok small">{tplNotice}</p>}
        <TemplatePicker
          key={user?.id ?? "pending-auth"}
          value={templateId}
          hint="Placeholders like {{company_name}} are filled per recipient when you send."
          onChange={(id, tpl) => {
            setTemplateId(id);
            if (tpl) {
              setSubject(tpl.subject);
              setBody(tpl.body);
              setTplNotice(`Loaded template “${tpl.name}”`);
            } else {
              setTplNotice(null);
            }
          }}
        />

        <label>Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />

        <label>Body</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} />

        <div className="row">
          <div>
            <label>Batch size</label>
            <input
              type="number"
              min={1}
              max={15}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value) || 10)}
            />
          </div>
          <div>
            <label>Delay between messages (sec)</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={messageDelay}
              onChange={(e) => setMessageDelay(Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <label>Pause between batches (sec)</label>
            <input
              type="number"
              min={0}
              value={batchPause}
              onChange={(e) => setBatchPause(Number(e.target.value) || 0)}
            />
          </div>
        </div>

        <button
          className="btn"
          type="button"
          disabled={running || !leads.length}
          onClick={() => void runSend()}
        >
          {running ? "Sending…" : `Send ${leads.length} email${leads.length === 1 ? "" : "s"}`}
        </button>

        {log.length > 0 && (
          <div className="log">
            {log.map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith("OK")
                    ? "ok"
                    : line.startsWith("FAIL") || line.includes("failed")
                      ? "bad"
                      : ""
                }
              >
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BulkPage() {
  return (
    <Suspense fallback={<div className="wrap muted">Loading…</div>}>
      <BulkInner />
    </Suspense>
  );
}
