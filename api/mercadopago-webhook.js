const crypto = require("node:crypto");

const {
  DEFAULT_BRANCH,
  LANDING_SOURCE,
  getRequiredEnv,
  getReservationProduct,
  insertSupabaseRecord,
  readJsonBody,
  selectSupabaseRecords,
  sendJson,
  todayInMexico,
  updateSupabaseRecords,
} = require("./_lib/prospect-flow");

const MERCADOPAGO_API_BASE = "https://api.mercadopago.com";

function getHeader(request, name) {
  return request.headers[name] || request.headers[name.toLowerCase()];
}

function getRequestUrl(request) {
  const host = getHeader(request, "host") || "localhost:5173";
  return new URL(request.url || "/api/mercadopago-webhook", `https://${host}`);
}

function parseSignatureHeader(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim().split("="))
    .reduce((accumulator, [key, ...valueParts]) => {
      if (key && valueParts.length > 0) {
        accumulator[key.trim()] = valueParts.join("=").trim();
      }
      return accumulator;
    }, {});
}

function safeEqualHex(left, right) {
  if (!left || !right || left.length !== right.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  } catch (error) {
    return false;
  }
}

function verifyWebhookSignature({ request, requestUrl, paymentId }) {
  const secret = getRequiredEnv("MERCADOPAGO_WEBHOOK_SECRET");
  if (!secret) {
    return { configured: false, valid: false, skipped: true };
  }

  const xSignature = getHeader(request, "x-signature");
  const xRequestId = getHeader(request, "x-request-id");
  const signatureParts = parseSignatureHeader(xSignature);
  const dataId = (requestUrl.searchParams.get("data.id") || paymentId || "").toLowerCase();

  if (!signatureParts.ts || !signatureParts.v1 || !xRequestId || !dataId) {
    return { configured: true, valid: false, skipped: false };
  }

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${signatureParts.ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  return {
    configured: true,
    valid: safeEqualHex(expected, signatureParts.v1),
    skipped: false,
  };
}

function getPaymentIdFromNotification(payload, requestUrl) {
  return (
    requestUrl.searchParams.get("data.id") ||
    (payload && payload.data && payload.data.id) ||
    requestUrl.searchParams.get("id") ||
    ""
  );
}

function getNotificationTopic(payload, requestUrl) {
  return (
    (payload && (payload.type || payload.topic)) ||
    requestUrl.searchParams.get("type") ||
    requestUrl.searchParams.get("topic") ||
    ""
  );
}

async function fetchMercadoPagoPayment(paymentId) {
  const response = await fetch(`${MERCADOPAGO_API_BASE}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `Bearer ${getRequiredEnv("MERCADOPAGO_ACCESS_TOKEN")}`,
    },
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && (payload.message || payload.error || payload.cause)) ||
      `Mercado Pago payment request failed with ${response.status}`;
    const error = new Error(typeof message === "string" ? message : JSON.stringify(message));
    error.status = response.status;
    error.payload = payload;
    throw error;
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

async function appendProspectPaymentNote(intent, payment, product) {
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

  if (existingRecords.length > 0) {
    return existingRecords[0];
  }

  return insertSupabaseRecord("finance_records", {
    id: crypto.randomUUID(),
    branch: DEFAULT_BRANCH,
    type: "Ingreso",
    category: product.financeCategory,
    amount: Number(payment.transaction_amount || intent.amount),
    payment_method: "Mercado Pago",
    reference,
    related_student_id: null,
    related_payment_id: paymentId,
    notes: [
      `Fuente: ${LANDING_SOURCE}`,
      `Prospecto: ${intent.prospect_id}`,
      `Curso: ${intent.course_label}`,
      `TipoReserva: ${intent.reservation_type_label}`,
      `Preference: ${intent.preference_id || ""}`,
      `Payment: ${paymentId}`,
    ].join(" | "),
    recorded_by: LANDING_SOURCE,
    record_date: todayInMexico(),
    created_at: new Date().toISOString(),
  });
}

async function recordWebhookEvent({ payload, paymentId, request, signature, processed, processingError }) {
  try {
    return await insertSupabaseRecord("mercadopago_webhook_events", {
      id: crypto.randomUUID(),
      event_id: payload && payload.id ? String(payload.id) : "",
      action: payload && payload.action ? String(payload.action) : "",
      topic: payload && (payload.type || payload.topic) ? String(payload.type || payload.topic) : "",
      data_id: paymentId ? String(paymentId) : "",
      payment_id: paymentId ? String(paymentId) : "",
      signature_valid: Boolean(signature.valid),
      request_id: getHeader(request, "x-request-id") || "",
      payload: payload || {},
      processed: Boolean(processed),
      processing_error: processingError || "",
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("webhook event record failed", {
      message: error.message,
      status: error.status,
      payload: error.payload,
    });
    return null;
  }
}

module.exports = async function mercadoPagoWebhook(request, response) {
  if (request.method === "GET") {
    return sendJson(response, 200, { ok: true, endpoint: "mercadopago-webhook" });
  }

  if (request.method !== "POST") {
    return sendJson(response, 405, { ok: false, error: "Metodo no permitido." });
  }

  if (!getRequiredEnv("MERCADOPAGO_ACCESS_TOKEN")) {
    return sendJson(response, 500, {
      ok: false,
      error: "Falta MERCADOPAGO_ACCESS_TOKEN para procesar webhooks.",
    });
  }

  let payload = {};
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    return sendJson(response, 400, { ok: false, error: "JSON invalido." });
  }

  const requestUrl = getRequestUrl(request);
  const paymentId = getPaymentIdFromNotification(payload, requestUrl);
  const topic = getNotificationTopic(payload, requestUrl);
  const signature = verifyWebhookSignature({ request, requestUrl, paymentId });

  if (signature.configured && !signature.valid) {
    await recordWebhookEvent({
      payload,
      paymentId,
      request,
      signature,
      processed: false,
      processingError: "Firma invalida.",
    });
    return sendJson(response, 401, { ok: false, error: "Firma invalida." });
  }

  if (topic && topic !== "payment") {
    await recordWebhookEvent({ payload, paymentId, request, signature, processed: true });
    return sendJson(response, 200, { ok: true, ignored: true, topic });
  }

  if (!paymentId) {
    await recordWebhookEvent({
      payload,
      paymentId,
      request,
      signature,
      processed: false,
      processingError: "No se recibio data.id del pago.",
    });
    return sendJson(response, 400, { ok: false, error: "No se recibio data.id del pago." });
  }

  try {
    const payment = await fetchMercadoPagoPayment(paymentId);
    const intentId = getPaymentIntentId(payment);

    if (!intentId) {
      await recordWebhookEvent({
        payload,
        paymentId,
        request,
        signature,
        processed: false,
        processingError: "El pago no contiene external_reference.",
      });
      return sendJson(response, 202, { ok: true, processed: false, reason: "missing_external_reference" });
    }

    const intent = await getPaymentIntent(intentId);
    if (!intent) {
      await recordWebhookEvent({
        payload,
        paymentId,
        request,
        signature,
        processed: false,
        processingError: "No se encontro payment intent.",
      });
      return sendJson(response, 202, { ok: true, processed: false, reason: "intent_not_found" });
    }

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
      await appendProspectPaymentNote(intent, payment, product);
      await upsertFinanceRecord(intent, payment, product);
    }

    await recordWebhookEvent({ payload, paymentId, request, signature, processed: true });

    return sendJson(response, 200, {
      ok: true,
      processed: true,
      paymentId: String(payment.id),
      intentId: intent.id,
      status: payment.status,
      crmStatus: payment.status === "approved" ? product.approvedStatus : "Pago Pendiente",
    });
  } catch (error) {
    console.error("mercadopago-webhook error", {
      message: error.message,
      status: error.status,
      payload: error.payload,
    });

    await recordWebhookEvent({
      payload,
      paymentId,
      request,
      signature,
      processed: false,
      processingError: error.message || String(error),
    });

    return sendJson(response, error.status && error.status < 500 ? error.status : 500, {
      ok: false,
      error: "No se pudo procesar el webhook de Mercado Pago.",
      detail: error.message || String(error),
    });
  }
};
