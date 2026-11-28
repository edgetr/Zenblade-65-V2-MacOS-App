import { $ } from "./dom.js";
import { modeById } from "./lighting-modes.js";
import { baseWireColor } from "./preview.js";
import { rgbToCss } from "./color.js";
import { formatMm } from "./units.js";
import { PROFILE_COUNT } from "./protocol.js";

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// One-line summaries shown on each profile card.
export function profileSummary(profile, appCount = 0) {
  const lighting = profile.lighting;
  const actuation = profile.actuation;
  const overrides = Object.keys(profile.keyOverrides || {}).length;
  const light = lighting.isOn ? modeById(lighting.mode).name : "Lights off";
  const feel = `${formatMm(actuation.press)}${
    actuation.rapidTrigger ? " · Rapid Trigger" : ""
  }`;
  const extras = [
    overrides ? plural(overrides, "key override") : "",
    appCount ? plural(appCount, "app") : "",
  ].filter(Boolean).join(" · ");
  return { light, feel, extras };
}

export function createProfilesUi({
  model,
  onSelect,
  onCopy,
  onReset,
  onRunningApplications,
  onRetry,
  connected,
  onAutomationChange,
  onNamesChange,
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
        option.textContent = model.labelFor(profile);
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

  function renderCards() {
    const grid = $("profileGrid");
    if (grid.children.length !== PROFILE_COUNT) {
      grid.replaceChildren(...Array.from({ length: PROFILE_COUNT }, (_, index) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "profile-card";
        card.dataset.profile = String(index);
        card.innerHTML = '<span class="profile-card__slot"></span>' +
          '<strong class="profile-card__name"></strong>' +
          '<span class="profile-card__meta profile-card__light">' +
          '<i class="profile-card__dot" aria-hidden="true"></i><span></span></span>' +
          '<span class="profile-card__meta profile-card__feel"></span>' +
          '<span class="profile-card__meta profile-card__extras"></span>';
        return card;
      }));
    }
    [...grid.children].forEach((card, index) => {
      const profile = model.profileAt(index);
      const apps = state.automation.rules.filter((rule) => rule.profile === index).length;
      const summary = profileSummary(profile, apps);
      const active = index === state.profile;
      const name = model.labelFor(index);
      card.classList.toggle("is-active", active);
      card.setAttribute("aria-pressed", String(active));
      card.setAttribute("aria-label", `${name}, slot ${index + 1}. ${summary.light}, ${summary.feel}`);
      card.querySelector(".profile-card__slot").textContent = `P${index + 1}`;
      card.querySelector(".profile-card__name").textContent = name;
      card.querySelector(".profile-card__light span").textContent = summary.light;
      card.querySelector(".profile-card__dot").style.setProperty(
        "--dot",
        profile.lighting.isOn ? rgbToCss(baseWireColor(profile.lighting)) : "transparent",
      );
      card.querySelector(".profile-card__feel").textContent = summary.feel;
      card.querySelector(".profile-card__extras").textContent = summary.extras;
    });
  }

  // Profile names appear in every profile picker on the page.
  function syncProfileOptions(select, exclude = null) {
    const wanted = Array.from({ length: PROFILE_COUNT }, (_, index) => index)
      .filter((index) => index !== exclude);
    const value = select.value;
    if (select.options.length !== wanted.length ||
      wanted.some((index, i) => select.options[i].value !== String(index))) {
      select.replaceChildren(...wanted.map((index) => {
        const option = document.createElement("option");
        option.value = String(index);
        return option;
      }));
    }
    wanted.forEach((index, i) => {
      const label = model.labelFor(index);
      if (select.options[i].textContent !== label) select.options[i].textContent = label;
    });
    if ([...select.options].some((option) => option.value === value)) select.value = value;
  }

  let syncedProfile = state.profile;
  function sync() {
    if (syncedProfile !== state.profile) {
      syncedProfile = state.profile;
      disarm($("btnCopyProfile"));
      disarm($("btnResetProfile"));
    }
    $("statProfile").textContent = state.name
      ? `P${state.profile + 1} · ${state.name}`
      : `P${state.profile + 1}`;
    renderCards();
    if (document.activeElement !== $("profileName")) {
      $("profileName").value = state.name || "";
    }
    $("profileName").placeholder = `Profile ${state.profile + 1}`;
    syncProfileOptions($("profileCopyTarget"), state.profile);
    syncProfileOptions($("automationDefaultProfile"));
    rulesRoot.querySelectorAll('select[data-action="profile"]').forEach((select) =>
      syncProfileOptions(select)
    );
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

  $("btnAddApplications").addEventListener("click", () => {
    if (picker.hidden) openPicker();
    else closePicker();
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

  $("profileName").addEventListener("input", (event) => {
    model.renameProfile(state.profile, event.target.value);
    sync();
    onNamesChange?.();
  });
  $("profileName").addEventListener("change", (event) => {
    event.target.value = state.name;
  });

  // Destructive actions arm on the first click and run on the second. The
  // armed choice is captured, and any change to it disarms the button.
  const armed = new Map();
  const disarm = (button) => {
    const entry = armed.get(button);
    if (!entry) return;
    clearTimeout(entry.timer);
    armed.delete(button);
    button.textContent = entry.original;
  };
  const confirmTwice = (button, capture, label, run) => {
    button.addEventListener("click", () => {
      const choice = capture();
      const entry = armed.get(button);
      if (!entry || entry.choice !== choice) {
        disarm(button);
        const original = button.textContent;
        button.textContent = label(choice);
        armed.set(button, {
          choice,
          original,
          timer: setTimeout(() => disarm(button), 3000),
        });
        return;
      }
      disarm(button);
      Promise.resolve(run(choice)).catch(onError);
    });
  };
  const copyChoice = () => `${state.profile}>${$("profileCopyTarget").value}`;
  confirmTwice(
    $("btnCopyProfile"),
    copyChoice,
    () => `Replace ${model.labelFor(Number($("profileCopyTarget").value))}?`,
    (choice) => onCopy?.(Number(choice.split(">")[1])),
  );
  confirmTwice(
    $("btnResetProfile"),
    () => String(state.profile),
    () => `Reset ${model.labelFor(state.profile)}?`,
    () => onReset?.(),
  );
  $("profileCopyTarget").addEventListener("change", () => disarm($("btnCopyProfile")));

  const picker = $("appPicker");
  const closePicker = () => {
    pickerRequest++;
    picker.hidden = true;
    $("btnAddApplications").setAttribute("aria-expanded", "false");
  };
  const addApplications = (applications) => {
    const existing = new Set(state.automation.rules.map((rule) => rule.bundleId));
    const additions = (applications || [])
      .filter((application) => application?.bundleId && !existing.has(application.bundleId))
      .map((application) => ({
        bundleId: application.bundleId,
        name: application.name || application.bundleId,
        profile: state.profile,
      }));
    if (!additions.length) return;
    commitAutomation({ rules: [...state.automation.rules, ...additions] });
  };
  let pickerRequest = 0;
  async function openPicker() {
    const request = ++pickerRequest;
    const list = $("appPickerList");
    list.replaceChildren();
    picker.hidden = false;
    $("btnAddApplications").setAttribute("aria-expanded", "true");
    let running = [];
    try {
      running = await onRunningApplications?.() || [];
    } catch {
      running = [];
    }
    // The picker may have closed or reopened while the list loaded.
    if (request !== pickerRequest || picker.hidden) return;
    list.replaceChildren();
    const existing = new Set(state.automation.rules.map((rule) => rule.bundleId));
    const available = running.filter((application) => !existing.has(application.bundleId));
    if (!available.length) {
      const empty = document.createElement("p");
      empty.className = "app-picker__empty";
      empty.textContent = running.length ? "Every running app already has a rule." : "No other apps are running.";
      list.append(empty);
    }
    available.forEach((application) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "app-picker__item";
      button.textContent = application.name;
      button.title = application.bundleId;
      button.addEventListener("click", () => {
        addApplications([application]);
        closePicker();
        $("btnAddApplications").focus();
      });
      list.append(button);
    });
    (list.querySelector("button") || $("btnBrowseApplications")).focus();
  }
  picker.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePicker();
      $("btnAddApplications").focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!picker.hidden && !picker.contains(event.target) &&
      !$("btnAddApplications").contains(event.target)) closePicker();
  });
  $("btnBrowseApplications").addEventListener("click", async () => {
    closePicker();
    try {
      addApplications(await onChooseApplications?.());
    } catch (error) {
      onError?.(error);
    }
  });
  document.addEventListener("zen:panel", (event) => {
    if (event.detail === "profiles") sync();
    else closePicker();
  });

  return { sync };
}
