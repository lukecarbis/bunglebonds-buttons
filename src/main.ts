import OBR, { buildShape, type Image, type Shape } from "@owlbear-rodeo/sdk";
import "./style.css";

const NS = "com.example.bunglebonds-buttons";
const PARTY_KEY = `${NS}.partyMembers`;
const IN_PARTY_KEY = `${NS}.inParty`;
const ACTIVE_RING_TAG = `${NS}.activeRing`;

const ACTIVE_RING_COLOR = "#3aa8ff";
const ACTIVE_RING_STROKE = 10;
const ACTIVE_RING_PADDING = 18;

type PartyMember = { id: string; name: string };
type PartyState = {
  members: PartyMember[];
  activeId: string | null;
};

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
  document.body.classList.add("bb-panel");
  
  const help = document.createElement("div");
  help.className = "bb-help";
  help.textContent = "Right-click a character token and choose “Add to Party” to populate this list.";
  
  const list = document.createElement("ul");
  list.className = "bb-party-list";
  
  document.body.appendChild(help);
  document.body.appendChild(list);
  
  return { list, help };
}
 
function normalisePartyState(value: unknown): PartyState {
  if (!value || typeof value !== "object") {
    return { members: [], activeId: null };
  }

  const v = value as any;

  const members: PartyMember[] = Array.isArray(v.members)
    ? v.members
        .filter((x: any) => x && typeof x.id === "string")
        .map((x: any) => ({
          id: String(x.id),
          name: typeof x.name === "string" ? x.name : "",
        }))
    : [];

  const activeId =
    typeof v.activeId === "string" ? v.activeId : v.activeId === null ? null : null;

  // If activeId points at a non-member, clear it.
  const activeOk = activeId && members.some((m) => m.id === activeId);
  return { members, activeId: activeOk ? activeId : null };
}

async function reconcilePartyFlagsFromState() {
  const state = await getPartyState();

  // Ensure all party members have the flag
  if (state.members.length) {
    await OBR.scene.items.updateItems(
      state.members.map((m) => m.id),
      (items) => {
        for (const it of items) it.metadata[IN_PARTY_KEY] = true;
      },
    );
  }
}

async function getPartyState(): Promise<PartyState> {
  const metadata = await OBR.scene.getMetadata();
  return normalisePartyState(metadata[PARTY_KEY]);
}

async function setPartyState(state: PartyState) {
  await OBR.scene.setMetadata({
    [PARTY_KEY]: state,
  });
}

async function addToParty(member: PartyMember) {
  const state = await getPartyState();
  if (state.members.some((m) => m.id === member.id)) return;

  state.members.push({ id: member.id, name: member.name ?? "" });
  await setPartyState(state);

  // Set item-level flag for context menu filtering
  await OBR.scene.items.updateItems([member.id], (items) => {
    for (const it of items) {
      it.metadata[IN_PARTY_KEY] = true;
    }
  });
}

async function removeFromParty(id: string) {
  const state = await getPartyState();
  const before = state.members.length;

  state.members = state.members.filter((m) => m.id !== id);
  if (state.activeId === id) state.activeId = null;

  if (state.members.length !== before) {
    await setPartyState(state);
  }

  // Clear item-level flag for context menu filtering
  await OBR.scene.items.updateItems([id], (items) => {
    for (const it of items) {
      delete it.metadata[IN_PARTY_KEY];
    }
  });
}

async function setActivePartyMember(id: string | null) {
  const state = await getPartyState();

  if (id === null) {
    state.activeId = null;
    await setPartyState(state);
    return;
  }

  // Only allow active to be set to an existing member.
  if (!state.members.some((m) => m.id === id)) return;

  state.activeId = id;
  await setPartyState(state);
}

function isActiveRing(item: any): item is Shape {
  return item?.type === "SHAPE" && item?.metadata?.[ACTIVE_RING_TAG] === true;
}

async function removeActiveRing() {
  const rings = await OBR.scene.local.getItems<Shape>((it) => isActiveRing(it));
  if (rings.length) {
    await OBR.scene.local.deleteItems(rings.map((r) => r.id));
  }
}

async function upsertActiveRing(activeId: string | null) {
  await removeActiveRing();

  if (!activeId) return;

  const [token] = await OBR.scene.items.getItems<Image>([activeId]);
  if (!token || token.type !== "IMAGE") return;

  const w = token.image.width * token.scale.x + ACTIVE_RING_PADDING;
  const h = token.image.height * token.scale.y + ACTIVE_RING_PADDING;

  const ring = buildShape()
    .shapeType("CIRCLE")
    .width(w)
    .height(h)
    .fillOpacity(0)
    .strokeColor(ACTIVE_RING_COLOR)
    .strokeWidth(ACTIVE_RING_STROKE)
    .strokeOpacity(0.9)
    .build();

  // IMPORTANT: place it where the token is
  ring.position = { ...token.position };
  ring.rotation = token.rotation;

  ring.attachedTo = token.id;
  ring.layer = "CHARACTER";
  ring.disableHit = true;

  ring.metadata[ACTIVE_RING_TAG] = true;

  await OBR.scene.local.addItems([ring]);
}

