const fs = require("fs");
const path = require("path");

let cached = null;

function readSnippetCss() {
  if (cached) return cached;
  const basePath = path.join(__dirname, "styles", "base.css");
  const cssBase = fs.readFileSync(basePath, "utf8");
  const cssPickers = "";
  const cssTraditional = "";
  cached = { cssBase, cssPickers, cssTraditional };
  return cached;
}

module.exports = { readSnippetCss };
