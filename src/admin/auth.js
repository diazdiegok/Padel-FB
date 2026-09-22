import { AUTH_KEY } from "./constants.js";
import { $, setMsg } from "./ui.js";

export function createAuth(ctx, { onLogin }) {
  let passReady = false;

  function keepLogin(nextToken = ctx.token, nextExp) {
    if (!nextToken) return;
    let current = {};
    try {
      current = JSON.parse(localStorage.getItem(AUTH_KEY) || "{}");
    } catch {}
    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({
        token: nextToken,
        exp: nextExp || current.exp,
      })
    );
    sessionStorage.removeItem(AUTH_KEY);
  }

  function clearLogin() {
    ctx.token = "";
    localStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(AUTH_KEY);
  }

  function isLoggedIn() {
    try {
      const raw = localStorage.getItem(AUTH_KEY) || sessionStorage.getItem(AUTH_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data?.token || !data.exp || Date.now() > data.exp) {
        clearLogin();
        return false;
      }
      ctx.token = data.token;
      return true;
    } catch {
      return false;
    }
  }

  async function authRequest(path, body) {
    if (!ctx.API_URL) throw new Error("Falta configurar la API segura del sitio.");
    const res = await fetch(`${ctx.API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "No se pudo validar el acceso.");
    return data;
  }

  function bind() {
    $("login-back")?.addEventListener("click", () => {
      passReady = false;
      $("step-otp").hidden = true;
      $("step-pass").hidden = false;
      $("otp").value = "";
      setMsg($("login-msg"), "");
    });

    $("login-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      setMsg($("login-msg"), "Validando…");
      try {
        const credentials = {
          user: $("user").value,
          password: $("pass").value,
        };
        if (!passReady) {
          await authRequest("/auth/password", credentials);
          passReady = true;
          $("step-pass").hidden = true;
          $("step-otp").hidden = false;
          $("otp").focus();
          setMsg($("login-msg"), "");
          return;
        }
        const session = await authRequest("/auth/login", { ...credentials, otp: $("otp").value });
        ctx.token = session.token;
        keepLogin(session.token, session.exp);
        onLogin();
      } catch (err) {
        clearLogin();
        setMsg($("login-msg"), err.message, "err");
      }
    });

    $("admin-logout")?.addEventListener("click", () => {
      clearLogin();
      location.reload();
    });
  }

  return { bind, isLoggedIn, keepLogin, clearLogin, authRequest };
}
