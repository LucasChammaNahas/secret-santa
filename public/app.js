// Each person's link looks like https://…/#<token>. The hash never reaches the server logs.
const token = location.hash.slice(1);

// Several people may share a phone, so local state is namespaced per link.
const storeKey = (k) => `ss:${token.slice(0, 8)}:${k}`;

const $ = (id) => document.getElementById(id);

const state = {
  me: null,
  side: "giving", // which chat is selected
  messages: { giving: [], receiving: [] },
  lastId: { giving: 0, receiving: 0 },
};

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

// Small DOM helper: el("li", { className: "x" }, child1, "text")
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

async function init() {
  if (!token) {
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

  $("status").hidden = true;
  $("app").hidden = false;
  $("hello").hidden = false;
  $("my-name").textContent = state.me.name;

  setupTabs();
  setupFriend();
  setupMyList();
  setupChats();
  if (state.me.isAdmin) setupAdmin();
}

// ---------- Tabs ----------

function setupTabs() {
  document.querySelectorAll("#tabs button").forEach((btn) =>
    btn.addEventListener("click", () => showTab(btn.dataset.tab))
  );
}

function showTab(id) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== id));

  if (id === "tab-friend" && isRevealed()) loadTheirList();
  if (id === "tab-chats") {
    scrollChatToBottom();
    markSeen();
  }
  if (id === "tab-admin") loadAdmin();
}

// ---------- Amigo (reveal + their list) ----------

// Remember the reveal per receiver, so a redraw asks to reveal again.
function isRevealed() {
  return state.me.drawn && localStorage.getItem(storeKey("revealed")) === state.me.receiver;
}

function setupFriend() {
  if (!state.me.drawn) {
    $("not-drawn").hidden = false;
    return;
  }
  $("drawn").hidden = false;
  $("receiver").textContent = state.me.receiver;
  document.querySelectorAll(".receiver-name").forEach((n) => (n.textContent = state.me.receiver));

  $("reveal-btn").addEventListener("click", () => {
    localStorage.setItem(storeKey("revealed"), state.me.receiver);
    applyReveal();
  });
  applyReveal();
}

function applyReveal() {
  const revealed = isRevealed();
  $("reveal-btn").hidden = revealed;
  $("receiver").hidden = !revealed;
  $("their-list-card").hidden = !revealed;
  document.querySelectorAll(".giving-label").forEach(
    (n) => (n.textContent = revealed ? state.me.receiver : "Quem eu tirei")
  );
  updateChatHint();
  if (revealed) loadTheirList();
}

async function loadTheirList() {
  try {
    const { items } = await api("/api/receiver/wishlist");
    $("their-list").replaceChildren(...items.map((item) => wishItem(item)));
    $("their-list-empty").hidden = items.length > 0;
  } catch (err) {
    $("their-list-empty").hidden = false;
    $("their-list-empty").textContent = `Erro ao carregar: ${err.message}`;
  }
}

// ---------- Minha lista ----------

function setupMyList() {
  const form = $("wish-form");
  form.querySelectorAll("input[name=kind]").forEach((r) => r.addEventListener("change", updateWishForm));
  updateWishForm();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const kind = form.elements.kind.value;
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const { item } = await api("/api/wishlist", {
        method: "POST",
        body: { kind, text: $("wish-text").value, url: kind === "item" ? $("wish-url").value : "" },
      });
      $("my-list").append(wishItem(item, { deletable: true }));
      form.reset();
      updateWishForm();
      updateMyListEmpty();
      $("wish-text").focus();
    } catch (err) {
      alert(err.message);
    } finally {
      submit.disabled = false;
    }
  });

  loadMyList();
}

function updateWishForm() {
  const isItem = $("wish-form").elements.kind.value === "item";
  $("wish-url").hidden = !isItem;
  $("wish-text").placeholder = isItem
    ? "Ex.: Fone de ouvido Bluetooth preto"
    : "Ex.: Algo para a cozinha, gosto de cafés especiais";
}

async function loadMyList() {
  try {
    const { items } = await api("/api/wishlist");
    $("my-list").replaceChildren(...items.map((item) => wishItem(item, { deletable: true })));
  } catch (err) {
    alert(`Erro ao carregar sua lista: ${err.message}`);
  }
  updateMyListEmpty();
}

function updateMyListEmpty() {
  $("my-list-empty").hidden = $("my-list").children.length > 0;
}

function wishItem(item, { deletable = false } = {}) {
  const body = el("div", { className: "wish-body" }, el("span", { textContent: item.text }));
  if (item.url) {
    body.append(
      el("a", {
        href: item.url,
        target: "_blank",
        rel: "noopener noreferrer",
        className: "wish-link",
        textContent: `${new URL(item.url).hostname.replace(/^www\./, "")} ↗`,
      })
    );
  }

  const li = el(
    "li",
    { className: "wish" },
    el("span", { className: `kind kind-${item.kind}`, textContent: item.kind === "idea" ? "Ideia" : "Item" }),
    body
  );

  if (deletable) {
    const remove = el("button", { type: "button", className: "icon-btn", textContent: "✕", title: "Remover" });
    remove.addEventListener("click", async () => {
      if (!confirm(`Remover "${item.text}"?`)) return;
      try {
        await api(`/api/wishlist/${item.id}`, { method: "DELETE" });
        li.remove();
        updateMyListEmpty();
      } catch (err) {
        alert(err.message);
      }
    });
    li.append(remove);
  }
  return li;
}

