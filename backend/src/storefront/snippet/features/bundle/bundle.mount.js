const bundleLogicParts = require("./bundle.logic");
const { buildStylesJs } = require("../../core/stylesJs");
const bundleUiParts = require('./bundle.ui');

module.exports = function mountBundle(context) {
  const parts = context.parts;
  const merchantId = context.merchantId;
  const token = context.token;
  const cssBase = context.cssBase;
  const cssPickers = context.cssPickers;
  const cssTraditional = context.cssTraditional;

  parts.push("(function(){");
  parts.push("var g=null;try{g=globalThis}catch(e){g=window}if(!g)g=window;");
  parts.push("g.BundleApp=g.BundleApp||{};");
  parts.push(`var merchantId=${JSON.stringify(merchantId)};`);
  parts.push(`var token=${JSON.stringify(token)};`);
  parts.push('var scriptSrc=(document.currentScript&&document.currentScript.src)||"";');
  parts.push(
    'if(!scriptSrc){try{var ss=document.getElementsByTagName("script");for(var si=0;si<ss.length;si++){var s=ss[si];var src=(s&&s.src)||"";if(!src)continue;if(src.indexOf("/api/storefront/snippet.js")!==-1&&src.indexOf("merchantId="+encodeURIComponent(merchantId))!==-1){scriptSrc=src;break}}}catch(e){}}'
  );
  parts.push('var debug=false;try{debug=new URL(scriptSrc).searchParams.get("debug")==="1"}catch(e){}');
  parts.push("function log(){if(!debug)return;try{console.log.apply(console,arguments)}catch(e){}}");
  parts.push("function warn(){if(!debug)return;try{console.warn.apply(console,arguments)}catch(e){}}");

  parts.push(buildStylesJs({ cssBase, cssPickers, cssTraditional }));
  parts.push('try{if(typeof ensureStyles==="function")ensureStyles()}catch(e){}');
  parts.push('try{if(typeof ensureTraditionalStyles==="function")ensureTraditionalStyles()}catch(e){}');

  for (let i = 0; i < bundleLogicParts.length; i += 1) parts.push(bundleLogicParts[i]);
  for (let i = 0; i < bundleUiParts.length; i += 1) parts.push(bundleUiParts[i]);
  parts.push("})();");
};
