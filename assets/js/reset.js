/* =====================================================================
 *  「忘记密码」页逻辑：手机号 + 密保答案 + 新密码 -> 交给 Edge Function 改密
 *  这个页面不碰密码存储、也不碰答案哈希：核对与改密都在服务端做，
 *  前端只把答案原文发过去（归一化口径只在数据库那一处实现）。
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;

  var noticeEl  = document.getElementById("notice");
  var form      = document.getElementById("reset-form");
  var phoneEl   = document.getElementById("reset-phone");
  var answerEl  = document.getElementById("reset-answer");
  var passEl    = document.getElementById("reset-password");
  var pass2El   = document.getElementById("reset-password2");
  var submitBtn = document.getElementById("reset-submit");
  var qListEl   = document.getElementById("q-list");

  document.title = "重设密码 · " + C.SITE_NAME;
  C.markTabbar("");

  /* 三个问题照抄 app.js 的单一来源：只是给同学当提示，不需要自己认出是哪一个 */
  var qs = C.securityQuestions ? C.securityQuestions() : [];
  for (var i = 0; i < qs.length; i++) {
    var li = document.createElement("li");
    li.textContent = qs[i].text;
    qListEl.appendChild(li);
  }

  if (!C.isReady()) {
    C.blockIfNotReady(noticeEl);
    submitBtn.disabled = true;
  } else {
    /* 已经登录的人不用走这条路：换密保问题在「我的」页；这里只提示一下，不拦着 */
    C.getIdentity().then(function (id) {
      if (id.isRegistered) {
        C.showNotice(noticeEl, "info",
          "你现在已经登录了。这个页面是给登不进来的同学用的；" +
          "想换个密保问题，去「我的」页设置。");
      }
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    C.hideNotice(noticeEl);

    if (!C.isValidPhone(phoneEl.value)) {
      C.showNotice(noticeEl, "warn", "请输入 11 位手机号");
      phoneEl.focus();
      return;
    }
    if (!answerEl.value.replace(/\s/g, "")) {
      C.showNotice(noticeEl, "warn", "请填写密保答案");
      answerEl.focus();
      return;
    }
    if (!passEl.value || passEl.value.length < 6) {
      C.showNotice(noticeEl, "warn", "新密码至少 6 位");
      passEl.focus();
      return;
    }
    if (passEl.value !== pass2El.value) {
      C.showNotice(noticeEl, "warn", "两遍新密码不一样");
      pass2El.focus();
      return;
    }

    setLoading(true, "正在重设…");

    var flow = C.resetPasswordWithAnswer(phoneEl.value, answerEl.value, passEl.value)
      .then(function (r) {
        C.showNotice(noticeEl, "ok",
          (r && r.message ? r.message : "密码已重置") + "，正在回到登录页…");
        setLoading(false, "重 设 密 码");
        setTimeout(function () { window.location.href = "login.html"; }, 1600);
      })
      .catch(function (err) {
        C.showNotice(noticeEl, "error", (err && err.message) || "没改成，请稍后重试");
        setLoading(false, "重 设 密 码");
      });

    watch(flow, 20000, function () {
      C.showNotice(noticeEl, "warn",
        "重设请求一直没有响应（可能是网络问题）。再试一次；还是不行就在「意见反馈」里说一声。");
      setLoading(false, "重 设 密 码");
    });
  });

  function setLoading(on, text) {
    submitBtn.disabled = on;
    submitBtn.innerHTML = on ? '<span class="spinner"></span><span>' + text + "</span>" : text;
  }

  /** 看门狗：请求多久没反应就提示一次（与 auth.js 里那份同一套逻辑） */
  function watch(promise, ms, onIdle) {
    var idle = false;
    var timer = setTimeout(function () {
      if (idle) return;
      idle = true;
      onIdle();
    }, ms);
    function stop() { idle = true; clearTimeout(timer); }
    promise.then(stop, stop);
    return promise;
  }
})();
