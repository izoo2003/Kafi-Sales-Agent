# Kafi Bulk / Individual Mailer (Vercel)

Separate email UI deployed on **Vercel** (not Railway). Railway Hobby blocks SMTP;
Vercel allows outbound SMTP on ports 465/587. The Sales Agent opens this app when you
click **Send emails**.

## Architecture

```
Sales Agent (Railway API + main Vercel UI)
  → POST /api/mailer/handoff  (signed short-lived token)
  → opens https://YOUR-MAILER.vercel.app/?token=...

Mailer (this folder on Vercel)
  → SMTP to mail.kafi-group.com as the logged-in user's mailbox
  → sends in batches with pauses (client-orchestrated)
```

## What you must provide

1. Create a **second Vercel project** pointed at this `mailer/` directory (Root Directory = `mailer`).
2. Copy these env vars into that Vercel project (same mailbox passwords as Railway):

```
MAILER_HANDOFF_SECRET=<long random string, same as Railway>
MAILBOX_SMTP_HOST=67.23.252.42
MAILBOX_SMTP_PORT=465
MAILBOX_SSL_HOSTNAME=mail.kafi-group.com
MAILBOX_ADMIN_EMAIL=...
MAILBOX_ADMIN_PASSWORD=...
MAILBOX_ASIM_EMAIL=...
MAILBOX_ASIM_PASSWORD=...
MAILBOX_USMAN_EMAIL=...
MAILBOX_USMAN_PASSWORD=...
MAILBOX_SADIA_EMAIL=...
MAILBOX_SADIA_PASSWORD=...
# optional display names
MAILBOX_ADMIN_DISPLAY_NAME=...
```

3. On **Railway** (Sales Agent backend) and main frontend:

```
MAILER_HANDOFF_SECRET=<same secret>
MAILER_PUBLIC_URL=https://YOUR-MAILER.vercel.app
```

Frontend (main app `frontend/.env` + Vercel):

```
VITE_BULK_MAILER_URL=https://YOUR-MAILER.vercel.app
```

4. Deploy this folder → tell the agent the live URL.

## Batch defaults

- Batch size: 10 emails per API call  
- Pause between batches: 45 seconds  
- Delay between messages inside a batch: 2 seconds  

Adjust in the mailer UI before sending.
