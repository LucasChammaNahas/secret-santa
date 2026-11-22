// /admin: if this browser already knows the admin's link, go straight to it.
// Otherwise ask for ADMIN_KEY, which the server trades for the admin's link token.
const ADMIN_TOKEN_KEY = "ss:adminToken";
const $ = (id) => document.getElementById(id);

function goToApp(token) {
  location.href = `/?tab=admin#${token}`;
}

async function isValidAdmin(token) {
  try {
    const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    return res.ok && (await res.json()).isAdmin;
  } catch {
    return false;
  }
}

async function init() {
  const saved = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (saved && (await isValidAdmin(saved))) return goToApp(saved);
  localStorage.removeItem(ADMIN_TOKEN_KEY); // stale, e.g. database recreated

  $("status").hidden = true;
  $("login-form").hidden = false;
  $("key").focus();
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("button");
  button.disabled = true;
  $("error").hidden = true;
  try {
    const res = await fetch("/api/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: $("key").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
    goToApp(data.token);
  } catch (err) {
    $("error").textContent = err.message;
    $("error").hidden = false;
    button.disabled = false;
  }
});

init();
