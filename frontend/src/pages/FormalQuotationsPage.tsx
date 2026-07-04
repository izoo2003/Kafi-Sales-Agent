import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {

  client,

  type Product,

  type Quotation,

  type QuotationEligibleLead,

} from "../api/client";



interface FormalQuotationsPageProps {

  onError: (message: string) => void;

}



interface LineForm {

  key: string;

  product_id: string;

  quantity: string;

  price_tier: string;

}



function emptyLine(): LineForm {

  return {

    key: crypto.randomUUID(),

    product_id: "",

    quantity: "20",

    price_tier: "standard",

  };

}



function formatMoney(value: number | null | undefined): string {

  if (value == null || Number.isNaN(value)) return "—";

  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

}



function statusClass(status: string): string {

  switch (status) {

    case "approved":

      return "text-emerald-300";

    case "sent":

      return "text-sky-300";

    case "expired":

      return "text-slate-500";

    default:

      return "text-amber-300";

  }

}



export function FormalQuotationsPage({ onError }: FormalQuotationsPageProps) {

  const [quotations, setQuotations] = useState<Quotation[]>([]);

  const [products, setProducts] = useState<Product[]>([]);

  const [eligibleLeads, setEligibleLeads] = useState<QuotationEligibleLead[]>([]);

  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);

  const [actingId, setActingId] = useState<number | null>(null);

  const [notice, setNotice] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);



  const [buyerId, setBuyerId] = useState("");

  const [incoterms, setIncoterms] = useState("FOB");

  const [validityDays, setValidityDays] = useState("14");

  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);



  const loadData = useCallback(async () => {

    setLoading(true);

    try {

      const [quoteRows, productRows, leads] = await Promise.all([

        client.listQuotations(),

        client.listProducts(),

        client.listQuotationEligibleLeads(),

      ]);

      setQuotations(quoteRows);

      setProducts(productRows);

      setEligibleLeads(leads);

    } catch (e) {

      onError(e instanceof Error ? e.message : "Failed to load quotations");

    } finally {

      setLoading(false);

    }

  }, [onError]);



  useEffect(() => {

    void loadData();

  }, [loadData]);



  const productMap = useMemo(

    () => new Map(products.map((p) => [String(p.id), p])),

    [products],

  );



  function updateLine(key: string, patch: Partial<LineForm>) {

    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  }



  function addLine() {

    setLines((prev) => [...prev, emptyLine()]);

  }



  function removeLine(key: string) {

    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((line) => line.key !== key)));

  }



  function tierOptionsFor(productId: string): string[] {

    const product = productMap.get(productId);

    if (!product?.price_tiers) return ["standard"];

    return Object.keys(product.price_tiers);

  }

  function availableProductsForLine(lineKey: string) {
    const taken = new Set(
      lines
        .filter((row) => row.key !== lineKey && row.product_id)
        .map((row) => row.product_id),
    );
    return products.filter((product) => !taken.has(String(product.id)));
  }



  async function handleCreate(event: FormEvent) {

    event.preventDefault();

    if (!buyerId) {

      onError("Select a lead");

      return;

    }



    const payloadLines = lines

      .filter((line) => line.product_id)

      .map((line) => ({

        product_id: Number(line.product_id),

        quantity: Number(line.quantity),

        price_tier: line.price_tier,

      }));



    if (payloadLines.length === 0) {

      onError("Add at least one product line");

      return;

    }

    const uniqueIds = new Set(payloadLines.map((line) => line.product_id));

    if (uniqueIds.size !== payloadLines.length) {

      onError("Each product can only be added once");

      return;

    }



    setCreating(true);

    setNotice(null);

    try {

      await client.createQuotation({

        buyer_id: Number(buyerId),

        lines: payloadLines,

        incoterms,

        validity_days: Number(validityDays),

      });

      setNotice(`Quotation created with ${payloadLines.length} product line(s).`);

      setLines([emptyLine()]);

      await loadData();

    } catch (e) {

      onError(e instanceof Error ? e.message : "Failed to create quotation");

    } finally {

      setCreating(false);

    }

  }



  async function handleApprove(quotation: Quotation) {

    setActingId(quotation.id);

    try {

      await client.approveQuotation(quotation.id);

      setNotice(`Quotation #${quotation.id} approved.`);

      await loadData();

    } catch (e) {

      onError(e instanceof Error ? e.message : "Approve failed");

    } finally {

      setActingId(null);

    }

  }



  async function handleEmailDraft(quotation: Quotation) {

    setActingId(quotation.id);

    try {

      await client.createQuotationEmailDraft(quotation.id);

      setNotice(

        `Email draft created for quotation #${quotation.id}. Open Approval Queue to review and send.`,

      );

      await loadData();

    } catch (e) {

      onError(e instanceof Error ? e.message : "Failed to create email draft");

    } finally {

      setActingId(null);

    }

  }



  if (loading) {

    return <p className="text-slate-400">Loading quotations…</p>;

  }



  return (

    <section className="space-y-6">

      <div>

        <h2 className="text-lg font-medium text-slate-100">Formal quotations</h2>

        <p className="text-sm text-slate-500 mt-1">

          Create priced quotations with one or more products, download PDF/HTML, approve, then draft

          an email to the Approval Queue.

        </p>

      </div>



      {notice && (

        <p className="text-sm text-emerald-300/90 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">

          {notice}

        </p>

      )}



      <form

        onSubmit={(e) => void handleCreate(e)}

        className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4"

      >

        <h3 className="text-sm font-medium text-slate-300">Create quotation</h3>



        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

          <label className="block sm:col-span-2">

            <span className="text-sm text-slate-400">Lead (HOT/WARM with email)</span>

            <select

              required

              value={buyerId}

              onChange={(e) => setBuyerId(e.target.value)}

              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"

            >

              <option value="">Select lead…</option>

              {eligibleLeads.map((lead) => (

                <option key={lead.id} value={lead.id}>

                  {lead.company_name} ({lead.latest_score}) — {lead.contact_email}

                </option>

              ))}

            </select>

          </label>



          <label className="block">

            <span className="text-sm text-slate-400">Incoterms</span>

            <input

              type="text"

              value={incoterms}

              onChange={(e) => setIncoterms(e.target.value)}

              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"

            />

          </label>



          <label className="block">

            <span className="text-sm text-slate-400">Validity (days)</span>

            <input

              type="number"

              min="1"

              value={validityDays}

              onChange={(e) => setValidityDays(e.target.value)}

              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"

            />

          </label>

        </div>



        <div className="space-y-3">

          <div className="flex items-center justify-between">

            <h4 className="text-sm text-slate-400">Products</h4>

            <button

              type="button"

              onClick={addLine}

              className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs"

            >

              + Add product

            </button>

          </div>



          {lines.map((line, index) => {

            const selectedProduct = productMap.get(line.product_id) ?? null;

            const tiers = tierOptionsFor(line.product_id);



            return (

              <div

                key={line.key}

                className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3"

              >

                <div className="flex items-center justify-between">

                  <span className="text-xs text-slate-500">Line {index + 1}</span>

                  {lines.length > 1 && (

                    <button

                      type="button"

                      onClick={() => removeLine(line.key)}

                      className="text-xs text-red-300 hover:text-red-200"

                    >

                      Remove

                    </button>

                  )}

                </div>



                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

                  <label className="block sm:col-span-2">

                    <span className="text-xs text-slate-400">Product</span>

                    <select

                      value={line.product_id}

                      onChange={(e) => {

                        const productId = e.target.value;

                        const tiersForProduct = tierOptionsFor(productId);

                        updateLine(line.key, {

                          product_id: productId,

                          price_tier: tiersForProduct[0] ?? "standard",

                        });

                      }}

                      className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200"

                    >

                      <option value="">Select product…</option>

                      {availableProductsForLine(line.key).map((product) => (

                        <option key={product.id} value={product.id}>

                          {product.name}

                          {product.category ? ` (${product.category.replace(/_/g, " ")})` : ""}

                        </option>

                      ))}

                    </select>

                  </label>



                  <label className="block">

                    <span className="text-xs text-slate-400">Price tier</span>

                    <select

                      value={line.price_tier}

                      onChange={(e) => updateLine(line.key, { price_tier: e.target.value })}

                      className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200"

                    >

                      {tiers.map((tier) => (

                        <option key={tier} value={tier}>

                          {tier.replace(/_/g, " ")}

                          {selectedProduct?.price_tiers?.[tier] != null

                            ? ` — ${selectedProduct.price_tiers[tier]}`

                            : ""}

                        </option>

                      ))}

                    </select>

                  </label>



                  <label className="block">

                    <span className="text-xs text-slate-400">Quantity</span>

                    <input

                      type="number"

                      min="0.01"

                      step="0.01"

                      required

                      value={line.quantity}

                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}

                      className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200"

                    />

                  </label>

                </div>



                {selectedProduct?.price_tiers && (

                  <p className="text-xs text-slate-500">

                    {Object.entries(selectedProduct.price_tiers)

                      .map(([tier, price]) => `${tier.replace(/_/g, " ")}: ${price}`)

                      .join(" · ")}

                  </p>

                )}

              </div>

            );

          })}

        </div>



        <div className="flex justify-end">

          <button

            type="submit"

            disabled={creating || eligibleLeads.length === 0}

            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"

          >

            {creating

              ? "Creating…"

              : `Create draft quotation (${lines.filter((l) => l.product_id).length} products)`}

          </button>

        </div>

      </form>



      <div className="overflow-x-auto rounded-xl border border-slate-800">

        <table className="w-full text-sm">

          <thead className="bg-slate-900 text-slate-400">

            <tr>

              <th className="p-3 text-left">ID</th>

              <th className="p-3 text-left">Buyer</th>

              <th className="p-3 text-left">Products</th>

              <th className="p-3 text-left">Total</th>

              <th className="p-3 text-left">Status</th>

              <th className="p-3 text-left">Valid until</th>

              <th className="p-3 text-left">Actions</th>

            </tr>

          </thead>

          <tbody>

            {quotations.length === 0 ? (

              <tr>

                <td colSpan={7} className="p-6 text-center text-slate-500">

                  No quotations yet. Create one above.

                </td>

              </tr>

            ) : (

              quotations.map((quote) => {

                const quoteLines = quote.lines ?? [];

                const multi = quoteLines.length > 1;

                const isExpanded = expandedId === quote.id;



                return (

                  <Fragment key={quote.id}>

                    <tr className="border-t border-slate-800 bg-slate-950/40">

                      <td className="p-3 text-slate-400">#{quote.id}</td>

                      <td className="p-3 text-slate-200">

                        {quote.buyer_name ?? `Lead #${quote.buyer_id}`}

                      </td>

                      <td className="p-3 text-slate-300">

                        {multi ? (

                          <button

                            type="button"

                            onClick={() => setExpandedId(isExpanded ? null : quote.id)}

                            className="text-emerald-400 hover:text-emerald-300 text-left"

                          >

                            {quoteLines.length} products {isExpanded ? "▾" : "▸"}

                          </button>

                        ) : (

                          quote.product_name ?? `#${quote.product_id}`

                        )}

                      </td>

                      <td className="p-3 text-slate-200">

                        {formatMoney(quote.grand_total ?? quote.line_total)}

                      </td>

                      <td className={`p-3 capitalize ${statusClass(quote.status)}`}>

                        {quote.status}

                      </td>

                      <td className="p-3 text-slate-400">{quote.validity_date ?? "—"}</td>

                      <td className="p-3">

                        <div className="flex flex-wrap gap-2">

                          {quote.pdf_path && (

                            <a

                              href={client.quotationFileUrl(quote.id)}

                              target="_blank"

                              rel="noreferrer"

                              className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs hover:bg-slate-700"

                            >

                              Download

                            </a>

                          )}

                          {quote.status === "draft" && (

                            <button

                              type="button"

                              onClick={() => void handleApprove(quote)}

                              disabled={actingId === quote.id}

                              className="px-2 py-1 rounded bg-emerald-900/50 border border-emerald-700/50 text-xs text-emerald-200 disabled:opacity-50"

                            >

                              Approve

                            </button>

                          )}

                          {(quote.status === "draft" || quote.status === "approved") && (

                            <button

                              type="button"

                              onClick={() => void handleEmailDraft(quote)}

                              disabled={actingId === quote.id}

                              className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs hover:bg-slate-700 disabled:opacity-50"

                            >

                              Draft email

                            </button>

                          )}

                        </div>

                      </td>

                    </tr>

                    {multi && isExpanded && (

                      <tr className="border-t border-slate-800/50 bg-slate-950/20">

                        <td colSpan={7} className="p-3">

                          <table className="w-full text-xs text-slate-400">

                            <thead>

                              <tr>

                                <th className="text-left pb-2">Product</th>

                                <th className="text-left pb-2">Qty</th>

                                <th className="text-left pb-2">Unit</th>

                                <th className="text-left pb-2">Line total</th>

                              </tr>

                            </thead>

                            <tbody>

                              {quoteLines.map((line, idx) => (

                                <tr key={`${line.product_id}-${idx}`}>

                                  <td className="py-1 text-slate-300">{line.product_name}</td>

                                  <td className="py-1">{line.quantity}</td>

                                  <td className="py-1">

                                    {formatMoney(line.unit_price)}

                                    {line.price_unit ? ` (${line.price_unit})` : ""}

                                  </td>

                                  <td className="py-1 text-slate-200">

                                    {formatMoney(line.line_total)}

                                  </td>

                                </tr>

                              ))}

                            </tbody>

                          </table>

                        </td>

                      </tr>

                    )}

                  </Fragment>

                );

              })

            )}

          </tbody>

        </table>

      </div>

    </section>

  );

}


