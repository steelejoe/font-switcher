(() => {
  const checkbox = document.getElementById("optShowStack");
  const savedLine = document.getElementById("optionsSaved");

  let saveTimer = 0;
  function flashSaved() {
    savedLine.textContent = "Saved.";
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      savedLine.textContent = "";
      saveTimer = 0;
    }, 1600);
  }

  FontSwitcherSettings.load().then((s) => {
    checkbox.checked = s.showComputedStack;
  });

  checkbox.addEventListener("change", async () => {
    await FontSwitcherSettings.save({ showComputedStack: checkbox.checked });
    flashSaved();
  });
})();
