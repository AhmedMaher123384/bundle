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
  parts.push("g.BundleApp=g.BundleApp||{};g.BundleApp.__verboseErrors=true;");
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

  for (let i = 0; i < bundleLogicParts.length; i += 1) parts.push(bundleLogicParts[i]);

  parts.push(
    'async function addItemsToCart(items){if(storeClosedNow()){var e0=new Error("store_closed");e0.status=410;throw e0}var cart=window.salla&&window.salla.cart;if(!cart||typeof cart.addItem!=="function")throw new Error("Salla cart API not available");function withTimeout(p,ms){return Promise.race([p,new Promise(function(_,rej){setTimeout(function(){rej(new Error("timeout"))},Math.max(1,Number(ms||1)))})])}function normOpts(o){try{if(!o||typeof o!=="object")return null;var ks=Object.keys(o);return ks&&ks.length?o:null}catch(e){return null}}async function resolveOpts(pid,vid,o){var o0=normOpts(o);if(o0)return o0;if(typeof getCachedVariants!=="function"||!pid)return null;try{var c=await getCachedVariants(pid);for(var ci=0;ci<(c||[]).length;ci++){var cv=c[ci]||{};if(String(cv.variantId||"").trim()===vid){var o1=normOpts(cv.cartOptions);if(o1)return o1;break}}}catch(e0){}return null}for(var i=0;i<(items||[]).length;i++){var it=items[i]||{};var qty=Math.max(1,Math.floor(Number(it.quantity||1)));var vid=String(it.variantId||"").trim();if(!vid)throw new Error("لازم تختار الفاريانت");var pidStr=String(it.cartProductId||it.productId||"").trim();var isRef=vid.indexOf("product:")===0;if((!pidStr||pidStr==="")&&isRef)pidStr=String(vid).slice("product:".length).trim();if(pidStr&&pidStr.indexOf("product:")===0)pidStr=String(pidStr).slice("product:".length).trim();var pidNum=Number(pidStr);var opts=it&&it.cartOptions&&typeof it.cartOptions==="object"?it.cartOptions:null;var resolved=null;if(pidStr)resolved=await resolveOpts(pidStr,vid,opts);var added=false;if(Number.isFinite(pidNum)&&pidNum>0){try{if(resolved){await withTimeout(cart.addItem({id:pidNum,quantity:qty,options:resolved}),12000);added=true}else{await withTimeout(cart.addItem({id:pidNum,quantity:qty}),12000);added=true}}catch(e1){markStoreClosed(e1);if(storeClosedNow())throw e1;added=false}if(added)continue;if(!resolved&&typeof cart.quickAdd==="function"&&qty===1&&Number.isFinite(pidNum)&&pidNum>0){try{await withTimeout(cart.quickAdd(pidNum),8000);continue}catch(e2){markStoreClosed(e2);if(storeClosedNow())throw e2}}}var skuNum=Number(vid);var skuId=(Number.isFinite(skuNum)&&skuNum>0)?skuNum:vid;try{await withTimeout(cart.addItem({id:skuId,quantity:qty}),12000);continue}catch(e3){markStoreClosed(e3);if(storeClosedNow())throw e3;throw e3}}}'
  );

  for (let i = 0; i < bundleUiParts.length - 1; i += 1) parts.push(bundleUiParts[i]);
  parts.push(
    'function initAuto(){var inited=false;var lastKey="";var lastEvt=0;function key(){try{var v=findVariantId();if(v)return"v:"+String(v);var p=findProductId();return p?"p:"+String(p):""}catch(e){return""}}function refreshIfChanged(){try{var k=key();if(!k){lastKey="";try{clearProductBanner()}catch(e0){}return}if(k===lastKey)return;lastKey=k;refreshProduct()}catch(e){}}function onEvt(){var now=Date.now();if(now-lastEvt<350)return;lastEvt=now;setTimeout(function(){refreshIfChanged()},0)}function start(){if(inited)return;inited=true;refreshIfChanged();try{window.addEventListener("focus",onEvt);window.addEventListener("popstate",onEvt);window.addEventListener("hashchange",onEvt);document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")onEvt()});document.addEventListener("change",onEvt,true);var h=window.history;if(h&&h.pushState){var p=h.pushState;h.pushState=function(){var r=p.apply(this,arguments);onEvt();return r}}if(h&&h.replaceState){var r0=h.replaceState;h.replaceState=function(){var r=r0.apply(this,arguments);onEvt();return r}}}catch(e){}setInterval(function(){refreshIfChanged()},15000)}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",start)}else{start()}}'
  );
  parts.push(bundleUiParts[bundleUiParts.length - 1]);
  parts.push("})();");
};
