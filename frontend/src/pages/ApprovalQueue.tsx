import { useEffect, useState } from "react";
import {
  client,
  type BulkEmailSettings,
  type DraftInteraction,
} from "../api/client";
import { useDrafts } from "../hooks/useDrafts";

interface ApprovalQueueProps {
  onError: (message: string) => void;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkIds(ids: number[], size: number): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

export function ApprovalQueue({ onError }: ApprovalQueueProps) {
  const { drafts, loading, refresh } = useDrafts();
  const [editingDraft, setEditingDraft] = useState<Record<number, string>>({});
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [bulkSettings, setBulkSettings] = useState<BulkEmailSettings | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{
    currentBatch: number;
    totalBatches: number;
    sentSoFar: number;
    phase: "sending" | "pausing";
    pauseSeconds: number;
  } | null>(null);

  useEffect(() => {
    client.getBulkEmailSettings().then(setBulkSettings).catch(() => setBulkSettings(null));
  }, []);

  const emailDrafts = drafts.filter((d) => d.channel === "email");
  const allEmailSelected =
    emailDrafts.length > 0 && emailDrafts.every((d) => selected.has(d.id));

  const batchSize = bulkSettings?.batch_size ?? 50;
  const batchCount = selected.size > 0 ? Math.ceil(selected.size / batchSize) : 0;

  function toggleSelect(draftId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(draftId)) next.delete(draftId);
      else next.add(draftId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allEmailSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(emailDrafts.map((d) => d.id)));
    }
  }

  async function handleApprove(draft: DraftInteraction, send: boolean) {
    setApprovingId(draft.id);
    setLastResult(null);
    try {
      const content = editingDraft[draft.id] ?? draft.content;
      const result = await client.approveDraft(draft.id, content, send);

      if (result.sent) {
        setLastResult(
          `Email sent to ${draft.contact_email || "contact"} for ${draft.company_name || "lead"}.`,
        );
      } else if (send && result.send_message) {
        setLastResult(`Draft approved but not sent: ${result.send_message}`);
      } else {
        setLastResult(`Draft approved (not sent).`);
      }

      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(draft.id);
        return next;
      });
      refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setApprovingId(null);
    }
  }

  async function handleBulkApprove(send: boolean) {
    const ids = [...selected];
    if (ids.length === 0) return;

    const settings = bulkSettings ?? (await client.getBulkEmailSettings());
    const size = settings.batch_size;
    const pauseMs = Math.round(settings.batch_pause_seconds * 1000);
    const batches = chunkIds(ids, size);

    if (send && ids.length > 200) {
      const ok = window.confirm(
        `You are about to send ${ids.length} emails from your Gmail account. ` +
          `This may trigger spam filters or daily limits (~${settings.gmail_daily_limit_hint}/day). ` +
          `Continue in ${batches.length} batch(es) of ${size}?`,
      );
      if (!ok) return;
    }

    setBulkApproving(true);
    setLastResult(null);
    let totalSent = 0;
    let totalFailed = 0;
    let totalProcessed = 0;

    try {
      for (let i = 0; i < batches.length; i++) {
        setBulkProgress({
          currentBatch: i + 1,
          totalBatches: batches.length,
          sentSoFar: totalSent,
          phase: "sending",
          pauseSeconds: settings.batch_pause_seconds,
        });

        const result = await client.bulkApproveDrafts(batches[i], send);
        totalSent += result.sent_count;
        totalFailed += result.failed_count;
        totalProcessed += result.processed;

        if (send && i < batches.length - 1) {
          setBulkProgress({
            currentBatch: i + 1,
            totalBatches: batches.length,
            sentSoFar: totalSent,
            phase: "pausing",
            pauseSeconds: settings.batch_pause_seconds,
          });
          await sleep(pauseMs);
        }
      }

      setLastResult(
        send
          ? `Bulk send complete: ${totalSent} sent, ${totalFailed} failed ` +
              `across ${batches.length} batch(es) of up to ${size}.`
          : `Bulk approve complete: ${totalProcessed} draft(s) approved in ${batches.length} batch(es).`,
      );
      setSelected(new Set());
      refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Bulk approve failed");
    } finally {
      setBulkApproving(false);
      setBulkProgress(null);
    }
  }

  async function handleReject(draftId: number) {
    try {
      await client.rejectDraft(draftId);
      setLastResult(`Draft #${draftId} rejected.`);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(draftId);
        return next;
      });
      refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Reject failed");
    }
  }

  if (loading) return <p className="text-slate-400">Loading drafts…</p>;

  return (
    <section className="space-y-4">
      {bulkSettings && (
        <p className="text-xs text-slate-400 rounded-lg border border-slate-800 bg-slate-900/80 px-4 py-3">
          Bulk send safety: up to <strong className="text-slate-300">{batchSize}</strong> emails
          per batch, <strong className="text-slate-300">{bulkSettings.message_delay_seconds}s</strong>{" "}
          between each email,{" "}
          <strong className="text-slate-300">{bulkSettings.batch_pause_seconds}s</strong> pause
          between batches. {bulkSettings.recommendation}
        </p>
      )}

      {emailDrafts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
          <label className="flex items-center gap-2 text-sm text-slate-300 mr-2">
            <input
              type="checkbox"
              checked={allEmailSelected}
              onChange={toggleSelectAll}
            />
            Select all email drafts ({emailDrafts.length})
          </label>
          <button
            type="button"
            onClick={() => void handleBulkApprove(true)}
            disabled={selected.size === 0 || bulkApproving}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
          >
            {bulkApproving
              ? bulkProgress
                ? bulkProgress.phase === "pausing"
                  ? `Pausing ${bulkProgress.pauseSeconds}s…`
                  : `Batch ${bulkProgress.currentBatch}/${bulkProgress.totalBatches}…`
                : "Sending…"
              : `Approve & send (${selected.size}${batchCount > 1 ? ` · ${batchCount} batches` : ""})`}
          </button>
          <button
            type="button"
            onClick={() => void handleBulkApprove(false)}
            disabled={selected.size === 0 || bulkApproving}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm disabled:opacity-50"
          >
            Approve only ({selected.size})
          </button>
        </div>
      )}

      {bulkProgress && (
        <p className="text-sm text-sky-300/90 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3">
          {bulkProgress.phase === "pausing"
            ? `Batch ${bulkProgress.currentBatch}/${bulkProgress.totalBatches} sent (${bulkProgress.sentSoFar} so far). Pausing ${bulkProgress.pauseSeconds}s before next batch…`
            : `Sending batch ${bulkProgress.currentBatch} of ${bulkProgress.totalBatches}…`}
        </p>
      )}

      {lastResult && (
        <p className="text-sm text-slate-400 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
          {lastResult}
        </p>
      )}

      {drafts.length === 0 ? (
        <p className="text-slate-400">No drafts pending approval.</p>
      ) : (
        drafts.map((draft) => (
          <article
            key={draft.id}
            className="rounded-xl border border-slate-800 bg-slate-900 p-5"
          >
            <div className="flex items-start gap-3 mb-3">
              {draft.channel === "email" && (
                <input
                  type="checkbox"
                  checked={selected.has(draft.id)}
                  onChange={() => toggleSelect(draft.id)}
                  disabled={bulkApproving}
                  className="mt-1"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    {draft.channel}
                  </span>
                  {draft.company_name && (
                    <span className="text-sm font-medium text-slate-200">
                      {draft.company_name}
                    </span>
                  )}
                  {draft.contact_email && (
                    <span className="text-xs text-slate-500">→ {draft.contact_email}</span>
                  )}
                </div>
                {draft.subject && (
                  <p className="text-sm text-slate-300 mt-1">{draft.subject}</p>
                )}
              </div>
            </div>
            <textarea
              className="w-full min-h-32 rounded-lg bg-slate-950 border border-slate-700 p-3 text-sm text-slate-200"
              value={editingDraft[draft.id] ?? draft.content}
              onChange={(e) =>
                setEditingDraft((prev) => ({ ...prev, [draft.id]: e.target.value }))
              }
            />
            <div className="flex flex-wrap gap-2 mt-3">
              {draft.channel === "email" ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleApprove(draft, true)}
                    disabled={approvingId === draft.id || bulkApproving}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
                  >
                    {approvingId === draft.id ? "Sending…" : "Approve & Send"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApprove(draft, false)}
                    disabled={approvingId === draft.id || bulkApproving}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm disabled:opacity-50"
                  >
                    Approve only
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleApprove(draft, false)}
                  disabled={approvingId === draft.id || bulkApproving}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
                >
                  Approve
                </button>
              )}
              <button
                type="button"
                onClick={() => handleReject(draft.id)}
                disabled={bulkApproving}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm"
              >
                Reject
              </button>
            </div>
            {draft.channel === "email" && (
              <p className="text-xs text-slate-500 mt-2">
                Sends from your configured Gmail account after approval.
              </p>
            )}
          </article>
        ))
      )}
    </section>
  );
}
