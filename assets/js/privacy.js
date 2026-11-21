/* =====================================================================
 *  隐私 / 协议页：点亮菜单里的「隐私 · 协议」；配置没填时给一句提示
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;

  document.title = "隐私政策 · " + C.SITE_NAME;
  C.markTabbar("privacy");
  C.blockIfNotReady(document.getElementById("notice"));
})();
