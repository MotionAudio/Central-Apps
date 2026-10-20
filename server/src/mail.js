// Email through Resend (https://resend.com): RESEND_API_KEY and MAIL_FROM ("Motion Audio <team@your-domain.com>",
// a domain verified in Resend). Without them nothing is sent: the website shows the invite link to copy or text instead.
const KEY = process.env.RESEND_API_KEY || "", FROM = process.env.MAIL_FROM || "";
export const mailOn = !!(KEY && FROM);
export async function sendMail(to, subject, text, html) {
  if (!mailOn) return { sent: false, why: "Email isn't set up yet (RESEND_API_KEY / MAIL_FROM)." };
  try {
    const r = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html }), signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { sent: false, why: "The email service answered " + r.status + ": " + (await r.text()).slice(0, 200) };
    return { sent: true };
  } catch (e) { return { sent: false, why: e.message }; }
}
export function escHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
