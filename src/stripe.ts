// Pro billing through Stripe Checkout with Managed Payments: Stripe (as Link) is the merchant
// of record, so it collects and files VAT/sales tax, handles fraud, disputes and payment
// support. We only keep the customer and subscription ids, and learn about changes by webhook.
// Plain fetch instead of the Stripe SDK keeps the Worker small.
import type { Env } from "./env";
import { NOW_SQL } from "./memories";

// Pinned so a Stripe account default upgrade can't change the shapes we read.
// Managed Payments needs 2025-03-31.basil or later.
const API_VERSION = "2026-10-28.endive";

export const PRO_PRICE_LABEL = { month: "$5 a month", year: "$48 a year" };

export const billingEnabled = (env: Env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_MONTHLY && env.STRIPE_PRICE_YEARLY);

async function stripe<T>(env: Env, method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, string>): Promise<T> {
  const body = params ? new URLSearchParams(params) : undefined;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Stripe-Version": API_VERSION,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
    },
    body
  });
  const json = await res.json<T & { error?: { message: string } }>();
  if (!res.ok) throw new Error(`Stripe ${method} ${path}: ${json.error?.message ?? res.status}`);
  return json;
}

interface BillingUser {
  id: string;
  email: string;
  stripe_customer_id: string | null;
}

/** A hosted Checkout page for Pro. The user id rides on the subscription's metadata, so every
 *  later subscription event can be matched to the account without a lookup table. */
export async function createCheckout(env: Env, user: BillingUser, interval: "month" | "year"): Promise<string> {
  const params: Record<string, string> = {
    mode: "subscription",
    "managed_payments[enabled]": "true",
    "line_items[0][price]": interval === "year" ? env.STRIPE_PRICE_YEARLY! : env.STRIPE_PRICE_MONTHLY!,
    "line_items[0][quantity]": "1",
    client_reference_id: user.id,
    "subscription_data[metadata][user_id]": user.id,
    success_url: `${env.PUBLIC_URL}/account?upgraded=1`,
    cancel_url: `${env.PUBLIC_URL}/account`
  };
  if (user.stripe_customer_id) params.customer = user.stripe_customer_id;
  else params.customer_email = user.email;
  const session = await stripe<{ url: string }>(env, "POST", "checkout/sessions", params);
  return session.url;
}

/** Stripe's customer portal, for changing the payment method, switching interval or cancelling. */
export async function createPortal(env: Env, customerId: string): Promise<string> {
  const session = await stripe<{ url: string }>(env, "POST", "billing_portal/sessions", {
    customer: customerId,
    return_url: `${env.PUBLIC_URL}/account`
  });
  return session.url;
}

/** Used when an account is deleted, so nobody keeps paying for an account that's gone. */
export async function cancelSubscription(env: Env, subscriptionId: string): Promise<void> {
  try {
    await stripe(env, "DELETE", `subscriptions/${subscriptionId}`);
  } catch (e) {
    // Already cancelled is fine; anything else should stop the deletion so it can be retried.
    if (!String(e).includes("No such subscription") && !String(e).includes("canceled")) throw e;
  }
}

interface Subscription {
  id: string;
  status: string;
  customer: string;
  metadata: Record<string, string>;
}

// past_due keeps Pro while Stripe retries the card; it moves to unpaid or canceled if that fails.
const PAID = new Set(["active", "trialing", "past_due"]);
const HISTORY_GRACE_DAYS = 30;

/**
 * Sets the account's plan from the subscription's current state. Fetched fresh rather than
 * read from the event, because Stripe doesn't guarantee events arrive in order.
 */
export async function syncSubscription(env: Env, subscriptionId: string, fallbackUserId?: string): Promise<void> {
  const sub = await stripe<Subscription>(env, "GET", `subscriptions/${subscriptionId}`);
  const userId =
    sub.metadata?.user_id ||
    fallbackUserId ||
    (await env.DB.prepare(`SELECT id FROM users WHERE stripe_customer_id = ?`).bind(sub.customer).first<{ id: string }>())?.id;
  if (!userId) return; // Not one of ours (or the account was deleted).

  if (PAID.has(sub.status)) {
    await env.DB.prepare(
      `UPDATE users SET plan = 'pro', stripe_customer_id = ?, stripe_subscription_id = ?, history_until = NULL WHERE id = ?`
    )
      .bind(sub.customer, sub.id, userId)
      .run();
    return;
  }
  // Only the subscription the account is on can end Pro: an old, replaced one being cancelled
  // later must not downgrade someone who has since resubscribed. Referral days banked while
  // paying start now, and history is kept until 30 days after any free Pro runs out.
  // (SQLite reads the old row in every SET expression, so pro_until there is the old value.)
  await env.DB.prepare(
    `UPDATE users SET plan = 'free', stripe_customer_id = ?,
       pro_until = CASE WHEN bonus_days > 0
         THEN strftime('%Y-%m-%dT%H:%M:%fZ', MAX(${NOW_SQL}, COALESCE(pro_until, '')), '+' || bonus_days || ' days')
         ELSE pro_until END,
       history_until = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(${NOW_SQL}, COALESCE(pro_until, '')), '+' || (bonus_days + ${HISTORY_GRACE_DAYS}) || ' days'),
       bonus_days = 0
     WHERE id = ? AND plan = 'pro' AND (stripe_subscription_id = ? OR stripe_subscription_id IS NULL)`
  )
    .bind(sub.customer, userId, sub.id)
    .run();
}

/** Checks the Stripe-Signature header (HMAC-SHA256 of "timestamp.body"), rejecting replays older than 5 minutes. */
export async function verifyWebhook(secret: string, body: string, header: string | undefined): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=", 2) as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !signatures.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return signatures.some((s) => timingSafeEqual(s, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
