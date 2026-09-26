/* =====================================================================
 *  发布页逻辑：写文字 + 传一张图 + 选择是否匿名
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;
  var MAX_LEN = 1000;

  var noticeEl   = document.getElementById("notice");
  var form       = document.getElementById("post-form");
  var contentEl  = document.getElementById("content");
  var counterEl  = document.getElementById("counter");
  var fileEl     = document.getElementById("image");
  var uploadBox  = document.getElementById("upload-box");
  var previewBox = document.getElementById("preview-box");
  var previewImg = document.getElementById("preview-img");
  var removeBtn  = document.getElementById("remove-image");
  var anonSwitch = document.getElementById("anon-switch");
  var identityEl = document.getElementById("identity-line");
  var submitBtn  = document.getElementById("submit");

  var selectedFile = null;
  var anon = false;

  document.title = "分享此刻 · " + C.SITE_NAME;
  C.markTabbar("post");
  C.blockIfNotReady(noticeEl);

  /* ---------------------------------------------------------------
   * 身份提示
   * --------------------------------------------------------------- */
  function renderIdentity() {
    if (!C.isReady()) {
      identityEl.textContent = "配置完成后，这里会显示你当前的发布身份。";
      return;
    }
    C.getIdentity().then(function (id) {
      if (!id.user) {
        identityEl.innerHTML = '你还未登录 · <a href="login.html">去登录或匿名进入</a>';
        return;
      }
      if (id.isAnonymous) {
        // 匿名访客也可能设过昵称，看一下现在会以什么名字出现
        C.getProfile().then(function (p) {
          var nickname = (p && p.nickname) ? p.nickname : "";
          var tail = ' · <a href="login.html">注册一个账号</a>';
          if (nickname) {
            identityEl.innerHTML = "当前身份：<strong>匿名访客</strong>，会以「" +
              C.escapeHtml(nickname) + "」署名" + tail;
          } else {
            identityEl.innerHTML = "当前身份：<strong>匿名访客</strong>，发布时不会显示账号，也可以给自己写个昵称" + tail;
          }
        });
        return;
      }
      C.getProfile().then(function (p) {
        var nickname = (p && p.nickname) ? p.nickname : "";
        var school = (p && p.school) ? p.school : "";
        if (nickname) {
          identityEl.innerHTML = "将以 <strong>" + C.escapeHtml(nickname) + "</strong>" +
            (school ? "（" + C.escapeHtml(school) + "）" : "") + " 的身份发布";
        } else {
          identityEl.innerHTML = '还没有设置昵称，会以「同学 xxxx」发布 · <a href="profile.html">去设置昵称</a>';
        }
      });
    });
  }

  /* ---------------------------------------------------------------
   * 字数统计
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
   * 图片选择与预览
   * --------------------------------------------------------------- */
  uploadBox.addEventListener("click", function () { fileEl.click(); });

  uploadBox.addEventListener("dragover", function (e) {
    e.preventDefault();
    uploadBox.style.borderColor = "var(--brand)";
  });
  uploadBox.addEventListener("dragleave", function () {
    uploadBox.style.borderColor = "";
  });
  uploadBox.addEventListener("drop", function (e) {
    e.preventDefault();
    uploadBox.style.borderColor = "";
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileEl.addEventListener("change", function () {
    if (fileEl.files && fileEl.files[0]) handleFile(fileEl.files[0]);
  });

  function handleFile(file) {
    if (file.size > 5 * 1024 * 1024) {
      C.showNotice(noticeEl, "warn", "图片有点大，请选择 5MB 以内的图片");
      return;
    }
    if (file.type && file.type.indexOf("image/") !== 0) {
      C.showNotice(noticeEl, "warn", "请选择图片文件（jpg / png / gif / webp）");
      return;
    }
    C.hideNotice(noticeEl);
    selectedFile = file;

    var reader = new FileReader();
    reader.onload = function () {
      previewImg.src = reader.result;
      uploadBox.classList.add("hidden");
      previewBox.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  }

  removeBtn.addEventListener("click", function () {
    selectedFile = null;
    fileEl.value = "";
    previewImg.removeAttribute("src");
    previewBox.classList.add("hidden");
    uploadBox.classList.remove("hidden");
  });

  /* ---------------------------------------------------------------
   * 匿名开关
   * --------------------------------------------------------------- */
  anonSwitch.addEventListener("click", function () {
    anon = !anon;
    anonSwitch.setAttribute("aria-checked", anon ? "true" : "false");
  });

  /* ---------------------------------------------------------------
   * 昵称弹窗：匿名访客第一次署名时问一下（参考 padlet 的做法）
   *   「就用这个名字发布」→ 保存昵称后署名发布
   *   「保持匿名」        → 直接按匿名发布
   *   Esc / 点背景 / 取消 → 回到表单，什么都不发
   * --------------------------------------------------------------- */
  var nickModal   = document.getElementById("nick-modal");
  var nickInput   = document.getElementById("nick-input");
  var nickSaveBtn = document.getElementById("nick-save");
  var nickKeepBtn = document.getElementById("nick-keep-anon");
  var nickCancelBtn = document.getElementById("nick-cancel");
  var nickResolve = null;

  function lockScroll(on) {
    if (document.body && document.body.classList) {
      document.body.classList.toggle("modal-open", on);
    }
  }

  function closeNickModal(result) {
    if (!nickModal || nickModal.hidden) return;
    nickModal.hidden = true;
    lockScroll(false);
    var resolve = nickResolve;
    nickResolve = null;
    if (resolve) resolve(result);
  }

  function askNickname() {
    // 兜底：页面里没有弹窗结构时，按「保持匿名」继续，不要让发布卡住
    if (!nickModal) return Promise.resolve({ keepAnon: true });

    setLoading(false);
    nickModal.hidden = false;
    lockScroll(true);
    nickInput.value = "";
    setTimeout(function () { nickInput.focus(); }, 30);
    return new Promise(function (resolve) { nickResolve = resolve; });
  }

  if (nickModal) {
    nickSaveBtn.addEventListener("click", function () {
      var name = nickInput.value.trim();
      if (!name) { nickInput.focus(); return; }
      closeNickModal({ nickname: name });
    });
    nickKeepBtn.addEventListener("click", function () { closeNickModal({ keepAnon: true }); });
    nickCancelBtn.addEventListener("click", function () { closeNickModal(null); });
    nickModal.addEventListener("click", function (e) {
      if (e.target === nickModal) closeNickModal(null);
    });
    nickInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); nickSaveBtn.click(); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !nickModal.hidden) { e.preventDefault(); closeNickModal(null); }
    });
  }

  /* ---------------------------------------------------------------
   * 提交
   * --------------------------------------------------------------- */
  function publish(content, isAnonymous) {
    return C.createPost({
      content: content,
      file: selectedFile,
      isAnonymous: isAnonymous
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    C.hideNotice(noticeEl);

    if (!C.isReady()) {
      C.showNotice(noticeEl, "warn", C.getConfigError());
      return;
    }

    var content = contentEl.value.trim();
    if (!content && !selectedFile) {
      C.showNotice(noticeEl, "warn", "写点什么，或者选一张图片吧");
      return;
    }

    setLoading(true);

    C.getIdentity().then(function (id) {
      if (!id.user) {
        C.showNotice(noticeEl, "warn", "请先登录或匿名进入，再发布内容");
        var go = confirm("还没有登录。现在去登录页吗？");
        if (go) window.location.href = "login.html";
        throw new Error("__aborted__");
      }

      // 匿名访客 + 没勾匿名：问一下要不要署个名字
      var needAsk = id.isAnonymous && !anon;
      var check = needAsk
        ? C.getProfile().then(function (p) { return !(p && p.nickname); })
        : Promise.resolve(false);

      return check.then(function (shouldAsk) {
        if (!shouldAsk) return { isAnonymous: anon };

        return askNickname().then(function (decision) {
          if (!decision) throw new Error("__aborted__");
          if (!decision.nickname) return { isAnonymous: true };

          setLoading(true);
          var name = decision.nickname;
          return C.saveNickname(name).then(function () {
            C.showNotice(noticeEl, "ok", "记住了，以后就用「" + name + "」署名。");
            return { isAnonymous: false };
          });
        });
      }).then(function (opt) {
        setLoading(true);
        return publish(content, opt.isAnonymous);
      });
    }).then(function () {
      // 发布成功后清空表单，避免重复提交或返回本页时看到旧内容
      resetForm();
      C.showNotice(noticeEl, "ok", "已提交审核，通过后就会出现在内容广场。先带你去看看大家的分享…");
      setTimeout(function () { window.location.href = "feed.html"; }, 1200);
    }).catch(function (err) {
      if (err && err.message === "__aborted__") { setLoading(false); return; }
      C.showNotice(noticeEl, "error", err.message);
      setLoading(false);
    });
  });

  function resetForm() {
    contentEl.value = "";
    updateCounter();
    selectedFile = null;
    fileEl.value = "";
    previewImg.removeAttribute("src");
    previewBox.classList.add("hidden");
    uploadBox.classList.remove("hidden");
    anon = false;
    anonSwitch.setAttribute("aria-checked", "false");
    setLoading(false);
  }

  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.innerHTML = on
      ? '<span class="spinner"></span><span>正在发布…</span>'
      : "发布分享";
  }

  renderIdentity();
})();