async function cleanupPartyForDeletedItems() {
  const state = await getPartyState();

  // Current items in the scene
  const items = await OBR.scene.items.getItems();
  const presentIds = new Set(items.map((i) => i.id));

  // Party members whose items no longer exist
  const removed = state.members.filter((m) => !presentIds.has(m.id));
  if (!removed.length) return;

  state.members = state.members.filter((m) => presentIds.has(m.id));

  if (state.activeId && !presentIds.has(state.activeId)) {
    state.activeId = null;
  }

  await setPartyState(state);
}

function renderPartyMembers(
  state: PartyState,
  els: { list: HTMLUListElement; help: HTMLDivElement },
) {
  els.list.innerHTML = "";

  if (!state.members.length) {
    els.help.style.display = "block";
    return;
  }

  els.help.style.display = "none";

  for (const m of state.members) {
    const li = document.createElement("li");
    li.className = "bb-party-item";

    const name = document.createElement("span");
    name.className = "bb-party-name";
    name.textContent = m.name || "(Unnamed)";

    const actions = document.createElement("span");
    actions.className = "bb-party-actions";

    const removeBtn = document.createElement("button");
    removeBtn.className = "bb-party-btn";
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove from party";
    removeBtn.addEventListener("click", () => {
      void removeFromParty(m.id);
    });

    const activeBtn = document.createElement("button");
    activeBtn.className = "bb-party-btn";
    activeBtn.type = "button";

    const isActive = state.activeId === m.id;
    activeBtn.textContent = isActive ? "★" : "☆";
    activeBtn.title = isActive ? "Deactivate" : "Make active";

    activeBtn.addEventListener("click", () => {
      void setActivePartyMember(isActive ? null : m.id);
    });

    actions.appendChild(activeBtn);
    actions.appendChild(removeBtn);

    li.appendChild(name);
    li.appendChild(actions);
    els.list.appendChild(li);
  }
}

OBR.onReady(async () => {
  applyThemeToCssVars(await OBR.theme.getTheme());
  OBR.theme.onChange(applyThemeToCssVars);

  // Mount UI once (panel iframe)
  const ui = mountUi();

  // Track whether we've wired scene listeners (scene can toggle ready/unready)
  let sceneWired = false;

  const wireScene = async () => {
    if (sceneWired) return;
    sceneWired = true;

    // Initial render + live updates
    renderPartyMembers(await getPartyState(), ui);

    OBR.scene.onMetadataChange((metadata) => {
      const state = normalisePartyState(metadata[PARTY_KEY]);
      renderPartyMembers(state, ui);
      void upsertActiveRing(state.activeId);
    });

    await reconcilePartyFlagsFromState();

    OBR.scene.items.onChange(() => {
      void cleanupPartyForDeletedItems();
    });

    await OBR.contextMenu.create({
      id: `${NS}.party.context`,
      icons: [
        {
          icon: "/bunglebonds-buttons/icon.svg",
          label: "Add to Party",
          filter: {
            every: [
              { key: "layer", value: "CHARACTER" },
              { key: "type", value: "IMAGE" },
              { key: ["metadata", IN_PARTY_KEY], value: undefined },
            ],
            permissions: ["UPDATE"],
          },
        },
        {
          icon: "/bunglebonds-buttons/icon.svg",
          label: "Remove from Party",
          filter: {
            every: [
              { key: "layer", value: "CHARACTER" },
              { key: "type", value: "IMAGE" },
              { key: ["metadata", IN_PARTY_KEY], value: true },
            ],
            permissions: ["UPDATE"],
          },
        },
      ],
      async onClick(context) {
        const items = context.items ?? [];
        if (!items.length) return;

        const shouldAdd = items.every(
          (it) => it.metadata?.[IN_PARTY_KEY] === undefined,
        );

        if (shouldAdd) {
          for (const it of items) await addToParty({ id: it.id, name: it.name ?? "" });
          await OBR.notification.show(`Added ${items.length} token(s) to Party.`, "SUCCESS");
        } else {
          for (const it of items) await removeFromParty(it.id);
          await OBR.notification.show(`Removed ${items.length} token(s) from Party.`, "SUCCESS");
        }
      },
    });
  };

  const unwireScene = () => {
    sceneWired = false;

    ui.list.innerHTML = "";
    ui.help.style.display = "block";
    ui.help.textContent = "Open a scene to use Party.";
  };

  OBR.scene.onReadyChange((ready) => {
    if (ready) void wireScene();
    else unwireScene();
  });

  // Handle the case where the scene is already ready when the iframe loads
  if (await OBR.scene.isReady()) {
    void wireScene();
  } else {
    unwireScene();
  }
});