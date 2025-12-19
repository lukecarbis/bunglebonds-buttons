import OBR from "@owlbear-rodeo/sdk";

const status = document.getElementById("status") as HTMLParagraphElement;
const out = document.getElementById("out") as HTMLPreElement;
const ping = document.getElementById("ping") as HTMLButtonElement;

const NS = "com.example.bunglebonds-buttons";

function log(obj: unknown) {
  out.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

let wired = false;

function start() {
  const timeout = window.setTimeout(() => {
    status.textContent = "Loaded, but not inside Owlbear Rodeo.";
  }, 2000);

  OBR.onReady(async () => {
    window.clearTimeout(timeout);

    await OBR.tool.create({
      id: `${NS}.tool`,
      name: "Bunglebond's Buttons",
      shortcut: "Shift+B",
      icons: {
        24: "icon.svg",
      },
    });

    const role = await OBR.player.getRole();
    status.textContent = `Ready (role: ${role})`;

    OBR.player.onSelectionChange((ids) => log({ selection: ids }));

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