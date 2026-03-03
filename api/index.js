const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const crypto = require("crypto");

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY; // football-data.org
const CHANNEL = process.env.CHANNEL;                             // "@channel" или "-100..."
const CRON_SECRET = process.env.CRON_SECRET;                     // секрет для cron/setwebhook/diag
const ADMIN_IDS = String(process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
  .map((x) => Number(x))
  .filter(Number.isFinite);

// ороги (можешь менять в Vercel env)
const MIN_PERCENT_CHANNEL = Number(process.env.MIN_PERCENT_CHANNEL || 80);
const MIN_PERCENT_DM = Number(process.env.MIN_PERCENT_DM || 70);

// Тихий режим (по умолчанию true): никаких Markdown/HTML
const QUIET_MODE = String(process.env.QUIET_MODE || "1") !== "0";

// кно дедупа (in-memory)
const DEDUP_WINDOW_MS = Number(process.env.DEDUP_WINDOW_MS || 12 * 60 * 60 * 1000);

// пционально: железный дедуп через Upstash REST (если когда-то подключишь)
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// ===== META =====
const COMMIT_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_GITHUB_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  "unknown";
const DEPLOYMENT_ID = process.env.VERCEL_DEPLOYMENT_ID || "unknown";

// ===== GUARDS =====
if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing in env");
const bot = new Telegraf(BOT_TOKEN);

function isAdminById(id) {
  if (!Number.isFinite(id)) return false;
  if (ADMIN_IDS.length === 0) return true; // если не задано — без ограничений
  return ADMIN_IDS.includes(id);
}
function isAdminCtx(ctx) {
  return isAdminById(Number(ctx?.from?.id));
}

// ===== DIAG BUFFER (last 10 errors) =====
const lastErrors = [];
function pushErr(where, e) {
  const status = e?.response?.status;
  const data = e?.response?.data;
  const msg = e?.message || String(e);

  lastErrors.push({
    t: new Date().toISOString(),
    where,
    status,
    msg,
    data: data ? JSON.stringify(data).slice(0, 800) : null,
  });
  while (lastErrors.length > 10) lastErrors.shift();

  console.error(where, { status, msg, data });
}

// ===== TELEGRAM SEND (quiet mode) =====
async function tgSend(chatId, text) {
  // ез parse_mode => Telegram не жрёт подчёркивания и "не пропускает буквы"
  await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    },
    { timeout: 15000 }
  );
}

async function notifyAdmins(text) {
  if (!Array.isArray(ADMIN_IDS) || ADMIN_IDS.length === 0) return;
  for (const id of ADMIN_IDS) {
    try { await tgSend(id, text); } catch (_) {}
  }
}

// ===== FOOTBALL-DATA FILTERS =====
// Топ-лиги по competition.code (у football-data обычно: PL, PD, SA, BL1, FL1, CL, EL)
const TOP_CODES = new Set(["PL", "PD", "SA", "BL1", "FL1", "CL", "EL"]);

function inNextHours(utcDate, hours) {
  const t = Date.parse(utcDate);
  if (!Number.isFinite(t)) return true;
  const now = Date.now();
  return t >= now && t <= now + hours * 60 * 60 * 1000;
}

async function fetchMatchesFootballData() {
  if (!FOOTBALL_DATA_API_KEY) throw new Error("FOOTBALL_DATA_API_KEY is missing");
  const res = await axios.get("https://api.football-data.org/v4/matches", {
    headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY },
    timeout: 15000,
  });
  return Array.isArray(res.data?.matches) ? res.data.matches : [];
}

// ===== MODEL (stub) + thresholds =====
function evaluateMatch(m) {
  const home = m.homeTeam?.name ?? "Home";
  const away = m.awayTeam?.name ?? "Away";

  // аглушка модели
  const matchPower = (String(home).length + String(away).length) % 10;

  let prediction, percent;
  if (matchPower > 7) { prediction = "Over 0.5 (1H) + Over 2.5"; percent = 84; }
  else if (matchPower < 3) { prediction = "Draw (X)"; percent = 62; }
  else { prediction = "Over 2.0"; percent = 75; }

  return { home, away, prediction, percent, score: percent };
}

function buildReport(matches, limit, minPercent) {
  if (!matches?.length) return null;

  const filtered = matches
    .filter((m) => {
      const code = m.competition?.code;
      return !code || TOP_CODES.has(code);
    })
    .filter((m) => inNextHours(m.utcDate, 24)); // ближайшие 24 часа

  const scored = filtered
    .map(evaluateMatch)
    .filter((x) => x.percent >= minPercent)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) return null;

  let out = "AUTO AUDIT\n\n";
  for (const s of scored) {
    out += `${s.home} vs ${s.away}\n`;
    out += `Pick: ${s.prediction}\n`;
    out += `Chance: ${s.percent}%\n\n`;
  }
  out += "Note: probabilistic model, not a guarantee.";
  return out;
}

// ===== DEDUP =====
let lastHash = null;
let lastAt = 0;

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

// пциональный “железный” дедуп через Upstash REST: SET key with TTL if not exists
async function dedupCheckAndSet(hash) {
  const now = Date.now();

  // 1) In-memory check
  if (lastHash === hash && (now - lastAt) < DEDUP_WINDOW_MS) return false;

  // 2) If Upstash configured — use it (stronger across cold starts)
  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    try {
      // SET key value NX EX seconds
      const ttlSec = Math.max(60, Math.floor(DEDUP_WINDOW_MS / 1000));
      const url = `${UPSTASH_REDIS_REST_URL}/set/auditor:${hash}/1?nx=true&ex=${ttlSec}`;
      const r = await axios.post(url, null, {
        headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
        timeout: 15000,
      });
      // Upstash returns { result: "OK" } when set, { result: null } when exists
      if (r.data?.result !== "OK") return false;
    } catch (e) {
      // если Upstash временно умер — не роняем, но дедуп будет слабее
      pushErr("upstash dedup error", e);
    }
  }

  lastHash = hash;
  lastAt = now;
  return true;
}

