const reservationForm = document.querySelector("#reservationForm");
const formStatus = document.querySelector("#formStatus");

const reservationAmounts = {
  apartado_399: 399,
  inscripcion_999: 999,
};

reservationForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(reservationForm);
  const selectedReservation = String(formData.get("tipoReserva") || "apartado_399");
  const amount = reservationAmounts[selectedReservation] || 399;

  formStatus.hidden = false;
  formStatus.textContent = `Listo. Recibimos tu solicitud para reservar con $${amount}. Un asesor te contactará para confirmar disponibilidad.`;
  reservationForm.reset();
});
