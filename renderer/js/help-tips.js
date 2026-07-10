export function initHelpTips() {
  const pop = document.getElementById("helpPop");
  if (!pop) return;

  let current = null;
  let positionFrame = 0;
  const hide = () => {
    if (positionFrame) cancelAnimationFrame(positionFrame);
    positionFrame = 0;
    current?.removeAttribute("aria-describedby");
    current = null;
    pop.hidden = true;
  };
  const show = (button) => {
    const text = button?.dataset.help;
    if (!text) return;
    if (positionFrame) cancelAnimationFrame(positionFrame);
    current?.removeAttribute("aria-describedby");
    current = button;
    button.setAttribute("aria-describedby", pop.id || "helpPop");
    pop.textContent = text;
    pop.hidden = false;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      // A pointer/focus transition may have hidden or replaced the tip while
      // the frame was pending. Never revive an old popup.
      if (current !== button || pop.hidden) return;
      const r = button.getBoundingClientRect();
      const pad = 10;
      const width = Math.min(280, innerWidth - pad * 2);
      pop.style.width = `${width}px`;
      const p = pop.getBoundingClientRect();
      pop.style.left = `${Math.max(pad, Math.min(r.left + r.width / 2 - p.width / 2, innerWidth - p.width - pad))}px`;
      pop.style.top = `${Math.max(pad, r.bottom + 8 + p.height > innerHeight - pad ? r.top - p.height - 8 : r.bottom + 8)}px`;
    });
  };

  document.addEventListener("pointerover", (event) => {
    const button = event.target.closest?.(".help-tip");
    if (button && current !== button) show(button);
  }, true);
  document.addEventListener("pointerout", (event) => {
    const button = event.target.closest?.(".help-tip");
    if (button === current && !button.contains(event.relatedTarget)) hide();
  }, true);
  document.addEventListener("focusin", (event) => {
    const button = event.target.closest?.(".help-tip");
    if (button) show(button);
  });
  document.addEventListener("focusout", (event) => {
    if (event.target === current) hide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  addEventListener("resize", hide);
  document.addEventListener("scroll", hide, true);
}
