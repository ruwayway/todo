const REPEAT_LABEL = {
  daily: "매일",
  weekday: "평일",
  weekly: "매주",
  monthly: "매월"
};

const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
const DAYS = ["일","월","화","수","목","금","토"];

let tasks = [];
let dateChecks = {};
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth();
let selectedDate = null;
let detailId = null;
let isNewMode = false;
let currentUser = null;

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function fmt(d) {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${m}/${day}`;
}

function isCheckedOn(id, ds) {
  return !!dateChecks[`${id}_${ds}`];
}

function getRepeatLabel(rep) {
  return REPEAT_LABEL[rep] || "";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function taskAppearsOn(t, ds) {
  if (t.repeat) {
    const d = new Date(ds);
    const dow = d.getDay();
    const dom = d.getDate();
    const ref = t.startDate || (t.createdAt || "").slice(0, 10) || ds;

    if (t.repeat === "daily") return true;
    if (t.repeat === "weekday") return dow >= 1 && dow <= 5;
    if (t.repeat === "weekly") return new Date(ref).getDay() === dow;
    if (t.repeat === "monthly") return new Date(ref).getDate() === dom;
  }

  if (t.startDate && t.dueDate) return ds >= t.startDate && ds <= t.dueDate;
  if (t.dueDate) return t.dueDate === ds;
  if (t.startDate) return t.startDate === ds;
  return (t.createdAt || "").slice(0, 10) === ds;
}

function getTasksForDate(ds) {
  return tasks.filter((t) => taskAppearsOn(t, ds));
}

function isDoneOn(t, ds) {
  if (t.repeat || (t.startDate && t.dueDate && t.startDate !== t.dueDate)) {
    return isCheckedOn(t.id, ds);
  }
  return !!t.done;
}

async function loadTasks() {
  const res = await fetch("/api/tasks");

  if (res.status === 401) {
    location.href = "/login.html";
    return;
  }

  const data = await res.json();
  tasks = data.tasks || [];
  dateChecks = data.dateChecks || {};
}

async function checkSession() {
  const res = await fetch("/api/me");
  const data = await res.json();

  if (!data.user) {
    location.href = "/login.html";
    return false;
  }

  currentUser = data.user;
  const userNameEl = document.getElementById("user-name");
  if (userNameEl) {
    userNameEl.textContent = currentUser.username;
  }
  return true;
}

function setupDesktopOnlyButtons() {
  const hasElectronWidget = !!window.widgetWindowAPI;
  const openBtn = document.getElementById("btn-open-widget");
  const hideBtn = document.getElementById("btn-hide-widget");

  if (!hasElectronWidget) {
    if (openBtn) openBtn.style.display = "none";
    if (hideBtn) hideBtn.style.display = "none";
  }
}

function getCategoryClass(category) {
  const map = {
    "업무": "cat-work",
    "개발": "cat-dev",
    "기획": "cat-plan",
    "미팅": "cat-meeting",
    "개인": "cat-personal",
    "썸네일": "cat-thumb",
    "상세페이지": "cat-detail",
    "배너": "cat-banner"
  };
  return map[category] || "cat-default";
}

function getRepeatClass(repeat) {
  const map = {
    daily: "rep-daily",
    weekday: "rep-weekday",
    weekly: "rep-weekly",
    monthly: "rep-monthly"
  };
  return map[repeat] || "rep-default";
}

function getCalendarChipClass(t, ds) {
  if (isDoneOn(t, ds)) return "dot-done";

  if (t.repeat) {
    return `dot-item ${getRepeatClass(t.repeat)}`;
  }

  if (t.category) {
    return `dot-item ${getCategoryClass(t.category)}`;
  }

  if (t.priority === "high") return "dot-item dot-high";
  if (t.priority === "low") return "dot-item dot-low";
  return "dot-item dot-mid";
}

function renderCalendar() {
  const calTitle = document.getElementById("cal-title");
  const grid = document.getElementById("cal-grid");
  if (!calTitle || !grid) return;

  calTitle.textContent = `${viewYear}년 ${MONTHS[viewMonth]}`;
  grid.innerHTML = "";

  DAYS.forEach((d) => {
    const el = document.createElement("div");
    el.className = "day-name";
    el.textContent = d;
    grid.appendChild(el);
  });

  const startDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevDays = new Date(viewYear, viewMonth, 0).getDate();

  for (let i = 0; i < startDow; i++) {
    const d = prevDays - startDow + 1 + i;
    const py = viewMonth === 0 ? viewYear - 1 : viewYear;
    const pm = viewMonth === 0 ? 12 : viewMonth;
    grid.appendChild(
      makeCell(
        d,
        `${py}-${String(pm).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        true
      )
    );
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    grid.appendChild(makeCell(d, ds, false));
  }

  const filled = startDow + daysInMonth;
  const rem = (7 - (filled % 7)) % 7;

  for (let d = 1; d <= rem; d++) {
    const ny = viewMonth === 11 ? viewYear + 1 : viewYear;
    const nm = viewMonth === 11 ? 1 : viewMonth + 2;
    grid.appendChild(
      makeCell(
        d,
        `${ny}-${String(nm).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        true
      )
    );
  }
}

function makeCell(d, ds, other) {
  const td = todayStr();
  const cell = document.createElement("div");

  let cls = "day-cell" + (other ? " other-month" : "");
  if (ds === td) cls += " today-cell";
  if (ds === selectedDate) cls += " selected";
  cell.className = cls;
  cell.onclick = () => selectDate(ds);

  const num = document.createElement("div");
  num.className = "day-num";
  num.textContent = d;

  if (ds === td) {
    const dot = document.createElement("span");
    dot.className = "today-dot";
    num.appendChild(dot);
  }

  cell.appendChild(num);

  const dots = document.createElement("div");
  dots.className = "day-dots";

  const dt = getTasksForDate(ds);
  dt.slice(0, 3).forEach((t) => {
    const chip = document.createElement("div");
    chip.className = getCalendarChipClass(t, ds);
    chip.textContent = t.title;
    dots.appendChild(chip);
  });

  if (dt.length > 3) {
    const more = document.createElement("div");
    more.className = "more-lbl";
    more.textContent = `+${dt.length - 3}`;
    dots.appendChild(more);
  }

  cell.appendChild(dots);
  return cell;
}

function selectDate(ds) {
  selectedDate = ds;

  const [y, m, d] = ds.split("-");
  const titleEl = document.getElementById("day-panel-title");
  const addBtn = document.getElementById("btn-add-task");

  if (titleEl) {
    titleEl.textContent = `${y}년 ${m}월 ${d}일`;
  }
  if (addBtn) {
    addBtn.style.display = "";
  }

  renderCalendar();
  renderDayPanel();
}

function renderCategoryTag(category) {
  if (!category) return "";
  return `<span class="tag tag-cat ${getCategoryClass(category)}" data-cat="${escapeHtml(category)}">${escapeHtml(category)}</span>`;
}

function renderRepeatTag(repeat) {
  if (!repeat) return "";
  return `<span class="tag tag-rep ${getRepeatClass(repeat)}" data-rep="${escapeHtml(repeat)}">${escapeHtml(getRepeatLabel(repeat))}</span>`;
}

function renderDayPanel() {
  if (!selectedDate) return;

  const dt = getTasksForDate(selectedDate);
  const el = document.getElementById("day-task-list");
  if (!el) return;

  if (!dt.length) {
    el.innerHTML = `<div class="empty-day">이날 업무가 없습니다</div>`;
    return;
  }

  el.innerHTML = dt.map((t) => {
    const checked = isDoneOn(t, selectedDate);
    return `
      <div class="task-row ${checked ? "done" : ""}">
        <input type="checkbox" ${checked ? "checked" : ""} onclick="event.stopPropagation();toggleDoneOn(${t.id}, '${selectedDate}')">
        <div class="task-row-body" onclick="openDetail(${t.id})">
          <div class="task-row-title">${escapeHtml(t.title)}</div>
          <div class="task-row-meta">
            ${renderCategoryTag(t.category)}
            ${renderRepeatTag(t.repeat)}
            ${t.dueDate ? `<span class="tag-date">~${fmt(t.dueDate)}</span>` : ""}
            ${t.memo ? `<span class="tag tag-cat cat-default">메모</span>` : ""}
          </div>
        </div>
        <button class="del-btn" onclick="event.stopPropagation();deleteTask(${t.id})">✕</button>
      </div>
    `;
  }).join("");
}

function getUrgentTasks() {
  const td = todayStr();
  const tm = tomorrowStr();

  return tasks
    .filter((t) => {
      if (t.repeat) return false;
      if (t.dueDate === td && !isDoneOn(t, td)) return true;
      if (t.dueDate === tm && !isDoneOn(t, tm)) return true;
      return false;
    })
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
}

function renderUrgent() {
  const urgent = getUrgentTasks();
  const td = todayStr();

  const countEl = document.getElementById("urgent-count");
  const el = document.getElementById("urgent-list");
  if (!countEl || !el) return;

  countEl.textContent = `${urgent.length}건`;

  if (!urgent.length) {
    el.innerHTML = `<div class="empty-urgent">임박한 업무가 없습니다</div>`;
    return;
  }

  el.innerHTML = urgent.map((t) => {
    const isToday = t.dueDate === td;
    const checked = isDoneOn(t, t.dueDate);

    return `
      <div class="urgent-item">
        <div class="urgency-bar ${isToday ? "ub-today" : "ub-tomorrow"}"></div>
        <div class="urgent-body" onclick="openDetail(${t.id})">
          <div class="urgent-title">${escapeHtml(t.title)}</div>
          <div class="urgent-meta">
            ${renderCategoryTag(t.category)}
            <span class="${isToday ? "due-today" : "due-tomorrow"}">${isToday ? "오늘 마감" : "내일 마감"}</span>
          </div>
        </div>
        <input type="checkbox" class="urgent-check" ${checked ? "checked" : ""} onchange="toggleDoneOn(${t.id}, '${t.dueDate}')">
      </div>
    `;
  }).join("");
}

function showDetailForm(withDelete) {
  const detailEmpty = document.getElementById("detail-empty");
  const detailHeader = document.getElementById("detail-header");
  const detailBody = document.getElementById("detail-body");
  const saveBtn = document.getElementById("btn-save");
  const delBtn = document.getElementById("btn-del2");
  const toast = document.getElementById("saved-toast");

  if (detailEmpty) detailEmpty.style.display = "none";
  if (detailHeader) detailHeader.style.display = "flex";
  if (detailBody) detailBody.style.display = "block";
  if (saveBtn) saveBtn.style.display = "";
  if (delBtn) delBtn.style.display = withDelete ? "" : "none";
  if (toast) toast.style.display = "none";
}

function openNewDetail() {
  isNewMode = true;
  detailId = null;

  document.getElementById("d-title").value = "";
  document.getElementById("d-start").value = selectedDate || "";
  document.getElementById("d-due").value = selectedDate || "";
  document.getElementById("d-cat").value = "";
  document.getElementById("d-repeat").value = "";
  document.getElementById("d-memo").value = "";

  showDetailForm(false);
}

function openDetail(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;

  isNewMode = false;
  detailId = id;

  document.getElementById("d-title").value = t.title || "";
  document.getElementById("d-start").value = t.startDate || "";
  document.getElementById("d-due").value = t.dueDate || "";
  document.getElementById("d-cat").value = t.category || "";
  document.getElementById("d-repeat").value = t.repeat || "";
  document.getElementById("d-memo").value = t.memo || "";

  showDetailForm(true);
}

function resetDetail() {
  detailId = null;
  isNewMode = false;

  const detailEmpty = document.getElementById("detail-empty");
  const detailHeader = document.getElementById("detail-header");
  const detailBody = document.getElementById("detail-body");

  if (detailEmpty) detailEmpty.style.display = "";
  if (detailHeader) detailHeader.style.display = "none";
  if (detailBody) detailBody.style.display = "none";
}

async function saveDetail() {
  const title = document.getElementById("d-title").value.trim();

  if (!title) {
    alert("업무명을 입력하세요");
    return;
  }

  const payload = {
    title,
    category: document.getElementById("d-cat").value,
    priority: "mid",
    startDate: document.getElementById("d-start").value,
    dueDate: document.getElementById("d-due").value,
    repeat: document.getElementById("d-repeat").value,
    memo: document.getElementById("d-memo").value
  };

  try {
    if (isNewMode) {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("추가 실패:", text);
        alert("업무 추가 실패");
        return;
      }

      const data = await res.json();
      isNewMode = false;
      detailId = data.id ?? null;
    } else {
      const res = await fetch(`/api/tasks/${detailId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("수정 실패:", text);
        alert("업무 수정 실패");
        return;
      }
    }

    await loadTasks();

    if (!selectedDate) {
      selectedDate = todayStr();
    }

    renderCalendar();
    renderDayPanel();
    renderUrgent();
    updateBadge();
    await renderTodayReport();

    const toast = document.getElementById("saved-toast");
    if (toast) {
      toast.style.display = "inline";
      setTimeout(() => {
        toast.style.display = "none";
      }, 1500);
    }
  } catch (e) {
    console.error(e);
    alert("저장 실패");
  }
}

