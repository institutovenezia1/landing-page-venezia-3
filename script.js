const reservationForm = document.querySelector("#reservationForm");
const formStatus = document.querySelector("#formStatus");
const courseSelect = reservationForm?.querySelector('select[name="curso"]');
const preferredScheduleSelect = reservationForm?.querySelector("#preferredSchedule");
const metaEventStoragePrefix = "venezia_meta_pixel_event";

const reservationAmounts = {
  apartado_399: 399.99,
  inscripcion_999: 999.99,
};

const courseSchedules = {
  unas_acrilicas: [
    "Viernes 9am a 1pm",
    "Sábado 2pm a 6pm",
    "Domingo 9am a 1pm",
  ],
  barberia: [
    "Viernes 9am a 1pm",
    "Sábado 9am a 1pm",
    "Sábado 1pm a 5pm",
  ],
};

function setFormStatus(message, tone = "info") {
  if (!formStatus) return;
  formStatus.hidden = false;
  formStatus.classList.toggle("is-error", tone === "error");
  formStatus.classList.toggle("is-loading", tone === "loading");
  formStatus.textContent = message;
}

function trackMetaEventOnce(eventName, eventId, parameters = {}) {
  if (typeof window.fbq !== "function") return false;

  const normalizedEventId = String(eventId || `${eventName}:${window.location.pathname}:${window.location.search}`);
  const storageKey = `${metaEventStoragePrefix}:${eventName}:${normalizedEventId}`;

  try {
    if (window.sessionStorage.getItem(storageKey)) return false;
    window.sessionStorage.setItem(storageKey, "1");
  } catch (error) {
    // Continue without storage when the browser blocks sessionStorage.
  }

  if (normalizedEventId) {
    window.fbq("track", eventName, parameters, { eventID: normalizedEventId });
  } else {
    window.fbq("track", eventName, parameters);
  }

  return true;
}

function setSchedulePlaceholder(message) {
  if (!preferredScheduleSelect) return;

  preferredScheduleSelect.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = message;
  preferredScheduleSelect.append(option);
}

function updatePreferredScheduleOptions() {
  if (!courseSelect || !preferredScheduleSelect) return;

  const schedules = courseSchedules[courseSelect.value] || [];
  setSchedulePlaceholder(schedules.length ? "Selecciona un horario" : "Selecciona primero un curso");
  preferredScheduleSelect.disabled = schedules.length === 0;

  for (const schedule of schedules) {
    const option = document.createElement("option");
    option.value = schedule;
    option.textContent = schedule;
    preferredScheduleSelect.append(option);
  }
}

function getSelectedReservationAmount(formData) {
  const selectedReservation = String(formData.get("tipoReserva") || "apartado_399");
  return reservationAmounts[selectedReservation] || 399.99;
}

function getProspectPayload(formData) {
  return {
    nombre: String(formData.get("nombre") || "").trim(),
    whatsapp: String(formData.get("whatsapp") || "").trim(),
    curso: String(formData.get("curso") || "").trim(),
    horarioPreferido: String(formData.get("horarioPreferido") || "").trim(),
    tipoReserva: String(formData.get("tipoReserva") || "apartado_399").trim(),
  };
}

function showPaymentReturnMessage() {
  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get("payment_status");
  const intentId = params.get("intent_id");

  if (!paymentStatus) return;

  const messages = {
    success: "Pago recibido. Estamos actualizando tu registro en Venezia One.",
    pending: "Tu pago quedo pendiente. Te contactaremos por WhatsApp para dar seguimiento.",
    failure: "El pago no se completo. Puedes intentar nuevamente o pedir apoyo por WhatsApp.",
  };

  setFormStatus(messages[paymentStatus] || "Recibimos tu regreso desde Mercado Pago.", paymentStatus === "failure" ? "error" : "info");

  if (paymentStatus === "success") {
    trackMetaEventOnce("Purchase", `purchase:${intentId || window.location.href}`, {
      currency: "MXN",
    });
  }
}

showPaymentReturnMessage();
updatePreferredScheduleOptions();
courseSelect?.addEventListener("change", updatePreferredScheduleOptions);

reservationForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(reservationForm);
  const amount = getSelectedReservationAmount(formData);
  const submitButton = reservationForm.querySelector('button[type="submit"]');
  const originalButtonText = submitButton?.textContent || "";

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "CREANDO CHECKOUT...";
  }

  setFormStatus(`Estamos registrando tu solicitud y preparando Mercado Pago por $${amount}.`, "loading");

  try {
    const response = await fetch("/api/create-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(getProspectPayload(formData)),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.checkoutUrl) {
      throw new Error(result.detail || result.error || "No se pudo crear el checkout.");
    }

    setFormStatus("Listo. Te llevamos a Mercado Pago para finalizar tu reserva.", "loading");
    const checkoutEventId = result.intentId || result.preferenceId || result.checkoutUrl;
    trackMetaEventOnce("InitiateCheckout", `initiate_checkout:${checkoutEventId}`, {
      value: amount,
      currency: "MXN",
      content_name: String(formData.get("tipoReserva") || "apartado_399"),
    });
    window.location.assign(result.checkoutUrl);
  } catch (error) {
    setFormStatus(
      `${error.message || "No se pudo preparar Mercado Pago."} Intenta nuevamente o solicita apoyo por WhatsApp.`,
      "error"
    );
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  }
});
