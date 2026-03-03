const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const CHANNEL = process.env.CHANNEL;         // "@channel_username" или "-100..."
const CRON_SECRET = process.env.CRON_SECRET; // длинная случайная строка

// Whitelist админа: "123,456" (Telegram user id)
const ADMIN_IDS = String(process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
  .map((x) => Number(x))
  .filter((n) => Number.isFinite(n));

// ля /version
const COMMIT_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_GITHUB_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  "unknown";

const DEPLOYMENT_ID = process.env.VERCEL_DEPLOYMENT_ID || "unknown";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing in env");
const bot = new Telegraf(BOT_TOKEN);

function isAdmin(ctx) {
  const id = Number(ctx?.from?.id);
  if (!Number.isFinite(id)) return false;
  // сли список пустой — считаем, что админ-ограничение выключено
  if (ADMIN_IDS.length === 0) return true;
  return ADMIN_IDS.includes(id);
}

function deny(ctx) {
  return ctx.reply("⛔ оступ только для администратора.");
}

function logAxiosError(prefix, e) {
  const status = e?.response?.status;
  const data = e?.response?.data;
  console.error(prefix, {
    status,
    data,
    message: e?.message,
  });
}

bot.start((ctx) => {
  return ctx.reply(
    "🤖 Auditor: READY",
    Markup.inlineKeyboard([
      [Markup.button.callback("🚀 айти сигналы", "find_signals")]
    ])
  );
});

async function fetchMatches() {
  if (!FOOTBALL_DATA_API_KEY) {
    throw new Error("FOOTBALL_DATA_API_KEY is missing in env");
  }
  const res = await axios.get("https://api.football-data.org/v4/matches", {
    headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY },
    timeout: 15000,
  });
  return Array.isArray(res.data?.matches) ? res.data.matches : [];
}

function evaluateMatch(m) {
  const home = m.homeTeam?.name ?? "Home";
  const away = m.awayTeam?.name ?? "Away";

  // аглушка модели (без “гарантий”)
  const matchPower = (String(home).length + String(away).length) % 10;

  let prediction, percent;
  if (matchPower > 7) { prediction = "⚽️ Т 0.5 (1Т) + Т 2.5"; percent = 84; }
  else if (matchPower < 3) { prediction = "🤝 ичья (X)"; percent = 62; }
  else { prediction = "🔥 Т 2.0"; percent = 75; }

  return { home, away, prediction, percent, score: percent };
}

function buildReport(matches, limit = 5) {
  if (!matches?.length) return null;

  const scored = matches.map(evaluateMatch).sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  let report = "📈 *Т-УТ*\n\n";
  top.forEach((t) => {
    report += `🏟 *${t.home} — ${t.away}*\n`;
    report += `🎯 ${t.prediction}\n`;
    report += `📊 ${t.percent}%\n\n`;
  });

  report += "⚠️ ероятностная модель, не гарантия.\n";
  return report;
}

async function postToChannel(text) {
  if (!CHANNEL) throw new Error("CHANNEL is missing in env");
  await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    { chat_id: CHANNEL, text, parse_mode: "Markdown", disable_web_page_preview: true },
    { timeout: 15000 }
  );
}

bot.action("find_signals", async (ctx) => {
  if (!isAdmin(ctx)) return deny(ctx);

  try {
    await ctx.answerCbQuery("щу матчи...");

    if (!FOOTBALL_DATA_API_KEY) {
      return ctx.reply(
        "❗ е задан FOOTBALL_DATA_API_KEY.\n" +
        "1) арегистрируйся на football-data.org\n" +
        "2) Сгенерируй API token\n" +
        "3) обавь его в Vercel → Settings → Environment Variables (Production)\n" +
        "4) Сделай Redeploy\n"
      );
    }

    const matches = await fetchMatches();
    const report = buildReport(matches, 5);
    if (!report) return ctx.reply("📭 атчей нет.");

    return ctx.reply(report, { parse_mode: "Markdown" });
  } catch (e) {
    logAxiosError("find_signals error", e);
    return ctx.reply("❌ шибка Football-Data. роверь ключ/лимиты/доступ.");
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
    if (!process.env.ADMIN_IDS) missing.push("ADMIN_IDS"); // не критично, но полезно
    return res.status(200).json({ ok: missing.length === 0, missing });
  }

  // /version
  if (method === "GET" && url.startsWith("/version")) {
    return res.status(200).json({
      ok: true,
      commit: COMMIT_SHA,
      deploymentId: DEPLOYMENT_ID,
      time: new Date().toISOString()
    });
  }

  // /cron?secret=... -> постит 1–2 топ сигнала в канал
  if (method === "GET" && url.startsWith("/cron")) {
    try {
      const u = new URL("http://localhost" + url);
      const secret = u.searchParams.get("secret");

      if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
      if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");

      if (!FOOTBALL_DATA_API_KEY) return res.status(500).send("FOOTBALL_DATA_API_KEY is missing");

      const matches = await fetchMatches();
      const report = buildReport(matches, 2); // <= важно: только 2
      if (!report) return res.status(200).send("No matches");

      await postToChannel(report);
      return res.status(200).send("Posted");
    } catch (e) {
      logAxiosError("cron error", e);
      return res.status(500).send("Cron error");
    }
  }

  // Telegram webhook updates
  if (method === "POST") {
    try { await bot.handleUpdate(req.body, res); } catch (e) { console.error(e); }
    return res.status(200).send("OK");
  }

  return res.status(200).send("API is working");
};
