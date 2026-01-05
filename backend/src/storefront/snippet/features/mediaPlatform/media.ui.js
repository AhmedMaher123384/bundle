module.exports = [
  `
const findFooterEl = () => {
  try {
    return (
      document.querySelector("footer") ||
      document.querySelector('[role="contentinfo"]') ||
      document.querySelector("#footer") ||
      document.querySelector(".footer") ||
      null
    );
  } catch {
    return null;
  }
};
`,
  `
const setFabVisible = (btn, on) => {
  try {
    btn.style.opacity = on ? "1" : "0";
    btn.style.pointerEvents = on ? "auto" : "none";
    btn.style.transform = on ? "translateY(0)" : "translateY(10px)";
  } catch {}
};
`,
  `
const setupFabFooterReveal = (btn) => {
  try {
    const footer = findFooterEl();
    if (!footer) {
      setFabVisible(btn, true);
      return;
    }

    const applyInView = (inView) => setFabVisible(btn, Boolean(inView));

    try {
      const io = new IntersectionObserver(
        (entries) => {
          try {
            const e = (entries && entries[0]) || null;
            applyInView(Boolean(e && e.isIntersecting && e.intersectionRatio > 0));
          } catch {}
        },
        { root: null, threshold: [0, 0.01, 0.1] }
      );
      io.observe(footer);

      setTimeout(() => {
        try {
          const r = footer.getBoundingClientRect();
          applyInView(r.top < window.innerHeight && r.bottom > 0);
        } catch {}
      }, 0);
    } catch {
      const check = () => {
        try {
          const r = footer.getBoundingClientRect();
          applyInView(r.top < window.innerHeight && r.bottom > 0);
        } catch {}
      };
      window.addEventListener("scroll", check, { passive: true });
      window.addEventListener("resize", check, { passive: true });
      setTimeout(check, 0);
    }
  } catch {
    try {
      setFabVisible(btn, true);
    } catch {}
  }
};
`,
  `
const createFab = () => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", isArabic() ? "منصة الرفع" : "Upload platform");
  btn.style.position = "fixed";
  btn.style.bottom = "10px";
  btn.style.left = "12px";
  btn.style.zIndex = "100002";
  btn.style.border = "1px solid rgba(24,181,213,.55)";
  btn.style.cursor = "pointer";
  btn.style.borderRadius = "999px";
  btn.style.background = "#292929";
  btn.style.color = "#fff";
  btn.style.boxShadow = "0 14px 34px rgba(0,0,0,.28)";
  btn.style.display = "grid";
  btn.style.placeItems = "center";
  btn.style.userSelect = "none";
  btn.style.webkitUserSelect = "none";
  btn.style.lineHeight = "1";
  btn.style.fontWeight = "900";
  btn.style.transition = "opacity .18s ease,transform .18s ease,filter .18s ease";
  btn.style.opacity = "0";
  btn.style.pointerEvents = "none";
  btn.style.transform = "translateY(10px)";

  btn.onmouseenter = () => {
    btn.style.filter = "brightness(1.05)";
  };
  btn.onmouseleave = () => {
    btn.style.filter = "";
  };

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.style.display = "block";
  icon.style.color = "#fff";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute(
    "d",
    "M12 2l3.09 6.26 6.91 1.01-5 4.87 1.18 6.88L12 17.77 5.82 21.02 7 14.14 2 9.27l6.91-1.01L12 2z"
  );
  icon.appendChild(path);
  btn.appendChild(icon);

  const applySize = () => {
    try {
      const vw = Math.min(Number(window.innerWidth || 0) || 0, Number(window.innerHeight || 0) || 0);
      const s = vw && vw < 380 ? 42 : 48;
      btn.style.width = \`\${s}px\`;
      btn.style.height = \`\${s}px\`;
      btn.style.padding = "0";
      const isSmall = s < 46;
      icon.setAttribute("width", isSmall ? "18" : "20");
      icon.setAttribute("height", isSmall ? "18" : "20");
    } catch {}
  };
  applySize();
  try {
    window.addEventListener("resize", applySize, { passive: true });
  } catch {}

  return btn;
};
`,
  `
const buildSheet = () => {
  const overlay = document.createElement("div");
  overlay.className = "bundle-app-bottomsheet";
  overlay.style.alignItems = "flex-end";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "10px";
  overlay.style.zIndex = "100003";

  const panel = document.createElement("div");
  panel.className = "bundle-app-bottomsheet__panel";
  panel.style.width = "min(760px,100%)";
  panel.style.maxHeight = "85vh";
  panel.style.overflow = "auto";

  const head = document.createElement("div");
  head.className = "bundle-app-bottomsheet__head";

  const title = document.createElement("div");
  title.className = "bundle-app-bottomsheet__title";
  title.textContent = isArabic() ? "منصة الرفع" : "Media platform";

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = isArabic() ? "إغلاق" : "Close";
  close.style.padding = "6px 10px";
  close.style.borderRadius = "10px";
  close.style.border = "1px solid rgba(15,23,42,.12)";
  close.style.background = "#fff";
  close.style.color = "#0b1220";
  close.style.fontSize = "13px";
  close.style.fontWeight = "900";

  head.appendChild(title);
  head.appendChild(close);

  const body = document.createElement("div");
  body.style.padding = "0 14px 14px";

  const topRow = document.createElement("div");
  topRow.style.display = "flex";
  topRow.style.alignItems = "center";
  topRow.style.justifyContent = "space-between";
  topRow.style.gap = "10px";
  topRow.style.flexWrap = "wrap";
  topRow.style.padding = "0 0 12px";

  const tabs = document.createElement("div");
  tabs.style.display = "flex";
  tabs.style.gap = "8px";
  tabs.style.flexWrap = "wrap";

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.flexWrap = "wrap";

  topRow.appendChild(tabs);
  topRow.appendChild(actions);

  const uploads = document.createElement("div");
  uploads.style.display = "none";
  uploads.style.flexDirection = "column";
  uploads.style.gap = "8px";
  uploads.style.marginBottom = "10px";

  const content = document.createElement("div");
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "12px";

  body.appendChild(topRow);
  body.appendChild(uploads);
  body.appendChild(content);
  panel.appendChild(head);
  panel.appendChild(body);
  overlay.appendChild(panel);

  return { overlay, closeBtn: close, tabs, actions, uploads, content };
};
`,
  `
const pill = (label, active) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.style.border = "1px solid rgba(15,23,42,.12)";
  b.style.background = active ? "#0f172a" : "#fff";
  b.style.color = active ? "#fff" : "#0b1220";
  b.style.padding = "9px 12px";
  b.style.borderRadius = "999px";
  b.style.fontSize = "13px";
  b.style.fontWeight = "900";
  b.style.cursor = "pointer";
  b.style.boxShadow = active ? "0 14px 30px rgba(2,6,23,.14)" : "0 10px 24px rgba(0,0,0,.06)";
  return b;
};
`,
  `
const btnPrimary = (label) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.style.border = "0";
  b.style.cursor = "pointer";
  b.style.padding = "10px 12px";
  b.style.borderRadius = "12px";
  b.style.background = "#0f172a";
  b.style.color = "#fff";
  b.style.fontWeight = "900";
  b.style.fontSize = "13px";
  b.style.boxShadow = "0 18px 40px rgba(2,6,23,.16)";
  return b;
};
`,
  `
const btnGhost = (label) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.style.border = "1px solid rgba(15,23,42,.12)";
  b.style.cursor = "pointer";
  b.style.padding = "10px 12px";
  b.style.borderRadius = "12px";
  b.style.background = "#fff";
  b.style.color = "#0b1220";
  b.style.fontWeight = "900";
  b.style.fontSize = "13px";
  b.style.boxShadow = "0 10px 24px rgba(0,0,0,.06)";
  return b;
};
`,
  `
const fmtBytes = (n) => {
  const b = Number(n);
  if (!Number.isFinite(b) || b < 0) return "";
  if (b < 1024) return \`\${b} B\`;
  const kb = b / 1024;
  if (kb < 1024) return \`\${kb.toFixed(1)} KB\`;
  const mb = kb / 1024;
  if (mb < 1024) return \`\${mb.toFixed(1)} MB\`;
  const gb = mb / 1024;
  return \`\${gb.toFixed(2)} GB\`;
};
`,
  `
const renderEmpty = () => {
  const wrap = document.createElement("div");
  wrap.style.border = "1px dashed rgba(15,23,42,.18)";
  wrap.style.borderRadius = "14px";
  wrap.style.padding = "16px";
  wrap.style.background = "rgba(15,23,42,.02)";
  wrap.style.color = "rgba(15,23,42,.8)";
  wrap.style.fontSize = "13px";
  wrap.style.fontWeight = "900";
  wrap.textContent = isArabic() ? "مفيش ملفات مرفوعة لحد دلوقتي." : "No media uploaded yet.";
  return wrap;
};
`,
  `
const renderError = (msg) => {
  const wrap = document.createElement("div");
  wrap.style.border = "1px solid rgba(225,29,72,.22)";
  wrap.style.borderRadius = "14px";
  wrap.style.padding = "16px";
  wrap.style.background = "rgba(225,29,72,.06)";
  wrap.style.color = "#881337";
  wrap.style.fontSize = "13px";
  wrap.style.fontWeight = "900";
  wrap.textContent = String(msg || "Error");
  return wrap;
};
`,
  `
const renderLoading = () => {
  const wrap = document.createElement("div");
  wrap.style.border = "1px solid rgba(15,23,42,.10)";
  wrap.style.borderRadius = "14px";
  wrap.style.padding = "14px";
  wrap.style.background = "#fff";
  wrap.style.color = "rgba(15,23,42,.75)";
  wrap.style.fontSize = "13px";
  wrap.style.fontWeight = "900";
  wrap.textContent = isArabic() ? "جاري التحميل..." : "Loading...";
  return wrap;
};
`,
  `
const copyText = (text, onDone) => {
  try {
    const t = String(text || "");
    if (!t) return;

    const ok = () => {
      try {
        if (onDone) onDone(true);
      } catch {}
    };
    const bad = () => {
      try {
        if (onDone) onDone(false);
      } catch {}
    };
    const fallback = () => {
      try {
        window.prompt(isArabic() ? "انسخ الرابط" : "Copy link", t);
      } catch {}
      bad();
    };

    if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(ok).catch(fallback);
    } else {
      fallback();
    }
  } catch {}
};
`,
  `
const renderLinkBlock = (url) => {
  const u = String(url || "");
  if (!u) return null;

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.alignItems = "stretch";
  wrap.style.gap = "10px";
  wrap.style.padding = "10px";
  wrap.style.borderRadius = "12px";
  wrap.style.border = "1px solid rgba(24,181,213,.35)";
  wrap.style.background = "#292929";
  wrap.style.boxShadow = "0 10px 22px rgba(0,0,0,.14)";

  const a = document.createElement("a");
  a.href = u;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = u;
  a.style.flex = "1 1 auto";
  a.style.minWidth = "0";
  a.style.overflow = "hidden";
  a.style.textOverflow = "ellipsis";
  a.style.whiteSpace = "nowrap";
  a.style.direction = "ltr";
  a.style.fontSize = "14px";
  a.style.fontWeight = "950";
  a.style.color = "#18b5d5";
  a.style.textDecoration = "underline";
  a.style.textDecorationThickness = "2px";
  a.style.textUnderlineOffset = "3px";

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = isArabic() ? "انسخ الرابط" : "Copy link";
  copy.style.flex = "0 0 auto";
  copy.style.border = "0";
  copy.style.cursor = "pointer";
  copy.style.padding = "10px 14px";
  copy.style.borderRadius = "10px";
  copy.style.background = "#18b5d5";
  copy.style.color = "#fff";
  copy.style.fontSize = "13px";
  copy.style.fontWeight = "950";
  copy.style.boxShadow = "0 12px 26px rgba(0,0,0,.20)";
  copy.onclick = () => {
    try {
      const prev = isArabic() ? "انسخ الرابط" : "Copy link";
      copyText(u, (done) => {
        copy.textContent = done ? (isArabic() ? "تم النسخ" : "Copied") : prev;
        setTimeout(() => {
          copy.textContent = prev;
        }, 1200);
      });
    } catch {}
  };

  wrap.appendChild(a);
  wrap.appendChild(copy);
  return wrap;
};
`,
  `
const renderUploadRow = (rec) => {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "10px";
  wrap.style.padding = "12px";
  wrap.style.borderRadius = "14px";
  wrap.style.border = "1px solid rgba(24,181,213,.25)";
  wrap.style.background = "#292929";
  wrap.style.boxShadow = "0 10px 22px rgba(0,0,0,.14)";

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.justifyContent = "space-between";
  row.style.gap = "10px";

  const left = document.createElement("div");
  left.style.minWidth = "0";
  left.style.display = "flex";
  left.style.flexDirection = "column";
  left.style.gap = "4px";

  const name = document.createElement("div");
  name.style.fontSize = "12px";
  name.style.fontWeight = "950";
  name.style.color = "#fff";
  name.style.overflow = "hidden";
  name.style.textOverflow = "ellipsis";
  name.style.whiteSpace = "nowrap";
  name.textContent = String(rec.name || "");

  const sub = document.createElement("div");
  sub.style.fontSize = "12px";
  sub.style.fontWeight = "900";
  sub.style.color = rec.status === "error" ? "#fff" : "rgba(255,255,255,.78)";
  sub.textContent =
    rec.status === "uploading"
      ? isArabic()
        ? "جاري الرفع..."
        : "Uploading..."
      : rec.status === "done"
        ? isArabic()
          ? "تم الرفع"
          : "Uploaded"
        : rec.status === "error"
          ? String(rec.error || "Error")
          : isArabic()
            ? "في الانتظار"
            : "Queued";

  left.appendChild(name);
  left.appendChild(sub);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.alignItems = "center";
  right.style.gap = "10px";
  right.style.flex = "0 0 auto";

  const meta = document.createElement("div");
  meta.style.fontSize = "12px";
  meta.style.fontWeight = "900";
  meta.style.color = "rgba(255,255,255,.78)";
  meta.textContent = rec.size ? fmtBytes(rec.size) : "";
  right.appendChild(meta);

  row.appendChild(left);
  row.appendChild(right);
  wrap.appendChild(row);

  const url = String((rec && rec.url) || "");
  if (url && rec.status === "done") {
    const block = renderLinkBlock(url);
    if (block) wrap.appendChild(block);
  }

  return wrap;
};
`,
  `
const renderGrid = (items) => {
  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(2,minmax(0,1fr))";
  grid.style.gap = "10px";
  grid.style.alignItems = "stretch";
  grid.style.marginTop = "4px";

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i] || {};
    const src = String(it.secureUrl || it.url || "");

    const card = document.createElement("div");
    card.style.border = "1px solid rgba(24,181,213,.20)";
    card.style.borderRadius = "14px";
    card.style.overflow = "hidden";
    card.style.background = "#292929";
    card.style.boxShadow = "0 10px 22px rgba(0,0,0,.14)";

    const media = document.createElement("div");
    media.style.width = "100%";
    media.style.aspectRatio = "16 / 10";
    media.style.background = "rgba(255,255,255,.06)";
    media.style.display = "flex";
    media.style.alignItems = "center";
    media.style.justifyContent = "center";
    media.style.overflow = "hidden";

    if (String(it.resourceType) === "video") {
      const v = document.createElement("video");
      v.controls = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.src = src;
      v.style.width = "100%";
      v.style.height = "100%";
      v.style.objectFit = "cover";
      media.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.src = src;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      media.appendChild(img);
    }

    const meta = document.createElement("div");
    meta.style.padding = "10px";
    meta.style.display = "flex";
    meta.style.flexDirection = "column";
    meta.style.gap = "10px";

    const top = document.createElement("div");
    top.style.display = "flex";
    top.style.alignItems = "center";
    top.style.justifyContent = "space-between";
    top.style.gap = "10px";

    const name = document.createElement("div");
    name.style.flex = "1 1 auto";
    name.style.minWidth = "0";
    name.style.fontSize = "12px";
    name.style.fontWeight = "950";
    name.style.color = "#fff";
    name.style.overflow = "hidden";
    name.style.textOverflow = "ellipsis";
    name.style.whiteSpace = "nowrap";
    name.textContent = String(it.originalFilename || it.publicId || "");

    const badge = document.createElement("div");
    badge.style.flex = "0 0 auto";
    badge.style.fontSize = "11px";
    badge.style.fontWeight = "950";
    badge.style.padding = "5px 8px";
    badge.style.borderRadius = "999px";
    badge.style.border = "1px solid rgba(24,181,213,.35)";
    badge.style.background = "rgba(24,181,213,.10)";
    badge.style.color = "#fff";
    badge.textContent = (String(it.resourceType || "") || "media").toUpperCase();

    top.appendChild(name);
    top.appendChild(badge);
    meta.appendChild(top);

    if (src) {
      const block = renderLinkBlock(src);
      if (block) meta.appendChild(block);
    }

    card.appendChild(media);
    card.appendChild(meta);
    grid.appendChild(card);
  }

  return grid;
};
`
];

