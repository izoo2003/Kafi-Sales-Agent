import { useState } from "react";
import { client, type DraftInteraction } from "../api/client";
import { useDrafts } from "../hooks/useDrafts";

interface ApprovalQueueProps {
  onError: (message: string) => void;
}

export function ApprovalQueue({ onError }: ApprovalQueueProps) {
  const { drafts, loading, refresh } = useDrafts();
  const [editingDraft, setEditingDraft] = useState<Record<number, string>>({});
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function handleApprove(draft: DraftInteraction, send: boolean) {
    setApprovingId(draft.id);
    setLastResult(null);
    try {
      const content = editingDraft[draft.id] ?? draft.content;
      const result = await client.approveDraft(draft.id, content, send);

      if (result.sent) {
        setLastResult(`Email sent successfully to contact for draft #${draft.id}.`);
      } else if (send && result.send_message) {
        setLastResult(
          `Draft #${draft.id} approved but not sent: ${result.send_message}`,
        );
      } else {
        setLastResult(`Draft #${draft.id} approved (not sent).`);
      }

      refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setApprovingId(null);
    }
  }

  async function handleReject(draftId: number) {
    try {
      await client.rejectDraft(draftId);
      setLastResult(`Draft #${draftId} rejected.`);
      refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Reject failed");
    }
  }

  if (loading) return <p className="text-slate-400">Loading drafts…</p>;

  return (
    <section className="space-y-4">
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
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs uppercase tracking-wide text-slate-500">
                {draft.channel}
              </span>
              {draft.subject && (
                <span className="text-sm font-medium">{draft.subject}</span>
              )}
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
                    disabled={approvingId === draft.id}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
                  >
                    {approvingId === draft.id ? "Sending…" : "Approve & Send"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApprove(draft, false)}
                    disabled={approvingId === draft.id}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm disabled:opacity-50"
                  >
                    Approve only
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleApprove(draft, false)}
                  disabled={approvingId === draft.id}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
                >
                  Approve
                </button>
              )}
              <button
                type="button"
                onClick={() => handleReject(draft.id)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm"
              >
                Reject
              </button>
            </div>
            {draft.channel === "email" && (
              <p className="text-xs text-slate-500 mt-2">
                Approve &amp; Send delivers via Gmail after you configure credentials in{" "}
                <code className="text-slate-400">backend/.env</code>.
              </p>
            )}
          </article>
        ))
      )}
    </section>
  );
}
