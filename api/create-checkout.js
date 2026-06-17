const crypto = require("node:crypto");

const {
  LANDING_SOURCE,
  buildProspectRecord,
  getMissingConfig,
  getRequiredEnv,
  getReservationProduct,
  insertProspect,
  insertSupabaseRecord,
  readJsonBody,
  selectSupabaseRecords,
  sendJson,
  updateSupabaseRecords,
  validateProspectPayload,
} = require("./_lib/prospect-flow");

const MERCADOPAGO_API_BASE = "https://api.mercadopago.com";

function getMissingCheckoutConfig() {
  const missing = getMissingConfig();
  if (!getRequiredEnv("MERCADOPAGO_ACCESS_TOKEN")) missing.push("MERCADOPAGO_ACCESS_TOKEN");
  return missing;
}

function getHeader(request, name) {
  return request.headers[name] || request.headers[name.toLowerCase()];
}

function getRequestBaseUrl(request) {
  const configuredBaseUrl = getRequiredEnv("LANDING_BASE_URL");
  if (configuredBaseUrl) return configuredBaseUrl.replace(/\/$/, "");

  const host = getHeader(request, "x-forwarded-host") || getHeader(request, "host") || "localhost:5173";
  const protocol =
    getHeader(request, "x-forwarded-proto") || (String(host).includes("localhost") ? "http" : "https");

  return `${protocol}://${host}`.replace(/\/$/, "");
}

function buildReturnUrl(baseUrl, status, intentId) {
  const url = new URL(baseUrl);
  url.searchParams.set("payment_status", status);
  url.searchParams.set("intent_id", intentId);
  return url.toString();
}

function getWebhookUrl(baseUrl) {
  const configuredWebhookUrl = getRequiredEnv("MERCADOPAGO_WEBHOOK_URL");
  return configuredWebhookUrl || `${baseUrl}/api/mercadopago-webhook`;
}

async function assertPaymentTablesReady() {
  try {
    await selectSupabaseRecords("landing_payment_intents", "select=id&limit=1");
  } catch (error) {
    const code = error.payload && error.payload.code;
    if (error.status === 404 || code === "PGRST205") {
      const tableError = new Error(
        "Falta crear la tabla landing_payment_intents en Supabase antes de activar Mercado Pago."
      );
      tableError.status = 500;
      tableError.code = "PAYMENT_TABLES_MISSING";
      tableError.detail = error.message;
      throw tableError;
    }

    throw error;
  }
}

function buildPaymentIntentRecord({ intentId, prospect, formData, product }) {
  const now = new Date().toISOString();

  return {
    id: intentId,
    prospect_id: prospect.id,
    preference_id: "",
    payment_id: "",
    status: "intent_created",
    payment_status: "",
    payment_status_detail: "",
    reservation_type_key: formData.tipoReservaKey,
    reservation_type_label: product.label,
    course_key: formData.cursoKey,
    course_label: formData.courseLabel,
    amount: product.amount,
    currency: product.currency,
    checkout_url: "",
    metadata: {
      source: LANDING_SOURCE,
      prospect_id: prospect.id,
      intent_id: intentId,
      reservation_type: product.label,
      course: formData.courseLabel,
      customer_name: formData.nombre,
      customer_phone: formData.whatsapp,
    },
    raw_preference: {},
    raw_payment: {},
    created_at: now,
    updated_at: now,
    approved_at: null,
  };
}

function buildPreferencePayload({ baseUrl, formData, intentId, prospect, product }) {
  return {
    items: [
      {
        id: product.key,
        title: product.title,
        description: `${formData.courseLabel} - ${product.label}`,
        category_id: "education",
        quantity: 1,
        currency_id: product.currency,
        unit_price: product.amount,
      },
    ],
    payer: {
      name: formData.nombre,
      phone: {
        number: formData.whatsapp,
      },
    },
    back_urls: {
      success: buildReturnUrl(baseUrl, "success", intentId),
      pending: buildReturnUrl(baseUrl, "pending", intentId),
      failure: buildReturnUrl(baseUrl, "failure", intentId),
    },
    auto_return: "approved",
    notification_url: getWebhookUrl(baseUrl),
    external_reference: intentId,
    statement_descriptor: "VENEZIA",
    metadata: {
      source: "landing_venezia_3",
      prospect_id: prospect.id,
      intent_id: intentId,
      course_key: formData.cursoKey,
      course_label: formData.courseLabel,
      reservation_type_key: formData.tipoReservaKey,
      reservation_type_label: product.label,
    },
  };
}

