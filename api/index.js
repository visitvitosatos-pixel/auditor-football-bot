const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const crypto = require("crypto");

const cfg = require("../lib/config");
const { buildReport } = require("../lib/report");
const { notifyAdmins, sendMessage } = require("../lib/notify");

const BOT_TOKEN = process.env.BOT_TOKEN;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY; // <- именно так
const CHANNEL = process.env.CHANNEL;
const CRON_SECRET = process.env.CRON_SECRET;

const ADMIN_IDS = String(process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
  .map((x) => Number(x))
  .filter((n) => Number.isFinite(n));

const COMMIT_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_GITHUB_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  "unknown";

const DEPLOYMENT_ID = process.env.VERCEL_DEPLOYMENT_ID || "unknown";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing in env");

const bot = new Telegraf(BOT_TOKEN);

// дедуп (ограничение: in-memory, может сбрасываться при холодном старте)
let lastPostHash = null;
let lastPostAt = 0;

function isAdmin(ctx) {
  const id = Number(ctx?.from?.id);
  if (!Number.isFinite(id)) return false;
  if (ADMIN_IDS.length === 0) return true; // если пусто — без ограничений
  return ADMIN_IDS.includes(id);
}

function logAxiosError(prefix, e) {
  console.error(prefix, {
    status: e?.response?.status,
    data: e?.response?.data,
    message: e?.message,
  });
}

async function fetchMatches() {
  if (!FOOTBALL_DATA_API_KEY) throw new Error("FOOTBALL_DATA_API_KEY is missing in env");

  const res = await axios.get("https://api.football-data.org/v4/matches", {
    headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY },
    timeout: 15000,
  });

  return Array.isArray(res.data?.matches) ? res.data.matches : [];
}

bot.start((ctx) => {
  return ctx.reply(
    "🤖 Auditor: READY",
    Markup.inlineKeyboard([
      [Markup.button.callback("🚀 айти сигналы", "find_signals")]
    ])
  );
});

bot.action("find_signals", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("⛔ оступ только для администратора.");

  try {
    await ctx.answerCbQuery("щу матчи...");

    if (!FOOTBALL_DATA_API_KEY) {
      return ctx.reply(
        "❗е задан FOOTBALL_DATA_API_KEY.\n" +
        "де взять ключ:\n" +
        "1) football-data.org → регистрация\n" +
        "2) олучи API Token\n" +
        "3) Vercel → Settings → Environment Variables → Production\n" +
        "4) обавь переменную FOOTBALL_DATA_API_KEY и сделай Redeploy"
      );
    }

    const matches = await fetchMatches();
    const report = buildReport(matches, cfg.dmTopN);
    if (!report) return ctx.reply("📭 ет подходящих матчей (или отфильтровано).");

    return ctx.reply(report, { parse_mode: "Markdown" });
  } catch (e) {
    logAxiosError("find_signals error", e);
    await notifyAdmins(BOT_TOKEN, ADMIN_IDS, `❌ find_signals error: ${e?.message || e}`);
    return ctx.reply("❌ шибка Football-Data (см. логи).");
  }
});

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
    });
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

      await notifyAdmins(BOT_TOKEN, ADMIN_IDS, `✅ Webhook set: ${webhookUrl}`);
      return res.status(200).json({ ok: true, webhookUrl, tg: tg.data });
    } catch (e) {
      logAxiosError("setwebhook error", e);
      await notifyAdmins(BOT_TOKEN, ADMIN_IDS, `❌ setwebhook error: ${e?.message || e}`);
      return res.status(500).send("setWebhook error");
    }
  }

  // /cron?secret=... -> постит 1–2 матча в канал + дедуп
  if (method === "GET" && url.startsWith("/cron")) {
    try {
      const u = new URL("http://localhost" + url);
      const secret = u.searchParams.get("secret");
      if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
      if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");

      if (!FOOTBALL_DATA_API_KEY) {
        const msg = "⚠️ Cron skipped: FOOTBALL_DATA_API_KEY missing.";
        await notifyAdmins(BOT_TOKEN, ADMIN_IDS, msg);
        return res.status(200).send(msg);
      }
      if (!CHANNEL) {
        const msg = "⚠️ Cron skipped: CHANNEL missing.";
        await notifyAdmins(BOT_TOKEN, ADMIN_IDS, msg);
        return res.status(200).send(msg);
      }

      const matches = await fetchMatches();
      const report = buildReport(matches, cfg.channelTopN);
      if (!report) return res.status(200).send("No matches");

      const hash = crypto.createHash("sha1").update(report).digest("hex");
      const now = Date.now();
      if (lastPostHash === hash && (now - lastPostAt) < cfg.dedupWindowMs) {
        return res.status(200).send("Skipped (dedup)");
      }

      await sendMessage(BOT_TOKEN, CHANNEL, report);
      lastPostHash = hash;
      lastPostAt = now;

      return res.status(200).send("Posted");
    } catch (e) {
      logAxiosError("cron error", e);
      await notifyAdmins(BOT_TOKEN, ADMIN_IDS, `❌ cron error: ${e?.message || e}`);
      return res.status(500).send("Cron error");
    }
  }

  // Telegram webhook updates
  if (method === "POST") {
    try {
      await bot.handleUpdate(req.body, res);
    } catch (e) {
      console.error("handleUpdate error", e);
      await notifyAdmins(BOT_TOKEN, ADMIN_IDS, `❌ handleUpdate error: ${e?.message || e}`);
    }
    return res.status(200).send("OK");
  }

  return res.status(200).send("API is working");
};
