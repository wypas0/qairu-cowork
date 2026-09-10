/* QairuCowork — фронтенд.
   Без сборки и фреймворков: одна страница = один набор обработчиков. */

(function () {
  "use strict";

  /* ---------- мелкие помощники ---------- */

  function toast(text) {
    var node = document.querySelector(".toast");
    if (!node) {
      node = document.createElement("div");
      node.className = "toast";
      document.body.appendChild(node);
    }
    node.textContent = text;
    node.classList.add("show");
    clearTimeout(node._timer);
    node._timer = setTimeout(function () { node.classList.remove("show"); }, 2200);
  }

  function postJSON(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body)
    }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
  }

  function hhmm(minutes) {
    var h = Math.floor(minutes / 60), m = minutes % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  /* ---------- вход из Telegram Mini App ---------- */

  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg && tg.initData) {
    tg.ready();
    tg.expand();
    var slugMeta = document.querySelector('meta[name="qairu-slug"]');
    if (!document.body.dataset.tgAuthed) {
      document.body.dataset.tgAuthed = "1";
      postJSON("/api/tg-auth", {
        initData: tg.initData,
        slug: slugMeta ? slugMeta.content : ""
      }).then(function () {
        if (!document.body.dataset.member) location.reload();
      }).catch(function () { /* обычный вход по ссылке остаётся доступен */ });
    }
  }

  /* ---------- редактор своего расписания ---------- */

  var editor = document.getElementById("editor");
  if (editor) initEditor(editor);

  function initEditor(root) {
    var slug = root.dataset.slug;
    var step = parseInt(root.dataset.step, 10) || 30;
    var painting = false;
    var paintTo = true;          // рисуем занятость или стираем
    var dirty = false;

    function cells() { return root.querySelectorAll("td.cell"); }

    function applyPaint(cell) {
      if (!cell) return;
      cell.classList.toggle("busy", paintTo);
      cell.setAttribute("aria-pressed", paintTo ? "true" : "false");
      dirty = true;
      markDirty();
    }

    function markDirty() {
      var save = document.getElementById("save-btn");
      if (save) { save.disabled = false; save.textContent = save.dataset.dirty; }
    }

    // Указатель: работает и мышью (протяжка), и пальцем (тап + ведение).
    root.addEventListener("pointerdown", function (event) {
      var cell = event.target.closest("td.cell");
      if (!cell) return;
      event.preventDefault();
      painting = true;
      paintTo = !cell.classList.contains("busy");
      applyPaint(cell);
      root.setPointerCapture(event.pointerId);
    });

    root.addEventListener("pointermove", function (event) {
      if (!painting) return;
      var node = document.elementFromPoint(event.clientX, event.clientY);
      var cell = node && node.closest ? node.closest("td.cell") : null;
      if (cell && cell.classList.contains("busy") !== paintTo) applyPaint(cell);
    });

    function stop() { painting = false; }
    root.addEventListener("pointerup", stop);
    root.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);

    // Клавиатура: пробел/Enter переключают клетку — сетка доступна без мыши.
    root.addEventListener("keydown", function (event) {
      if (event.key !== " " && event.key !== "Enter") return;
      var cell = event.target.closest("td.cell");
      if (!cell) return;
      event.preventDefault();
      paintTo = !cell.classList.contains("busy");
      applyPaint(cell);
    });

    // Кнопки «весь день» в заголовке колонки
    root.querySelectorAll("[data-fillday]").forEach(function (button) {
      button.addEventListener("click", function () {
        var weekday = button.dataset.fillday;
        var column = root.querySelectorAll('td.cell[data-weekday="' + weekday + '"]');
        var allBusy = Array.prototype.every.call(column, function (cell) {
          return cell.classList.contains("busy");
        });
        paintTo = !allBusy;
        column.forEach(applyPaint);
      });
    });

    document.getElementById("clear-btn").addEventListener("click", function () {
      paintTo = false;
      cells().forEach(applyPaint);
    });

    /* --- сбор клеток обратно в интервалы --- */
    function collect() {
      var slots = [];
      for (var weekday = 0; weekday < 7; weekday++) {
        var column = root.querySelectorAll('td.cell[data-weekday="' + weekday + '"]');
        var runStart = null, previousEnd = null;
        column.forEach(function (cell) {
          var start = parseInt(cell.dataset.start, 10);
          var end = start + step;
          if (cell.classList.contains("busy")) {
            if (runStart === null) runStart = start;
            previousEnd = end;
          } else if (runStart !== null) {
            slots.push({ weekday: weekday, start: runStart, end: previousEnd });
            runStart = null;
          }
        });
        if (runStart !== null) slots.push({ weekday: weekday, start: runStart, end: previousEnd });
      }
      return slots;
    }

    document.getElementById("save-btn").addEventListener("click", function () {
      var button = this;
      button.disabled = true;
      postJSON("/api/g/" + slug + "/schedule", { slots: collect() })
        .then(function () {
          dirty = false;
          button.textContent = button.dataset.saved;
          toast(button.dataset.savedToast);
        })
        .catch(function () {
          button.disabled = false;
          toast(button.dataset.error);
        });
    });

    window.addEventListener("beforeunload", function (event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });

    /* --- импорт текстом: тот же парсер, что и в боте --- */
    var importBtn = document.getElementById("import-btn");
    if (importBtn) {
      importBtn.addEventListener("click", function () {
        var text = document.getElementById("import-text").value;
        var box = document.getElementById("import-preview");
        if (!text.trim()) return;
        importBtn.disabled = true;
        postJSON("/api/g/" + slug + "/import", { text: text })
          .then(function (data) {
            importBtn.disabled = false;
            if (!data.ok) {
              box.innerHTML = '<p class="muted small">' + importBtn.dataset.failed + "</p>";
              return;
            }
            // Раскрашиваем сетку по распознанным парам, ничего не сохраняя:
            // человек сначала видит результат и только потом жмёт «Сохранить».
            cells().forEach(function (cell) {
              cell.classList.remove("busy");
              cell.setAttribute("aria-pressed", "false");
            });
            data.slots.forEach(function (slot) {
              for (var m = slot.start; m < slot.end; m += step) {
                var cell = root.querySelector(
                  'td.cell[data-weekday="' + slot.weekday + '"][data-start="' + m + '"]');
                if (cell) {
                  cell.classList.add("busy");
                  cell.setAttribute("aria-pressed", "true");
                }
              }
            });
            var lines = data.slots.map(function (slot) {
              return slot.text + (slot.label ? " · " + slot.label : "");
            });
            box.innerHTML = '<p class="small">' + importBtn.dataset.parsed
              .replace("{n}", data.slots.length) + "</p>"
              + '<p class="small muted mono">' + lines.slice(0, 12).join("<br>") + "</p>"
              + (data.errors.length
                ? '<p class="small muted">⚠️ ' + data.errors.join(" · ") + "</p>" : "");
            markDirty();
          })
          .catch(function () {
            importBtn.disabled = false;
            toast(importBtn.dataset.error);
          });
      });
    }
  }

  /* ---------- дашборд: пересчёт сетки под кворум и длину окна ---------- */

  var board = document.getElementById("board");
  if (board) initBoard(board);

  function initBoard(root) {
    var slug = root.dataset.slug;
    var quorumInput = document.getElementById("quorum");
    var minInput = document.getElementById("minslot");
    var output = document.getElementById("windows");
    var quorumLabel = document.getElementById("quorum-label");

    function heatClass(count, total) {
      if (!total || count <= 0) return "h0";
      var share = count / total;
      if (share >= 1) return "h5";
      if (share >= 0.8) return "h4";
      if (share >= 0.6) return "h3";
      if (share >= 0.4) return "h2";
      return "h1";
    }

    function refresh() {
      var params = new URLSearchParams();
      if (quorumInput) params.set("quorum", quorumInput.value);
      if (minInput) params.set("min", minInput.value);
      fetch("/api/g/" + slug + "/state?" + params.toString(), { credentials: "same-origin" })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          if (quorumLabel) {
            quorumLabel.textContent = quorumLabel.dataset.template
              .replace("{q}", data.quorum).replace("{n}", data.total);
          }
          data.days.forEach(function (day) {
            day.cells.forEach(function (cell) {
              var node = root.querySelector(
                'td.cell[data-date="' + day.date + '"][data-start="' + cell.start + '"]');
              if (!node) return;
              node.className = "cell " + heatClass(cell.count, data.total);
              node.title = cell.count + "/" + data.total;
            });
          });
          renderWindows(data);
        })
        .catch(function () { /* при сетевой ошибке просто оставляем прежнюю картинку */ });
    }

    function renderWindows(data) {
      if (!output) return;
      if (!data.windows.length) {
        output.innerHTML = '<p class="muted small">' + output.dataset.empty + "</p>";
        return;
      }
      var html = "";
      data.windows.forEach(function (day) {
        html += '<div class="daygroup"><h3>' + day.label + "</h3><ul class='windows'>";
        day.items.forEach(function (item) {
          html += "<li><span class='when'>" + item.text + "</span>";
          if (!data.everyone) {
            html += ' <span class="small muted">' + item.count + "/" + data.total
              + (item.missing.length ? " — " + output.dataset.missing + " "
                + item.missing.join(", ") : "") + "</span>";
          }
          html += ' <button type="button" class="btn btn-sm pick" data-when="'
            + day.date + "T" + hhmm(item.start) + "|" + (item.end - item.start)
            + '">' + output.dataset.pick + "</button></li>";
        });
        html += "</ul></div>";
      });
      output.innerHTML = html;
    }

    if (quorumInput) quorumInput.addEventListener("input", refresh);
    if (minInput) minInput.addEventListener("change", refresh);

    // «Назначить встречу на это окно» — подставляем время в форму
    document.addEventListener("click", function (event) {
      var pick = event.target.closest(".pick");
      if (!pick) return;
      var field = document.getElementById("when");
      if (!field) return;
      field.value = pick.dataset.when;
      var label = document.getElementById("when-label");
      if (label) label.textContent = pick.closest("li").querySelector(".when").textContent;
      document.getElementById("meeting-form").scrollIntoView({ behavior: "smooth", block: "center" });
    });

    refresh();
  }

  /* ---------- копирование ссылки-приглашения ---------- */

  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      var value = button.dataset.copy;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(value).then(function () {
          toast(button.dataset.copied);
        });
      } else {
        window.prompt(button.dataset.copied, value);
      }
    });
  });
})();
