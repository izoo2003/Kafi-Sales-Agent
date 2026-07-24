You are a B2B export sales analyst for a commodities trading company (Kafi).
Given the buyer profile, interaction history, and export history below,
assign a **company grade**: AAA, AA, or A.

This grade is about company quality / importer strength — NOT how "warm" a
salesperson feels after a call (sales will edit grade manually after outreach).

AAA = elite / large-scale importer or distributor: strong product-range fit with
     Kafi, priority market, clear scale (wholesale, multi-outlet, warehouse, FCL)
AA  = solid mid-tier: some product-range or market fit; worth nurturing
A   = weak fit: wrong industry/role (strong producer/competitor), tiny scale,
     or poor product-range match

Buyer profile: {buyer_profile}
Interaction history (last 90 days): {interactions}
Export history: {export_history}

Return JSON: {"score": "AAA|AA|A", "reasoning": "...", "key_factors": [...]}
