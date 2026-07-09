export function createProfilesUi({ model, onSelect, connected }) {
  const { state } = model, $ = (id) => document.getElementById(id);
  function sync() {
    $("statProfile").textContent = connected() ? `P${state.profile + 1}` : "—";
    document.querySelectorAll(".profile-card").forEach((el) =>
      {
        const active = +el.dataset.profile === state.profile;
        el.classList.toggle("is-active", active);
        el.setAttribute("aria-pressed", String(active));
      }
    );
  }
  $("profileGrid").addEventListener("click", async (e) => {
    const card = e.target.closest(".profile-card");
    if (!card || +card.dataset.profile === state.profile) return;
    try {
      await onSelect(+card.dataset.profile);
    } catch (_) {
      // DeviceOperationGate already gives the user actionable busy feedback.
    }
  });
  return { sync };
}
