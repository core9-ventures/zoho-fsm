import "server-only";
import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };

let transport: nodemailer.Transporter | undefined;

/** SMTP transport from SMTP_HOST / SMTP_PORT (Mailpit in development: http://localhost:8025). */
export async function sendMail(mail: Mail): Promise<void> {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } } : {}),
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? "FieldServe <no-reply@fieldserve.local>",
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
}
