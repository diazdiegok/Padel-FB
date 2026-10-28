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

  function otpCells() {
    return [...document.querySelectorAll("[data-otp-i]")];
  }

  function syncOtpValue() {
    const code = otpCells()
      .map((el) => String(el.value || "").replace(/\D/g, "").slice(0, 1))
      .join("");
    const hidden = $("otp");
    if (hidden) hidden.value = code;
    otpCells().forEach((el) => el.classList.toggle("is-filled", Boolean(el.value)));
    return code;
  }

  function clearOtpCells() {
    otpCells().forEach((el) => {
      el.value = "";
      el.classList.remove("is-filled");
    });
    if ($("otp")) $("otp").value = "";
  }

  function setOtpMode(on) {
    $("gate")?.classList.toggle("is-otp", on);
    $("step-otp").hidden = !on;
    $("step-pass").hidden = on;
    if (on) {
      clearOtpCells();
      otpCells()[0]?.focus();
    }
  }

  function setVerifying(on) {
    const btn = $("login");
    const label = btn?.querySelector(".admin-otp-submit-label");
    btn?.classList.toggle("is-verifying", on);
    if (label) label.textContent = on ? "Verificando código…" : "Entrar";
    btn && (btn.disabled = on);
    $("login-back") && ($("login-back").disabled = on);
    otpCells().forEach((el) => (el.disabled = on));
  }

  function bindOtpGrid() {
    const cells = otpCells();
    cells.forEach((cell, i) => {
      cell.addEventListener("input", (e) => {
        const v = String(e.target.value || "").replace(/\D/g, "");
        e.target.value = v.slice(-1);
        syncOtpValue();
        if (v && i < cells.length - 1) cells[i + 1].focus();
        if (syncOtpValue().length === 6) $("login-form")?.requestSubmit();
      });
      cell.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !e.target.value && i > 0) {
          cells[i - 1].focus();
          cells[i - 1].value = "";
          syncOtpValue();
        }
        if (e.key === "ArrowLeft" && i > 0) cells[i - 1].focus();
        if (e.key === "ArrowRight" && i < cells.length - 1) cells[i + 1].focus();
      });
      cell.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = String(e.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
        text.split("").forEach((ch, idx) => {
          if (cells[idx]) cells[idx].value = ch;
        });
        syncOtpValue();
        const next = cells[Math.min(text.length, cells.length - 1)];
        next?.focus();
        if (text.length === 6) $("login-form")?.requestSubmit();
      });
    });
  }

  function bind() {
    bindOtpGrid();

    $("login-back")?.addEventListener("click", () => {
      passReady = false;
      setVerifying(false);
      setOtpMode(false);
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
          setOtpMode(true);
          setMsg($("login-msg"), "");
          return;
        }
        const otp = syncOtpValue();
        if (otp.length !== 6) {
          setMsg($("login-msg"), "Completá los 6 dígitos del autenticador.", "err");
          otpCells().find((el) => !el.value)?.focus();
          return;
        }
        setVerifying(true);
        setMsg($("login-msg"), "");
        const session = await authRequest("/auth/login", { ...credentials, otp });
        ctx.token = session.token;
        keepLogin(session.token, session.exp);
        onLogin();
      } catch (err) {
        clearLogin();
        setVerifying(false);
        setMsg($("login-msg"), err.message, "err");
        if (passReady) {
          clearOtpCells();
          otpCells()[0]?.focus();
        }
      }
    });

    $("admin-logout")?.addEventListener("click", () => {
      clearLogin();
      location.reload();
    });
  }

  return { bind, isLoggedIn, keepLogin, clearLogin, authRequest };
}
