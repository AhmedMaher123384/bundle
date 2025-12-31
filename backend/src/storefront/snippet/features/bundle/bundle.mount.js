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
    'function savePendingCoupon(triggerProductId,data){try{var code=String(data&&(data.code||data.couponCode)||"").trim();var tp=String(triggerProductId||"").trim();if(!code||!tp)return;var payload={code:code,ts:Date.now(),trigger:tp};var s=JSON.stringify(payload);localStorage.setItem(pendingKey(tp),s);localStorage.setItem(pendingAnyKey(),s)}catch(e){}}' +
      'function loadPendingCoupon(triggerProductId){try{var tp=String(triggerProductId||"").trim();var raw=null;try{if(tp)raw=localStorage.getItem(pendingKey(tp))}catch(e0){}if(!raw){try{raw=localStorage.getItem(pendingAnyKey())}catch(e1){raw=null}}if(!raw)return null;var t=String(raw||"").trim();if(!t)return null;var ch=t.charAt(0);if(ch!=="{"&&ch!=="[")return null;var j=JSON.parse(t);if(!j||typeof j!=="object")return null;var code=String(j.code||j.couponCode||"").trim();if(!code)return null;var ts=Number(j.ts||0);if(!Number.isFinite(ts)||ts<=0)return null;var trig=String(j.trigger||"").trim();return {code:code,ts:ts,trigger:trig||tp||null}}catch(e){return null}}' +
      'function clearPendingCoupon(triggerProductId){try{var tp=String(triggerProductId||"").trim();if(tp)localStorage.removeItem(pendingKey(tp))}catch(e){}try{localStorage.removeItem(pendingAnyKey())}catch(e2){}}' +
      'async function addItemsToCart(items){if(storeClosedNow()){var e0=new Error("store_closed");e0.status=410;throw e0}var cart=window.salla&&window.salla.cart;if(!cart||typeof cart.addItem!=="function")throw new Error("Salla cart API not available");function withTimeout(p,ms){return Promise.race([p,new Promise(function(_,rej){setTimeout(function(){rej(new Error("timeout"))},Math.max(1,Number(ms||1)))})])}function normOpts(o){try{if(!o||typeof o!=="object")return null;var ks=Object.keys(o);return ks&&ks.length?o:null}catch(e){return null}}async function resolveOpts(pid,vid,o){var o0=normOpts(o);if(o0)return o0;if(typeof getCachedVariants!=="function"||!pid)return null;try{var c=await getCachedVariants(pid);for(var ci=0;ci<(c||[]).length;ci++){var cv=c[ci]||{};if(String(cv.variantId||"").trim()===vid){var o1=normOpts(cv.cartOptions);if(o1)return o1;break}}}catch(e0){}return null}for(var i=0;i<(items||[]).length;i++){var it=items[i]||{};var qty=Math.max(1,Math.floor(Number(it.quantity||1)));var vid=String(it.variantId||"").trim();if(!vid)throw new Error("لازم تختار الفاريانت");var pidStr=String(it.cartProductId||it.productId||"").trim();var isRef=vid.indexOf("product:")===0;if((!pidStr||pidStr==="")&&isRef)pidStr=String(vid).slice("product:".length).trim();if(pidStr&&pidStr.indexOf("product:")===0)pidStr=String(pidStr).slice("product:".length).trim();var pidNum=Number(pidStr);var opts=it&&it.cartOptions&&typeof it.cartOptions==="object"?it.cartOptions:null;var resolved=null;if(pidStr)resolved=await resolveOpts(pidStr,vid,opts);var added=false;if(Number.isFinite(pidNum)&&pidNum>0){try{if(resolved){await withTimeout(cart.addItem({id:pidNum,quantity:qty,options:resolved}),12000);added=true}else{await withTimeout(cart.addItem({id:pidNum,quantity:qty}),12000);added=true}}catch(e1){markStoreClosed(e1);if(storeClosedNow())throw e1;added=false}if(added)continue;if(!resolved&&typeof cart.quickAdd==="function"&&qty===1&&Number.isFinite(pidNum)&&pidNum>0){try{await withTimeout(cart.quickAdd(pidNum),8000);continue}catch(e2){markStoreClosed(e2);if(storeClosedNow())throw e2}}}var skuNum=Number(vid);var skuId=(Number.isFinite(skuNum)&&skuNum>0)?skuNum:vid;try{await withTimeout(cart.addItem({id:skuId,quantity:qty}),12000);continue}catch(e3){markStoreClosed(e3);if(storeClosedNow())throw e3;throw e3}}}' +
      'async function applyPendingCouponForCart(){if(storeClosedNow())return;var allow=false;try{allow=isCartLikePage()}catch(e0){}var until=0;try{until=Number(g.BundleApp&&g.BundleApp._couponAutoApplyUntil||0)}catch(e1){}if(!allow&&!(Number.isFinite(until)&&until>Date.now()))return;var trigger=String(lastTriggerProductId||"").trim();try{var pending=loadPendingCoupon(trigger);var trig=String((pending&&pending.trigger)||trigger||"").trim();if(!pending||!pending.code||!trig)return;var code=String(pending.code||"").trim();if(!code){clearPendingCoupon(trig);return}var ts=Number(pending.ts||0);if(!Number.isFinite(ts)||ts<=0)ts=Date.now();if(Date.now()-ts>2*60*1000){clearPendingCoupon(trig);return}var attemptKey="bundle_app_coupon_attempt:"+String(merchantId||"")+":"+String(code||"")+":"+String(ts||"");try{if(localStorage.getItem(attemptKey)){clearPendingCoupon(trig);return}}catch(ea0){}var st=g.BundleApp._pendingCouponApply||(g.BundleApp._pendingCouponApply={inFlight:false});if(st.inFlight)return;st.inFlight=true;var ok=false;try{var cur="";try{var cart=window.salla&&window.salla.cart;var cands=[cart&&cart.coupon&&cart.coupon.code,cart&&cart.coupon&&cart.coupon.coupon_code,cart&&cart.coupon_code,cart&&cart.couponCode,cart&&cart.data&&cart.data.coupon&&cart.data.coupon.code,cart&&cart.data&&cart.data.coupon_code];for(var i=0;i<cands.length;i++){var v=String(cands[i]||"").trim();if(v){cur=v;break}}}catch(ec0){}if(cur&&cur===code){ok=true}else{try{await tryClearCoupon()}catch(ecl0){}ok=await tryApplyCoupon(code)}}finally{st.inFlight=false}try{localStorage.setItem(attemptKey,String(Date.now()))}catch(ea1){}clearPendingCoupon(trig);if(ok){try{if(selectedBundleId){messageByBundleId[selectedBundleId]="تم تطبيق الخصم";renderProductBanners(lastBundles||[])}}catch(eok){}return}var stc=null;try{stc=g.BundleApp&&g.BundleApp._lastCouponApplyStatus}catch(x2){}var stn=Number(stc);var msg="";try{msg=String(g.BundleApp&&g.BundleApp._lastCouponApplyMessage||"")}catch(x3){}var ml=String(msg||"").toLowerCase();var hard400=ml.indexOf("غير صحيح")!==-1||ml.indexOf("منتهي")!==-1||ml.indexOf("expired")!==-1||ml.indexOf("invalid")!==-1||ml.indexOf("not valid")!==-1;try{if(selectedBundleId){if(Number.isFinite(stn)&&stn===400&&hard400){messageByBundleId[selectedBundleId]="تعذر تطبيق الخصم (الكود غير صحيح أو منتهي)"}else{var hm=humanizeCartError({status:stn,message:msg});messageByBundleId[selectedBundleId]=hm?("تعذر تطبيق الخصم ("+hm+")"):"تعذر تطبيق الخصم"}renderProductBanners(lastBundles||[])}}catch(eu1){}}catch(e){try{if(g.BundleApp._pendingCouponApply)g.BundleApp._pendingCouponApply.inFlight=false}catch(x0){}markStoreClosed(e)}}'
  );

  for (let i = 0; i < bundleUiParts.length - 1; i += 1) parts.push(bundleUiParts[i]);
  parts.push(
    'function initAuto(){var inited=false;var lastKey="";var lastEvt=0;var couponTimer=0;function key(){try{var v=findVariantId();if(v)return"v:"+String(v);var p=findProductId();return p?"p:"+String(p):""}catch(e){return""}}function refreshIfChanged(){try{var k=key();if(!k){lastKey="";try{clearProductBanner()}catch(e0){}return}if(k===lastKey)return;lastKey=k;refreshProduct()}catch(e){}}function scheduleCoupon(immediate){try{if(couponTimer)clearTimeout(couponTimer);couponTimer=0;var allow=false;try{allow=isCartLikePage()}catch(e0){}var until=0;try{until=Number(window.BundleApp&&window.BundleApp._couponAutoApplyUntil||0)}catch(e1){}if(!allow&&!(Number.isFinite(until)&&until>Date.now()))return;var hasPending=false;try{var p0=loadPendingCoupon(String(lastTriggerProductId||"").trim());if(!p0||!p0.code)p0=loadPendingCoupon("");hasPending=Boolean(p0&&p0.code)}catch(ep0){}if(!hasPending)return;var st=null;try{st=window.BundleApp&&window.BundleApp._pendingCouponApply}catch(e2){}var inFlight=st?Boolean(st.inFlight):false;var delay=0;if(immediate===true){delay=0}else if(inFlight){delay=800}else{delay=1200}couponTimer=setTimeout(function(){try{applyPendingCouponForCart()}catch(e3){}scheduleCoupon(false)},delay)}catch(e){}}function onEvt(){var now=Date.now();if(now-lastEvt<350)return;lastEvt=now;setTimeout(function(){refreshIfChanged();scheduleCoupon(true)},0)}function start(){if(inited)return;inited=true;refreshIfChanged();scheduleCoupon(true);try{window.addEventListener("focus",onEvt);window.addEventListener("popstate",onEvt);window.addEventListener("hashchange",onEvt);document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")onEvt()});document.addEventListener("change",onEvt,true);var h=window.history;if(h&&h.pushState){var p=h.pushState;h.pushState=function(){var r=p.apply(this,arguments);onEvt();return r}}if(h&&h.replaceState){var r0=h.replaceState;h.replaceState=function(){var r=r0.apply(this,arguments);onEvt();return r}}}catch(e){}setInterval(function(){refreshIfChanged()},15000)}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",start)}else{start()}}'
  );
  parts.push(bundleUiParts[bundleUiParts.length - 1]);
  parts.push(`
function clearPendingCoupon(triggerProductId){
  try{
    var tp=String(triggerProductId||"").trim();
    try{if(tp)localStorage.removeItem(pendingKey(tp))}catch(e0){}
    try{localStorage.removeItem(pendingAnyKey())}catch(e1){}
    try{
      var prefix="bundle_app_pending_coupon:"+String(merchantId||"");
      for(var i=localStorage.length-1;i>=0;i--){
        var k="";try{k=String(localStorage.key(i)||"")}catch(ek){k=""}
        if(k&&k.indexOf(prefix)===0){try{localStorage.removeItem(k)}catch(er){}}
      }
    }catch(e2){}
  }catch(e){}
}
function savePendingCoupon(triggerProductId,data){
  try{
    var code=String(data&&(data.code||data.couponCode)||"").trim();
    var tp=String(triggerProductId||"").trim();
    if(!code)return;
    try{clearPendingCoupon("")}catch(e0){}
    var ts=Number(data&&data.ts);if(!Number.isFinite(ts)||ts<=0)ts=Date.now();
    var payload={code:code,ts:ts,trigger:tp||""};
    var s=JSON.stringify(payload);
    try{if(tp)localStorage.setItem(pendingKey(tp),s)}catch(e1){}
    try{localStorage.setItem(pendingAnyKey(),s)}catch(e2){}
  }catch(e){}
}
async function applyPendingCouponForCart(){
  if(storeClosedNow())return;
  var allow=false;try{allow=isCartLikePage()}catch(e0){}
  var until=0;try{until=Number(g.BundleApp&&g.BundleApp._couponAutoApplyUntil||0)}catch(e1){}
  if(!allow&&!(Number.isFinite(until)&&until>Date.now()))return;
  function getCurrentCouponCode(){
    try{
      var cart=window.salla&&window.salla.cart;
      var cands=[cart&&cart.coupon&&cart.coupon.code,cart&&cart.coupon&&cart.coupon.coupon_code,cart&&cart.coupon_code,cart&&cart.couponCode,cart&&cart.data&&cart.data.coupon&&cart.data.coupon.code,cart&&cart.data&&cart.data.coupon_code];
      for(var i=0;i<cands.length;i++){var v=String(cands[i]||"").trim();if(v)return v}
    }catch(e){}
    return "";
  }
  function isLikelyBundleAppCode(code){
    try{
      var s=String(code||"").trim().toUpperCase();
      return /^B[0-9A-F]{15}$/.test(s);
    }catch(e){return false}
  }
  function extractCartVariantId(it){
    return String((it&&(it.variant_id||it.variantId||it.sku_id||it.skuId||(it.variant&&it.variant.id)||it.id))||"").trim();
  }
  function extractCartQuantity(it){
    var q=Number((it&&(it.quantity||it.qty||(it.pivot&&it.pivot.quantity)))||0);
    return Number.isFinite(q)?Math.floor(q):0;
  }
  function normalizeCartItemsForBackend(cartItems){
    var byVariant={};
    for(var i=0;i<(cartItems||[]).length;i++){
      var it=cartItems[i]||{};
      var vid=extractCartVariantId(it);
      var qty=extractCartQuantity(it);
      if(!vid||!qty||qty<=0)continue;
      byVariant[vid]=(byVariant[vid]||0)+qty;
    }
    var out=[];
    var keys=Object.keys(byVariant);keys.sort();
    for(var j=0;j<keys.length;j++){
      var k=keys[j];
      var q=byVariant[k];
      if(!k||!q||q<=0)continue;
      out.push({variantId:k,quantity:q});
    }
    return out;
  }
  var trigger=String(lastTriggerProductId||"").trim();
  var pending=null;
  try{pending=loadPendingCoupon(trigger)}catch(e2){pending=null}
  var cur=getCurrentCouponCode();
  if((!pending||!pending.code)&&allow&&cur&&isLikelyBundleAppCode(cur)){
    var refreshKey="bundle_app_coupon_refresh:"+String(merchantId||"")+":"+String(cur||"");
    try{
      var last=Number(localStorage.getItem(refreshKey)||0);
      if(Number.isFinite(last)&&Date.now()-last<2*60*1000)return;
    }catch(e3){}
    var itemsRaw=[];
    try{itemsRaw=await readCartItems()}catch(e4){itemsRaw=[]}
    var backendItems=normalizeCartItemsForBackend(itemsRaw);
    if(backendItems&&backendItems.length){
      var res=null;
      try{res=await requestCartBanner(backendItems)}catch(e5){res=null}
      if(res&&res.ok){
        var cc=String((res&&(res.couponCode||(res.coupon&&res.coupon.code)))||"").trim();
        if(res.hasDiscount===false||res.couponIssueFailed){
          try{await tryClearCoupon()}catch(e6){}
          try{clearPendingCoupon("")}catch(e7){}
          try{localStorage.setItem(refreshKey,String(Date.now()))}catch(e8){}
          return;
        }
        if(cc&&cc!==cur){
          try{g.BundleApp._couponAutoApplyUntil=Date.now()+90000}catch(e9){}
          savePendingCoupon(trigger||"",{code:cc,ts:Date.now()});
          try{pending=loadPendingCoupon(trigger)}catch(e10){pending=null}
          if(!pending||!pending.code){try{pending=loadPendingCoupon("")}catch(e11){pending=null}}
        }else{
          try{localStorage.setItem(refreshKey,String(Date.now()))}catch(e12){}
          return;
        }
      }else{
        return;
      }
    }else{
      try{localStorage.setItem(refreshKey,String(Date.now()))}catch(e13){}
      return;
    }
  }
  try{
    pending=pending&&pending.code?pending:(function(){try{return loadPendingCoupon("")}catch(e){return null}})();
  }catch(e14){}
  var trig=String((pending&&pending.trigger)||trigger||"").trim();
  if(!pending||!pending.code)return;
  var code=String(pending.code||"").trim();
  if(!code){clearPendingCoupon(trig);return}
  var ts=Number(pending.ts||0);if(!Number.isFinite(ts)||ts<=0)ts=Date.now();
  if(Date.now()-ts>2*60*1000){clearPendingCoupon(trig);return}
  var attemptKey="bundle_app_coupon_attempt:"+String(merchantId||"")+":"+String(code||"")+":"+String(ts||"");
  try{if(localStorage.getItem(attemptKey)){clearPendingCoupon(trig);return}}catch(ea0){}
  var st=g.BundleApp._pendingCouponApply||(g.BundleApp._pendingCouponApply={inFlight:false});
  if(st.inFlight)return;
  st.inFlight=true;
  var ok=false;
  try{
    cur=getCurrentCouponCode();
    if(cur&&cur===code){ok=true}else{try{await tryClearCoupon()}catch(ecl0){}ok=await tryApplyCoupon(code)}
  }finally{st.inFlight=false}
  try{localStorage.setItem(attemptKey,String(Date.now()))}catch(ea1){}
  clearPendingCoupon(trig);
  if(ok){
    try{if(selectedBundleId){messageByBundleId[selectedBundleId]="تم تطبيق الخصم";renderProductBanners(lastBundles||[])}}catch(eok){}
    return;
  }
  var stc=null;try{stc=g.BundleApp&&g.BundleApp._lastCouponApplyStatus}catch(x2){}
  var stn=Number(stc);
  var msg="";try{msg=String(g.BundleApp&&g.BundleApp._lastCouponApplyMessage||"")}catch(x3){}
  var ml=String(msg||"").trim();
  var m2="";
  if(Number.isFinite(stn)&&stn){m2=" ("+String(stn)+")"}
  var base="فشل تفعيل الخصم"+m2;
  if(ml)base+=": "+ml;
  try{if(selectedBundleId){messageByBundleId[selectedBundleId]=base;renderProductBanners(lastBundles||[])}}catch(e5){}
}
try{setTimeout(function(){try{applyPendingCouponForCart()}catch(e){}},650)}catch(e){}
`);
  parts.push("})();");
};