async function deleteTask(id) {
  const res = await fetch(`/api/tasks/${id}`, {
    method: "DELETE"
  });

  if (!res.ok) {
    alert("삭제 실패");
    return;
  }

  if (detailId === id) {
    resetDetail();
  }

  await loadTasks();
  renderCalendar();
  renderDayPanel();
  renderUrgent();
  updateBadge();
  await renderTodayReport();
}

async function deleteFromDetail() {
  if (!detailId) return;
  await deleteTask(detailId);
}

async function toggleDoneOn(id, ds) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;

  const nextChecked = !isDoneOn(t, ds);

  const res = await fetch(`/api/tasks/${id}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: ds,
      checked: nextChecked
    })
  });

  if (!res.ok) {
    alert("체크 상태 변경 실패");
    return;
  }

  await loadTasks();
  renderCalendar();
  renderDayPanel();
  renderUrgent();
  updateBadge();
  await renderTodayReport();
}

function updateBadge() {
  const td = todayStr();
  const pending = tasks.filter((t) => !isDoneOn(t, td)).length;
  const badge = document.getElementById("pending-badge");
  if (badge) {
    badge.textContent = `${pending}개 남음`;
  }
}

async function renderTodayReport() {
  const res = await fetch("/api/today-report");
  if (!res.ok) return;

  const report = await res.json();

  const summaryEl = document.getElementById("report-summary");
  const box = document.getElementById("today-report-box");
  const reportText = document.getElementById("report-text");

  if (summaryEl) {
    summaryEl.textContent = `${report.done} / ${report.total}`;
  }

  if (reportText) {
    reportText.value = report.reportText || "";
  }

  if (!box) return;

  if (!report.total) {
    box.innerHTML = `<div class="empty-urgent">오늘 업무가 없습니다</div>`;
    return;
  }

  box.innerHTML = `
    <div class="report-section">
      <h4>완료한 일 (${report.done})</h4>
      ${
        report.doneList.length
          ? report.doneList.map((t) => `<div class="report-li">✅ ${escapeHtml(t.title)}</div>`).join("")
          : `<div class="report-li">완료한 업무 없음</div>`
      }
    </div>
    <div class="report-section">
      <h4>남은 일 (${report.pending})</h4>
      ${
        report.pendingList.length
          ? report.pendingList.map((t) => `<div class="report-li">🕒 ${escapeHtml(t.title)}</div>`).join("")
          : `<div class="report-li">남은 업무 없음</div>`
      }
    </div>
  `;
}

function copyTodayReport() {
  const text = document.getElementById("report-text").value;
  navigator.clipboard.writeText(text).then(() => {
    alert("업무보고 텍스트가 복사되었습니다.");
  }).catch(() => {
    alert("복사 실패");
  });
}

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login.html";
}

function openWidget() {
  if (window.widgetWindowAPI?.show) {
    window.widgetWindowAPI.show();
  }
}

function hideWidget() {
  if (window.widgetWindowAPI?.hide) {
    window.widgetWindowAPI.hide();
  }
}

function openDesktopWidget() {
  window.location.href = "todocal://open-widget";
}

function changeMonth(dir) {
  viewMonth += dir;

  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear++;
  }
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear--;
  }

  renderCalendar();
}

function goToday() {
  const td = todayStr();
  const d = new Date(td);
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
  selectDate(td);
}

async function refresh() {
  renderCalendar();
  renderDayPanel();
  renderUrgent();
  updateBadge();
  await renderTodayReport();
}

(async function init() {
  const ok = await checkSession();
  if (!ok) return;

  setupDesktopOnlyButtons();
  await loadTasks();

  if (!selectedDate) {
    selectedDate = todayStr();
  }

  await refresh();
  selectDate(selectedDate);
})();