// ===== BOT UI =====
bot.start((ctx) => {
  return ctx.reply(
    "Auditor: READY",
    Markup.inlineKeyboard([[Markup.button.callback("Find signals", "find_signals")]])
  );
});

bot.action("find_signals", async (ctx) => {
  if (!isAdminCtx(ctx)) return ctx.reply("Access denied (admin only).");

  try {
    await ctx.answerCbQuery("Searching...");

    if (!FOOTBALL_DATA_API_KEY) {
      return ctx.reply(
        "FOOTBALL_DATA_API_KEY is not set.\n" +
        "How to fix:\n" +
        "1) Register on football-data.org\n" +
        "2) Get API Token\n" +
        "3) Vercel → Settings → Environment Variables → Production\n" +
        "4) Add variable FOOTBALL_DATA_API_KEY and Redeploy\n"
      );
    }

    const matches = await fetchMatchesFootballData();
    const report = buildReport(matches, 5, MIN_PERCENT_DM);
    if (!report) return ctx.reply("No matches (filtered/threshold).");

    return ctx.reply(report);
  } catch (e) {
    pushErr("find_signals", e);
    await notifyAdmins(`find_signals error: ${e?.message || e}`);
    return ctx.reply("Error. Check env/API limits.");
  }
});

// ===== HTTP HANDLER (Vercel) =====
module.exports = async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  // /health
  if (method === "GET" && url.startsWith("/health")) {
    const missing = [];
    if (!process.env.BOT_TOKEN) missing.push("BOT_TOKEN");
    if (!process.env.FOOTBALL_DATA_API_KEY) missing.push("FOOTBALL_DATA_API_KEY");
    if (!process.env.CHANNEL) missing.push("CHANNEL");
    if (!process.env.CRON_SECRET) missing.push("CRON_SECRET");
    if (!process.env.ADMIN_IDS) missing.push("ADMIN_IDS");
    return res.status(200).json({ ok: missing.length === 0, missing });
  }

  // /version
  if (method === "GET" && url.startsWith("/version")) {
    return res.status(200).json({
      ok: true,
      commit: COMMIT_SHA,
      deploymentId: DEPLOYMENT_ID,
      time: new Date().toISOString(),
      quietMode: QUIET_MODE,
      thresholds: { MIN_PERCENT_CHANNEL, MIN_PERCENT_DM }
    });
  }

  // /diag?secret=...
  if (method === "GET" && url.startsWith("/diag")) {
    try {
      const u = new URL("http://localhost" + url);
      const secret = u.searchParams.get("secret");
      if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
      if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");
      return res.status(200).json({ ok: true, lastErrors });
    } catch (e) {
      pushErr("diag", e);
      return res.status(500).send("diag error");
    }
  }

  // /setwebhook?secret=...
  if (method === "GET" && url.startsWith("/setwebhook")) {
    try {
      const u = new URL("http://localhost" + url);
      const secret = u.searchParams.get("secret");
      if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
      if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");

      const host = req.headers["x-forwarded-host"] || req.headers["host"];
      const proto = req.headers["x-forwarded-proto"] || "https";
      const webhookUrl = `${proto}://${host}/`;

      const tg = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
        params: { url: webhookUrl },
        timeout: 15000,
      });

      await notifyAdmins(`Webhook set to: ${webhookUrl}`);
      return res.status(200).json({ ok: true, webhookUrl, tg: tg.data });
    } catch (e) {
      pushErr("setwebhook", e);
      await notifyAdmins(`setwebhook error: ${e?.message || e}`);
      return res.status(500).send("setWebhook error");
    }
  }

  // /cron?secret=... (в браузере)
  if (method === "GET" && url.startsWith("/cron")) {
    try {
      const u = new URL("http://localhost" + url);
      const secret = u.searchParams.get("secret");
      if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
      if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");

      if (!FOOTBALL_DATA_API_KEY) {
        const msg = "Cron skipped: FOOTBALL_DATA_API_KEY missing.";
        await notifyAdmins(msg);
        return res.status(200).send(msg);
      }
      if (!CHANNEL) {
        const msg = "Cron skipped: CHANNEL missing.";
        await notifyAdmins(msg);
        return res.status(200).send(msg);
      }

      const matches = await fetchMatchesFootballData();
      const report = buildReport(matches, 2, MIN_PERCENT_CHANNEL); // 1–2 сигнала
      if (!report) return res.status(200).send("No matches (filtered/threshold)");

      const hash = sha1(report);
      const okToPost = await dedupCheckAndSet(hash);
      if (!okToPost) return res.status(200).send("Skipped (dedup)");

      await tgSend(CHANNEL, report);
      return res.status(200).send("Posted");
    } catch (e) {
      pushErr("cron", e);
      await notifyAdmins(`cron error: ${e?.message || e}`);
      return res.status(500).send("Cron error");
    }
  }

  // Telegram webhook updates
  if (method === "POST") {
    try {
      await bot.handleUpdate(req.body, res);
    } catch (e) {
      pushErr("handleUpdate", e);
      await notifyAdmins(`handleUpdate error: ${e?.message || e}`);
    }
    return res.status(200).send("OK");
  }

  return res.status(200).send("API is working");
};
