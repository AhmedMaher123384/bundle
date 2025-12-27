const fs = require("fs");
const path = require("path");

let cached = null;

function readSnippetCss() {
  if (cached) return cached;
  const basePath = path.join(process.cwd(), "src", "storefront", "snippet", "styles", "base.css");
  const pickersPath = path.join(process.cwd(), "src", "storefront", "snippet", "styles", "pickers.css");
  const cssBase = fs.readFileSync(basePath, "utf8");
  const cssPickers = fs.readFileSync(pickersPath, "utf8");
  cached = { cssBase, cssPickers };
  return cached;
}

module.exports = { readSnippetCss };
