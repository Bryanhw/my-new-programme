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

  var regSecQ     = document.getElementById("reg-security-q");
  var regSecA     = document.getElementById("reg-security-a");
  var loginToReg  = document.getElementById("login-to-register");

  document.title = "登录 / 注册 · " + C.SITE_NAME;
  C.markTabbar("");

  /* ---------------------------------------------------------------
   * 学校补全（任务 D2）
   * 固定列表来自 assets/js/campuses.js，找不到的学校照原样手输，
   * 所以这里只填 <datalist>，不做任何限制。
   * --------------------------------------------------------------- */
  var schoolList = document.getElementById("school-list");
  var campusOptions = schoolList && C.schoolOptions ? C.schoolOptions() : [];
  for (var si = 0; si < campusOptions.length; si++) {
    var opt = document.createElement("option");
    opt.value = campusOptions[si].name;
    opt.label = campusOptions[si].province + " " + campusOptions[si].city;
    schoolList.appendChild(opt);
  }

  /* 密保问题下拉：选项来自 app.js 的单一来源（id 与数据库 CHECK 对齐），
     三个问题都写死在代码里，不新增配置渠道，也不从网络拉 */
  if (regSecQ && C.securityQuestions) {
    var secPh = document.createElement("option");
    secPh.value = "";
    secPh.textContent = "选一个问题（忘密码时要用）";
    regSecQ.appendChild(secPh);

    var secQs = C.securityQuestions();
    for (var sq = 0; sq < secQs.length; sq++) {
      var secOpt = document.createElement("option");
      secOpt.value = secQs[sq].id;
      secOpt.textContent = secQs[sq].text;
      regSecQ.appendChild(secOpt);
    }
  }

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

  /* 登录面板里的「先去注册」：直接切到注册面板，省得自己找 */
  if (loginToReg) {
    loginToReg.addEventListener("click", function (e) {
      e.preventDefault();
      switchPanel("register");
      regPhone.focus();
    });
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

    var flow = C.signIn(loginPhone.value, loginPass.value).then(function () {
      C.showNotice(noticeEl, "ok", "登录成功，正在进入广场…");
      setTimeout(function () { window.location.href = "feed.html"; }, 500);
    }).catch(function (err) {
      var msg = err.message || "登录失败";
      // 登录失败最常见的两种死路：没账号、忘了密码 —— 都指到面板下方的「登不进去？」
      if (/密码|不正确|不存在|未注册/.test(msg)) {
        msg += "（忘了密码可以用密保问题重设，看下面「登不进去？」）";
      }
      C.showNotice(noticeEl, "error", msg);
      setLoading(loginBtn, false, "登 录");
    });

    // 卡住 15 秒还没动静：与其让按钮一直转圈，不如直说没响应
    watch(flow, 15000, function () {
      C.showNotice(noticeEl, "warn",
        "登录一直没有响应（可能是网络问题或者被拦了）。可以再试一次、换个网络；" +
        "也可以先看下面「登不进去？」里的两个办法。");
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
    // 密保是唯一的自助找回通道，所以注册时必填（不想填就自己去「我的」补）
    if (!regSecQ || !regSecQ.value) {
      C.showNotice(noticeEl, "warn", "选一个密保问题：忘密码时只能靠它");
      if (regSecQ) regSecQ.focus();
      return;
    }
    if (!regSecA.value.replace(/\s/g, "")) {
      C.showNotice(noticeEl, "warn", "填一下密保答案（忘密码时要用）");
      regSecA.focus();
      return;
    }

    setLoading(regBtn, true, "正在注册…");

    var flow = C.signUp(regPhone.value, regPass.value, regSchool.value, regNick.value)
      .then(function () {
        // 账号已建好，紧接着登记密保：这一步失败不回滚账号，但要如实说，
        // 并指路「我的」页补登记，不能让用户以为已经存上了
        return C.saveSecurityAnswer(regSecQ.value, regSecA.value).then(
          function () { return ""; },
          function (err) { return (err && err.message) || "密保没存上"; }
        );
      })
      .then(function (secErr) {
        if (secErr) {
          C.showNotice(noticeEl, "warn",
            "注册成功，但密保没存上：" + secErr + " 请登录后在「我的」里补一次。");
        } else {
          C.showNotice(noticeEl, "ok", "注册成功，欢迎来到 " + C.SITE_NAME + "！");
        }
        setLoading(regBtn, false, "注 册");
        setTimeout(function () { window.location.href = "feed.html"; }, secErr ? 3000 : 800);
      })
      .catch(function (err) {
        C.showNotice(noticeEl, "error", err.message);
        setLoading(regBtn, false, "注 册");
      });

    watch(flow, 20000, function () {
      C.showNotice(noticeEl, "warn",
        "注册一直没有响应（可能是网络问题）。再试一次；也可以先「匿名看看」。");
      setLoading(regBtn, false, "注 册");
    });
  });

  /* ---------------------------------------------------------------
   * 匿名进入
   * --------------------------------------------------------------- */
  anonBtn.addEventListener("click", function () {
    C.hideNotice(noticeEl);
    setLoading(anonBtn, true, "正在进入…");

    var flow = C.signInAnonymously().then(function () {
      C.showNotice(noticeEl, "ok", "已匿名进入，现在就可以分享了（也可以随时注册账号）");
      setTimeout(function () { window.location.href = "feed.html"; }, 700);
    }).catch(function (err) {
      C.showNotice(noticeEl, "error", err.message);
      setLoading(anonBtn, false, "🌙 先匿名看看，不注册");
    });

    watch(flow, 15000, function () {
      C.showNotice(noticeEl, "warn",
        "匿名进入一直没有响应（可能是网络问题）。再试一次，或者干脆注册一个账号。");
      setLoading(anonBtn, false, "🌙 先匿名看看，不注册");
    });
  });

  /* ---------------------------------------------------------------
   * 工具
   * --------------------------------------------------------------- */
  /**
   * 看门狗：请求多久没反应就提示一次（不改动原 Promise 的行为）。
   * 请求真卡住时按钮会一直转圈，用户只能干等或刷新 —— 15 秒后直说
   * 「没响应」，比让他对着转圈的按钮猜要好。
   */
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

  function setLoading(btn, on, text) {
    btn.disabled = on;
    btn.innerHTML = on ? '<span class="spinner"></span><span>' + text + "</span>" : text;
  }
})();
