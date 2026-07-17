# Kafi Sales Agent

**AI Sales Co-Pilot for Kafi Commodities (Pvt) Ltd**

Kafi Sales Agent is an AI-powered sales co-pilot streamlining B2B outreach for Kafi Commodities. It helps teams discover, score, and convert global buyers for staples like spices and Essence pink salt. Featuring AI lead intelligence, automated email drafting, and smart product matching, it accelerates workflows while maintaining human-in-the-loop control.

### 🌟 Core Features

**Lead Generation & Intelligence**

* **Automated Trade Show Ingestion:** Custom data extraction pipelines instantly parse, enrich, and verify raw attendee lists from global food expos or CSV imports.
* **Lead Scoring & Classification:** The agent researches each lead's website and public presence, classifying them as HOT, WARM, or COLD against Kafi's 177-SKU catalog with transparent reasoning.
* **Social Signals Tracking:** Monitors target buyer platforms for intent signals, automatically piping new prospects into the sales funnel.

**Smart Communication & Workflow**

* **Unified AI Mailbox:** Connects directly to the company inbox to instantly summarize incoming emails and generate context-aware, editable draft replies.
* **Human-in-the-Loop:** Zero auto-sends. Every AI-generated email, DM, or WhatsApp message remains a draft until explicitly approved by a representative via the dashboard.
* **Calls & Follow-Ups:** Quick-dial capabilities, recent-call tracking, and scheduled follow-ups for quotation expiries and post-delivery relationship touchpoints.

**Product Matching & Integration**

* **Natural Language Catalog Search (RAG):** A retrieval-augmented generation interface allowing reps to query the entire product catalog and historical sales data using conversational prompts.
* **Smart Quoting:** Matches buyer signals to relevant product categories, generating FCL-optimized PDF quotations complete with category pricing and carton dimensions.
* **Secure ERP/CRM Sync:** Idempotent webhook endpoints featuring HMAC signature verification to securely and instantly sync approved leads, communications, and orders with external systems.

**Compliance & Security**

* **Compliance by Design:** Respects `robots.txt`, exclusively utilizes official APIs, requires explicit consent for personal outreach, and maintains a strict audit log of all AI drafts, edits, and sends.

### 🛠️ Tech Stack

* **Backend:** Python, FastAPI, PostgreSQL (Supabase)
* **Frontend:** React, Vite
* **AI Engine:** LLM-powered analysis (Gemini)
* **Deployment:** Railway (Backend), Vercel (Frontend)

### 🚀 Access & Environments

| Environment | Link / Endpoint | Notes |
| --- | --- | --- |
| **Live Dashboard** | [https://kafi-sales-agent.vercel.app](https://www.google.com/search?q=https://kafi-sales-agent.vercel.app) | Production environment |
| **Local Dashboard** | `http://localhost:5173` | Accessible after running `npm run dev` |
| **API Docs (Swagger)** | `[http://127.0.0.1:8001/docs](http://127.0.0.1:8001/docs)` | Accessible after backend startup |
