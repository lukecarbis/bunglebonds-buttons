import OBR, { buildShape, isShape, type Image, type Shape } from "@owlbear-rodeo/sdk";
import "./style.css";

const NS = "com.example.bunglebonds-buttons";
const PARTY_KEY = `${NS}.partyMembers`;
const IN_PARTY_KEY = `${NS}.inParty`;
const ACTIVE_KEY = `${NS}.active`;
const ACTIVE_RING_KEY = `${NS}.activeRing`;

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

function buildActiveRing(attachedTo: Image, dpi: number): Shape {
  // Match the coloured-rings approach: size ring to grid DPI and token scale.
  const size = dpi * attachedTo.scale.x;

  return buildShape()
    .name("Active Ring")
    .layer("ATTACHMENT")
    .attachedTo(attachedTo.id)
    .disableHit(true)
    .locked(true)
    .width(size)
    .height(size)
    .shapeType("CIRCLE")
    .style({
      fillColor: "#000000",
      fillOpacity: 0,          // hollow ring
      strokeColor: "#3aa0ff",  // blue
      strokeOpacity: 0.55,     // baseline
      strokeWidth: Math.max(6, dpi * 0.12),
      strokeDash: [],          // or e.g. [8, 6] for dashed
    })
    .metadata({
      [ACTIVE_RING_KEY]: { enabled: true },
    })
    .build();
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

async function reconcileActiveFlagFromState() {
  const state = await getPartyState();
  const items = await OBR.scene.items.getItems();

  const activeId = state.activeId;
  const idsToClear = items
    .filter((i) => i.metadata?.[ACTIVE_KEY] === true && i.id !== activeId)
    .map((i) => i.id);

  if (idsToClear.length) {
    await OBR.scene.items.updateItems(idsToClear, (its) => {
      for (const it of its) delete it.metadata[ACTIVE_KEY];
    });
  }

  if (activeId) {
    await OBR.scene.items.updateItems([activeId], (its) => {
      for (const it of its) it.metadata[ACTIVE_KEY] = true;
    });
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
  const prev = state.activeId;

  if (id !== null && !state.members.some((m) => m.id === id)) return;

  state.activeId = id;
  await setPartyState(state);

  // Clear previous active flag
  if (prev) {
    await OBR.scene.items.updateItems([prev], (items) => {
      for (const it of items) delete it.metadata[ACTIVE_KEY];
    });
  }

  // Set new active flag
  if (id) {
    await OBR.scene.items.updateItems([id], (items) => {
      for (const it of items) it.metadata[ACTIVE_KEY] = true;
    });
  }
}

async function setActiveRingForToken(activeTokenId: string | null) {
  // Remove existing active rings created by this extension
  const existing = await OBR.scene.items.getItems<Shape>((item): item is Shape => {
    if (!isShape(item)) return false;
    const meta = item.metadata?.[ACTIVE_RING_KEY] as any;
    return Boolean(meta?.enabled);
  });

  if (existing.length) {
    await OBR.scene.items.deleteItems(existing.map((r) => r.id));
  }

  if (!activeTokenId) return;

  const [token] = await OBR.scene.items.getItems<Image>([activeTokenId]);
  if (!token) return;

  const dpi = await OBR.scene.grid.getDpi();
  const ring = buildActiveRing(token, dpi);
  await OBR.scene.items.addItems([ring]);
}

let pulseTimer: number | null = null;

function startRingPulse() {
  if (pulseTimer !== null) window.clearInterval(pulseTimer);

  const periodMs = 2800;
  const min = 0.25;
  const max = 0.85;

  pulseTimer = window.setInterval(async () => {
    const rings = await OBR.scene.items.getItems<Shape>((item): item is Shape => {
      if (!isShape(item)) return false;
      const meta = item.metadata?.[ACTIVE_RING_KEY] as any;
      return Boolean(meta?.enabled);
    });

    if (!rings.length) return;

    const t = (Date.now() % periodMs) / periodMs;
    const s = 0.5 - 0.5 * Math.cos(t * Math.PI * 2); // 0..1
    const opacity = min + (max - min) * s;

    await OBR.scene.items.updateItems<Shape>(
      rings.map((r) => r.id),
      (items) => {
        for (const it of items) {
          it.style.strokeOpacity = opacity;
        }
      },
    );
  }, 120);
}

function stopRingPulse() {
  if (pulseTimer !== null) window.clearInterval(pulseTimer);
  pulseTimer = null;
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

    let lastActiveId: string | null = null;
    
    OBR.scene.onMetadataChange((metadata) => {
      const state = normalisePartyState(metadata[PARTY_KEY]);
      renderPartyMembers(state, ui);
    
      if (state.activeId !== lastActiveId) {
        lastActiveId = state.activeId;
        void setActiveRingForToken(state.activeId);
      }
    });

    await reconcilePartyFlagsFromState();
    await reconcileActiveFlagFromState();
    await setActiveRingForToken((await getPartyState()).activeId);
    startRingPulse();

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

    stopRingPulse();
    void setActiveRingForToken(null);

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