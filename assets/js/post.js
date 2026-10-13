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

  /* ---------------------------------------------------------------
   * 今日一问（C1）：一句按天轮换的话题，点一下带进正文（不强制）
   *   - 纯前端：不联网、不写存储、不新增读取通道
   *   - 同一天永远是同一句（按本地日期算，跨天自动换）
   *   - 已经在写字时不覆盖，接在后面另起一行
   * --------------------------------------------------------------- */
  var DAILY_QUESTIONS = [
    "图书馆哪一层最安静？",
    "食堂里哪道菜值得排队？",
    "今天的天是什么颜色？",
    "最近哪门课让你改观了？",
    "学校附近有什么只有你知道的小店？",
    "手机里最新的一张照片拍的是什么？",
    "这周有没有哪件事，你想说声谢谢？",
    "晚上从教学楼走回宿舍，你在想什么？",
    "有什么小事，今天让你笑了一下？",
    "想找个人一起做的事，是什么？",
    "你最近在循环哪首歌？",
    "如果明天没课，你最想去哪？",
    "宿舍楼下那棵树，你注意过吗？",
    "哪句话是你最近常对自己说的？"
  ];

  /** 今天这一句：按「本地日期」数天，同一天恒定、每天换一句、轮完从头来。
   *  传一个 Date 只是为了测试能问「明天是哪句」，页面自己从不传。 */
  function questionOfTheDay(now) {
    var d = now || new Date();
    var midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var day = Math.floor(midnight / 86400000);
    var n = DAILY_QUESTIONS.length;
    return DAILY_QUESTIONS[((day % n) + n) % n];
  }

  var dailyQEl    = document.getElementById("daily-q");
  var dailyQText  = document.getElementById("daily-q-text");
  var dailyQUse   = document.getElementById("daily-q-use");
  var todayQuestion = "";

  function renderDailyQuestion() {
    if (!dailyQEl) return;               // 页面里没有这条就不管，别把发布页搞崩
    todayQuestion = questionOfTheDay();
    if (dailyQText) dailyQText.textContent = todayQuestion;
    dailyQEl.hidden = false;
  }

  if (dailyQUse) {
    dailyQUse.addEventListener("click", function () {
      if (!todayQuestion) return;
      var written = contentEl.value;
      contentEl.value = written.trim()
        ? written.replace(/\s+$/, "") + "\n" + todayQuestion   // 已经在写：接在后面，不覆盖
        : todayQuestion;
      updateCounter();
      contentEl.focus();
      if (contentEl.setSelectionRange) {
        contentEl.setSelectionRange(contentEl.value.length, contentEl.value.length);
      }
    });
  }

  document.title = "分享此刻 · " + C.SITE_NAME;
  C.markTabbar("post");
  C.blockIfNotReady(noticeEl);

  /* ---------------------------------------------------------------
   * 话题标签（C3）：从站里约定的那份列表里挑，最多 3 个，可以不挑。
   *   列表只有一份（Campus.TOPICS），发布页和广场筛选条用的是同一个 ——
   *   自己造词会让标签碎成一片没人看得懂的东西，所以这里只给选项。
   * --------------------------------------------------------------- */
  var topicPickerEl = document.getElementById("topic-picker");
  var topicHintEl   = document.getElementById("topic-hint");
  var pickedTopics  = [];

  function renderTopicPicker() {
    if (!topicPickerEl) return;
    var all = C.TOPICS || [];
    var html = "";
    for (var i = 0; i < all.length; i++) {
      var on = pickedTopics.indexOf(all[i]) >= 0 ? " chip-on" : "";
      html += '<button class="chip' + on + '" type="button" data-pick="' +
        C.escapeHtml(all[i]) + '">#' + C.escapeHtml(all[i]) + "</button>";
    }
    topicPickerEl.innerHTML = html;
  }

  function renderTopicHint() {
    if (!topicHintEl) return;
    topicHintEl.textContent = pickedTopics.length
      ? "已选：" + pickedTopics.join("、") + "（再点一下取消）"
      : "话题是站里约定好的几个，方便同学按兴趣翻。不加也照样能发。";
  }

  /** 点一下选中、再点一下取消；满了就直说，不静默丢掉 */
  function toggleTopic(name) {
    var i = pickedTopics.indexOf(name);
    if (i >= 0) {
      pickedTopics.splice(i, 1);
    } else if (pickedTopics.length >= C.TOPIC_LIMIT) {
      C.showNotice(noticeEl, "warn",
        "一条最多带 " + C.TOPIC_LIMIT + " 个话题，先点掉一个再选。");
      return;
    } else {
      pickedTopics.push(name);
    }
    renderTopicPicker();
    renderTopicHint();
  }

  if (topicPickerEl) {
    topicPickerEl.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-pick]") : null;
      if (!btn) return;
      toggleTopic(btn.getAttribute("data-pick") || "");
    });
  }

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
      isAnonymous: isAnonymous,
      topics: pickedTopics
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
      // 发布成功后清空表单，避免重复提交或返回本页时看到旧内容。
      // 话题要在这之前记下来：resetForm 会清掉它；而「库迁移过没有」的探测结果
      // 在刚才那次发帖里已经定下来了，此刻读是准的。
      var asked = pickedTopics.length;
      var carried = asked > 0 && C.topicsSupported();
      resetForm();
      C.showNotice(noticeEl, "ok",
        "已提交审核" + (carried ? "（带 " + asked + " 个话题）" : "") +
        "。你自己现在就能在广场看到它（带「审核中」标记），别人要等通过后才看得到。" +
        (asked > 0 && !carried ? "话题这次没带上 —— 站点的标签功能还没开启。" : ""));
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
    pickedTopics = [];
    renderTopicPicker();
    renderTopicHint();
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

  renderDailyQuestion();
  renderTopicPicker();
  renderTopicHint();
  renderIdentity();
})();
