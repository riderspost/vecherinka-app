// Two big buttons, male and female. The chosen one is lifted and lit in its
// own colour. Nothing is chosen until the person taps (the game needs to
// know, so the form refuses to go on without it). Used wherever a Fanty
// player is created: the setup wizard, the join form and "add a player".
const OPTIONS = [
  { value: "m", sign: "♂", label: "Мужской", cls: "male" },
  { value: "f", sign: "♀", label: "Женский", cls: "female" },
];

export function createGenderPicker(initial) {
  let value = initial || null;
  const wrap = document.createElement("div");
  wrap.className = "gender-picker";
  wrap.setAttribute("role", "radiogroup");

  function draw() {
    wrap.innerHTML = "";
    OPTIONS.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `gender-btn ${opt.cls}`;
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(value === opt.value));
      btn.innerHTML = `<em aria-hidden="true">${opt.sign}</em><span>${opt.label}</span>`;
      btn.addEventListener("click", () => {
        value = opt.value;
        draw();
      });
      wrap.appendChild(btn);
    });
  }
  draw();

  return { element: wrap, getValue: () => value };
}