async function createMercadoPagoPreference(preferencePayload, intentId) {
  const response = await fetch(`${MERCADOPAGO_API_BASE}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getRequiredEnv("MERCADOPAGO_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": intentId,
    },
    body: JSON.stringify(preferencePayload),
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
      `Mercado Pago request failed with ${response.status}`;
    const error = new Error(typeof message === "string" ? message : JSON.stringify(message));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function getCheckoutUrl(preference) {
  const accessToken = getRequiredEnv("MERCADOPAGO_ACCESS_TOKEN");
  const forceSandbox = getRequiredEnv("MERCADOPAGO_USE_SANDBOX") === "true";

  if (forceSandbox || accessToken.startsWith("TEST-")) {
    return preference.sandbox_init_point || preference.init_point;
  }

  return preference.init_point || preference.sandbox_init_point;
}

module.exports = async function createCheckout(request, response) {
  if (request.method === "OPTIONS") {
    return sendJson(response, 200, { ok: true });
  }

  if (request.method !== "POST") {
    return sendJson(response, 405, { ok: false, error: "Metodo no permitido." });
  }

  const missingConfig = getMissingCheckoutConfig();
  if (missingConfig.length > 0) {
    return sendJson(response, 500, {
      ok: false,
      error: "Faltan variables para crear el checkout de Mercado Pago.",
      missingConfig,
    });
  }

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    return sendJson(response, 400, { ok: false, error: "JSON invalido." });
  }

  const validation = validateProspectPayload(payload);
  if (!validation.ok) {
    return sendJson(response, 422, {
      ok: false,
      error: "Revisa los datos del formulario.",
      details: validation.errors,
    });
  }

  try {
    await assertPaymentTablesReady();

    const formData = validation.data;
    const product = getReservationProduct(formData.tipoReservaKey);
    const baseUrl = getRequestBaseUrl(request);
    const prospect = await insertProspect(buildProspectRecord(formData));
    const prospectId = prospect.id;

    if (!prospectId) {
      const prospectIdError = new Error("No se pudo obtener prospect_id despues de crear el prospecto.");
      prospectIdError.status = 500;
      prospectIdError.code = "PROSPECT_ID_MISSING";
      prospectIdError.payload = { prospect };
      throw prospectIdError;
    }

    const intentId = crypto.randomUUID();
    const paymentIntent = await insertSupabaseRecord(
      "landing_payment_intents",
      buildPaymentIntentRecord({ intentId, prospect, formData, product })
    );
    const preferencePayload = buildPreferencePayload({
      baseUrl,
      formData,
      intentId,
      prospect,
      product,
    });
    const preference = await createMercadoPagoPreference(preferencePayload, intentId);
    const checkoutUrl = getCheckoutUrl(preference);

    if (!checkoutUrl) {
      throw new Error("Mercado Pago no regreso una URL de checkout.");
    }

    await updateSupabaseRecords(
      "landing_payment_intents",
      `id=eq.${encodeURIComponent(paymentIntent.id)}`,
      {
        preference_id: preference.id || "",
        checkout_url: checkoutUrl,
        status: "checkout_created",
        raw_preference: preference,
        updated_at: new Date().toISOString(),
      }
    );

    return sendJson(response, 200, {
      ok: true,
      prospectId: prospect.id,
      intentId,
      preferenceId: preference.id,
      checkoutUrl,
      amount: product.amount,
      currency: product.currency,
      status: "checkout_created",
      returnUrls: preferencePayload.back_urls,
      webhookUrl: preferencePayload.notification_url,
    });
  } catch (error) {
    console.error("create-checkout error", {
      message: error.message,
      status: error.status,
      code: error.code,
      payload: error.payload,
    });

    return sendJson(response, error.status && error.status < 500 ? error.status : 500, {
      ok: false,
      error: "No se pudo crear el checkout de Mercado Pago.",
      code: error.code,
      detail: error.message || String(error),
    });
  }
};