// ---------- Chats ----------
// Polls every 5 s while the page is visible. The dot on the tab shows unread messages.

const POLL_MS = 5000;
let polling = false;

function setupChats() {
  if (!state.me.drawn) {
    $("chats-not-drawn").hidden = false;
    return;
  }
  $("chats").hidden = false;

  document.querySelectorAll("#chat-sides button").forEach((b) =>
    b.addEventListener("click", () => selectSide(b.dataset.side))
  );
  $("chat-form").addEventListener("submit", sendMessage);
  selectSide("giving");

  poll();
  setInterval(() => document.visibilityState === "visible" && poll(), POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") poll();
  });
}

function selectSide(side) {
  state.side = side;
  document.querySelectorAll("#chat-sides button").forEach((b) => b.classList.toggle("active", b.dataset.side === side));
  updateChatHint();
  renderMessages();
  markSeen();
}

function updateChatHint() {
  if (!state.me?.drawn) return;
  $("chat-hint").textContent = state.side === "giving"
    ? `Converse com ${isRevealed() ? state.me.receiver : "quem você tirou"} sem revelar quem você é.`
    : "Quem tirou você está do outro lado. Você não sabe quem é!";
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const data = await api(`/api/chats?giving=${state.lastId.giving}&receiving=${state.lastId.receiving}`);
    addMessages("giving", data.giving);
    addMessages("receiving", data.receiving);
    markSeen();
  } catch {
    // Network hiccup: the next poll retries.
  } finally {
    polling = false;
  }
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
  else $("messages").append(el("li", { className: "empty", textContent: "Nenhuma mensagem ainda." }));
  scrollChatToBottom();
}

function appendMessages(msgs) {
  const list = $("messages");
  list.querySelector(".empty")?.remove();
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  list.append(
    ...msgs.map((m) =>
      el(
        "li",
        { className: m.mine ? "msg mine" : "msg theirs" },
        el("span", { textContent: m.body }),
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

async function sendMessage(e) {
  e.preventDefault();
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;
  const side = state.side;
  input.disabled = true;
  try {
    const { message } = await api(`/api/chats/${side}`, { method: "POST", body: { body: text } });
    input.value = "";
    addMessages(side, [message]);
    markSeen();
  } catch (err) {
    alert(err.message);
  } finally {
    input.disabled = false;
    input.focus();
  }
}

// Unread = messages from the other side newer than what was on screen last time.
const seenKey = (side) => storeKey(`seen:${side}`);

function markSeen() {
  const visible = !$("tab-chats").hidden && document.visibilityState === "visible";
  if (visible && state.me.drawn) localStorage.setItem(seenKey(state.side), state.lastId[state.side]);
  updateDots();
}

function hasUnread(side) {
  const seen = Number(localStorage.getItem(seenKey(side)) || 0);
  return state.messages[side].some((m) => !m.mine && m.id > seen);
}

function updateDots() {
  const unread = { giving: hasUnread("giving"), receiving: hasUnread("receiving") };
  document.querySelectorAll("#chat-sides button").forEach((b) => (b.querySelector(".dot").hidden = !unread[b.dataset.side]));
  $("chats-dot").hidden = !(unread.giving || unread.receiving);
}

function formatTime(sqliteUtc) {
  // D1 stores "YYYY-MM-DD HH:MM:SS" in UTC.
  return new Date(sqliteUtc.replace(" ", "T") + "Z").toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------- Admin ----------

function setupAdmin() {
  $("admin-tab-btn").hidden = false;
  $("draw-btn").addEventListener("click", async () => {
    if (!confirm("Fazer o sorteio agora?")) return;
    await adminAction("/api/admin/draw");
  });
  $("reset-btn").addEventListener("click", async () => {
    if (!confirm("Reiniciar o sorteio? Todas as conversas serão apagadas. As listas de desejos continuam.")) return;
    await adminAction("/api/admin/reset");
  });
}

async function adminAction(path) {
  try {
    await api(path, { method: "POST" });
  } catch (err) {
    alert(err.message);
  }
  // The admin is also a participant, so their own views change too.
  location.reload();
}

async function loadAdmin() {
  let data;
  try {
    data = await api("/api/admin/members");
  } catch (err) {
    $("draw-status").textContent = `Erro: ${err.message}`;
    return;
  }

  const opened = data.members.filter((m) => m.opened).length;
  const filled = data.members.filter((m) => m.hasWishlist).length;
  $("draw-status").textContent =
    `${data.drawn ? "✅ Sorteio feito." : "Sorteio ainda não feito."} ` +
    `${opened}/${data.members.length} abriram · ${filled}/${data.members.length} com lista`;
  $("draw-btn").hidden = data.drawn;
  $("reset-btn").hidden = !data.drawn;

  $("member-list").replaceChildren(...data.members.map(memberRow));
}

function memberRow(m) {
  const link = `${location.origin}/#${m.token}`;
  const copy = el("button", { type: "button", className: "small", textContent: "Copiar link" });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = "Copiado!";
      setTimeout(() => (copy.textContent = "Copiar link"), 1500);
    } catch {
      prompt("Copie o link:", link);
    }
  });

  return el(
    "li",
    {},
    el("span", { className: "member-name", textContent: m.name + (m.isKid ? " 🧒" : "") }),
    el("span", { className: "flags", textContent: `${m.opened ? "👀" : "·"} ${m.hasWishlist ? "🎁" : "·"}` }),
    copy
  );
}

init();
