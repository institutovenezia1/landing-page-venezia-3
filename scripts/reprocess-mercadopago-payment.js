#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");

const {
  DEFAULT_BRANCH,
  LANDING_SOURCE,
  getRequiredEnv,
  getReservationProduct,
  insertSupabaseRecord,
  selectSupabaseRecords,
  todayInMexico,
  updateSupabaseRecords,
} = require("../api/_lib/prospect-flow");

function loadLocalEnv() {
  if (!fs.existsSync(".env.local")) return;

  const lines = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

async function fetchMercadoPagoPayment(paymentId) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `Bearer ${getRequiredEnv("MERCADOPAGO_ACCESS_TOKEN")}`,
    },
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Mercado Pago payment request failed ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

function getPaymentIntentId(payment) {
  return (
    payment.external_reference ||
    (payment.metadata && (payment.metadata.intent_id || payment.metadata.intentId)) ||
    ""
  );
}

async function getPaymentIntent(intentId) {
  const intents = await selectSupabaseRecords(
    "landing_payment_intents",
    `select=*&id=eq.${encodeURIComponent(intentId)}&limit=1`
  );
  return intents[0] || null;
}

async function updateProspect(intent, payment, product) {
  const prospects = await selectSupabaseRecords(
    "prospects",
    `select=id,notes&id=eq.${encodeURIComponent(intent.prospect_id)}&limit=1`
  );
  const currentNotes = (prospects[0] && prospects[0].notes) || "";
  const paymentNote = `Mercado Pago aprobado: pago ${payment.id} | ${product.label} | monto $${payment.transaction_amount} ${payment.currency_id || "MXN"} | intent ${intent.id}`;
  const notes = currentNotes.includes(`pago ${payment.id}`)
    ? currentNotes
    : [currentNotes, paymentNote].filter(Boolean).join(" | ");

  await updateSupabaseRecords("prospects", `id=eq.${encodeURIComponent(intent.prospect_id)}`, {
    prospect_status: product.approvedStatus,
    info_status: "Pago confirmado",
    notes,
  });
}

async function upsertFinanceRecord(intent, payment, product) {
  const paymentId = String(payment.id);
  const reference = `mp:${paymentId}`;
  const existingRecords = await selectSupabaseRecords(
    "finance_records",
    `select=id&reference=eq.${encodeURIComponent(reference)}&limit=1`
  );

  if (existingRecords.length > 0) return existingRecords[0];

  return insertSupabaseRecord("finance_records", {
    id: crypto.randomUUID(),
    branch: DEFAULT_BRANCH,
    type: "Ingreso",
    category: product.financeCategory,
    amount: Number(payment.transaction_amount || intent.amount),
    payment_method: "Mercado Pago",
    reference,
    related_student_id: null,
    related_payment_id: null,
    notes: [
      `Fuente: ${LANDING_SOURCE}`,
      `Prospecto: ${intent.prospect_id}`,
      `Curso: ${intent.course_label}`,
      `TipoReserva: ${intent.reservation_type_label}`,
      `Preference: ${intent.preference_id || ""}`,
      `Payment: ${paymentId}`,
      "Reprocesado manualmente tras correccion de webhook.",
    ].join(" | "),
    recorded_by: LANDING_SOURCE,
    record_date: todayInMexico(),
    created_at: new Date().toISOString(),
  });
}

async function recordManualReprocessEvent(payment, intent) {
  return insertSupabaseRecord("mercadopago_webhook_events", {
    id: crypto.randomUUID(),
    event_id: `manual-reprocess:${payment.id}`,
    action: "manual.reprocess",
    topic: "payment",
    data_id: String(payment.id),
    payment_id: String(payment.id),
    signature_valid: false,
    request_id: "manual-reprocess",
    payload: {
      manual_reprocess: true,
      reason: "Reprocesamiento temporal solicitado tras correccion de validacion de firma.",
      payment,
      intent_id: intent.id,
      prospect_id: intent.prospect_id,
    },
    processed: true,
    processing_error: "",
    created_at: new Date().toISOString(),
  });
}

async function main() {
  loadLocalEnv();

  const paymentId = process.argv[2];
  if (!paymentId) {
    throw new Error("Uso: node scripts/reprocess-mercadopago-payment.js <payment_id>");
  }

  const payment = await fetchMercadoPagoPayment(paymentId);
  const intentId = getPaymentIntentId(payment);
  if (!intentId) throw new Error("El pago no contiene external_reference ni metadata.intent_id.");

  const intent = await getPaymentIntent(intentId);
  if (!intent) throw new Error(`No se encontro landing_payment_intents id=${intentId}.`);

  const product = getReservationProduct(intent.reservation_type_key);
  const now = new Date().toISOString();

  await updateSupabaseRecords("landing_payment_intents", `id=eq.${encodeURIComponent(intent.id)}`, {
    payment_id: String(payment.id),
    status: payment.status === "approved" ? "approved" : payment.status || "received",
    payment_status: payment.status || "",
    payment_status_detail: payment.status_detail || "",
    raw_payment: payment,
    approved_at: payment.status === "approved" ? payment.date_approved || now : intent.approved_at,
    updated_at: now,
  });

  if (payment.status === "approved") {
    await updateProspect(intent, payment, product);
    await upsertFinanceRecord(intent, payment, product);
  }

  await recordManualReprocessEvent(payment, intent);

  const [updatedIntent] = await selectSupabaseRecords(
    "landing_payment_intents",
    `select=*&id=eq.${encodeURIComponent(intent.id)}&limit=1`
  );
  const [updatedProspect] = await selectSupabaseRecords(
    "prospects",
    `select=id,full_name,prospect_status,info_status&id=eq.${encodeURIComponent(intent.prospect_id)}&limit=1`
  );
  const financeRecords = await selectSupabaseRecords(
    "finance_records",
    `select=*&reference=eq.${encodeURIComponent(`mp:${payment.id}`)}&limit=1`
  );

  console.log(JSON.stringify(
    {
      payment: {
        id: payment.id,
        status: payment.status,
        status_detail: payment.status_detail,
        amount: payment.transaction_amount,
        external_reference: intentId,
      },
      prospect: updatedProspect,
      paymentIntent: {
        id: updatedIntent.id,
        status: updatedIntent.status,
        payment_id: updatedIntent.payment_id,
        payment_status: updatedIntent.payment_status,
        approved_at: updatedIntent.approved_at,
      },
      financeRecord: financeRecords[0] || null,
    },
    null,
    2
  ));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
