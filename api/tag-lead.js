// Vercel serverless function: captures a consult LEAD in Kit (v4) at modal submit — BEFORE payment.
// Applies `content-consultation-lead` so leads who don't pay can be nurtured. Keeps the Kit secret
// server-side (never exposed to the browser). Mirrors tag-paid.js.
//
// Env vars needed (set in Vercel — consult project):
//   KIT_API_KEY        — Kit v4 API key (same as tag-paid)
//   KIT_LEAD_TAG_ID    — tag id for `content-consultation-lead` (= 17730698)

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const email = String(body.email || "").trim();
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ ok: false, reason: "no_valid_email" });
    }

    const KIT_KEY = process.env.KIT_API_KEY;
    const TAG_ID = process.env.KIT_LEAD_TAG_ID;
    if (!KIT_KEY || !TAG_ID) {
      return res.status(500).json({ ok: false, reason: "kit_not_configured" });
    }

    const kitHeaders = { "X-Kit-Api-Key": KIT_KEY, "Content-Type": "application/json" };

    // upsert subscriber
    await fetch("https://api.kit.com/v4/subscribers", {
      method: "POST",
      headers: kitHeaders,
      body: JSON.stringify({
        email_address: email,
        first_name: name || undefined,
        fields: phone ? { phone_number: phone } : undefined
      })
    });

    // apply the lead tag (triggers the lead-nurture automation)
    const tagRes = await fetch(`https://api.kit.com/v4/tags/${TAG_ID}/subscribers`, {
      method: "POST",
      headers: kitHeaders,
      body: JSON.stringify({ email_address: email })
    });

    return res.status(200).json({ ok: true, tagged: tagRes.ok, email });
  } catch (e) {
    // non-blocking: checkout must proceed even if lead capture fails
    return res.status(200).json({ ok: false, reason: "kit_error", detail: String(e) });
  }
};
