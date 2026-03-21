const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const path = require("path");
const { createClient } = require("redis");
const { RedisStore } = require("connect-redis");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
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

function isDoneOn(t, ds, dateChecks) {
  if (t.repeat || (t.startDate && t.dueDate && t.startDate !== t.dueDate)) {
    return !!dateChecks[`${t.id}_${ds}`];
  }
  return !!t.done;
}

async function buildDateChecks(userId) {
  const result = await db.query(
    `
    SELECT
      tc.task_id AS "taskId",
      tc.check_date::text AS "checkDate",
      tc.checked
    FROM task_checks tc
    JOIN tasks t ON tc.task_id = t.id
    WHERE t.user_id = $1
    `,
    [userId]
  );

  const dateChecks = {};
  for (const row of result.rows) {
    if (row.checked) {
      dateChecks[`${row.taskId}_${row.checkDate}`] = true;
    }
  }
  return dateChecks;
}

async function startServer() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL 환경변수가 없습니다.");
  }

  const redisClient = createClient({ url: redisUrl });
  redisClient.on("error", (err) => {
    console.error("Redis client error:", err);
  });
  await redisClient.connect();

  const redisStore = new RedisStore({
    client: redisClient,
    prefix: "todo:sess:"
  });

  app.use(
    session({
      store: redisStore,
      name: "todo.sid",
      secret: process.env.SESSION_SECRET || "dev-secret-change-this",
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 30,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax"
      }
    })
  );

  await db.initDb();

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

      const exists = await db.query(
        `SELECT id FROM users WHERE username = $1`,
        [cleanId]
      );

      if (exists.rows.length) {
        return res.status(400).json({ message: "이미 존재하는 아이디입니다." });
      }

      const passwordHash = await bcrypt.hash(cleanPw, 10);

      const inserted = await db.query(
        `
        INSERT INTO users (username, password_hash)
        VALUES ($1, $2)
        RETURNING id, username
        `,
        [cleanId, passwordHash]
      );

      req.session.user = inserted.rows[0];
      res.json({ ok: true, user: req.session.user });
    } catch (error) {
      console.error("register error:", error);
      res.status(500).json({ message: "회원가입 실패", error: error.message });
    }
  });

  app.post("/api/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      const result = await db.query(
        `SELECT * FROM users WHERE username = $1`,
        [(username || "").trim()]
      );

      const user = result.rows[0];
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
      res.clearCookie("todo.sid");
      res.json({ ok: true });
    });
  });

  /* ---------------- TASKS ---------------- */

  app.get("/api/tasks", requireLogin, async (req, res) => {
    try {
      const tasksResult = await db.query(
        `
        SELECT
          id,
          title,
          category,
          priority,
          COALESCE(start_date::text, '') AS "startDate",
          COALESCE(due_date::text, '') AS "dueDate",
          COALESCE(repeat_type, '') AS repeat,
          done,
          memo,
          created_at::text AS "createdAt"
        FROM tasks
        WHERE user_id = $1
        ORDER BY id DESC
        `,
        [req.session.user.id]
      );

      const dateChecks = await buildDateChecks(req.session.user.id);

      res.json({
        tasks: tasksResult.rows,
        dateChecks
      });
    } catch (error) {
      console.error("get tasks error:", error);
      res.status(500).json({ message: "업무 목록 조회 실패", error: error.message });
    }
  });

  app.post("/api/tasks", requireLogin, async (req, res) => {
    try {
      const { title, category, priority, startDate, dueDate, repeat, memo } = req.body;

      if (!title || !title.trim()) {
        return res.status(400).json({ message: "업무명을 입력하세요." });
      }

      const inserted = await db.query(
        `
        INSERT INTO tasks (
          user_id, title, category, priority,
          start_date, due_date, repeat_type, memo, done
        ) VALUES ($1, $2, $3, $4, NULLIF($5, '')::date, NULLIF($6, '')::date, $7, $8, FALSE)
        RETURNING id
        `,
        [
          req.session.user.id,
          title.trim(),
          category || "",
          priority || "mid",
          startDate || "",
          dueDate || "",
          repeat || "",
          memo || ""
        ]
      );

      res.json({ ok: true, id: inserted.rows[0].id });
    } catch (error) {
      console.error("create task error:", error);
      res.status(500).json({ message: "업무 추가 실패", error: error.message });
    }
  });

  app.put("/api/tasks/:id", requireLogin, async (req, res) => {
    try {
      const { id } = req.params;
      const { title, category, priority, startDate, dueDate, repeat, memo, done } = req.body;

      await db.query(
        `
        UPDATE tasks
        SET
          title = $1,
          category = $2,
          priority = $3,
          start_date = NULLIF($4, '')::date,
          due_date = NULLIF($5, '')::date,
          repeat_type = $6,
          memo = $7,
          done = $8
        WHERE id = $9 AND user_id = $10
        `,
        [
          title || "",
          category || "",
          priority || "mid",
          startDate || "",
          dueDate || "",
          repeat || "",
          memo || "",
          !!done,
          Number(id),
          req.session.user.id
        ]
      );

      res.json({ ok: true });
    } catch (error) {
      console.error("update task error:", error);
      res.status(500).json({ message: "업무 수정 실패", error: error.message });
    }
  });

  app.delete("/api/tasks/:id", requireLogin, async (req, res) => {
    try {
      const { id } = req.params;

      await db.query(
        `DELETE FROM tasks WHERE id = $1 AND user_id = $2`,
        [Number(id), req.session.user.id]
      );

      res.json({ ok: true });
    } catch (error) {
      console.error("delete task error:", error);
      res.status(500).json({ message: "업무 삭제 실패", error: error.message });
    }
  });

  app.post("/api/tasks/:id/check", requireLogin, async (req, res) => {
    try {
      const { id } = req.params;
      const { date, checked } = req.body;

      const taskResult = await db.query(
        `
        SELECT *
        FROM tasks
        WHERE id = $1 AND user_id = $2
        `,
        [Number(id), req.session.user.id]
      );

      const task = taskResult.rows[0];
      if (!task) {
        return res.status(404).json({ message: "업무를 찾을 수 없습니다." });
      }

      const isRepeatOrRange =
        !!task.repeat_type ||
        (task.start_date && task.due_date && String(task.start_date) !== String(task.due_date));

      if (isRepeatOrRange) {
        await db.query(
          `
          INSERT INTO task_checks (task_id, check_date, checked)
          VALUES ($1, NULLIF($2, '')::date, $3)
          ON CONFLICT(task_id, check_date)
          DO UPDATE SET checked = EXCLUDED.checked
          `,
          [Number(id), date || todayStr(), !!checked]
        );
      } else {
        await db.query(
          `
          UPDATE tasks
          SET done = $1
          WHERE id = $2 AND user_id = $3
          `,
          [!!checked, Number(id), req.session.user.id]
        );
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("check task error:", error);
      res.status(500).json({ message: "체크 상태 변경 실패", error: error.message });
    }
  });

  /* ---------------- TODAY REPORT ---------------- */

  app.get("/api/today-report", requireLogin, async (req, res) => {
    try {
      const ds = req.query.date || todayStr();

      const tasksResult = await db.query(
        `
        SELECT
          id,
          title,
          category,
          priority,
          COALESCE(start_date::text, '') AS "startDate",
          COALESCE(due_date::text, '') AS "dueDate",
          COALESCE(repeat_type, '') AS repeat,
          done,
          memo,
          created_at::text AS "createdAt"
        FROM tasks
        WHERE user_id = $1
        ORDER BY id DESC
        `,
        [req.session.user.id]
      );

      const tasks = tasksResult.rows;
      const dateChecks = await buildDateChecks(req.session.user.id);

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

  /* ---------------- BACKUP / RESTORE ---------------- */

  app.get("/api/backup", requireLogin, async (req, res) => {
    try {
      const userId = req.session.user.id;

      const userResult = await db.query(
        `
        SELECT
          id,
          username,
          created_at::text AS "createdAt"
        FROM users
        WHERE id = $1
        `,
        [userId]
      );

      const tasksResult = await db.query(
        `
        SELECT
          id,
          title,
          category,
          priority,
          COALESCE(start_date::text, '') AS "startDate",
          COALESCE(due_date::text, '') AS "dueDate",
          COALESCE(repeat_type, '') AS repeat,
          done,
          memo,
          created_at::text AS "createdAt"
        FROM tasks
        WHERE user_id = $1
        ORDER BY id ASC
        `,
        [userId]
      );

      const checksResult = await db.query(
        `
        SELECT
          tc.task_id AS "taskId",
          tc.check_date::text AS "checkDate",
          tc.checked
        FROM task_checks tc
        JOIN tasks t ON tc.task_id = t.id
        WHERE t.user_id = $1
        ORDER BY tc.id ASC
        `,
        [userId]
      );

      const backupData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        user: userResult.rows[0],
        tasks: tasksResult.rows,
        checks: checksResult.rows
      };

      const fileName = `todo-backup-${backupData.user.username}-${todayStr()}.json`;

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(JSON.stringify(backupData, null, 2));
    } catch (error) {
      console.error("backup error:", error);
      res.status(500).json({ message: "백업 생성 실패", error: error.message });
    }
  });

  app.post("/api/restore", requireLogin, async (req, res) => {
    const client = await db.pool.connect();

    try {
      const userId = req.session.user.id;
      const { backup, mode } = req.body;

      if (!backup || typeof backup !== "object") {
        client.release();
        return res.status(400).json({ message: "복구 파일 형식이 올바르지 않습니다." });
      }

      const tasks = Array.isArray(backup.tasks) ? backup.tasks : [];
      const checks = Array.isArray(backup.checks) ? backup.checks : [];
      const restoreMode = mode === "replace" ? "replace" : "merge";

      await client.query("BEGIN");

      if (restoreMode === "replace") {
        await client.query(
          `
          DELETE FROM tasks
          WHERE user_id = $1
          `,
          [userId]
        );
      }

      const taskIdMap = new Map();

      for (const task of tasks) {
        const inserted = await client.query(
          `
          INSERT INTO tasks (
            user_id, title, category, priority,
            start_date, due_date, repeat_type, done, memo, created_at
          ) VALUES (
            $1, $2, $3, $4,
            NULLIF($5, '')::date,
            NULLIF($6, '')::date,
            $7, $8, $9, COALESCE(NULLIF($10, '')::timestamptz, NOW())
          )
          RETURNING id
          `,
          [
            userId,
            task.title || "",
            task.category || "",
            task.priority || "mid",
            task.startDate || "",
            task.dueDate || "",
            task.repeat || "",
            !!task.done,
            task.memo || "",
            task.createdAt || ""
          ]
        );

        taskIdMap.set(task.id, inserted.rows[0].id);
      }

      for (const check of checks) {
        const newTaskId = taskIdMap.get(check.taskId);
        if (!newTaskId) continue;

        await client.query(
          `
          INSERT INTO task_checks (task_id, check_date, checked)
          VALUES ($1, NULLIF($2, '')::date, $3)
          ON CONFLICT(task_id, check_date)
          DO UPDATE SET checked = EXCLUDED.checked
          `,
          [newTaskId, check.checkDate || todayStr(), !!check.checked]
        );
      }

      await client.query("COMMIT");
      client.release();

      res.json({
        ok: true,
        message: restoreMode === "replace" ? "전체 복구 완료" : "백업 추가 복구 완료"
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      console.error("restore error:", error);
      res.status(500).json({ message: "복구 실패", error: error.message });
    }
  });

  app.get("/", (req, res) => {
    res.redirect("/login.html");
  });

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("서버 시작 실패:", err);
  process.exit(1);
});