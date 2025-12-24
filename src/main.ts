import OBR, { buildShape, type Image, type Shape } from "@owlbear-rodeo/sdk";
import "./style.css";

const NS = "com.example.bunglebonds-buttons";
const PARTY_KEY = `${NS}.partyMembers`;
const IN_PARTY_KEY = `${NS}.inParty`;
const ACTIVE_RING_TAG = `${NS}.activeRing`;

const NUMPAD_DIR: Record<string, { dx: number; dy: number } | null> = {
  Numpad1: { dx: -1, dy:  1 }, // SW
  Numpad2: { dx:  0, dy:  1 }, // S
  Numpad3: { dx:  1, dy:  1 }, // SE
  Numpad4: { dx: -1, dy:  0 }, // W
  Numpad5: null,
  Numpad6: { dx:  1, dy:  0 }, // E
  Numpad7: { dx: -1, dy: -1 }, // NW
  Numpad8: { dx:  0, dy: -1 }, // N
  Numpad9: { dx:  1, dy: -1 }, // NE
};

let activeRingPulseTimer: number | null = null;

type GridStep = { dx: number; dy: number };
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

async function shiftActivePartyMember(direction: -1 | 1) {
  const state = await getPartyState();
  const members = state.members;

  if (!members.length) return;

  const currentIndex = state.activeId
    ? members.findIndex((m) => m.id === state.activeId)
    : -1;

  // If none active (or activeId missing), pick first/last depending on direction
  const nextIndex =
    currentIndex === -1
      ? direction === 1
        ? 0
        : members.length - 1
      : (currentIndex + direction + members.length) % members.length;

  state.activeId = members[nextIndex].id;
  await setPartyState(state);
}

function isActiveRing(item: any): item is Shape {
  return item?.type === "SHAPE" && item?.metadata?.[ACTIVE_RING_TAG] === true;
}

async function removeActiveRing() {
  if (activeRingPulseTimer !== null) {
    clearInterval(activeRingPulseTimer);
    activeRingPulseTimer = null;
  }

  const rings = await OBR.scene.local.getItems<Shape>((it) => isActiveRing(it));
  if (rings.length) {
    await OBR.scene.local.deleteItems(rings.map((r) => r.id));
  }
}

async function upsertActiveRing(activeId: string | null) {
  await removeActiveRing();

  if (!activeId) return;

  const token = await getTokenEventually(activeId);
  if (!token || !token.grid) return;

  const sceneDpi = await OBR.scene.grid.getDpi();

  // Normalise token image pixels into scene units
  const dpiScale = sceneDpi / token.grid.dpi;
  const width = token.image.width * dpiScale;
  const height = token.image.height * dpiScale;

  // Use a circular ring sized to the smaller dimension
  const diameter = Math.min(width, height) + 12;

  // Account for grid offset (very important for tokens whose grid origin
  // is not the top-left of the image)
  const offsetX = (token.grid.offset.x / token.image.width) * width;
  const offsetY = (token.grid.offset.y / token.image.height) * height;

  // Compute centre position in scene coordinates
  const position = {
    x: token.position.x - offsetX + width / 2,
    y: token.position.y - offsetY + height / 2,
  };

  const ring = buildShape()
    .shapeType("CIRCLE")
    .width(diameter)
    .height(diameter)
    .position(position)
    .fillOpacity(0)
    .strokeColor("#3aa8ff")
    .strokeWidth(4)
    .strokeOpacity(0.4)
    .disableHit(true)
    .layer("ATTACHMENT") // matches exemplar; also tends to “sit with” the token
    .attachedTo(token.id)
    .locked(true)
    .name("Active Ring")
    .metadata({ [ACTIVE_RING_TAG]: true })
    .visible(token.visible)
    .build();

  await OBR.scene.local.addItems([ring]);
  startActiveRingPulse();
}

function startActiveRingPulse() {
  if (activeRingPulseTimer !== null) return;

  const start = performance.now();
  const min_opacity = 0.4;
  const max_opacity = 0.8;
  const min_stroke = 4;
  const max_stroke = 8;
  const period = 3000;

  activeRingPulseTimer = window.setInterval(async () => {
    const rings = await OBR.scene.local.getItems<Shape>(isActiveRing);
    if (!rings.length) return;

    const t = (performance.now() - start) / period;
    const wave = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);

    const opacity =
      min_opacity +
      (max_opacity - min_opacity) * wave;

    const strokeWidth =
      min_stroke +
      (max_stroke - min_stroke) * wave;

    await OBR.scene.local.updateItems(
      rings.map((r) => r.id),
      (items) => {
        for (const it of items) {
          if (it.type !== "SHAPE") continue;
          const shape = it as unknown as Shape;
          shape.style.strokeOpacity = opacity;
          shape.style.strokeWidth = strokeWidth;
        }
      },
    );
  }, 100);
}

async function getTokenEventually(id: string, tries = 6, delayMs = 200) {
  for (let i = 0; i < tries; i++) {
    const [token] = await OBR.scene.items.getItems<Image>([id]);
    if (token && token.type === "IMAGE") return token;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

async function moveActiveTokenByGridSteps({ dx, dy }: GridStep, steps = 1) {
  if (dx === 0 && dy === 0) return;

  const state = await getPartyState();
  if (!state.activeId) return;

  const [token] = await OBR.scene.items.getItems<Image>([state.activeId]);
  if (!token) return;

  // For square grids, 1 “space” == scene grid DPI in pixels.
  const cell = await OBR.scene.grid.getDpi();

  const target = {
    x: token.position.x + dx * cell * steps,
    y: token.position.y + dy * cell * steps,
  };

  // Snap to grid so it stays aligned. (Change snap parameters if you want corners vs centres.)
  const snapped = await OBR.scene.grid.snapPosition(target, 1, true);

  await OBR.scene.items.updateItems([token.id], (items) => {
    for (const it of items) it.position = snapped;
  });
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
    const initialState = await getPartyState();
    renderPartyMembers(initialState, ui);
    void upsertActiveRing(initialState.activeId);

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

    const TOOL_ID = `${NS}.partyTool`;

    await OBR.tool.create({
      id: TOOL_ID,
      icons: [{ icon: "/bunglebonds-buttons/icon.svg", label: "Party Hotkeys" }],
      shortcut: "B",
      defaultMode: `${NS}.partyToolKeypad`
    });

    await OBR.tool.createMode({
      id: `${NS}.partyToolKeypad`,
      icons: [
        {
          icon: "/bunglebonds-buttons/icon.svg",
          label: "Keypad",
          filter: {
            activeTools: [TOOL_ID],
          },
        },
      ],
      shortcut: "K",
      onKeyDown(_ctx, e) {
        if (!e.altKey || e.repeat) return;

        if (e.key === "ArrowLeft") void shiftActivePartyMember(-1);
        if (e.key === "ArrowRight") void shiftActivePartyMember(1);

        const dir = NUMPAD_DIR[e.code];
        if (dir) {
          void moveActiveTokenByGridSteps(dir);
        }
      },
    });
  };

  const unwireScene = () => {
    sceneWired = false;
    void removeActiveRing();

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