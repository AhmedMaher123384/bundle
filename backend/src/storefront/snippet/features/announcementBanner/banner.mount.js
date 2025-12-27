const bannerLogicParts = require("./banner.logic");

module.exports = function mountAnnouncementBanner(context) {
  const parts = context.parts;
  for (let i = 0; i < bannerLogicParts.length; i += 1) {
    parts.push(bannerLogicParts[i]);
  }
};

