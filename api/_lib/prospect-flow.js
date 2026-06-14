const crypto = require("node:crypto");

const LANDING_SOURCE = "Landing Venezia 3.0";
const DEFAULT_BRANCH = "Tlaxcala";
const DEFAULT_ACCESS_INTEREST = "Beca Venezia";

const COURSES = {
  unas_acrilicas: "Uñas Acrílicas Profesionales",
  barberia: "Corte y Barbería Profesional",
};

const RESERVATION_TYPES = {
  apartado_399: "Apartado $399",
  inscripcion_999: "Inscripción Completa $999",
};

const PAYMENT_PRODUCTS = {
  apartado_399: {
    key: "apartado_399",
    title: "Apartado Venezia 3.0",
    label: RESERVATION_TYPES.apartado_399,
    amount: 399,
    currency: "MXN",
    approvedStatus: "Apartado Pagado",
    financeCategory: "Apartado",
  },
  inscripcion_999: {
    key: "inscripcion_999",
    title: "Inscripción completa Venezia 3.0",
    label: RESERVATION_TYPES.inscripcion_999,
    amount: 999,
    currency: "MXN",
    approvedStatus: "Inscripción Pagada",
    financeCategory: "Inscripción",
  },
};

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePhone(value) {
  return normalizeText(value).replace(/\D/g, "");
}

function createProspectId() {
  return crypto.randomUUID();
}

function getMexicoDateParts(baseDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(baseDate).reduce((accumulator, part) => {
    accumulator[part.type] = part.value;
    return accumulator;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    value: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function todayInMexico() {
  return getMexicoDateParts().value;
}

function addDaysToDate(dateValue, days) {
  const [year, month, day] = String(dateValue).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return getMexicoDateParts(date).value;
}

function getRequiredEnv(name) {
  return normalizeText(process.env[name]);
}

function getSupabaseKey() {
  return getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY") || getRequiredEnv("SUPABASE_ANON_KEY");
}

function getMissingConfig() {
  const missing = [];
  if (!getRequiredEnv("SUPABASE_URL")) missing.push("SUPABASE_URL");
  if (!getSupabaseKey()) missing.push("SUPABASE_SERVICE_ROLE_KEY o SUPABASE_ANON_KEY");
  return missing;
}

function getSupabaseBaseUrl() {
  return getRequiredEnv("SUPABASE_URL").replace(/\/$/, "");
}

function getSupabaseHeaders(extraHeaders = {}) {
  const supabaseKey = getSupabaseKey();
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  if (typeof request.body === "string") {
    return request.body ? JSON.parse(request.body) : {};
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function validateProspectPayload(payload) {
  const nombre = normalizeText(payload.nombre);
  const whatsapp = normalizePhone(payload.whatsapp);
  const cursoKey = normalizeText(payload.curso);
  const tipoReservaKey = normalizeText(payload.tipoReserva || "apartado_399");
  const courseLabel = COURSES[cursoKey];
  const tipoReservaLabel = RESERVATION_TYPES[tipoReservaKey];
  const errors = [];

  if (nombre.length < 2) errors.push("Nombre requerido.");
  if (whatsapp.length < 10) errors.push("WhatsApp requerido.");
  if (!courseLabel) errors.push("Curso no valido.");
  if (!tipoReservaLabel) errors.push("Tipo de reserva no valido.");

  return {
    ok: errors.length === 0,
    errors,
    data: {
      nombre,
      whatsapp,
      cursoKey,
      courseLabel,
      tipoReservaKey,
      tipoReservaLabel,
    },
  };
}

function buildLandingNotes({ courseLabel, tipoReservaLabel, followupDate }) {
  return [
    `Lead captado desde ${LANDING_SOURCE}.`,
    `Fuente: ${LANDING_SOURCE}`,
    `Curso: ${courseLabel}`,
    `TipoReserva: ${tipoReservaLabel}`,
    "Estado: Pago Pendiente",
    `Acceso de interés: ${DEFAULT_ACCESS_INTEREST}`,
    `Próximo seguimiento: ${followupDate}`,
  ].join(" | ");
}

function buildProspectRecord(formData) {
  const contactDate = todayInMexico();
  const followupDate = addDaysToDate(contactDate, 3);

  return {
    id: createProspectId(),
    full_name: formData.nombre,
    phone: formData.whatsapp,
    contact_date: contactDate,
    branch_interest: DEFAULT_BRANCH,
    course_interest: formData.courseLabel,
    origin: LANDING_SOURCE,
    contact_channel: "WhatsApp",
    info_status: "Pendiente de enviar",
    prospect_status: "Pago Pendiente",
    request_type: formData.tipoReservaLabel,
    access_interest: DEFAULT_ACCESS_INTEREST,
    enrolled_by: "Pendiente",
    appointment_time: "",
    suggested_time: "",
    notes: buildLandingNotes({
      courseLabel: formData.courseLabel,
      tipoReservaLabel: formData.tipoReservaLabel,
      followupDate,
    }),
    created_at: new Date().toISOString(),
  };
}

function parseSupabasePayload(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function normalizeSingleRecord(payload) {
  return payload;
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${getSupabaseBaseUrl()}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: getSupabaseHeaders(options.headers),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const payload = parseSupabasePayload(text);

  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && (payload.message || payload.details || payload.hint)) ||
      `Supabase request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function insertSupabaseRecord(table, record) {
  return normalizeSingleRecord(
    await supabaseRequest(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: record,
    })
  );
}

async function updateSupabaseRecords(table, query, record) {
  return supabaseRequest(`${table}?${query}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: record,
  });
}

async function selectSupabaseRecords(table, query) {
  const payload = await supabaseRequest(`${table}?${query}`);
  return Array.isArray(payload) ? payload : [];
}

async function insertProspect(record) {
  return insertSupabaseRecord("prospects", record);
}

function getReservationProduct(tipoReservaKey) {
  return PAYMENT_PRODUCTS[tipoReservaKey] || PAYMENT_PRODUCTS.apartado_399;
}

module.exports = {
  COURSES,
  DEFAULT_ACCESS_INTEREST,
  DEFAULT_BRANCH,
  LANDING_SOURCE,
  PAYMENT_PRODUCTS,
  RESERVATION_TYPES,
  buildProspectRecord,
  getMissingConfig,
  getRequiredEnv,
  getReservationProduct,
  insertProspect,
  insertSupabaseRecord,
  normalizeText,
  readJsonBody,
  selectSupabaseRecords,
  sendJson,
  supabaseRequest,
  todayInMexico,
  updateSupabaseRecords,
  validateProspectPayload,
};
