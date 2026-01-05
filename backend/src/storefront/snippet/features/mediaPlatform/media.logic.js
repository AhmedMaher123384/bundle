const uiParts = require("./media.ui");

module.exports = [
  `(function(){\n`,
  `const g = (() => { try { return globalThis; } catch { return window; } })() || window;\n`,
  `g.BundleApp = g.BundleApp || {};\n`,
  `const debug = (() => { try { return new URL(scriptSrc).searchParams.get("debug") === "1"; } catch { return false; } })();\n`,
  `const warn = (...args) => { if (!debug) return; try { console.warn(...args); } catch {} };\n`,
  `
const getBackendOrigin = () => {
  try {
    return new URL(scriptSrc).origin;
  } catch {
    return "";
  }
};
`,
  `
const buildUrl = (path, params = {}) => {
  const origin = getBackendOrigin();
  if (!origin) return null;
  const u = new URL(origin + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || String(v) === "") continue;
    u.searchParams.set(String(k), String(v));
  }
  u.searchParams.set("merchantId", merchantId);
  u.searchParams.set("token", token);
  return u.toString();
};
`,
  `
const fetchJson = async (url, opts = {}) => {
  const r = await fetch(url, opts || {});
  const t = await r.text();
  let j = null;
  try {
    j = t ? JSON.parse(t) : null;
  } catch {
    throw new Error("Invalid JSON response");
  }
  if (!r.ok) {
    const msg = (j && j.message) || \`HTTP \${r.status}\`;
    const err = new Error(msg);
    err.status = r.status;
    err.details = j;
    throw err;
  }
  return j;
};
`,
  `
const postJson = (url, body) =>
  fetchJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
`,
  `
const pageLang = () => {
  try {
    const el = document && document.documentElement;
    const b = document && document.body;
    const l = (el && el.getAttribute && el.getAttribute("lang")) || (b && b.getAttribute && b.getAttribute("lang")) || "";
    return String(l || "").toLowerCase();
  } catch {
    return "";
  }
};
`,
  `
const isArabic = () => {
  try {
    const l = pageLang();
    if (l && l.indexOf("ar") === 0) return true;
    const nl = String((navigator && navigator.language) || "").toLowerCase();
    return Boolean(nl && nl.indexOf("ar") === 0);
  } catch {
    return false;
  }
};
`,
  `
const isRtl = () => {
  try {
    const d = (document && document.documentElement && document.documentElement.dir) || "";
    if (d && String(d).toLowerCase() === "rtl") return true;
    const bd = (document && document.body && document.body.dir) || "";
    if (bd && String(bd).toLowerCase() === "rtl") return true;
    const cs = window.getComputedStyle ? window.getComputedStyle(document.body || document.documentElement) : null;
    const dir = cs && cs.direction ? String(cs.direction).toLowerCase() : "";
    if (dir === "rtl") return true;
    return isArabic();
  } catch {
    return false;
  }
};
`,
  `
const ensureOnce = () => {
  try {
    if (g.BundleApp && g.BundleApp.__mediaPlatformMounted) return false;
    g.BundleApp.__mediaPlatformMounted = true;
    return true;
  } catch {
    return true;
  }
};
`,
  ...uiParts,
  `
const loadAssets = async (resourceType, page, limit) => {
  const url = buildUrl("/api/proxy/media/assets", { resourceType: resourceType || "", page: page || 1, limit: limit || 24 });
  if (!url) throw new Error("Missing backend origin");
  return await fetchJson(url);
};
`,
  `
const getSignature = async (resourceType) => {
  const url = buildUrl("/api/proxy/media/signature", {});
  if (!url) throw new Error("Missing backend origin");
  return await postJson(url, { resourceType: resourceType || "image" });
};
`,
  `
const recordAsset = async (cloud) => {
  const url = buildUrl("/api/proxy/media/assets", {});
  if (!url) throw new Error("Missing backend origin");
  return await postJson(url, { cloudinary: cloud });
};
`,
  `
const uploadToCloudinary = async (file, sign) => {
  const c = sign && sign.cloudinary ? sign.cloudinary : null;
  if (!c || !c.uploadUrl || !c.apiKey || !c.signature || !c.timestamp || !c.folder) throw new Error("Invalid signature");

  const fd = new FormData();
  fd.append("file", file);
  fd.append("api_key", String(c.apiKey));
  fd.append("timestamp", String(c.timestamp));
  fd.append("signature", String(c.signature));
  fd.append("folder", String(c.folder));
  if (c.tags) fd.append("tags", String(c.tags));
  if (c.context) fd.append("context", String(c.context));

  const r = await fetch(String(c.uploadUrl), { method: "POST", body: fd });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (j && j.error && j.error.message) || "Upload failed";
    throw new Error(msg);
  }
  return j;
};
`,
  `
const mount = () => {
  try {
    if (!ensureOnce()) return;
    try {
      if (typeof ensureStyles === "function") ensureStyles();
    } catch {}

    const fab = createFab();
    try {
      setupFabFooterReveal(fab);
    } catch {}

    let sheetEl = null;
    fab.onclick = () => {
      try {
        if (sheetEl) return;

        const sheet = buildSheet();
        sheetEl = sheet.overlay;

        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = "image/*,video/*";
        input.style.display = "none";
        document.body.appendChild(input);

        const close = () => {
          try {
            if (sheetEl) sheetEl.remove();
          } catch {}
          try {
            if (input && input.remove) input.remove();
          } catch {}
          sheetEl = null;
        };

        sheet.closeBtn.onclick = close;
        sheet.overlay.addEventListener("click", (ev) => {
          try {
            if (ev.target === sheet.overlay) close();
          } catch {}
        });

        const state = {
          type: "",
          page: 1,
          limit: 24,
          loading: false,
          items: [],
          total: 0,
          error: "",
          uploads: [],
          uploading: false
        };

        const render = () => {
          try {
            sheet.tabs.innerHTML = "";
            sheet.actions.innerHTML = "";
            sheet.uploads.innerHTML = "";
            sheet.content.innerHTML = "";

            const labels = isArabic()
              ? { all: "الكل", img: "صور", vid: "فيديو", up: "رفع ملفات", ref: "تحديث" }
              : { all: "All", img: "Images", vid: "Videos", up: "Upload", ref: "Refresh" };

            const allBtn = pill(labels.all, state.type === "");
            const imgBtn = pill(labels.img, state.type === "image");
            const vidBtn = pill(labels.vid, state.type === "video");

            const setTab = (t) => {
              state.type = t || "";
              state.page = 1;
              state.items = [];
              state.total = 0;
              state.error = "";
              render();
              fetchAndRender();
            };

            allBtn.onclick = () => setTab("");
            imgBtn.onclick = () => setTab("image");
            vidBtn.onclick = () => setTab("video");
            sheet.tabs.appendChild(allBtn);
            sheet.tabs.appendChild(imgBtn);
            sheet.tabs.appendChild(vidBtn);

            const uploadBtn = btnPrimary(labels.up);
            uploadBtn.onclick = () => {
              try {
                input.click();
              } catch {}
            };
            const refreshBtn = btnGhost(labels.ref);
            refreshBtn.onclick = () => fetchAndRender();
            sheet.actions.appendChild(uploadBtn);
            sheet.actions.appendChild(refreshBtn);

            if (state.uploads.length) {
              sheet.uploads.style.display = "flex";
              for (let i = 0; i < state.uploads.length; i += 1) {
                sheet.uploads.appendChild(renderUploadRow(state.uploads[i]));
              }
            } else {
              sheet.uploads.style.display = "none";
            }

            if (state.loading && state.page === 1) sheet.content.appendChild(renderLoading());
            if (state.error) sheet.content.appendChild(renderError(state.error));

            if (!state.loading && !state.error) {
              if (!state.items.length) sheet.content.appendChild(renderEmpty());
              else sheet.content.appendChild(renderGrid(state.items));

              if (state.total > state.items.length) {
                const more = btnPrimary(isArabic() ? "تحميل المزيد" : "Load more");
                more.onclick = () => {
                  state.page += 1;
                  fetchAndRender();
                };
                sheet.content.appendChild(more);
              }
            }
          } catch {}
        };

        const fetchAndRender = async () => {
          if (state.loading) return;
          state.loading = true;
          render();
          try {
            const data = await loadAssets(state.type, state.page, state.limit);
            const items = Array.isArray(data && data.items) ? data.items : [];
            state.total = Number((data && data.total) || 0) || 0;
            state.items = state.page === 1 ? items : state.items.concat(items);
            state.loading = false;
            render();
          } catch (err) {
            state.loading = false;
            state.error = String((err && err.message) || err || "");
            render();
          }
        };

        const runUploads = async (files) => {
          if (state.uploading) return;
          state.uploading = true;
          state.uploads = [];

          for (let i = 0; i < files.length; i += 1) {
            const f = files[i];
            if (!f) continue;
            state.uploads.push({ name: String(f.name || ""), size: Number(f.size || 0) || 0, status: "queued", error: "", url: "" });
          }

          render();

          for (let i = 0; i < files.length; i += 1) {
            const file = files[i];
            if (!file) continue;
            const rec = state.uploads[i];
            try {
              rec.status = "uploading";
              rec.error = "";
              rec.url = "";
              render();
              const rt = String(file.type || "").indexOf("video") === 0 ? "video" : "image";
              const sign = await getSignature(rt);
              const uploaded = await uploadToCloudinary(file, sign);
              await recordAsset(uploaded);
              rec.url = String((uploaded && (uploaded.secure_url || uploaded.url)) || "");
              rec.status = "done";
              render();
            } catch (e) {
              rec.status = "error";
              rec.error = String((e && e.message) || e || "Error");
              render();
            }
          }

          state.uploading = false;
          render();
          state.type = state.type || "";
          state.page = 1;
          state.items = [];
          state.total = 0;
          state.error = "";
          render();
          fetchAndRender();
        };

        input.onchange = () => {
          try {
            const fs = input.files ? Array.from(input.files) : [];
            input.value = "";
            if (!fs.length) return;
            runUploads(fs);
          } catch {}
        };

        document.body.appendChild(sheet.overlay);
        render();
        fetchAndRender();
      } catch (e) {
        warn("media platform open failed", e);
        try {
          if (sheetEl) sheetEl.remove();
        } catch {}
        sheetEl = null;
      }
    };

    document.body.appendChild(fab);
  } catch (e) {
    warn("media platform mount failed", e);
  }
};
`,
  `try { mount(); } catch {}\n`,
  `})();\n`
];
