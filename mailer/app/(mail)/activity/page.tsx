"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type EventRow = {
  id: number;
  event_label: string;
  severity: string;
  title: string;
  message: string;
  created_at?: string | null;
  read_at?: string | null;
};

export default function ActivityPage() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{
        rows: EventRow[];
        total: number;
        unread_count: number;
      }>("/email-activity?page=1&page_size=50");
      setRows(data.rows);
      setTotal(data.total);
      setUnread(data.unread_count);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activity");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAllRead() {
    await apiFetch("/email-activity/mark-read", {
      method: "POST",
      body: JSON.stringify({ mark_all: true }),
    });
    void load();
  }

  return (
    <div className="pad">
      <div className="folder-list-head">
        <h2 className="folder-title">Email Activity</h2>
        <button type="button" className="btn ghost small" onClick={() => void markAllRead()}>
          Mark all read
        </button>
      </div>
      <p className="muted small">
        {total} events · {unread} unread
      </p>
      {error && <p className="bad">{error}</p>}
      <ul className="simple-list">
        {rows.map((row) => (
          <li key={row.id} className={`card-row ${row.read_at ? "" : "unread"}`}>
            <div>
              <p className="msg-subject">{row.title}</p>
              <p className="muted small">
                {row.event_label} · {row.severity}
                {row.created_at ? ` · ${new Date(row.created_at).toLocaleString()}` : ""}
              </p>
              <p className="msg-preview">{row.message}</p>
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="muted">No activity yet</li>}
      </ul>
    </div>
  );
}
