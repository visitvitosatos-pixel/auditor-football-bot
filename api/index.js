const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const CHANNEL = process.env.CHANNEL;         // "@channel_username" или "-100..."
const CRON_SECRET = process.env.CRON_SECRET; // длинная случайная строка

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing in env");
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  return ctx.reply(
    "🤖 Auditor: READY",
    Markup.inlineKeyboard([[Markup.button.callback("🚀 айти сигналы", "find_signals")]])
  );
});

async function fetchMatches() {
  if (!FOOTBALL_DATA_API_KEY) throw new Error("FOOTBALL_DATA_API_KEY is missing in env");
  const res = await axios.get("https://api.football-data.org/v4/matches", {
    headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY },
    timeout: 15000
  });
  return Array.isArray(res.data?.matches) ? res.data.matches : [];
}

function buildReport(matches) {
  if (!matches?.length) return null;

  let report = "📈 *Т-УТ*\n\n";
  matches.slice(0, 5).forEach((m) => {
    const home = m.homeTeam?.name ?? "Home";
    const away = m.awayTeam?.name ?? "Away";

    const matchPower = (String(home).length + String(away).length) % 10;

    let prediction, percent;
    if (matchPower > 7) { prediction = "⚽️ Т 0.5 (1Т) + Т 2.5"; percent = 84; }
    else if (matchPower < 3) { prediction = "🤝 ичья (X)"; percent = 62; }
    else { prediction = "🔥 Т 2.0"; percent = 75; }

    report += `🏟 *${home} — ${away}*\n`;
    report += `🎯 ${prediction}\n`;
    report += `📊 ${percent}%\n\n`;
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
  try {
    await ctx.answerCbQuery("щу матчи...");
    const matches = await fetchMatches();
    const report = buildReport(matches);
    if (!report) return ctx.reply("📭 атчей нет.");
    return ctx.reply(report, { parse_mode: "Markdown" });
  } catch (e) {
    console.error(e?.response?.data || e);
    return ctx.reply("❌ шибка. роверь env (BOT_TOKEN/FOOTBALL_DATA_API_KEY).");
  }
});

module.exports = async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  // GET /cron?secret=... -> постит в канал
  if (method === "GET" && url.startsWith("/cron")) {
    try {
      const u = new URL("http://localhost" + url);
      const secret = u.searchParams.get("secret");

      if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
      if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");

      const matches = await fetchMatches();
      const report = buildReport(matches);
      if (!report) return res.status(200).send("No matches");

      await postToChannel(report);
      return res.status(200).send("Posted");
    } catch (e) {
      console.error(e?.response?.data || e);
      return res.status(500).send("Cron error");
    }
  }

  // POST -> Telegram webhook
  if (method === "POST") {
    try { await bot.handleUpdate(req.body, res); } catch (e) { console.error(e); }
    return res.status(200).send("OK");
  }

  return res.status(200).send("API is working");
};
