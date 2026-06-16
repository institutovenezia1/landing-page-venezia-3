const reservationForm = document.querySelector("#reservationForm");
const formStatus = document.querySelector("#formStatus");

const reservationAmounts = {
  apartado_399: 399.99,
  inscripcion_999: 999.99,
};

function setFormStatus(message, tone = "info") {
  if (!formStatus) return;
  formStatus.hidden = false;
  formStatus.classList.toggle("is-error", tone === "error");
  formStatus.classList.toggle("is-loading", tone === "loading");
  formStatus.textContent = message;
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
    tipoReserva: String(formData.get("tipoReserva") || "apartado_399").trim(),
  };
}

function showPaymentReturnMessage() {
  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get("payment_status");

  if (!paymentStatus) return;

  const messages = {
    success: "Pago recibido. Estamos actualizando tu registro en Venezia One.",
    pending: "Tu pago quedo pendiente. Te contactaremos por WhatsApp para dar seguimiento.",
    failure: "El pago no se completo. Puedes intentar nuevamente o pedir apoyo por WhatsApp.",
  };

  setFormStatus(messages[paymentStatus] || "Recibimos tu regreso desde Mercado Pago.", paymentStatus === "failure" ? "error" : "info");
}

showPaymentReturnMessage();

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
