import OBR from "@owlbear-rodeo/sdk";

const NS = "com.example.bunglebonds-buttons";
const PARTY_KEY = `${NS}/partyMembers`;

type PartyMember = { id: string; name: string };

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

/**
 * Minimal in-tool UI: list all tokens/items.
 * (No reliance on previous test DOM nodes: status/out/ping.)
 */
function mountUi() {
  document.body.classList.add("bb-root");
  
  const root = document.createElement("div");
  root.className = "bb-panel";
  
  const title = document.createElement("div");
  title.className = "bb-title";
  title.textContent = "Bunglebond's Buttons";
  
  const subtitle = document.createElement("div");
  subtitle.className = "bb-subtitle";
  subtitle.textContent = "Scene items";
  
  const list = document.createElement("pre");
  list.className = "bb-list";
  list.textContent = "Loading…";
  
  root.appendChild(title);
  root.appendChild(subtitle);
  root.appendChild(list);
  document.body.appendChild(root);
  
  return { list };
}
 
async function getPartyMembers(): Promise<PartyMember[]> {
  const metadata = await OBR.scene.getMetadata();
  const value = metadata[PARTY_KEY];
  if (!Array.isArray(value)) return [];
  return value
    .filter((x) => x && typeof x.id === "string")
    .map((x) => ({
      id: String(x.id),
      name: typeof x.name === "string" ? x.name : "",
    }));
}

async function setPartyMembers(members: PartyMember[]) {
  await OBR.scene.setMetadata({
    [PARTY_KEY]: members,
  });
}

async function addPartyMember(member: PartyMember) {
  const members = await getPartyMembers();
  if (members.some((m) => m.id === member.id)) {
    await OBR.notification.show(
      `"${member.name || "Unnamed"}" is already in Party Members.`,
      "INFO",
    );
    return;
  }
  members.push({ id: member.id, name: member.name ?? "" });
  await setPartyMembers(members);
  await OBR.notification.show(
    `Added "${member.name || "Unnamed"}" to Party Members.`,
    "SUCCESS",
  );
}

function formatItemsForList(items: any[]) {
  // Keep it compact: show id, name, type, layer.
  return JSON.stringify(
    items.map((i) => ({
      id: i.id,
      name: i.name ?? "",
      type: i.type,
      layer: i.layer,
    })),
    null,
    2,
  );
}

async function refreshItemList(target: HTMLPreElement) {
  const items = await OBR.scene.items.getItems();
  target.textContent = formatItemsForList(items);
}

function start() {
  OBR.onReady(async () => {
    // Theme → CSS vars (unchanged)
    applyThemeToCssVars(await OBR.theme.getTheme());
    OBR.theme.onChange(applyThemeToCssVars);

    // Tool (kept)
    await OBR.tool.create({
      id: `${NS}.tool`,
      shortcut: "Shift+B",
      icons: [{ icon: "icon.svg", label: "Bunglebond's Buttons" }],
    });

    // In-tool UI: show all tokens/items
    const ui = mountUi();

    // Initial fill + live updates
    await refreshItemList(ui.list);

    OBR.scene.items.onChange(async (items) => {
      // onChange gives the full current list; display it directly.
      ui.list.textContent = formatItemsForList(items);
    });

    // Right-click context menu: Character token → Add to Party Members (stored in scene metadata)
    await OBR.contextMenu.create({
      id: `${NS}.party.add`,
      icons: [
        {
          icon: "/icon.svg",
          label: "Add to Party",
          filter: {
            min: 1,
            max: 1,
            every: [
              { key: "layer", value: "CHARACTER" },
              { key: "type", value: "IMAGE" },
            ],
            permissions: ["UPDATE"],
          },
        },
      ],
      async onClick(context) {
        const item = context.items?.[0];
        if (!item) return;
        await addPartyMember({ id: item.id, name: item.name ?? "" });
      },
    });
  });
}

start();