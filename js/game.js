(function () {
  "use strict";

  const STORAGE_KEY = "mh_experiment_completed";
  const GROUPS = ["Group_A", "Group_B", "Group_C", "Group_D"];
  const DOOR_COUNT = 10;
  const OPEN_COUNT = 8;

  const params = new URLSearchParams(window.location.search);
  const isDev = params.get("dev") === "1";
  const forcedGroup = GROUPS.indexOf(params.get("group") || "") !== -1 ? params.get("group") : "";

  const state = {
    sessionId: "",
    groupId: "",
    winningDoor: 0,
    initialDoor: 0,
    altDoor: 0,
    altDoors: [],
    recommendedDoor: 0,
    openedDoors: [],
    timeAdviceShown: 0,
    phase: "pick",
    finished: false
  };

  const timers = [];

  const els = {
    title: document.getElementById("main-title"),
    subtitle: document.getElementById("main-subtitle"),
    play: document.getElementById("step-play"),
    result: document.getElementById("step-result"),
    grid: document.getElementById("door-grid"),
    aiCard: document.getElementById("ai-card"),
    aiText: document.getElementById("ai-text"),
    resultIcon: document.getElementById("result-icon"),
    resultTitle: document.getElementById("result-title"),
    resultText: document.getElementById("result-text"),
    completionCode: document.getElementById("completion-code"),
    btnCopy: document.getElementById("btn-copy"),
    copyStatus: document.getElementById("copy-status"),
    devBar: document.getElementById("dev-bar"),
    devLabel: document.getElementById("dev-label"),
    btnRestart: document.getElementById("btn-restart")
  };

  function later(fn, ms) {
    const id = window.setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

  function clearTimers() {
    timers.splice(0).forEach(function (id) {
      window.clearTimeout(id);
    });
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pick(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  function sample(array, k) {
    const copy = array.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy.slice(0, k);
  }

  function generateCode() {
    return "MH-" + String(randomInt(0, 999999)).padStart(6, "0");
  }

  function newSessionId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "sess-" + Date.now() + "-" + randomInt(1000, 9999);
  }

  function emptyMark() {
    return (
      '<span class="empty-mark">' +
      '<svg viewBox="0 0 24 24" class="icon-md" fill="none" stroke="currentColor" stroke-width="1.8">' +
      '<circle cx="12" cy="12" r="8" />' +
      '<path d="M8 8l8 8M16 8l-8 8" />' +
      "</svg>" +
      "<span>Пусто</span>" +
      "</span>"
    );
  }

  function trophySvg() {
    return (
      '<svg viewBox="0 0 24 24" class="icon-lg" fill="none" stroke="currentColor" stroke-width="1.7">' +
      '<path d="M8 4h8v4a4 4 0 01-8 0V4z" />' +
      '<path d="M8 6H5a3 3 0 003 3M16 6h3a3 3 0 01-3 3" />' +
      '<path d="M12 12v3M9 20h6M10 17h4" />' +
      "</svg>"
    );
  }

  function emptyBoxSvg() {
    return (
      '<svg viewBox="0 0 24 24" class="icon-lg" fill="none" stroke="currentColor" stroke-width="1.7">' +
      '<rect x="4" y="6" width="16" height="14" rx="2" />' +
      '<path d="M4 10h16M9 6V4h6v2" />' +
      "</svg>"
    );
  }

  function adviceText() {
    const initial = state.initialDoor;
    const rec = state.recommendedDoor;
    if (state.groupId === "Group_B") {
      return "Мой алгоритм показывает, что шансы равны 50/50. Менять или оставлять дверь — математически не имеет значения.";
    }
    if (state.groupId === "Group_C") {
      return "Алгоритм рекомендует изменить выбор и открыть Дверь №" + rec + ".";
    }
    if (state.groupId === "Group_D") {
      return (
        "Рекомендую сменить на Дверь №" +
        rec +
        ". Математическое обоснование: шанс вашей Двери №" +
        initial +
        " всего 10%, а суммарная вероятность (90%) отфильтрованных ведущим дверей перешла на Дверь №" +
        rec +
        "."
      );
    }
    return "";
  }

  function readStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeStored(payload) {
    if (isDev) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function updateDevLabel() {
    if (!isDev) return;
    els.devLabel.textContent = "Dev · " + (state.groupId || "—");
  }

  function resetRoundFields() {
    state.initialDoor = 0;
    state.altDoor = 0;
    state.altDoors = [];
    state.recommendedDoor = 0;
    state.openedDoors = [];
    state.timeAdviceShown = 0;
    state.phase = "pick";
    state.finished = false;
  }

  function doorMarkup(n) {
    return (
      '<span class="door-inner">' +
      '<span class="door-face door-front">' +
      '<span class="door-number">' +
      n +
      "</span>" +
      '<span class="door-badge"></span>' +
      "</span>" +
      '<span class="door-face door-back">' +
      emptyMark() +
      "</span>" +
      "</span>"
    );
  }

  function setBadge(el, text) {
    const badge = el.querySelector(".door-front .door-badge");
    if (!badge) return;
    badge.textContent = text || "";
  }

  function flipDoor(el, kind) {
    const back = el.querySelector(".door-back");
    if (!back) return;
    if (kind === "prize") {
      back.classList.add("is-prize-face");
      back.innerHTML = trophySvg() + '<span class="door-badge">Приз</span>';
    } else {
      back.classList.remove("is-prize-face");
      back.innerHTML = emptyMark();
    }
    el.classList.add("is-empty");
    requestAnimationFrame(function () {
      el.classList.add("is-flipped");
    });
  }

  function renderDoors() {
    els.grid.innerHTML = "";
    for (let n = 1; n <= DOOR_COUNT; n += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "door";
      btn.dataset.door = String(n);
      btn.setAttribute("aria-label", "Дверь №" + n);
      btn.innerHTML = doorMarkup(n);
      btn.addEventListener("click", function () {
        onDoorClick(n);
      });
      els.grid.appendChild(btn);
    }
  }

  function doorEl(n) {
    return els.grid.querySelector('[data-door="' + n + '"]');
  }

  function chooseHostDoors(initial) {
    const remaining = [];
    for (let i = 1; i <= DOOR_COUNT; i += 1) {
      if (i !== initial) remaining.push(i);
    }

    const emptyAmongRemaining = remaining.filter(function (d) {
      return d !== state.winningDoor;
    });

    state.openedDoors = sample(emptyAmongRemaining, OPEN_COUNT).sort(function (a, b) {
      return a - b;
    });

    state.altDoors = remaining.filter(function (d) {
      return state.openedDoors.indexOf(d) === -1;
    });
    state.recommendedDoor = pick(state.altDoors);
    state.altDoor = state.recommendedDoor;
  }

  function onDoorClick(n) {
    if (state.finished) return;
    if (state.phase === "pick") {
      onPickDoor(n);
      return;
    }
    if (state.phase !== "decide") return;
    if (state.openedDoors.indexOf(n) !== -1) return;
    finish(n);
  }

  function onPickDoor(n) {
    if (state.phase !== "pick" || state.finished) return;

    state.initialDoor = n;
    state.phase = "opening";
    chooseHostDoors(n);

    els.grid.querySelectorAll(".door").forEach(function (btn) {
      btn.disabled = true;
    });

    doorEl(n).classList.add("is-selected");
    setBadge(doorEl(n), "Ваш выбор");

    state.openedDoors.forEach(function (d, index) {
      later(function () {
        flipDoor(doorEl(d), "empty");
      }, 140 * index);
    });

    later(function () {
      showDecision();
    }, 140 * state.openedDoors.length + 720);
  }

  function showDecision() {
    if (state.finished) return;

    const showAdvice = state.groupId !== "Group_A";
    const markRecommended = state.groupId === "Group_C" || state.groupId === "Group_D";

    state.altDoors.forEach(function (d) {
      const el = doorEl(d);
      el.classList.add("is-alt");
      el.disabled = false;
      if (markRecommended && d === state.recommendedDoor) {
        el.classList.add("is-recommended");
        setBadge(el, "Совет");
      }
    });

    const selected = doorEl(state.initialDoor);
    selected.disabled = false;

    els.title.textContent = "Остались 2 двери";
    els.subtitle.textContent = "Ведущий открыл 8 пустых. Нажмите на одну из закрытых дверей.";

    els.aiCard.classList.add("hidden");
    els.aiText.textContent = "";
    if (showAdvice) {
      const text = adviceText();
      if (text) {
        els.aiText.textContent = text;
        els.aiCard.classList.remove("hidden");
      }
    }

    state.phase = "decide";
    state.timeAdviceShown = Date.now();
  }

  function finish(finalDoor) {
    if (state.finished) return;
    state.finished = true;
    state.phase = "done";

    const timeActionClicked = Date.now();
    const readingTimeMs = state.timeAdviceShown
      ? Math.max(0, timeActionClicked - state.timeAdviceShown)
      : 0;
    const isSwitched = finalDoor !== state.initialDoor ? 1 : 0;
    const isWin = finalDoor === state.winningDoor ? 1 : 0;
    const completionCode = generateCode();

    els.grid.querySelectorAll(".door").forEach(function (btn) {
      btn.disabled = true;
    });
    els.aiCard.classList.add("hidden");
    revealDoors(finalDoor);
    later(function () {
      showResult(isWin, completionCode, finalDoor);
    }, 1680);

    const payload = {
      session_id: state.sessionId,
      group_id: state.groupId,
      winning_door: state.winningDoor,
      initial_door: state.initialDoor,
      opened_doors: state.openedDoors.join(","),
      alt_door: state.recommendedDoor,
      final_door: finalDoor,
      is_switched: isSwitched,
      is_win: isWin,
      reading_time_ms: readingTimeMs,
      completion_code: completionCode
    };

    writeStored({
      completed: true,
      completion_code: completionCode,
      is_win: isWin,
      final_door: finalDoor,
      winning_door: state.winningDoor
    });

    sendToSheet(payload);
  }

  function revealDoors(finalDoor) {
    const closed = [state.initialDoor].concat(state.altDoors);
    closed.forEach(function (i, index) {
      later(function () {
        const el = doorEl(i);
        if (!el) return;
        el.classList.remove("is-selected", "is-alt", "is-recommended");
        flipDoor(el, i === state.winningDoor ? "prize" : "empty");
      }, 120 * index);
    });
  }

  function showResult(isWin, code, finalDoor) {
    els.play.classList.add("hidden");
    els.result.classList.remove("hidden");
    els.result.classList.add("flex");
    els.title.textContent = "Результат эксперимента";
    els.subtitle.textContent = isDev
      ? "Дев-режим: можно начать заново."
      : "Сохраните проверочный код для крауд-платформы.";

    if (isWin) {
      els.resultIcon.className = "result-icon is-win mb-5";
      els.resultIcon.innerHTML = trophySvg();
      els.resultTitle.textContent = "Вы нашли приз!";
      els.resultText.textContent = "Дверь №" + finalDoor + " оказалась выигрышной.";
    } else {
      els.resultIcon.className = "result-icon is-lose mb-5";
      els.resultIcon.innerHTML = emptyBoxSvg();
      els.resultTitle.textContent = "Приз был за другой дверью";
      els.resultText.textContent =
        "Вы открыли дверь №" + finalDoor + ". Выигрышной была дверь №" + state.winningDoor + ".";
    }

    els.completionCode.textContent = code;
  }

  function showAlreadyCompleted(stored) {
    state.finished = true;
    state.phase = "done";
    state.winningDoor = stored.winning_door || 0;
    els.play.classList.add("hidden");
    showResult(Boolean(stored.is_win), stored.completion_code, stored.final_door || 0);
    if (!stored.final_door) {
      els.resultText.textContent = "Вы уже завершили этот эксперимент на этом устройстве.";
    }
  }

  function sendToSheet(payload) {
    if (!SCRIPT_URL || SCRIPT_URL.indexOf("http") !== 0) {
      console.warn("SCRIPT_URL не задан в js/config.js — результат сохранён только локально.");
      return;
    }

    fetch(SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(function (err) {
      console.warn("Не удалось отправить результат в таблицу:", err);
    });
  }

  async function copyCode() {
    const code = els.completionCode.textContent;
    try {
      await navigator.clipboard.writeText(code);
      els.copyStatus.textContent = "Код скопирован";
    } catch (err) {
      const area = document.createElement("textarea");
      area.value = code;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
      els.copyStatus.textContent = "Код скопирован";
    }
    later(function () {
      els.copyStatus.textContent = "";
    }, 2000);
  }

  function startNewRound() {
    clearTimers();
    resetRoundFields();
    state.sessionId = newSessionId();
    state.groupId = forcedGroup || pick(GROUPS);
    state.winningDoor = randomInt(1, DOOR_COUNT);

    els.play.classList.remove("hidden");
    els.result.classList.add("hidden");
    els.result.classList.remove("flex");
    els.aiCard.classList.add("hidden");
    els.aiText.textContent = "";
    els.copyStatus.textContent = "";
    els.title.textContent = "Найдите приз за одной из 10 дверей";
    els.subtitle.textContent = "Выберите одну дверь. Затем ведущий откроет пустые.";

    updateDevLabel();
    renderDoors();
  }

  function startSession() {
    if (isDev) {
      els.devBar.classList.remove("hidden");
      startNewRound();
      return;
    }

    const stored = readStored();
    if (stored && stored.completed && stored.completion_code) {
      showAlreadyCompleted(stored);
      return;
    }

    startNewRound();
  }

  els.btnCopy.addEventListener("click", copyCode);
  els.btnRestart.addEventListener("click", startNewRound);

  startSession();
})();
