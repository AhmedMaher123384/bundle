function buildStylesJs({ cssBase, cssPickers }) {
  const base = JSON.stringify(String(cssBase || ""));
  const pickers = JSON.stringify(String(cssPickers || ""));
  return [
    `var __bundleAppCssBase=${base};`,
    `var __bundleAppCssPickers=${pickers};`,
    'function __bundleAppInjectStyle(id,css){try{if(!css)return;if(document.getElementById(id))return;var s=document.createElement("style");s.id=id;s.textContent=String(css||"");document.head.appendChild(s)}catch(e){}}',
    'function ensurePickerStyles(){try{if(g.BundleAppUi&&typeof g.BundleAppUi.ensurePickerStyles==="function"){g.BundleAppUi.ensurePickerStyles();return}}catch(e){}__bundleAppInjectStyle("bundle-app-pickers-style",__bundleAppCssPickers)}',
    'function ensureStyles(){__bundleAppInjectStyle("bundle-app-style",__bundleAppCssBase)}'
  ].join("");
}

module.exports = { buildStylesJs };
