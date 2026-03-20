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

function minimizeWidget() {
  if (window.widgetWindowAPI?.minimize) {
    window.widgetWindowAPI.minimize();
  }
}

function closeWidget() {
  if (window.widgetWindowAPI?.close) {
    window.widgetWindowAPI.close();
  }
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

loadWidget();
setInterval(loadWidget, 30000);