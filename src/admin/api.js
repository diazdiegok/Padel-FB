import { AUTH_KEY } from "./constants.js";

export function toB64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

export function fromB64(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

export function createApi(ctx) {
  function getPublishToken() {
    try {
      const data = JSON.parse(localStorage.getItem(AUTH_KEY) || sessionStorage.getItem(AUTH_KEY) || "{}");
      return String(data.token || "").trim();
    } catch {
      return "";
    }
  }

  function publishError(err) {
    const m = String(err?.message || err);
    if (/does not match/i.test(m)) {
      return "El sitio se actualizó en otro lado. Tocá Guardar de nuevo.";
    }
    if (/bad credentials/i.test(m) || /\b401\b/.test(m)) {
      return "No se pudo guardar. Volvé a iniciar sesión en el admin.";
    }
    return m;
  }

  function usePublishToken() {
    ctx.token = getPublishToken();
    if (!ctx.API_URL || !ctx.token) {
      return { ok: false, message: "La sesión segura venció. Volvé a ingresar al admin." };
    }
    return { ok: true };
  }

  async function api(path, opts = {}) {
    if (!ctx.API_URL) throw new Error("Falta configurar la API segura del sitio.");
    ctx.token = getPublishToken();
    const res = await fetch(`${ctx.API_URL}/github`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + ctx.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path,
        method: opts.method || "GET",
        body: opts.body,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(publishError({ message: data.message || "Error GitHub " + res.status }));
    }
    return data;
  }

  async function readRemoteJson(filePath, fallback) {
    try {
      const file = await api(`/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}?ref=main`);
      const raw = String(file.content || "").replace(/\n/g, "");
      if (!raw) return fallback;
      return JSON.parse(fromB64(raw));
    } catch (error) {
      if (/\b404\b|not found|no encontrado/i.test(String(error?.message || error))) return fallback;
      throw error;
    }
  }

  async function getFileSha(filePath) {
    try {
      const data = await api(`/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
      return data.sha || null;
    } catch (error) {
      if (/\b404\b|not found|no encontrado/i.test(String(error?.message || error))) return null;
      throw error;
    }
  }

  async function publishFile(filePath, content, message, alreadyB64 = false) {
    const payload = alreadyB64 ? content : toB64(content);
    let lastErr;
    for (let i = 0; i < 2; i++) {
      try {
        const sha = await getFileSha(filePath);
        const body = { message, content: payload, branch: "main" };
        if (sha) body.sha = sha;
        await api(`/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        return;
      } catch (err) {
        lastErr = err;
        if (!/does not match/i.test(String(err?.message || err)) || i === 1) throw err;
      }
    }
    throw lastErr;
  }

  async function publishFiles(files, message) {
    const ref = await api(`/repos/${ctx.owner}/${ctx.repo}/git/refs/heads/main`);
    const baseSha = ref.object.sha;
    const baseCommit = await api(`/repos/${ctx.owner}/${ctx.repo}/git/commits/${baseSha}`);
    const tree = await api(`/repos/${ctx.owner}/${ctx.repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: files.map((f) => ({
          path: f.path,
          mode: "100644",
          type: "blob",
          content: f.content,
        })),
      }),
    });
    const commit = await api(`/repos/${ctx.owner}/${ctx.repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: [baseSha],
      }),
    });
    await api(`/repos/${ctx.owner}/${ctx.repo}/git/refs/heads/main`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha }),
    });
  }

  return {
    api,
    readRemoteJson,
    publishFile,
    publishFiles,
    getPublishToken,
    usePublishToken,
    publishError,
    fromB64,
    toB64,
  };
}
