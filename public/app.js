// Each person's link looks like https://…/#<token>. The hash never reaches the server logs.
const token = location.hash.slice(1);

// Several people may share a phone, so local state is namespaced per link.
const storeKey = (k) => `ss:${token.slice(0, 8)}:${k}`;

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  me: null,
  side: "giving", // selected chat
  showing: false, // receiver's name on screen right now
  messages: { giving: [], receiving: [] },
  lastId: { giving: 0, receiving: 0 },
  theirItems: [],
};

// ---------- Helpers ----------

async function api(path, { body, ...options } = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

// el("li", { className: "x" }, child, "text")
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

function icon(name, extraClass = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `icon ${extraClass}`.trim());
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

const initials = (name) => name.trim().slice(0, 1).toUpperCase();

let toastTimer;
function toast(message, kind = "ok") {
  const t = $("toast");
  t.textContent = message;
  t.className = `toast toast-${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// Promise-based replacement for confirm(), styled like the app.
function confirmDialog({ title, text, ok, danger = false, iconName = "check" }) {
  const dlg = $("confirm-dialog");
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;
  $("confirm-ok").textContent = ok;
  $("confirm-ok").className = `btn btn-block ${danger ? "btn-danger" : "btn-primary"}`;
  $("confirm-icon").className = `dialog-icon ${danger ? "danger" : ""}`;
  $("confirm-icon").replaceChildren(icon(iconName));
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
}

// ---------- Boot ----------

async function init() {
  if (!/^[0-9a-f]{32}$/.test(token)) {
    $("status").textContent = "Abra esta página pelo link que você recebeu no WhatsApp.";
    return;
  }

  try {
    state.me = await api("/api/me");
  } catch (err) {
    $("status").textContent = err.message === "Link inválido"
      ? "Este link não é válido. Peça um novo ao Lucas."
      : `Não foi possível carregar: ${err.message}`;
    return;
  }

  const me = state.me;
  $("status").hidden = true;
  $("app").hidden = false;
  $("bottom-nav").hidden = false;
  $("my-name").textContent = me.name;
  $("whoami").textContent = me.name;
  $("whoami").hidden = false;
  $("draw-chip").hidden = false;
  $("draw-chip").classList.toggle("done", me.drawn);
  $("draw-chip").querySelector("span").textContent = me.drawn ? "Sorteio realizado" : "Aguardando sorteio";
  $("greeting-text").textContent = me.drawn
    ? "O sorteio já aconteceu e quem você tirou está guardado aqui dentro."
    : "Ainda falta o sorteio. Assim que acontecer, você descobre aqui quem tirou.";

  setupNav();
  setupReveal();
  setupWishes();
  setupChats();
  if (me.isAdmin) setupAdmin();

  // Restore the tab from the URL (?tab=chats), so refresh keeps you where you were.
  const tab = new URLSearchParams(location.search).get("tab");
  const valid = ["reveal", "wishes", "chats", ...(me.isAdmin ? ["admin"] : [])];
  showTab(valid.includes(tab) ? `tab-${tab}` : "tab-reveal", { replace: true });
}

// ---------- Navigation ----------

function setupNav() {
  $$("#bottom-nav button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // Shortcut buttons inside cards: data-goto="tab-x" (+ optional data-wish-view / data-chat-side)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-goto]");
    if (!btn) return;
    if (btn.dataset.wishView) showWishView(btn.dataset.wishView);
    if (btn.dataset.chatSide && state.me.drawn) selectSide(btn.dataset.chatSide);
    showTab(btn.dataset.goto);
  });
}

// Conversas unlocks only after the draw AND after the person saw who they drew.
// isOpened() is false before the draw, and a reset + new draw makes it false again (new drawId).
// Presentes is always open (people can build their own list early); inside it, the
// "Quem eu tirei" list only appears once opened (see applyReveal).
const isLocked = (id) => !isOpened() && id === "tab-chats";

function updateLocks() {
  // Red dot on Seu Amigo: drawn but not seen yet. Goes away for good once opened (per draw).
  $("reveal-dot").hidden = !(state.me.drawn && !isOpened());
  $$("#bottom-nav button").forEach((b) => {
    const locked = isLocked(b.dataset.tab);
    b.classList.toggle("locked", locked);
    b.setAttribute("aria-disabled", locked);
  });
  updateDots(); // unlocking Conversas may reveal waiting unread messages
}

function showTab(id, { replace = false } = {}) {
  if (isLocked(id)) {
    // Tapped: explain and stay where you are. Restored from the URL/history: fall back to the first tab.
    if (!replace) return toast(state.me.drawn ? "Primeiro veja quem você tirou 🎁" : "Abre depois do sorteio 🎁");
    id = "tab-reveal";
  }
  if (id !== "tab-reveal") hideName();
  document.body.classList.toggle("chat-mode", id === "tab-chats");
  $$("#bottom-nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  $$(".tab").forEach((t) => (t.hidden = t.id !== id));
  window.scrollTo({ top: 0 });

  // Keep the token in the hash; only the tab goes in the query string.
  const url = `${location.pathname}?tab=${id.replace("tab-", "")}${location.hash}`;
  history[replace ? "replaceState" : "pushState"]({ tab: id }, "", url);

  if ((id === "tab-reveal" || id === "tab-wishes") && isOpened()) loadTheirList();
  if (id === "tab-chats") {
    scrollChatToBottom();
    markSeen();
  }
  if (id === "tab-admin") loadAdmin();
}

window.addEventListener("popstate", (e) => {
  if (e.state?.tab && state.me) showTab(e.state.tab, { replace: true });
});

// ---------- Revelação ----------

// Two states:
// - opened: the gift was opened once for this draw (saved per drawId, so a reset + redraw asks again).
// - showing: the name is on screen right now. Phones are shared, so it covers itself
//   after 1 min, when leaving this tab, or when the page is hidden. The name appears nowhere else.
const SHOW_MS = 60 * 1000;
let hideTimer;

function isOpened() {
  return state.me.drawn && localStorage.getItem(storeKey("revealed")) === String(state.me.drawId);
}

function showName({ celebrate = false } = {}) {
  state.showing = true;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideName, SHOW_MS);
  applyReveal({ celebrate });
}

function hideName() {
  if (!state.showing) return;
  state.showing = false;
  clearTimeout(hideTimer);
  applyReveal();
}

function setupReveal() {
  const me = state.me;
  updateLocks();
  if (!me.drawn) {
    $("reveal-waiting").hidden = false;
    return;
  }
  $("receiver-name").textContent = me.receiver;

  const open = () => {
    if ($("gift-btn").classList.contains("opening")) return;
    $("gift-btn").classList.add("opening");
    setTimeout(() => {
      localStorage.setItem(storeKey("revealed"), String(me.drawId));
      showName({ celebrate: true });
      $("gift-btn").classList.remove("opening");
    }, 650);
  };
  $("gift-btn").addEventListener("click", open);
  $("reveal-btn").addEventListener("click", open);
  $("show-btn").addEventListener("click", () => showName());
  $("cover-btn").addEventListener("click", hideName);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hideName();
  });

  applyReveal();
}

function applyReveal({ celebrate = false } = {}) {
  const opened = isOpened();
  $("reveal-wrapped").hidden = opened;
  $("reveal-stack").hidden = !opened;
  $("reveal-open").classList.toggle("off", !state.showing);
  $("reveal-covered").classList.toggle("off", state.showing);
  $("their-preview").hidden = !opened;
  $("theirs-view-btn").hidden = !opened;
  updateLocks();
  if (!opened) showWishView("mine");
  // showTab loads the list on later visits; only the first opening needs it here.
  if (celebrate) {
    loadTheirList();
    confetti();
  }
}

function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = $("confetti");
  box.replaceChildren();
  const colors = ["#c5221f", "#fda611", "#255647", "#ffb4aa", "#ffddb6"];
  for (let i = 0; i < 40; i++) {
    const piece = el("i");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty("--dx", `${(Math.random() - 0.5) * 160}px`);
    piece.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    piece.style.animationDelay = `${Math.random() * 0.25}s`;
    box.append(piece);
  }
  setTimeout(() => box.replaceChildren(), 2200);
}

// ---------- Lista de presentes ----------

function setupWishes() {
  $$("#wish-views button").forEach((b) => b.addEventListener("click", () => showWishView(b.dataset.view)));

  const form = $("wish-form");
  form.querySelectorAll("input[name=kind]").forEach((r) => r.addEventListener("change", updateWishForm));
  updateWishForm();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const kind = form.elements.kind.value;
    const text = $("wish-text").value.trim();
    if (!text) {
      $("wish-text").focus();
      $("wish-text").classList.add("shake");
      setTimeout(() => $("wish-text").classList.remove("shake"), 500);
      return;
    }
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const { item } = await api("/api/wishlist", {
        method: "POST",
        body: { kind, text, url: kind === "item" ? $("wish-url").value : "" },
      });
      $("my-list").append(wishCard(item, { deletable: true }));
      form.reset();
      updateWishForm();
      updateMyCount();
      toast("Presente adicionado! 🎁");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      submit.disabled = false;
    }
  });

  loadMyList();
}

function showWishView(view) {
  if (view === "theirs" && !isOpened()) view = "mine";
  $$("#wish-views button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("wishes-mine").hidden = view !== "mine";
  $("wishes-theirs").hidden = view !== "theirs";
}

function updateWishForm() {
  const isItem = $("wish-form").elements.kind.value === "item";
  $("wish-url-field").hidden = !isItem;
  $("wish-text").placeholder = isItem
    ? "Ex.: Fone de ouvido Bluetooth preto"
    : "Ex.: Algo para a cozinha, adoro café";
}

async function loadMyList() {
  try {
    const { items } = await api("/api/wishlist");
    $("my-list").replaceChildren(...items.map((item) => wishCard(item, { deletable: true })));
  } catch (err) {
    toast(`Erro ao carregar sua lista: ${err.message}`, "error");
  }
  updateMyCount();
}

function updateMyCount() {
  const n = $("my-list").children.length;
  $("my-count").textContent = n;
  $("my-list-empty").hidden = n > 0;
}

async function loadTheirList() {
  try {
    const { items } = await api("/api/receiver/wishlist");
    state.theirItems = items;
    $("their-list").replaceChildren(...items.map((item) => wishCard(item)));
    $("their-list-empty").hidden = items.length > 0;
    $("their-preview-list").replaceChildren(...items.slice(0, 3).map((item) => wishCard(item, { compact: true })));
    $("their-preview-empty").hidden = items.length > 0;
    $("their-count").textContent = items.length === 1 ? "1 presente" : `${items.length} presentes`;
  } catch (err) {
    toast(`Erro ao carregar a lista: ${err.message}`, "error");
  }
}

function wishCard(item, { deletable = false, compact = false } = {}) {
  const isIdea = item.kind === "idea";
  const body = el(
    "div",
    { className: "wish-body" },
    compact ? null : el("span", { className: `pill ${isIdea ? "pill-green" : "pill-gold"}`, textContent: isIdea ? "Ideia de presente" : "Item específico" }),
    el("span", { className: "wish-text", textContent: item.text })
  );
  if (item.url && !compact) {
    const link = el("a", { href: item.url, target: "_blank", rel: "noopener noreferrer", className: "wish-link" });
    link.append(`Ver em ${new URL(item.url).hostname.replace(/^www\./, "")}`, icon("external"));
    body.append(link);
  }

  const li = el("li", { className: `wish ${compact ? "compact" : "card"}` }, el("span", { className: `wish-icon ${isIdea ? "green" : "gold"}` }, icon(isIdea ? "bulb" : "bag")), body);

  if (deletable) {
    const remove = el("button", { type: "button", className: "icon-btn", ariaLabel: `Remover ${item.text}` }, icon("trash"));
    remove.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Remover este presente?",
        text: `"${item.text}" vai sair da sua lista.`,
        ok: "Sim, remover",
        danger: true,
        iconName: "trash",
      });
      if (!ok) return;
      try {
        await api(`/api/wishlist/${item.id}`, { method: "DELETE" });
        li.classList.add("leaving");
        setTimeout(() => {
          li.remove();
          updateMyCount();
        }, 200);
      } catch (err) {
        toast(err.message, "error");
      }
    });
    li.append(remove);
  }
  return li;
}

// ---------- Conversas ----------
// Polls every 5 s while the page is visible and someone touched it in the last 10 min.
// A forgotten open tab stops polling, so it can't burn the free plan's daily request limit.
// Dots show unread messages.

const POLL_MS = 5000;
const IDLE_MS = 10 * 60 * 1000;
let polling = false;
let lastActivity = Date.now();

const isActive = () => document.visibilityState === "visible" && Date.now() - lastActivity < IDLE_MS;

// Any interaction restarts the 10 min window. Coming back from idle polls right away.
function noteActivity() {
  const wasIdle = Date.now() - lastActivity >= IDLE_MS;
  lastActivity = Date.now();
  if (wasIdle) poll();
}

// Before the draw there's no timer: the page only checks when it becomes visible again
// (e.g. reopened from WhatsApp). That's how an open page finds out the draw happened (see poll).
function setupChats() {
  if (state.me.drawn) {
    $("chats").hidden = false;
    $$("#chat-sides button").forEach((b) => b.addEventListener("click", () => selectSide(b.dataset.side)));
    $("chat-form").addEventListener("submit", sendMessage);
    setupKeyboard();
    selectSide("giving");
    poll();
    setInterval(() => isActive() && poll(), POLL_MS);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    lastActivity = Date.now();
    poll();
  });
  // Capture phase so scrolls inside the message list count too.
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"])
    document.addEventListener(type, noteActivity, { capture: true, passive: true });
}

// The receiver's name never appears here; only the Seu Amigo tab shows it.
function selectSide(side) {
  state.side = side;
  $$("#chat-sides button").forEach((b) => b.classList.toggle("active", b.dataset.side === side));
  $("chat-input").placeholder = side === "giving" ? "Mensagem anônima para quem você tirou…" : "Responder a quem tirou você…";
  renderMessages();
  markSeen();
}

async function poll() {
  if (polling) return;
  polling = true;
  console.log(`[poll] ${new Date().toLocaleTimeString()}`);
  try {
    const data = await api(`/api/chats?giving=${state.lastId.giving}&receiving=${state.lastId.receiving}`);
    // The draw happened, or was reset/redone, since this page loaded: everything on screen is stale.
    if (data.drawn !== state.me.drawn || data.drawId !== state.me.drawId) return reloadWhenSafe();
    addMessages("giving", data.giving);
    addMessages("receiving", data.receiving);
    markSeen();
  } catch {
    // Network hiccup: the next poll retries.
  } finally {
    polling = false;
  }
}

// Don't wipe half-typed text or an open dialog; the next poll tries again.
function reloadWhenSafe() {
  const typing = ["wish-text", "wish-url", "chat-input"].some((id) => $(id).value.trim());
  if (typing || document.querySelector("dialog[open]")) return;
  location.reload();
}

// Dedupe by id: a poll in flight can return a message we already added after sending.
function addMessages(side, msgs) {
  const fresh = msgs.filter((m) => m.id > state.lastId[side]);
  if (!fresh.length) return;
  state.messages[side].push(...fresh);
  state.lastId[side] = fresh[fresh.length - 1].id;
  if (side === state.side) appendMessages(fresh);
}

function renderMessages() {
  $("messages").replaceChildren();
  const msgs = state.messages[state.side];
  if (msgs.length) appendMessages(msgs);
  else
    $("messages").append(
      el("li", { className: "empty" }, icon("sparkles"), el("span", {
        textContent: state.side === "giving"
          ? "Puxe assunto! Pergunte tamanho, cor preferida…"
          : "Quando quem tirou você escrever, aparece aqui.",
      }))
    );
  scrollChatToBottom();
}

function appendMessages(msgs) {
  const list = $("messages");
  list.querySelector(".empty")?.remove();
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.append(
    ...msgs.map((m) =>
      el(
        "li",
        { className: m.mine ? "msg mine" : `msg theirs ${state.side}` },
        el("span", { className: "msg-body", textContent: m.body }),
        el("time", { textContent: formatTime(m.at) })
      )
    )
  );
  if (nearBottom || msgs.some((m) => m.mine)) scrollChatToBottom();
}

function scrollChatToBottom() {
  const list = $("messages");
  list.scrollTop = list.scrollHeight;
}

// The input is never disabled: disabling it would blur it and close the phone keyboard on every send.
let sending = false;
async function sendMessage(e) {
  e.preventDefault();
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text || sending) return;
  const side = state.side;
  sending = true;
  try {
    const { message } = await api(`/api/chats/${side}`, { method: "POST", body: { body: text } });
    if (input.value.trim() === text) input.value = "";
    addMessages(side, [message]);
    markSeen();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    sending = false;
  }
}

// ---------- Phone keyboard ----------
// iOS doesn't shrink the page when the keyboard opens; it only shrinks the visual viewport.
// So while typing on a touch screen, the chat is sized to the visible area and the tab bar hides.
// Android shrinks the page itself (interactive-widget=resizes-content in the viewport meta).
function setupKeyboard() {
  const input = $("chat-input");
  const vv = window.visualViewport;
  const touch = matchMedia("(pointer: coarse)").matches;

  const fit = () => {
    const open = document.body.classList.contains("kb-open");
    if (open && vv) document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
    else document.documentElement.style.removeProperty("--app-h");
    if (document.body.classList.contains("chat-mode")) {
      window.scrollTo(0, 0); // iOS scrolls the page to the input; undo it, the layout already fits
      if (open) scrollChatToBottom();
    }
  };

  input.addEventListener("focus", () => {
    if (!touch) return;
    document.body.classList.add("kb-open");
    fit();
  });
  input.addEventListener("blur", () => {
    document.body.classList.remove("kb-open");
    fit();
  });
  vv?.addEventListener("resize", fit);
  vv?.addEventListener("scroll", fit);

  // Tapping send must not steal focus from the input, or the keyboard closes between messages.
  $("chat-form").querySelector("button").addEventListener("pointerdown", (e) => e.preventDefault());
}

// Unread = messages from the other side newer than what was on screen last time.
const seenKey = (side) => storeKey(`seen:${side}`);

function markSeen() {
  const visible = !$("tab-chats").hidden && document.visibilityState === "visible";
  if (visible && state.me.drawn) localStorage.setItem(seenKey(state.side), state.lastId[state.side]);
  updateDots();
}

function unreadCount(side) {
  const seen = Number(localStorage.getItem(seenKey(side)) || 0);
  return state.messages[side].filter((m) => !m.mine && m.id > seen).length;
}

function updateDots() {
  let total = 0;
  $$("#chat-sides button").forEach((b) => {
    const n = unreadCount(b.dataset.side);
    total += n;
    const badge = b.querySelector(".badge");
    badge.hidden = n === 0;
    badge.textContent = n > 9 ? "9+" : n;
  });
  // A locked tab gets no dot: tapping it would only say "see who you drew first".
  $("chats-dot").hidden = total === 0 || isLocked("tab-chats");
}

function formatTime(sqliteUtc) {
  // D1 stores "YYYY-MM-DD HH:MM:SS" in UTC.
  const d = new Date(sqliteUtc.replace(" ", "T") + "Z");
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return today ? time : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}, ${time}`;
}

// ---------- Admin ----------

function setupAdmin() {
  // Lets /admin skip the key prompt next time on this browser.
  localStorage.setItem("ss:adminToken", token);
  $("admin-tab-btn").hidden = false;

  $("draw-btn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Fazer o sorteio agora?",
      text: "Cada pessoa vai tirar alguém. Ninguém, nem você, vê os pares.",
      ok: "Sim, sortear",
      iconName: "shuffle",
    });
    if (ok) adminAction("/api/admin/draw");
  });
  $("reset-btn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Reiniciar o sorteio?",
      text: "Todas as conversas serão apagadas e os pares desfeitos. As listas de presentes continuam salvas.",
      ok: "Reiniciar sorteio",
      danger: true,
      iconName: "reset",
    });
    if (ok) adminAction("/api/admin/reset");
  });
}

