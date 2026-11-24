// Sends mail via SMTP when SMTP_URL is set; otherwise logs it (and keeps an
// in-memory outbox so tests and local development can read the messages).
import nodemailer from 'nodemailer';

export function createMailer(cfg) {
  const outbox = [];
  const transport = cfg.smtpUrl ? nodemailer.createTransport(cfg.smtpUrl) : null;
  return {
    outbox,
    async send({ to, subject, text }) {
      const msg = { from: cfg.mailFrom, to, subject, text };
      if (!transport) {
        outbox.push(msg);
        if (outbox.length > 100) outbox.shift();
        if (!cfg.quiet) console.log(`[mail] (SMTP_URL not set, not sent) to=${to} subject="${subject}"\n${text}\n`);
        return;
      }
      try {
        await transport.sendMail(msg);
      } catch (e) {
        console.error('[mail] failed:', e.message);
      }
    },
  };
}
