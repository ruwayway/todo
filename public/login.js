async function checkSession() {
  const res = await fetch("/api/me");
  const data = await res.json();

  if (data.user) {
    location.href = "/index.html";
  }
}

async function auth(type) {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const msg = document.getElementById("auth-msg");

  msg.textContent = "";

  if (!username || !password) {
    msg.textContent = "아이디와 비밀번호를 입력하세요.";
    return;
  }

  const res = await fetch(`/api/${type}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();

  if (res.ok) {
    location.href = "/index.html";
  } else {
    msg.textContent = data.message || "오류가 발생했습니다.";
  }
}

document.getElementById("loginBtn").addEventListener("click", () => auth("login"));
document.getElementById("registerBtn").addEventListener("click", () => auth("register"));

checkSession();

function openDesktopWidget() {
  window.location.href = "todocal://open-widget";
}