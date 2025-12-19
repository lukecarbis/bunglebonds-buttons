import OBR from "@owlbear-rodeo/sdk";

const status = document.getElementById("status") as HTMLParagraphElement;
const out = document.getElementById("out") as HTMLPreElement;
const ping = document.getElementById("ping") as HTMLButtonElement;

function log(obj: unknown) {
  out.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

function start() {
  const timeout = window.setTimeout(() => {
    status.textContent = "Loaded, but not inside Owlbear Rodeo.";
  }, 2000);

  OBR.onReady(async () => {
    window.clearTimeout(timeout);

    // A unique namespace for your plugin metadata keys
    const NS = "com.example.bunglebonds-buttons";
    
    // Add a toolbar button
    await OBR.tool.create({
      id: `${NS}.tool`,
      icon: "/icon.svg",
      name: "Bunglebond's Buttons",
      shortcut: "Shift+B"
    });
    
    // Store/read a scene metadata value
    const sceneMeta = await OBR.scene.getMetadata();
    const count = (sceneMeta[`${NS}/count`] as number | undefined) ?? 0;
    
    await OBR.scene.setMetadata({
      ...sceneMeta,
      [`${NS}/count`]: count + 1
    });

    // Role lives on the player API
    const role = await OBR.player.getRole();
    status.textContent = `Ready (role: ${role})`;

    // Selection subscription
    OBR.player.onSelectionChange((ids) => {
      log({ selection: ids });
    });

    // Button: dump selected items
    ping.addEventListener("click", async () => {
      const ids = await OBR.player.getSelection();
      if (!ids || ids.length === 0) {
        log("No items selected.");
        return;
      }

      const items = await OBR.scene.items.getItems(ids);
      log({ selectedItems: items.map((i) => ({ id: i.id, name: i.name, type: i.type })) });
    });
  });
}

start();