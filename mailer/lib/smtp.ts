import nodemailer from "nodemailer";

type MailboxCreds = {
  email: string;
  password: string;
  displayName?: string;
};

const USER_ENV: Record<string, { email: string; password: string; display?: string }> = {
  admin: {
    email: "MAILBOX_ADMIN_EMAIL",
    password: "MAILBOX_ADMIN_PASSWORD",
    display: "MAILBOX_ADMIN_DISPLAY_NAME",
  },
  asim: {
    email: "MAILBOX_ASIM_EMAIL",
    password: "MAILBOX_ASIM_PASSWORD",
    display: "MAILBOX_ASIM_DISPLAY_NAME",
  },
  usmankhan: {
    email: "MAILBOX_USMAN_EMAIL",
    password: "MAILBOX_USMAN_PASSWORD",
    display: "MAILBOX_USMAN_DISPLAY_NAME",
  },
  sadia: {
    email: "MAILBOX_SADIA_EMAIL",
    password: "MAILBOX_SADIA_PASSWORD",
    display: "MAILBOX_SADIA_DISPLAY_NAME",
  },
};

export function resolveMailbox(username: string, fallbackEmail?: string): MailboxCreds | null {
  const map = USER_ENV[username.toLowerCase()];
  if (map) {
    const email = (process.env[map.email] || "").trim();
    const password = process.env[map.password] || "";
    const displayName = (map.display && process.env[map.display]) || undefined;
    if (email && password) {
      return { email, password, displayName: displayName?.trim() || undefined };
    }
  }
  // Fallback: match by email against any configured mailbox
  if (fallbackEmail) {
    for (const key of Object.keys(USER_ENV)) {
      const cfg = USER_ENV[key];
      const email = (process.env[cfg.email] || "").trim().toLowerCase();
      if (email && email === fallbackEmail.trim().toLowerCase()) {
        const password = process.env[cfg.password] || "";
        if (password) {
          return {
            email,
            password,
            displayName: (cfg.display && process.env[cfg.display])?.trim() || undefined,
          };
        }
      }
    }
  }
  return null;
}

function normalizeAddrList(value?: string | null): string | undefined {
  const cleaned = (value || "")
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter((part) => part.includes("@"));
  return cleaned.length ? cleaned.join(", ") : undefined;
}

export async function sendSmtp(options: {
  username: string;
  mailboxEmail?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  html?: boolean;
}): Promise<{ ok: boolean; message: string }> {
  const creds = resolveMailbox(options.username, options.mailboxEmail);
  if (!creds) {
    return {
      ok: false,
      message: `No SMTP credentials on mailer for user "${options.username}". Set MAILBOX_* env on Vercel.`,
    };
  }

  const host = process.env.MAILBOX_SMTP_HOST || "67.23.252.42";
  const port = Number(process.env.MAILBOX_SMTP_PORT || "465");
  const sslHostname = process.env.MAILBOX_SSL_HOSTNAME || "mail.kafi-group.com";

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: creds.email, pass: creds.password },
    tls: {
      servername: sslHostname,
      // Connecting by IP; verify against cert hostname
      rejectUnauthorized: true,
    },
    connectionTimeout: 25_000,
    greetingTimeout: 25_000,
    socketTimeout: 40_000,
  });

  const from = creds.displayName
    ? `"${creds.displayName}" <${creds.email}>`
    : creds.email;

  const cc = normalizeAddrList(options.cc);
  const bcc = normalizeAddrList(options.bcc);

  try {
    await transporter.sendMail({
      from,
      to: options.to,
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {}),
      subject: options.subject,
      text: options.body,
      html: options.html
        ? options.body.replace(/\n/g, "<br/>")
        : undefined,
      replyTo: creds.email,
    });
    return { ok: true, message: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  } finally {
    try {
      transporter.close();
    } catch {
      /* ignore close errors */
    }
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
