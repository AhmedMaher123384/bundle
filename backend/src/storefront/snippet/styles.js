const fs = require("fs");
const path = require("path");

let cached = null;
let cachedSig = "";

function readSnippetCss() {
  const basePath = path.join(__dirname, "styles", "base.css");

  let baseM = 0;
  if (fs.existsSync(basePath)) baseM = Number(fs.statSync(basePath).mtimeMs || 0);

  const sig = String(baseM);
  if (cached && cachedSig === sig) return cached;

  const cssBase = fs.readFileSync(basePath, "utf8");
  const cssPickers = "";
  const cssTraditional = "";

  cached = { cssBase, cssPickers, cssTraditional };
  cachedSig = sig;
  return cached;
}

module.exports = { readSnippetCss };
