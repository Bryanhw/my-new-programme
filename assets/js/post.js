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
        identityEl.innerHTML = '当前身份：<strong>匿名访客</strong>（发布时不会显示你的账号） · <a href="login.html">注册一个账号</a>';
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
      return C.createPost({
        content: content,
        file: selectedFile,
        isAnonymous: anon
      });
    }).then(function () {
      // 发布成功后清空表单，避免重复提交或返回本页时看到旧内容
      resetForm();
      C.showNotice(noticeEl, "ok", "发布成功，正在带你去看看大家的分享…");
      setTimeout(function () { window.location.href = "feed.html"; }, 700);
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
