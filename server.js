const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax"
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  next();
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

function buildDateChecks(userId) {
  const checks = db
    .prepare(
      `
      SELECT tc.task_id, tc.check_date, tc.checked
      FROM task_checks tc
      JOIN tasks t ON tc.task_id = t.id
      WHERE t.user_id = ?
      `
    )
    .all(userId);

  const dateChecks = {};
  checks.forEach((c) => {
    if (c.checked) {
      dateChecks[`${c.task_id}_${c.check_date}`] = true;
    }
  });
  return dateChecks;
}

function isDoneOn(t, ds, dateChecks) {
  if (t.repeat || (t.startDate && t.dueDate && t.startDate !== t.dueDate)) {
    return !!dateChecks[`${t.id}_${ds}`];
  }
  return !!t.done;
}

/* ---------------- AUTH ---------------- */

app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "아이디와 비밀번호를 입력하세요." });
    }

    const cleanId = username.trim();
    const cleanPw = password.trim();

    if (cleanId.length < 3) {
      return res.status(400).json({ message: "아이디는 3자 이상이어야 합니다." });
    }

    if (cleanPw.length < 4) {
      return res.status(400).json({ message: "비밀번호는 4자 이상이어야 합니다." });
    }

    const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(cleanId);
    if (exists) {
      return res.status(400).json({ message: "이미 존재하는 아이디입니다." });
    }

    const passwordHash = await bcrypt.hash(cleanPw, 10);

    const result = db
      .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
      .run(cleanId, passwordHash);

    req.session.user = {
      id: result.lastInsertRowid,
      username: cleanId
    };

    res.json({ ok: true, user: req.session.user });
  } catch (error) {
    console.error("register error:", error);
    res.status(500).json({ message: "회원가입 실패", error: error.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get((username || "").trim());

    if (!user) {
      return res.status(400).json({ message: "존재하지 않는 아이디입니다." });
    }

    const ok = await bcrypt.compare((password || "").trim(), user.password_hash);
    if (!ok) {
      return res.status(400).json({ message: "비밀번호가 올바르지 않습니다." });
    }

    req.session.user = {
      id: user.id,
      username: user.username
    };

    res.json({ ok: true, user: req.session.user });
  } catch (error) {
    console.error("login error:", error);
    res.status(500).json({ message: "로그인 실패", error: error.message });
  }
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

/* ---------------- TASKS ---------------- */

app.get("/api/tasks", requireLogin, (req, res) => {
  try {
    const tasks = db
      .prepare(
        `
        SELECT
          id,
          title,
          category,
          priority,
          start_date as startDate,
          due_date as dueDate,
          repeat_type as repeat,
          done,
          memo,
          created_at as createdAt
        FROM tasks
        WHERE user_id = ?
        ORDER BY id DESC
        `
      )
      .all(req.session.user.id);

    const dateChecks = buildDateChecks(req.session.user.id);

    res.json({ tasks, dateChecks });
  } catch (error) {
    console.error("get tasks error:", error);
    res.status(500).json({ message: "업무 목록 조회 실패", error: error.message });
  }
});

app.post("/api/tasks", requireLogin, (req, res) => {
  try {
    const { title, category, priority, startDate, dueDate, repeat, memo } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: "업무명을 입력하세요." });
    }

    const result = db
      .prepare(
        `
        INSERT INTO tasks (
          user_id, title, category, priority,
          start_date, due_date, repeat_type, memo, done
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        `
      )
      .run(
        req.session.user.id,
        title.trim(),
        category || "",
        priority || "mid",
        startDate || "",
        dueDate || "",
        repeat || "",
        memo || ""
      );

    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error("create task error:", error);
    res.status(500).json({ message: "업무 추가 실패", error: error.message });
  }
});

