const bannerLogicParts = require("./banner.logic");

module.exports = function mountAnnouncementBanner(context) {
  const parts = context.parts;
  const merchantId = context.merchantId;
  const token = context.token;

  for (let i = 0; i < bannerLogicParts.length; i += 1) {
    if (i === 3) {
      parts.push(`var merchantId=${JSON.stringify(merchantId)};`);
      parts.push(`var token=${JSON.stringify(token)};`);
      parts.push('var scriptSrc=(document.currentScript&&document.currentScript.src)||"";');
      parts.push(
        'if(!scriptSrc){try{var ss=document.getElementsByTagName("script");for(var si=0;si<ss.length;si++){var s=ss[si];var src=(s&&s.src)||"";if(!src)continue;if(src.indexOf("/api/storefront/snippet.js")!==-1&&src.indexOf("merchantId="+encodeURIComponent(merchantId))!==-1){scriptSrc=src;break}}}catch(e){}}'
      );
    }
    parts.push(bannerLogicParts[i]);
  }
};
