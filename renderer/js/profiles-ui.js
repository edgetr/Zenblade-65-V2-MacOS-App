import { $ } from "./dom.js";

export function createProfilesUi({
  model,
  onSelect,
  onRetry,
  connected,
  onAutomationChange,
  onChooseApplications,
  onExport,
  onImport,
  onError,
}) {
  const { state } = model;
  const rulesRoot = $("automationRules");
  let renderedRules = "";

  const commitAutomation = (partial) => {
    model.setAutomation(partial);
    sync();
    onAutomationChange?.();
  };

  function renderRules() {
    const nextRules = JSON.stringify(state.automation.rules);
    if (nextRules === renderedRules) return;
    renderedRules = nextRules;
    rulesRoot.replaceChildren();
    $("automationEmpty").hidden = state.automation.rules.length > 0;
    state.automation.rules.forEach((rule) => {
      const row = document.createElement("div");
      row.className = "automation-rule";
      row.dataset.bundleId = rule.bundleId;

      const appInfo = document.createElement("div");
      appInfo.className = "automation-rule__app";
      const name = document.createElement("strong");
      name.textContent = rule.name;
      const bundleId = document.createElement("small");
      bundleId.textContent = rule.bundleId;
      bundleId.className = "sr-only";
      appInfo.append(name, bundleId);

      const select = document.createElement("select");
      select.className = "select-input";
      select.dataset.action = "profile";
      select.setAttribute("aria-label", `${rule.name} profile`);
      [0, 1, 2].forEach((profile) => {
        const option = document.createElement("option");
        option.value = String(profile);
        option.textContent = `Profile ${profile + 1}`;
        option.selected = profile === rule.profile;
        select.append(option);
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn--ghost automation-rule__remove";
      remove.dataset.action = "remove";
      remove.setAttribute("aria-label", `Remove ${rule.name}`);
      remove.title = `Remove ${rule.name}`;
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>';

      row.append(appInfo, select, remove);
      rulesRoot.append(row);
    });
  }

  function sync() {
    $("statProfile").textContent = connected() ? `P${state.profile + 1}` : "—";
    document.querySelectorAll(".profile-card").forEach((el) => {
      const active = +el.dataset.profile === state.profile;
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-pressed", String(active));
    });
    const retry = $("btnRetrySync");
    if (retry) retry.hidden = !state.syncIncomplete;

    $("automationEnabled").checked = state.automation.enabled;
    $("automationRestoreDefault").checked = state.automation.restoreDefault;
    $("automationDefaultProfile").value = String(
      state.automation.defaultProfile,
    );
    $("automationDefaultProfile").disabled =
      !state.automation.restoreDefault;
    renderRules();
  }

  $("profileGrid").addEventListener("click", async (event) => {
    const card = event.target.closest(".profile-card");
    if (!card || +card.dataset.profile === state.profile) return;
    try {
      await onSelect(+card.dataset.profile);
    } catch {
      // Busy feedback is already shown by the device operation gate.
    }
  });

  $("btnRetrySync").addEventListener("click", () => {
    onRetry?.().catch(() => {});
  });

  $("btnExportProfile").addEventListener("click", () => {
    onExport?.().catch(onError);
  });

  $("btnImportProfile").addEventListener("click", () => {
    onImport?.().catch(onError);
  });

  $("automationEnabled").addEventListener("change", (event) => {
    commitAutomation({ enabled: event.target.checked });
    if (event.target.checked && !state.automation.enabled) {
      onError?.(new Error("Add an app rule or fallback first."));
    }
  });

  $("automationRestoreDefault").addEventListener("change", (event) => {
    commitAutomation({ restoreDefault: event.target.checked });
  });

  $("automationDefaultProfile").addEventListener("change", (event) => {
    commitAutomation({ defaultProfile: Number(event.target.value) });
  });

  $("btnAddApplications").addEventListener("click", async () => {
    try {
      const applications = await onChooseApplications?.();
      if (!applications?.length) return;
      const existing = new Set(
        state.automation.rules.map((rule) => rule.bundleId),
      );
      const additions = applications
        .filter((application) =>
          application?.bundleId && !existing.has(application.bundleId)
        )
        .map((application) => ({
          bundleId: application.bundleId,
          name: application.name || application.bundleId,
          profile: state.profile,
        }));
      if (!additions.length) return;
      commitAutomation({
        rules: [...state.automation.rules, ...additions],
      });
    } catch (error) {
      onError?.(error);
    }
  });

  rulesRoot.addEventListener("change", (event) => {
    if (event.target.dataset.action !== "profile") return;
    const row = event.target.closest(".automation-rule");
    commitAutomation({
      rules: state.automation.rules.map((rule) =>
        rule.bundleId === row?.dataset.bundleId
          ? { ...rule, profile: Number(event.target.value) }
          : rule
      ),
    });
  });

  rulesRoot.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="remove"]');
    if (!button) return;
    const row = button.closest(".automation-rule");
    commitAutomation({
      rules: state.automation.rules.filter(
        (rule) => rule.bundleId !== row?.dataset.bundleId,
      ),
    });
  });

  return { sync };
}
