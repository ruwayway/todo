let widgetSettings = {
  alwaysOnTop: true,
  opacity: 1,
  ignoreMouseEvents: false,
  theme: "yellow"
};

function getTodayLabel() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const week = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${y}.${m}.${day} (${week})`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function applyTheme(theme) {
  const body = document.getElementById("widget-body");
  body.classList.remove("theme-yellow", "theme-pink", "theme-mint");
  body.classList.add(`theme-${theme}`);
}

function syncControlUI() {
  const opacityRange = document.getElementById("opacity-range");
  const themeSelect = document.getElementById("theme-select");

  if (opacityRange) opacityRange.value = String(Math.round((widgetSettings.opacity || 1) * 100));
  if (themeSelect) themeSelect.value = widgetSettings.theme || "yellow";

  applyTheme(widgetSettings.theme || "yellow");
}

async function loadInitialSettings() {
  if (!window.widgetWindowAPI?.getSettings) return;
  const settings = await window.widgetWindowAPI.getSettings();
  widgetSettings = { ...widgetSettings, ...settings };
  syncControlUI();
}

function minimizeWidget() {
  window.widgetWindowAPI?.minimize?.();
}

function closeWidget() {
  window.widgetWindowAPI?.close?.();
}

function openMainApp() {
  window.widgetWindowAPI?.showMain?.();
}

function toggleAlwaysOnTop() {
  widgetSettings.alwaysOnTop = !widgetSettings.alwaysOnTop;
  window.widgetWindowAPI?.setAlwaysOnTop?.(widgetSettings.alwaysOnTop);
}

function toggleIgnoreMouse() {
  widgetSettings.ignoreMouseEvents = !widgetSettings.ignoreMouseEvents;
  window.widgetWindowAPI?.setIgnoreMouse?.(widgetSettings.ignoreMouseEvents);
}

async function loadWidget() {
  const summaryEl = document.getElementById("widget-summary");
  const pendingEl = document.getElementById("widget-pending-list");
  const doneEl = document.getElementById("widget-done-list");
  const dateEl = document.getElementById("widget-date");

  if (dateEl) {
    dateEl.textContent = getTodayLabel();
  }

  try {
    const meRes = await fetch("/api/me");
    const meData = await meRes.json();

    if (!meData.user) {
      summaryEl.textContent = "로그인 필요";
      pendingEl.innerHTML = `<div class="empty-day">메인 창에서 먼저 로그인하세요</div>`;
      doneEl.innerHTML = "";
      return;
    }

    const reportRes = await fetch("/api/today-report");
    if (!reportRes.ok) {
      summaryEl.textContent = "불러오기 실패";
      pendingEl.innerHTML = `<div class="empty-day">업무현황을 불러오지 못했습니다</div>`;
      doneEl.innerHTML = "";
      return;
    }

    const report = await reportRes.json();

    summaryEl.textContent = `완료 ${report.done} / 전체 ${report.total}`;

    if (!report.total) {
      pendingEl.innerHTML = `<div class="empty-day">오늘 업무가 없습니다</div>`;
      doneEl.innerHTML = `<div class="empty-day">완료한 업무 없음</div>`;
      return;
    }

    pendingEl.innerHTML = report.pendingList.length
      ? report.pendingList.map((t) => `
          <label class="postit-item">
            <input type="checkbox" onchange="toggleWidgetTask(${t.id}, true)">
            <span>${escapeHtml(t.title)}</span>
          </label>
        `).join("")
      : `<div class="empty-day">남은 업무 없음</div>`;

    doneEl.innerHTML = report.doneList.length
      ? report.doneList.map((t) => `
          <label class="postit-item done">
            <input type="checkbox" checked onchange="toggleWidgetTask(${t.id}, false)">
            <span>${escapeHtml(t.title)}</span>
          </label>
        `).join("")
      : `<div class="empty-day">완료한 업무 없음</div>`;
  } catch (error) {
    console.error(error);
    summaryEl.textContent = "오류";
    pendingEl.innerHTML = `<div class="empty-day">위젯 로딩 중 오류가 발생했습니다</div>`;
    doneEl.innerHTML = "";
  }
}

async function toggleWidgetTask(id, checked) {
  const today = new Date().toISOString().split("T")[0];

  try {
    const res = await fetch(`/api/tasks/${id}/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        date: today,
        checked
      })
    });

    if (!res.ok) {
      alert("체크 변경 실패");
      return;
    }

    await loadWidget();
  } catch (error) {
    console.error(error);
    alert("체크 변경 실패");
  }
}

document.getElementById("opacity-range")?.addEventListener("input", (e) => {
  const value = Number(e.target.value) / 100;
  widgetSettings.opacity = value;
  window.widgetWindowAPI?.setOpacity?.(value);
});

document.getElementById("theme-select")?.addEventListener("change", (e) => {
  const theme = e.target.value;
  widgetSettings.theme = theme;
  applyTheme(theme);
  window.widgetWindowAPI?.setTheme?.(theme);
});

window.widgetWindowAPI?.onApplySettings?.((settings) => {
  widgetSettings = { ...widgetSettings, ...settings };
  syncControlUI();
});

loadInitialSettings();
loadWidget();
setInterval(loadWidget, 30000);