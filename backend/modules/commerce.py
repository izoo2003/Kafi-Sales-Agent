from datetime import date, timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from db.models import Buyer, ExportHistory, LeadScoreLabel, Product, Quotation, QuotationStatus
from modules.product_catalog import cross_sell_for_categories, list_products, load_catalog
from modules.research import ResearchModule


class CommerceModule:
    """Quotation generation and upsell recommendations (rule-based)."""

    def __init__(self, storage_dir: str = "storage/quotations"):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def resolve_unit_price(
        self,
        product: Product,
        buyer_id: int,
        db: Session,
        tier: str = "standard",
    ) -> float:
        tiers = product.price_tiers or {}
        base = float(tiers.get(tier, tiers.get("standard", 0)))

        last_order = (
            db.query(ExportHistory)
            .filter(
                ExportHistory.buyer_id == buyer_id,
                ExportHistory.product_id == product.id,
            )
            .order_by(ExportHistory.order_date.desc())
            .first()
        )
        if last_order and last_order.unit_price:
            negotiated = float(last_order.unit_price)
            if negotiated < base:
                return negotiated
        return base

    def create_quotation(
        self,
        db: Session,
        *,
        buyer_id: int,
        product_id: int,
        quantity: float,
        incoterms: str = "FOB",
        validity_days: int = 14,
        price_tier: str = "standard",
    ) -> Quotation:
        buyer = db.get(Buyer, buyer_id)
        product = db.get(Product, product_id)
        if not buyer or not product:
            raise ValueError("Buyer or product not found")

        unit_price = self.resolve_unit_price(product, buyer_id, db, price_tier)
        validity = date.today() + timedelta(days=validity_days)

        quotation = Quotation(
            buyer_id=buyer_id,
            product_id=product_id,
            quantity=quantity,
            unit_price=unit_price,
            incoterms=incoterms,
            validity_date=validity,
            status=QuotationStatus.draft,
        )
        db.add(quotation)
        db.commit()
        db.refresh(quotation)

        pdf_path = self.generate_quotation_pdf(db, quotation.id)
        quotation.pdf_path = str(pdf_path)
        db.commit()
        db.refresh(quotation)
        return quotation

    def generate_quotation_pdf(self, db: Session, quotation_id: int) -> Path:
        quotation = db.get(Quotation, quotation_id)
        if not quotation:
            raise ValueError("Quotation not found")

        buyer = db.get(Buyer, quotation.buyer_id)
        product = db.get(Product, quotation.product_id)
        total = float(quotation.quantity) * float(quotation.unit_price)

        html = f"""
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><title>Quotation</title></head>
        <body style="font-family: Arial, sans-serif; padding: 40px;">
          <h1>Kafi Commodities</h1>
          <h2>Quotation</h2>
          <p><strong>Buyer:</strong> {buyer.company_name if buyer else 'N/A'}</p>
          <p><strong>Product:</strong> {product.name if product else 'N/A'}</p>
          <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%;">
            <tr><th>Quantity</th><th>Unit Price (USD/MT)</th><th>Incoterms</th><th>Total (USD)</th></tr>
            <tr>
              <td>{quotation.quantity}</td>
              <td>{quotation.unit_price}</td>
              <td>{quotation.incoterms or 'FOB'}</td>
              <td>{total:,.2f}</td>
            </tr>
          </table>
          <p><strong>Validity:</strong> {quotation.validity_date}</p>
          <p style="margin-top: 24px; color: #555;">Draft quotation — subject to approval.</p>
        </body></html>
        """

        output = self.storage_dir / f"quotation_{quotation_id}.pdf"
        try:
            from weasyprint import HTML

            HTML(string=html).write_pdf(output)
        except Exception:
            output = self.storage_dir / f"quotation_{quotation_id}.html"
            output.write_text(html, encoding="utf-8")

        return output

    def recommend_upsell(self, db: Session, buyer_id: int) -> list[dict[str, str]]:
        history = (
            db.query(ExportHistory)
            .filter(ExportHistory.buyer_id == buyer_id)
            .all()
        )
        if not history:
            return []

        purchased_ids = {h.product_id for h in history}
        products = db.query(Product).filter(Product.id.notin_(purchased_ids)).limit(3).all()
        recommendations = []
        for p in products:
            rationale = f"Complements existing purchases; {p.category or 'related'} category."
            recommendations.append(
                {"product_id": str(p.id), "product_name": p.name, "rationale": rationale}
            )
        return recommendations

    def recommend_cross_sell_from_catalog(
        self, db: Session, buyer_id: int, *, limit: int = 5
    ) -> list[dict[str, str]]:
        """Cross-sell from ESSENCE catalog based on categories not yet purchased."""
        history = (
            db.query(ExportHistory)
            .join(Product, ExportHistory.product_id == Product.id)
            .filter(ExportHistory.buyer_id == buyer_id)
            .all()
        )
        purchased_categories = [h.product.category for h in history if h.product and h.product.category]
        if not purchased_categories:
            # No order history — suggest top catalog categories
            catalog_products = list_products()[:limit]
            return [
                {
                    "category": p["category"],
                    "product_name": p["name"],
                    "rationale": f"Kafi ESSENCE {p['category'].replace('_', ' ')} line may fit this buyer.",
                }
                for p in catalog_products
            ]
        return cross_sell_for_categories(purchased_categories, limit=limit)

    def list_quotations(self, db: Session, *, buyer_id: int | None = None) -> list[Quotation]:
        query = db.query(Quotation).order_by(Quotation.generated_at.desc())
        if buyer_id is not None:
            query = query.filter(Quotation.buyer_id == buyer_id)
        return query.all()

    def get_or_create_db_product(self, db: Session, *, name: str, category: str) -> Product:
        existing = db.query(Product).filter(Product.name == name).first()
        if existing:
            return existing

        catalog_item = next(
            (p for p in load_catalog().get("products", []) if p.get("name") == name),
            None,
        )
        product = Product(
            name=name,
            category=category,
            spec_sheet={
                "brand": (catalog_item or {}).get("brand", "ESSENCE"),
                "packaging": (catalog_item or {}).get("packaging"),
            },
            price_tiers={"standard": 500},
            moq="1 carton",
            certifications={"halal": True},
        )
        db.add(product)
        db.commit()
        db.refresh(product)
        return product

    def create_quotations_for_scored_lead(
        self,
        db: Session,
        buyer_id: int,
        *,
        quantity: float = 20.0,
        incoterms: str = "FOB",
        max_quotes: int = 3,
    ) -> list[Quotation]:
        """Create draft quotations for HOT or WARM leads based on product fit."""
        from modules.leads import get_latest_score

        score_record = get_latest_score(db, buyer_id)
        if not score_record:
            raise ValueError("Lead must be scored before creating quotations")
        if score_record.score not in (LeadScoreLabel.HOT, LeadScoreLabel.WARM):
            raise ValueError("Quotations are only auto-created for HOT or WARM leads")

        profile = ResearchModule().research_buyer(db, buyer_id)
        candidates: list[dict[str, str]] = list(profile.matched_products)

        if not candidates and profile.matched_categories:
            for cat in profile.matched_categories[:max_quotes]:
                cat_products = list_products(cat)
                if cat_products:
                    sample = cat_products[0]
                    candidates.append({"name": sample["name"], "category": sample["category"]})

        if not candidates:
            raise ValueError(
                "No product fit found for this lead. Run research first or create a quotation manually."
            )

        quotations: list[Quotation] = []
        for item in candidates[:max_quotes]:
            product = self.get_or_create_db_product(
                db, name=item["name"], category=item["category"]
            )
            quotations.append(
                self.create_quotation(
                    db,
                    buyer_id=buyer_id,
                    product_id=product.id,
                    quantity=quantity,
                    incoterms=incoterms,
                )
            )
        return quotations

    def sync_catalog_to_products(self, db: Session) -> dict[str, int]:
        """Import ESSENCE catalog JSON into the products table (idempotent by name)."""
        catalog_products = load_catalog().get("products", [])
        created = 0
        skipped = 0
        for item in catalog_products:
            existing = db.query(Product).filter(Product.name == item["name"]).first()
            if existing:
                skipped += 1
                continue
            db.add(
                Product(
                    name=item["name"],
                    category=item.get("category"),
                    spec_sheet={
                        "brand": item.get("brand", "ESSENCE"),
                        "packaging": item.get("packaging"),
                        "catalog_id": item.get("id"),
                    },
                    price_tiers={"standard": 500},
                    moq="1 carton",
                    certifications={"halal": True},
                )
            )
            created += 1
        if created:
            db.commit()
        return {
            "created": created,
            "skipped": skipped,
            "total": db.query(Product).count(),
        }

    def list_products(self, db: Session) -> list[Product]:
        if db.query(Product).count() < 10:
            self.sync_catalog_to_products(db)
        return db.query(Product).order_by(Product.category, Product.name).all()

    def create_product(self, db: Session, data: dict) -> Product:
        product = Product(**data)
        db.add(product)
        db.commit()
        db.refresh(product)
        return product


_commerce = CommerceModule()


def get_commerce() -> CommerceModule:
    return _commerce
