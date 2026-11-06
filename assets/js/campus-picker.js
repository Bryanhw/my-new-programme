/* =====================================================================
 *  选学校组件（V4-4 / M3）
 *  注册页选校从 <datalist> 升级成「搜索 + 首字母索引 + 标签筛选」的选择器。
 *
 *  设计原则：
 *  - 搜索建议来自 assets/js/campuses.js 的 CampusList.search() / byInitial()；
 *  - 找不到自己的学校时照原样手输（D2 的「自由输入不能丢」不变）；
 *  - 渐进增强：本组件缺位时，#reg-school 仍是一个普通文本框，注册照常。
 *  - 测试沙箱 stub 的 document.querySelector 恒空，这里一律只用
 *    createElement + appendChild + 事件回调构建 DOM。
 * ===================================================================== */
(function () {
  "use strict";

  var L = (typeof window !== "undefined" && window.CampusList)
    ? window.CampusList
    : (typeof CampusList !== "undefined" ? CampusList : null);

  var FILTERS = [
    { id: "",        name: "\u5168\u90e8" },      // 全部
    { id: "985",     name: "985" },
    { id: "211",     name: "211" },
    { id: "\u6e2f\u4e94\u6fb3\u4e09", name: "\u6e2f\u4e94\u6fb3\u4e09" }, // 港五澳三
    { id: "\u77e5\u540d", name: "\u77e5\u540d" }        // 知名
  ];
  var LETTERS = ["A","B","C","D","E","F","G","H","I","J","K","L","M",
                   "N","O","P","Q","R","S","T","U","V","W","X","Y","Z"];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function entryName(e) { return (e && e.name != null) ? String(e.name) : ""; }

  function tagMatch(e, filter) {
    if (!filter) return true;
    var t = e.tags || [];
    for (var i = 0; i < t.length; i++) { if (t[i] === filter) return true; }
    return false;
  }

  /**
   * attach(container, opts) 在容器内挂一套选择器。
   * opts: { inputEl, onPick(entry) }
   * 返回 handle：{ input, list, query(q), browse(letter), setFilter(id), getState() }。
   */
  function attach(container, opts) {
    opts = opts || {};
    var inputEl = opts.inputEl;
    if (!container || !inputEl) return null;

    // 兜底去掉 datalist 残留（login.html 里已移除 list 属性）
    if (inputEl.removeAttribute) inputEl.removeAttribute("list");

    var state = { filter: "", letter: "", hits: [], q: "", active: -1 };

    /* ---------- 骨架 ---------- */
    var wrap = document.createElement("div");
    wrap.className = "campus-picker";

    var chipsRow = document.createElement("div");
    chipsRow.className = "campus-picker-chips";
    wrap.appendChild(chipsRow);

    var lettersRow = document.createElement("div");
    lettersRow.className = "campus-picker-letters";
    wrap.appendChild(lettersRow);

    var list = document.createElement("div");
    list.className = "campus-picker-list";
    wrap.appendChild(list);

    container.appendChild(wrap);

    /* ---------- 标签筛选 chips ---------- */
    var chipEls = [];
    for (var fi = 0; fi < FILTERS.length; fi++) {
      (function (f) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "campus-chip" + (f.id === "" ? " active" : "");
        b.textContent = f.name;
        b.setAttribute("data-filter", f.id);
        b.addEventListener("click", function () { setFilter(f.id, b); });
        chipsRow.appendChild(b);
        chipEls.push(b);
      })(FILTERS[fi]);
    }

    function setFilter(id, btn) {
      state.filter = id;
      for (var k = 0; k < chipEls.length; k++) {
        if (chipEls[k].className) {
          chipEls[k].className = "campus-chip" + (chipEls[k] === btn ? " active" : "");
        } else {
          chipEls[k].classList.toggle("active", chipEls[k] === btn);
        }
      }
      refresh();
    }

    /* ---------- 首字母索引条 ---------- */
    var letterEls = {};
    for (var li = 0; li < LETTERS.length; li++) {
      (function (ch) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "campus-letter";
        b.textContent = ch;
        b.setAttribute("data-letter", ch);
        b.addEventListener("click", function () { browse(ch); });
        lettersRow.appendChild(b);
        letterEls[ch] = b;
      })(LETTERS[li]);
    }

    function clearList() {
      while (list._children && list._children.length) {
        list._children.pop();
      }
      list.innerHTML = "";
      list.textContent = "";
    }

    function renderHeader(text) {
      var h = document.createElement("div");
      h.className = "campus-picker-note";
      h.textContent = text;
      list.appendChild(h);
    }

    function renderOpt(entry, isCustom) {
      var row = document.createElement("div");
      row.className = "campus-opt" + (isCustom ? " campus-opt-custom" : "");
      row.setAttribute("data-name", entryName(entry));
      var tags = (entry && entry.tags) || [];
      var meta = (entry && entry.province) ? esc(entry.province) + " \u00b7 " + esc(entry.city) : "";
      var tagHtml = "";
      for (var ti = 0; ti < tags.length; ti++) {
        tagHtml += '<span class="campus-tag">' + esc(tags[ti]) + "</span>";
      }
      row.innerHTML = '<span class="campus-opt-name">' + esc(entryName(entry)) + "</span>"
        + (meta ? '<span class="campus-opt-meta">' + meta + "</span>" : "")
        + tagHtml;
      row.addEventListener("click", function () { pick(row); });
      list.appendChild(row);
      return row;
    }

    function refresh() {
      var value = readValue();
      if (value) { query(value); return; }
      browse(state.letter);
    }

    /* ---------- 搜索 ---------- */
    function query(raw) {
      var q = String(raw == null ? "" : raw).trim();
      state.q = q;
      state.mode = "query";
      clearList();
      if (!q) { browse(state.letter); return; }
      var hits = [];
      if (L && typeof L.search === "function") {
        try { hits = L.search(q) || []; } catch (e) { hits = []; }
      }
      var shown = [];
      for (var i = 0; i < hits.length; i++) {
        if (tagMatch(hits[i], state.filter)) { shown.push(hits[i]); }
      }
      state.hits = shown;
      if (!shown.length) {
        renderHeader("\u6ca1\u627e\u5230\uff1f\u53ef\u4ee5\u7167\u539f\u6837\u7528\u8fd9\u4e2a\u540d\u5b57"); // 没找到？可以照原样用这个名字
        renderOpt({ name: q, province: "", city: "", tags: [] }, true);
        return;
      }
      for (var j = 0; j < shown.length; j++) { renderOpt(shown[j], false); }
    }

    /* ---------- 首字母浏览 ---------- */
    function browse(letter) {
      state.letter = letter || "";
      state.mode = "browse";
      clearList();
      var rows = [];
      if (L && typeof L.byInitial === "function" && letter) {
        try { rows = L.byInitial(letter) || []; } catch (e) { rows = []; }
        rows = rows.filter(function (e) { return tagMatch(e, state.filter); });
        if (!rows.length) {
          renderHeader("\u8fd9\u4e2a\u5b57\u6bcd\u4e0b\u6682\u65e0\u6821\u533a\uff0c\u8bd5\u8bd5\u5176\u4ed6"); // 这个字母下暂无校区，试试其他
          return;
        }
      } else {
        rows = L ? (L.schoolOptions ? L.schoolOptions() : []) : [];
        rows = rows.filter(function (e) { return tagMatch(e, state.filter); });
      }
      state.hits = rows;
      for (var i = 0; i < rows.length; i++) { renderOpt(rows[i], false); }
    }

    function pick(row) {
      var name = row.getAttribute("data-name");
      if (name == null) return;
      inputEl.value = name;
      if (opts.onPick) {
        var entry = null;
        if (L && typeof L.search === "function") {
          var hits = L.search(name);
          entry = hits && hits.length ? hits[0] : null;
        }
        opts.onPick(entry);
      }
    }

    function readValue() {
      return (inputEl && inputEl.value != null) ? String(inputEl.value) : "";
    }

    /* ---------- 事件 ---------- */
    if (inputEl.addEventListener) {
      inputEl.addEventListener("input", function () { query(readValue()); });
      inputEl.addEventListener("keydown", function (ev) {
        var key = ev && ev.key;
        var rows = list._children || [];
        var opts2 = [];
        for (var oi = 0; oi < rows.length; oi++) {
          if (rows[oi].className && rows[oi].className.indexOf("campus-opt") === 0) { opts2.push(rows[oi]); }
        }
        if (key === "ArrowDown" && opts2.length) {
          state.active = Math.min(state.active + 1, opts2.length - 1);
          highlight(opts2);
        } else if (key === "ArrowUp" && opts2.length) {
          state.active = Math.max(state.active - 1, 0);
          highlight(opts2);
        } else if (key === "Enter" && opts2.length && state.active >= 0) {
          if (ev && ev.preventDefault) ev.preventDefault();
          pick(opts2[state.active]);
        } else if (key === "Escape") {
          if (ev && ev.preventDefault) ev.preventDefault();
        }
      });
    }

    function highlight(rows) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].classList) {
          rows[i].classList.toggle("campus-active", i === state.active);
        }
      }
    }

    var handle = {
      input: inputEl,
      list: list,
      query: query,
      browse: browse,
      setFilter: setFilter,
      getState: function () { return state; }
    };
    return handle;
  }

  var API = { attach: attach };
  if (typeof window !== "undefined") { window.CampusPicker = API; }
  if (typeof module !== "undefined" && module.exports) { module.exports = API; }
})();
