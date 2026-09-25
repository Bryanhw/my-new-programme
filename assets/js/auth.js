/* =====================================================================
 *  登录页逻辑：注册（手机号+学校）/ 登录 / 匿名进入
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;

  var noticeEl    = document.getElementById("notice");
  var tabsEl      = document.getElementById("tabs");
  var panelLogin  = document.getElementById("panel-login");
  var panelReg    = document.getElementById("panel-register");

  var loginForm   = document.getElementById("login-form");
  var loginPhone  = document.getElementById("login-phone");
  var loginPass   = document.getElementById("login-password");
  var loginBtn    = document.getElementById("login-submit");

  var regForm     = document.getElementById("register-form");
  var regPhone    = document.getElementById("reg-phone");
  var regSchool   = document.getElementById("reg-school");
  var regNick     = document.getElementById("reg-nickname");
  var regPass     = document.getElementById("reg-password");
  var regBtn      = document.getElementById("register-submit");

  var anonBtn     = document.getElementById("anon-btn");

  document.title = "登录 / 注册 · " + C.SITE_NAME;
  C.markTabbar("");

  /* 后端还没配置时，直接说明原因，避免点了按钮才报错 */
  if (!C.isReady()) {
    C.blockIfNotReady(noticeEl);
    [loginBtn, regBtn, anonBtn].forEach(function (b) { b.disabled = true; });
  } else {
    /* 已经登录的话直接回广场，避免重复登录 */
    C.getIdentity().then(function (id) {
      if (id.user) {
        C.showNotice(noticeEl, "info", "你已经登录了，正在回到广场…");
        setTimeout(function () { window.location.href = "feed.html"; }, 600);
      }
    });
  }

  /* ---------------------------------------------------------------
   * Tab 切换
   * --------------------------------------------------------------- */
  tabsEl.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-panel]") : null;
    if (!btn) return;
    switchPanel(btn.getAttribute("data-panel"));
  });

  function switchPanel(name) {
    var tabs = tabsEl.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("active", tabs[i].getAttribute("data-panel") === name);
    }
    panelLogin.classList.toggle("hidden", name !== "login");
    panelReg.classList.toggle("hidden", name !== "register");
    C.hideNotice(noticeEl);
  }

  /* ---------------------------------------------------------------
   * 登录
   * --------------------------------------------------------------- */
  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    C.hideNotice(noticeEl);

    if (!C.isValidPhone(loginPhone.value)) {
      C.showNotice(noticeEl, "warn", "请输入 11 位手机号");
      loginPhone.focus();
      return;
    }

    setLoading(loginBtn, true, "正在登录…");

    C.signIn(loginPhone.value, loginPass.value).then(function () {
      C.showNotice(noticeEl, "ok", "登录成功，正在进入广场…");
      setTimeout(function () { window.location.href = "feed.html"; }, 500);
    }).catch(function (err) {
      C.showNotice(noticeEl, "error", err.message);
      setLoading(loginBtn, false, "登 录");
    });
  });

  /* ---------------------------------------------------------------
   * 注册
   * --------------------------------------------------------------- */
  regForm.addEventListener("submit", function (e) {
    e.preventDefault();
    C.hideNotice(noticeEl);

    if (!C.isValidPhone(regPhone.value)) {
      C.showNotice(noticeEl, "warn", "请输入 11 位手机号");
      regPhone.focus();
      return;
    }
    if (!regSchool.value.trim()) {
      C.showNotice(noticeEl, "warn", "请填写你的学校");
      regSchool.focus();
      return;
    }
    if (!regPass.value || regPass.value.length < 6) {
      C.showNotice(noticeEl, "warn", "密码至少 6 位");
      regPass.focus();
      return;
    }

    setLoading(regBtn, true, "正在注册…");

    C.signUp(regPhone.value, regPass.value, regSchool.value, regNick.value)
      .then(function () {
        C.showNotice(noticeEl, "ok", "注册成功，欢迎来到 " + C.SITE_NAME + "！");
        setTimeout(function () { window.location.href = "feed.html"; }, 800);
      })
      .catch(function (err) {
        C.showNotice(noticeEl, "error", err.message);
        setLoading(regBtn, false, "注 册");
      });
  });

  /* ---------------------------------------------------------------
   * 匿名进入
   * --------------------------------------------------------------- */
  anonBtn.addEventListener("click", function () {
    C.hideNotice(noticeEl);
    setLoading(anonBtn, true, "正在进入…");

    C.signInAnonymously().then(function () {
      C.showNotice(noticeEl, "ok", "已匿名进入，现在就可以分享了（也可以随时注册账号）");
      setTimeout(function () { window.location.href = "feed.html"; }, 700);
    }).catch(function (err) {
      C.showNotice(noticeEl, "error", err.message);
      setLoading(anonBtn, false, "🌙 先匿名看看，不注册");
    });
  });

  /* ---------------------------------------------------------------
   * 工具
   * --------------------------------------------------------------- */
  function setLoading(btn, on, text) {
    btn.disabled = on;
    btn.innerHTML = on ? '<span class="spinner"></span><span>' + text + "</span>" : text;
  }
})();
