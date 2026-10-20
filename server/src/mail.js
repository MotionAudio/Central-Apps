// Email through Resend (https://resend.com): RESEND_API_KEY and MAIL_FROM ("Motion Audio <team@your-domain.com>",
// a domain verified in Resend). Without them nothing is sent: the website shows the invite link to copy or text instead.
const KEY = process.env.RESEND_API_KEY || "", FROM = process.env.MAIL_FROM || "";
export const mailOn = !!(KEY && FROM);
// every email in the same simple frame: the Motion Audio name on graphite, then the message on white
function frame(html) {
  if (!html || /data-ma-frame/.test(html)) return html;
  return '<div data-ma-frame style="background:#F4F5F6;padding:24px 12px"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #E1E4E8;border-radius:12px;overflow:hidden">' +
    '<div style="background:#15181D;padding:18px 24px;color:#ECE7DD;font:600 17px/1.2 Helvetica,Arial,sans-serif;letter-spacing:.01em"><span style="color:#E2C27E">&#9679;</span>&nbsp; Motion Audio</div>' +
    '<div style="padding:22px 24px;font:15px/1.6 Helvetica,Arial,sans-serif;color:#12161C">' + html + "</div></div>" +
    '<p style="text-align:center;color:#69717D;font:12px/1.5 Helvetica,Arial,sans-serif;margin:14px 0 0">Motion Audio makes Central, the system for worship teams.</p></div>';
}
export async function sendMail(to, subject, text, html, replyTo) {
  html = frame(html);
  if (!mailOn) return { sent: false, why: "Email isn't set up yet (RESEND_API_KEY / MAIL_FROM)." };
  try {
    const r = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ from: FROM, to: [to], subject, text, html }, replyTo ? { reply_to: replyTo } : {})), signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { sent: false, why: "The email service answered " + r.status + ": " + (await r.text()).slice(0, 200) };
    return { sent: true };
  } catch (e) { return { sent: false, why: e.message }; }
}
export function escHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
