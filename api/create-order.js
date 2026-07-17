// Vercel serverless function: creates a Cashfree order server-side and returns payment_session_id.
// Consult page = ONE offer: ₹497 1:1 consultation. Secret key read from env — never hardcoded.

const PACKS = {
  consult: { amount: 497, label: "1:1 Consultation with Dr. Madhu" }
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { pack, name, email, phone } = body;

    const chosen = PACKS[pack] || PACKS.consult;

    // international friendly (8-15 digits)
    const cleanPhone = String(phone || "").replace(/\D/g, "");
    if (cleanPhone.length < 8 || cleanPhone.length > 15) {
      return res.status(400).json({ error: "Valid phone required" });
    }

    const ENV = (process.env.CASHFREE_ENV || "sandbox").toLowerCase();
    const APP_ID = process.env.CASHFREE_APP_ID;
    const SECRET = process.env.CASHFREE_SECRET_KEY;
    if (!APP_ID || !SECRET) {
      return res.status(500).json({ error: "Payment not configured" });
    }

    const BASE = ENV === "production"
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg";

    const orderId = "consult_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

    // return_url sends the buyer to our thank-you page with amount + pack for the Purchase pixel + Kit tag
    const origin = req.headers.origin || "https://consult.drmadhusudan.com";
    const returnUrl = `${origin}/thank-you?order_id={order_id}&amount=${chosen.amount}&pack=consult`;

    const orderPayload = {
      order_id: orderId,
      order_amount: chosen.amount,
      order_currency: "INR",
      customer_details: {
        customer_id: "cust_" + cleanPhone,
        customer_name: name || "Customer",
        customer_email: email || "customer@example.com",
        customer_phone: cleanPhone
      },
      order_meta: {
        return_url: returnUrl
      },
      order_note: chosen.label,
      order_tags: {
        funnel: "consult",
        env: ENV
      }
    };

    const cfRes = await fetch(`${BASE}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-version": "2023-08-01",
        "x-client-id": APP_ID,
        "x-client-secret": SECRET
      },
      body: JSON.stringify(orderPayload)
    });

    const data = await cfRes.json();

    if (!cfRes.ok || !data.payment_session_id) {
      return res.status(502).json({
        error: "Order creation failed",
        detail: data.message || "unknown"
      });
    }

    return res.status(200).json({
      payment_session_id: data.payment_session_id,
      order_id: orderId,
      amount: chosen.amount,
      env: ENV
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err.message || err) });
  }
};
