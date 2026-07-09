export function initHelpTips() {
  const pop = document.getElementById("helpPop");
  if (!pop) return;
  let current = null, pinned = null, hideTimer = 0;
  const hide = () => {
    current?.removeAttribute("aria-describedby");
    current = null;
    pinned = null;
    pop.hidden = true;
  };
  const show = (button) => {
    const text = button.dataset.help;
    if (!text) return;
    current = button;
    if (!pop.id) pop.id = "helpPop";
    button.setAttribute("aria-describedby", pop.id);
    pop.textContent = text;
    pop.hidden = false;
    const r = button.getBoundingClientRect(), pad = 10;
    const width = Math.min(280, innerWidth - pad * 2);
    pop.style.width = `${width}px`;
    requestAnimationFrame(() => {
      const p = pop.getBoundingClientRect();
      pop.style.left = `${
        Math.max(
          pad,
          Math.min(
            r.left + r.width / 2 - p.width / 2,
            innerWidth - p.width - pad,
          ),
        )
      }px`;
      pop.style.top = `${
        Math.max(
          pad,
          r.bottom + 8 + p.height > innerHeight - pad
            ? r.top - p.height - 8
            : r.bottom + 8,
        )
      }px`;
    });
  };
  document.addEventListener("pointerover", (e) => {
    const b = e.target.closest?.(".help-tip");
    if (b) {
      clearTimeout(hideTimer);
      show(b);
    }
  }, true);
  document.addEventListener("pointerout", (e) => {
    const b = e.target.closest?.(".help-tip");
    if (b && !pop.contains(e.relatedTarget)) hideTimer = setTimeout(hide, 120);
  }, true);
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".help-tip");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    // Hover may have already opened this popup; only a prior click pins it.
    if (pinned === b) hide();
    else {
      pinned = b;
      show(b);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  document.addEventListener("focusin", (e) => {
    const b = e.target.closest?.(".help-tip");
    if (b) show(b);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target === current) hideTimer = setTimeout(hide, 120);
  });
  addEventListener("resize", hide);
  document.addEventListener("scroll", hide, true);
}
