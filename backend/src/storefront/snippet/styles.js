const fs = require("fs");
const path = require("path");

let cached = null;

function readSnippetCss() {
  if (cached) return cached;
  const basePath = path.join(__dirname, "styles", "base.css");
  const pickersPath = path.join(__dirname, "styles", "pickers.css");
  const traditionalPath = path.join(__dirname, "features", "bundle", "bundle-traditional.css");
  const cssBase = fs.readFileSync(basePath, "utf8");
  const cssPickers = fs.readFileSync(pickersPath, "utf8");
  const cssTraditional = fs.readFileSync(traditionalPath, "utf8");
  cached = { cssBase, cssPickers, cssTraditional };
  return cached;
}

module.exports = { readSnippetCss };
