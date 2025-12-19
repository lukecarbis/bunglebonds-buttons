import OBR from "@owlbear-rodeo/sdk";

const status = document.getElementById("status") as HTMLParagraphElement;
const out = document.getElementById("out") as HTMLPreElement;
const ping = document.getElementById("ping") as HTMLButtonElement;

const NS = "com.example.bunglebonds-buttons";

function log(obj: unknown) {
  out.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

let wired = false;

function applyThemeToCssVars(theme: Awaited<ReturnType<typeof OBR.theme.getTheme>>) {
  const r = document.documentElement.style;

  r.setProperty("--obr-mode", theme.mode);
  r.setProperty("--obr-primary", theme.primary.main);
  r.setProperty("--obr-primary-contrast", theme.primary.contrastText);
  r.setProperty("--obr-secondary", theme.secondary.main);

  r.setProperty("--obr-bg", theme.background.default);
  r.setProperty("--obr-surface", theme.background.paper);

  r.setProperty("--obr-text", theme.text.primary);
  r.setProperty("--obr-text-muted", theme.text.secondary);
  r.setProperty("--obr-text-disabled", theme.text.disabled);
}

function start() {
  const timeout = window.setTimeout(() => {
    status.textContent = "Loaded, but not inside Owlbear Rodeo.";
  }, 2000);

  OBR.onReady(async () => {
    window.clearTimeout(timeout);

    applyThemeToCssVars(await OBR.theme.getTheme());
    OBR.theme.onChange(applyThemeToCssVars);

    await OBR.tool.create({
      id: `${NS}.tool`,
      shortcut: "Shift+B",
      icons: [
        { icon: "icon.svg", label: "Bunglebond's Buttons" },
      ],
    });

    const role = await OBR.player.getRole();
    status.textContent = `Ready (role: ${role})`;

    OBR.player.onChange((player) => {
      log({ selection: player.selection ?? [] });
    });

    if (!wired) {
      wired = true;
      ping.onclick = async () => {
        const ids = await OBR.player.getSelection();
        if (!ids || ids.length === 0) return log("No items selected.");
        const items = await OBR.scene.items.getItems(ids);
        log({ selectedItems: items.map((i) => ({ id: i.id, name: i.name, type: i.type })) });
      };
    }
  });
}

start();