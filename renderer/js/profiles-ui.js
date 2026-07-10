import { $ } from "./dom.js";

export function createProfilesUi({ model, onSelect, onRetry, connected }) {
  const { state } = model;

  function sync() {
    $("statProfile").textContent = connected() ? `P${state.profile + 1}` : "—";
    document.querySelectorAll(".profile-card").forEach((el) => {
      const active = +el.dataset.profile === state.profile;
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-pressed", String(active));
    });
    const retry = $("btnRetrySync");
    if (retry) retry.hidden = !state.syncIncomplete;
  }

  $("profileGrid").addEventListener("click", async (e) => {
    const card = e.target.closest(".profile-card");
    if (!card || +card.dataset.profile === state.profile) return;
    try {
      await onSelect(+card.dataset.profile);
    } catch {
      // busy feedback already shown
    }
  });

  $("btnRetrySync").addEventListener("click", () => {
    onRetry?.().catch(() => {});
  });

  return { sync };
}