app.put("/api/tasks/:id", requireLogin, (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, priority, startDate, dueDate, repeat, memo, done } = req.body;

    db.prepare(
      `
      UPDATE tasks
      SET title = ?, category = ?, priority = ?, start_date = ?, due_date = ?, repeat_type = ?, memo = ?, done = ?
      WHERE id = ? AND user_id = ?
      `
    ).run(
      title || "",
      category || "",
      priority || "mid",
      startDate || "",
      dueDate || "",
      repeat || "",
      memo || "",
      done ? 1 : 0,
      id,
      req.session.user.id
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("update task error:", error);
    res.status(500).json({ message: "업무 수정 실패", error: error.message });
  }
});

app.delete("/api/tasks/:id", requireLogin, (req, res) => {
  try {
    const { id } = req.params;

    db.prepare(
      `
      DELETE FROM task_checks
      WHERE task_id IN (
        SELECT id FROM tasks WHERE id = ? AND user_id = ?
      )
      `
    ).run(id, req.session.user.id);

    db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(id, req.session.user.id);

    res.json({ ok: true });
  } catch (error) {
    console.error("delete task error:", error);
    res.status(500).json({ message: "업무 삭제 실패", error: error.message });
  }
});

app.post("/api/tasks/:id/check", requireLogin, (req, res) => {
  try {
    const { id } = req.params;
    const { date, checked } = req.body;

    const task = db
      .prepare(
        `
        SELECT *
        FROM tasks
        WHERE id = ? AND user_id = ?
        `
      )
      .get(id, req.session.user.id);

    if (!task) {
      return res.status(404).json({ message: "업무를 찾을 수 없습니다." });
    }

    const isRepeatOrRange =
      !!task.repeat_type ||
      (task.start_date && task.due_date && task.start_date !== task.due_date);

    if (isRepeatOrRange) {
      db.prepare(
        `
        INSERT INTO task_checks (task_id, check_date, checked)
        VALUES (?, ?, ?)
        ON CONFLICT(task_id, check_date)
        DO UPDATE SET checked = excluded.checked
        `
      ).run(id, date || todayStr(), checked ? 1 : 0);
    } else {
      db.prepare(
        `
        UPDATE tasks
        SET done = ?
        WHERE id = ? AND user_id = ?
        `
      ).run(checked ? 1 : 0, id, req.session.user.id);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("check task error:", error);
    res.status(500).json({ message: "체크 상태 변경 실패", error: error.message });
  }
});

/* ---------------- TODAY REPORT ---------------- */

app.get("/api/today-report", requireLogin, (req, res) => {
  try {
    const ds = req.query.date || todayStr();

    const tasks = db
      .prepare(
        `
        SELECT
          id,
          title,
          category,
          priority,
          start_date as startDate,
          due_date as dueDate,
          repeat_type as repeat,
          done,
          memo,
          created_at as createdAt
        FROM tasks
        WHERE user_id = ?
        ORDER BY id DESC
        `
      )
      .all(req.session.user.id);

    const dateChecks = buildDateChecks(req.session.user.id);

    const todayTasks = tasks.filter((t) => taskAppearsOn(t, ds));
    const doneList = todayTasks.filter((t) => isDoneOn(t, ds, dateChecks));
    const pendingList = todayTasks.filter((t) => !isDoneOn(t, ds, dateChecks));

    const reportText = [
      `[${ds} 업무 보고]`,
      `- 전체 업무: ${todayTasks.length}건`,
      `- 완료: ${doneList.length}건`,
      `- 남은 업무: ${pendingList.length}건`,
      "",
      "[완료한 일]",
      ...(doneList.length ? doneList.map((t) => `- ${t.title}`) : ["- 없음"]),
      "",
      "[남은 일]",
      ...(pendingList.length ? pendingList.map((t) => `- ${t.title}`) : ["- 없음"])
    ].join("\n");

    res.json({
      date: ds,
      total: todayTasks.length,
      done: doneList.length,
      pending: pendingList.length,
      doneList,
      pendingList,
      reportText
    });
  } catch (error) {
    console.error("today report error:", error);
    res.status(500).json({ message: "오늘의 업무현황 조회 실패", error: error.message });
  }
});

/* ---------------- ROOT ---------------- */

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});