async function adminAction(path) {
  try {
    await api(path, { method: "POST" });
    // The admin is also a participant, so every view changes.
    location.reload();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function loadAdmin() {
  let data;
  try {
    data = await api("/api/admin/members");
  } catch (err) {
    toast(`Erro: ${err.message}`, "error");
    return;
  }

  const total = data.members.length;
  const opened = data.members.filter((m) => m.opened).length;
  const filled = data.members.filter((m) => m.hasWishlist).length;

  $("admin-state").className = `pill ${data.drawn ? "pill-green" : "pill-gold"}`;
  $("admin-state").replaceChildren(icon(data.drawn ? "check" : "clock"), data.drawn ? "Sorteio realizado" : "Aguardando sorteio");
  $("stat-total").textContent = total;
  $("draw-count").textContent = `Sorteia todos os ${total} de uma vez`;
  $("stat-opened").textContent = opened;
  $("stat-filled").textContent = filled;
  $("progress-label").textContent = `${filled} de ${total}`;
  $("progress-bar").style.width = `${Math.round((filled / total) * 100)}%`;
  $("draw-btn").hidden = data.drawn;
  $("reset-btn").hidden = !data.drawn;

  $("member-list").replaceChildren(...data.members.map(memberCard));
}

function memberCard(m) {
  const link = `${location.origin}/#${m.token}`;
  const isMe = m.name === state.me.name;

  const zap = el("a", {
    className: "btn btn-zap btn-sm",
    href: `https://wa.me/?text=${encodeURIComponent(`Oi, ${m.name}! 🎄 Este é o seu link do nosso Amigo Secreto. É pessoal, não compartilhe: ${link}`)}`,
    target: "_blank",
    rel: "noopener noreferrer",
  });
  zap.append(icon("send"), "Zap");

  const copy = el("button", { type: "button", className: "btn btn-ghost btn-sm", ariaLabel: `Copiar link de ${m.name}` }, icon("copy"));
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast(`Link de ${m.name} copiado`);
    } catch {
      prompt("Copie o link:", link);
    }
  });

  const status = (ok, yes, no, iconName) =>
    el("span", { className: `pill ${ok ? "pill-green" : "pill-muted"}` }, icon(ok ? iconName : "clock"), ok ? yes : no);

  return el(
    "li",
    { className: "card member" },
    el("span", { className: "member-avatar", textContent: initials(m.name) }),
    el(
      "div",
      { className: "member-info" },
      el(
        "div",
        { className: "member-name" },
        el("strong", { textContent: m.name }),
        m.isKid ? el("span", { className: "pill pill-gold", textContent: "Criança" }) : null,
        isMe ? el("span", { className: "pill pill-red", textContent: "Você" }) : null
      ),
      el("div", { className: "member-status" }, status(m.opened, "Abriu", "Não abriu", "check"), status(m.hasWishlist, "Tem lista", "Sem lista", "heart"))
    ),
    el("div", { className: "member-actions" }, zap, copy)
  );
}

init();
