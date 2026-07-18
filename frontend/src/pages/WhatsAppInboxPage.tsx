import { useCallback, useEffect, useState } from "react";
import {
  client,
  type DraftInteraction,
  type WhatsAppConversation,
  type WhatsAppTemplate,
} from "../api/client";

interface WhatsAppInboxPageProps {
  onError: (message: string) => void;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function initialsFrom(label: string): string {
  return label.trim().charAt(0).toUpperCase() || "?";
}

export function WhatsAppInboxPage({ onError }: WhatsAppInboxPageProps) {
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selected, setSelected] = useState<WhatsAppConversation | null>(null);
  const [messages, setMessages] = useState<DraftInteraction[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [needsTemplate, setNeedsTemplate] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [variables, setVariables] = useState<string[]>([]);

  const refreshConversations = useCallback(async () => {
    setLoadingList(true);
    try {
      const result = await client.listWhatsAppConversations({ page: 1, page_size: 50 });
      setConversations(result.rows);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load WhatsApp conversations");
    } finally {
      setLoadingList(false);
    }
  }, [onError]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const loadThread = useCallback(
    async (conversation: WhatsAppConversation) => {
      setSelected(conversation);
      setNeedsTemplate(false);
      setReply("");
      setLoadingThread(true);
      try {
        const rows = await client.listWhatsAppConversationMessages(conversation.contact_id);
        setMessages(rows);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Failed to load conversation");
      } finally {
        setLoadingThread(false);
      }
    },
    [onError],
  );

  const selectedTemplate = templates.find((t) => String(t.id) === templateId);

  useEffect(() => {
    setVariables(Array(selectedTemplate?.variable_count ?? 0).fill(""));
  }, [selectedTemplate]);

  useEffect(() => {
    if (!needsTemplate) return;
    client
      .listWhatsAppTemplates(true)
      .then((rows) => {
        setTemplates(rows);
        if (rows.length > 0) setTemplateId(String(rows[0].id));
      })
      .catch(() => setTemplates([]));
  }, [needsTemplate]);

  async function handleSend() {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      await client.replyToWhatsAppConversation(selected.contact_id, { content: reply, send: true });
      setReply("");
      setNeedsTemplate(false);
      await loadThread(selected);
      await refreshConversations();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to send reply";
      if (/template|24|window/i.test(message)) {
        setNeedsTemplate(true);
      } else {
        onError(message);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleSendWithTemplate() {
    if (!selected || !selectedTemplate) {
      onError("Select an approved template first");
      return;
    }
    setSending(true);
    try {
      await client.replyToWhatsAppConversation(selected.contact_id, {
        content: reply || selectedTemplate.body_text || selectedTemplate.name,
        send: true,
        template_name: selectedTemplate.name,
        template_language: selectedTemplate.language,
        template_variables: variables,
      });
      setReply("");
      setNeedsTemplate(false);
      await loadThread(selected);
      await refreshConversations();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to send with template");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-slate-100">WhatsApp inbox</h2>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Two-way WhatsApp conversations. Replies within 24h of the customer's last message send as
          free text; outside that window Meta requires an approved template.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden min-h-[520px]">
        <div className="border-r border-slate-800 overflow-y-auto max-h-[70vh]">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900/80">
            <h3 className="text-sm font-medium text-slate-300">Conversations</h3>
            <span className="text-xs text-slate-500">{conversations.length}</span>
          </div>
          {loadingList ? (
            <p className="text-sm text-slate-400 p-4">Loading…</p>
          ) : conversations.length === 0 ? (
            <p className="text-sm text-slate-500 p-4">
              No WhatsApp conversations yet. They appear here once a contact messages you or you
              send an approved campaign.
            </p>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.contact_id}
                type="button"
                onClick={() => void loadThread(conv)}
                className={`w-full text-left px-4 py-3 border-b border-slate-800/60 flex gap-3 items-start hover:bg-slate-800/40 ${
                  selected?.contact_id === conv.contact_id ? "bg-slate-800/60" : ""
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-emerald-600/20 border border-emerald-600/40 text-emerald-300 flex items-center justify-center text-xs font-medium shrink-0">
                  {initialsFrom(conv.contact_name || conv.company_name || "?")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-200 truncate">
                      {conv.company_name || conv.contact_name || "Unknown"}
                    </p>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      {formatDate(conv.last_message_at)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">{conv.contact_name}</p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {conv.last_direction === "inbound" ? "" : "You: "}
                    {conv.last_message}
                  </p>
                  {conv.within_session_window ? (
                    <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                      24h window open
                    </span>
                  ) : (
                    <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] border border-slate-700 bg-slate-800 text-slate-500">
                      Template required
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="flex flex-col min-h-[520px]">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
              Select a conversation to view messages.
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-slate-800">
                <p className="text-sm font-medium text-slate-200">
                  {selected.company_name || selected.contact_name}
                </p>
                <p className="text-xs text-slate-500">
                  {selected.contact_name} · {selected.contact_phone}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[50vh]">
                {loadingThread ? (
                  <p className="text-sm text-slate-400">Loading messages…</p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-slate-500">No messages yet.</p>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        msg.direction === "inbound"
                          ? "bg-slate-800 text-slate-200 mr-auto"
                          : "bg-emerald-600/20 border border-emerald-600/30 text-emerald-100 ml-auto"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      <p className="text-[10px] text-slate-500 mt-1">
                        {formatDate(msg.created_at)}
                        {msg.direction === "outbound" && msg.wa_status ? ` · ${msg.wa_status}` : ""}
                      </p>
                    </div>
                  ))
                )}
              </div>

              {needsTemplate && (
                <div className="mx-4 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                  <p className="text-sm text-amber-200">
                    Outside the 24h reply window — select an approved template to send instead.
                  </p>
                  {templates.length === 0 ? (
                    <p className="text-xs text-amber-200/80">
                      No approved templates synced yet. Open{" "}
                      <strong>WhatsApp templates</strong> and sync from Meta.
                    </p>
                  ) : (
                    <>
                      <select
                        value={templateId}
                        onChange={(e) => setTemplateId(e.target.value)}
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                      >
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.language})
                          </option>
                        ))}
                      </select>
                      {variables.map((value, index) => (
                        <input
                          key={index}
                          value={value}
                          onChange={(e) =>
                            setVariables((prev) =>
                              prev.map((v, i) => (i === index ? e.target.value : v)),
                            )
                          }
                          placeholder={`Variable {{${index + 1}}}`}
                          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => void handleSendWithTemplate()}
                        disabled={sending}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
                      >
                        {sending ? "Sending…" : "Send with template"}
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="p-4 border-t border-slate-800 flex gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={2}
                  placeholder="Type a reply…"
                  className="flex-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending || !reply.trim()}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50 self-end"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
