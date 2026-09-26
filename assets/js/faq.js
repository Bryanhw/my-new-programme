/* =====================================================================
 *  常见问题页：点亮二级菜单里的当前页；配置没填时给一句提示
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;

  document.title = "常见问题 · " + C.SITE_NAME;
  C.markTabbar("faq");
  C.blockIfNotReady(document.getElementById("notice"));
})();
