/* =====================================================================
 *  意见反馈页逻辑
 *  ---------------------------------------------------------------------
 *  三条产品约定（对应 docs/supabase-feedback.sql）：
 *   1. 不用登录也能提交 —— 这个页面不做任何登录拦截；
 *   2. 文字最多 500 字（HTML 的 maxlength + 这里的计数器各拦一次）；
 *   3. 提交后只给一句「已收到」，不显示别人提交过什么 ——
 *      因为数据库那边没有 select 策略，想显示也读不到。
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;
  var MAX_LEN = C.FEEDBACK_MAX || 500;
  var CONTACT_MAX = 100;

  var noticeEl  = document.getElementById("notice");
  var form      = document.getElementById("feedback-form");
  var contentEl = document.getElementById("content");
  var counterEl = document.getElementById("counter");
  var contactEl = document.getElementById("contact");
  var submitBtn = document.getElementById("submit");

  /* 设备选项：id 固定四个（问卷里也就这四项），下面按 UA 预选一个 */
  var DEVICE_IDS = {
    desktop: "dev-desktop",
    tablet:  "dev-tablet",
    phone:   "dev-phone",
    other:   "dev-other"
  };

  document.title = "意见反馈 · " + C.SITE_NAME;
  C.markTabbar("feedback");
  C.blockIfNotReady(noticeEl);

  /* ---------------------------------------------------------------
   * 设备：按 UA 猜一个先选上（用户随时能改，改了就按用户的）
   * --------------------------------------------------------------- */
  function pickDevice(value) {
    var el = document.getElementById(DEVICE_IDS[value] || DEVICE_IDS.other);
    if (el) el.checked = true;
  }

  function currentDevice() {
    for (var key in DEVICE_IDS) {
      if (DEVICE_IDS.hasOwnProperty(key)) {
        var el = document.getElementById(DEVICE_IDS[key]);
        if (el && el.checked) return key;
      }
    }
    return "";   /* 用户把预选项取消了（理论上不会），交给接口兜成 other */
  }

  pickDevice(C.guessDevice());

  /* ---------------------------------------------------------------
   * 字数统计：和发布页同一套做法（超过九成就变黄）
   * --------------------------------------------------------------- */
  function updateCounter() {
    var len = contentEl.value.length;
    counterEl.textContent = len + " / " + MAX_LEN;
    counterEl.classList.toggle("warn", len > MAX_LEN * 0.9);
    if (len > MAX_LEN) {
      contentEl.value = contentEl.value.slice(0, MAX_LEN);
      counterEl.textContent = MAX_LEN + " / " + MAX_LEN;
    }
  }
  contentEl.addEventListener("input", updateCounter);
  updateCounter();

  /* ---------------------------------------------------------------
   * 提交
   * --------------------------------------------------------------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    C.hideNotice(noticeEl);

    if (!C.isReady()) {
      C.showNotice(noticeEl, "warn", C.getConfigError());
      return;
    }

    var content = contentEl.value.trim();
    if (!content) {
      C.showNotice(noticeEl, "warn", "写点什么再提交吧 —— 一句话也很有用");
      contentEl.focus();
      return;
    }

    var contact = contactEl.value.trim();
    if (contact.length > CONTACT_MAX) contact = contact.slice(0, CONTACT_MAX);

    setLoading(true);

    // 刻意不传任何身份信息：接口也不会去取（见 app.js 的 sendFeedback）
    C.sendFeedback({
      device: currentDevice(),
      content: content,
      contact: contact
    }).then(function () {
      resetForm();
      C.showNotice(noticeEl, "ok", "已收到，谢谢你说这些 —— 站主会看的。");
      setTimeout(function () { C.hideNotice(noticeEl); }, 8000);
    }).catch(function (err) {
      C.showNotice(noticeEl, "error", err && err.message ? err.message : "提交失败，稍后再试一次");
    }).then(function () {
      setLoading(false);
    });
  });

  function resetForm() {
    contentEl.value = "";
    contactEl.value = "";
    updateCounter();
    pickDevice(C.guessDevice());
    setLoading(false);
  }

  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.textContent = on ? "正在提交…" : "提交反馈";
  }
})();
