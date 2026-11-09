// Daily Tower digest. Reads admin_digest() with the service role and emails every admin who
// opted in (Admins page in Tower). Sends through Resend.
//
// Deploy: Supabase dashboard -> Edge Functions -> Deploy a new function -> "tower-digest",
//         paste this file, turn OFF "Verify JWT" (the cron call authenticates with DIGEST_SECRET).
// Secrets: RESEND_API_KEY, DIGEST_SECRET (any long random string), optional DIGEST_FROM
//          (defaults to "Kova Tower <onboarding@resend.dev>", which Resend only delivers to the
//          address that owns the Resend account until kovamaps.com is verified there).
// Schedule: supabase/digest-cron.sql.
import { createClient } from "jsr:@supabase/supabase-js@2";

type Digest = {
  since: string; until: string; signups: number; active_users: number; total_users: number;
  reports: number; reports_by_kind: Record<string, number>; feedback: number; feedback_new_total: number;
  feedback_list: { id: string; kind: string; message: string; contact: string | null; created_at: string }[];
  signups_list: { email: string | null; created_at: string; provider: string | null }[];
  admin_actions: number; recipients: string[];
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function render(d: Digest): { subject: string; html: string; text: string } {
  const tower = "https://tower.kovamaps.com/#";
  const stat = (label: string, value: number, href: string) =>
    `<td style="padding:12px 14px;border:1px solid #e3e8ef;border-radius:10px"><a href="${href}" style="color:#121a26;text-decoration:none"><div style="font-size:24px;font-weight:700">${value}</div><div style="font-size:12px;color:#67748a">${label}</div></a></td>`;
  const feedback = d.feedback_list.map((f) =>
    `<li style="margin:0 0 10px"><a href="${tower}/feedback/${f.id}" style="color:#2f6fe4">${esc(f.kind)}</a> — ${esc(f.message)}${f.contact ? ` <span style="color:#67748a">(${esc(f.contact)})</span>` : ""}</li>`).join("");
  const signups = d.signups_list.map((u) => `<li>${esc(u.email ?? "no email")} <span style="color:#67748a">via ${esc(u.provider ?? "?")}</span></li>`).join("");
  const kinds = Object.entries(d.reports_by_kind).map(([k, n]) => `${esc(k)} ${n}`).join(" · ");
  const subject = `Kova Tower · ${d.signups} sign-up${d.signups === 1 ? "" : "s"}, ${d.feedback} feedback, ${d.reports} report${d.reports === 1 ? "" : "s"}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#121a26">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#67748a">Last 24 hours</div>
    <h1 style="font-size:24px;margin:4px 0 18px">Kova Tower digest</h1>
    <table style="width:100%;border-collapse:separate;border-spacing:8px;margin:0 -8px"><tr>
      ${stat("New sign-ups", d.signups, `${tower}/users`)}${stat("Active users", d.active_users, `${tower}/users`)}</tr><tr>
      ${stat("New feedback", d.feedback, `${tower}/feedback?status=new`)}${stat("Traffic reports", d.reports, `${tower}/reports?days=1`)}</tr></table>
    <p style="color:#67748a;font-size:13px">${d.total_users} users in total · ${d.feedback_new_total} feedback untriaged · ${d.admin_actions} admin actions${kinds ? ` · reports: ${kinds}` : ""}</p>
    ${feedback ? `<h2 style="font-size:16px;margin:22px 0 8px">Feedback</h2><ul style="padding-left:18px;margin:0">${feedback}</ul>` : ""}
    ${signups ? `<h2 style="font-size:16px;margin:22px 0 8px">Sign-ups</h2><ul style="padding-left:18px;margin:0">${signups}</ul>` : ""}
    <p style="margin-top:26px"><a href="${tower}/" style="background:#2f6fe4;color:#fff;padding:10px 16px;border-radius:9px;text-decoration:none;font-weight:600">Open Tower</a></p>
    <p style="color:#8e9bad;font-size:12px;margin-top:22px">Turn this off on the Admins page in Tower.</p>
  </div></body></html>`;
  const text = `${subject}\n\n${d.total_users} users, ${d.active_users} active, ${d.feedback_new_total} feedback untriaged.\n\n` +
    d.feedback_list.map((f) => `- [${f.kind}] ${f.message}`).join("\n") + `\n\n${tower}/`;
  return { subject, html, text };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("DIGEST_SECRET");
  if (!secret || req.headers.get("x-digest-secret") !== secret) return json(401, { error: "unauthorized" });
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json(500, { error: "RESEND_API_KEY is not set" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.rpc("admin_digest");
  if (error) return json(500, { error: error.message });
  const d = data as Digest;
  const url = new URL(req.url);
  const quiet = d.signups + d.feedback + d.reports + d.admin_actions === 0;
  if (quiet && url.searchParams.get("force") !== "1") return json(200, { sent: 0, skipped: "nothing happened" });
  if (!d.recipients.length) return json(200, { sent: 0, skipped: "no recipients" });

  const { subject, html, text } = render(d);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("DIGEST_FROM") ?? "Kova Tower <onboarding@resend.dev>", to: d.recipients, subject, html, text }),
  });
  if (!res.ok) return json(502, { error: `Resend ${res.status}: ${await res.text()}` });
  return json(200, { sent: d.recipients.length });
});
