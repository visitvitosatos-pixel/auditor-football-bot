const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

// уда постить: либо "@channel_username", либо "-1001234567890"
const CHANNEL = process.env.CHANNEL;

// ащита cron-эндпоинта (любой длинный рандомный токен)
const CRON_SECRET = process.env.CRON_SECRET;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing in env");
}

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  return ctx.reply(
    "🤖 Premium Auditor: ТТ\nнализирую ближайшие топ-матчи...",
    Markup.inlineKeyboard([[Markup.button.callback("🚀 айти сигналы", "find_signals")]])
  );
});

async function fetchMatches() {
  if (!API_KEY) {
    throw new Error("FOOTBALL_DATA_API_KEY is missing in env");
  }

  const res = await axios.get("https://api.football-data.org/v4/matches", {
    headers: { "X-Auth-Token": API_KEY },
    timeout: 15000,
  });

  const matches = res.data && res.data.matches ? res.data.matches : [];
  return matches;
}

function buildReport(matches) {
  if (!matches || matches.length === 0) return null;

  let report = "📈 *ТТС Т*\n\n";

  matches.slice(0, 5).forEach((m) => {
    const home = m.homeTeam?.name ?? "Home";
    const away = m.awayTeam?.name ?? "Away";

    // аглушка модели (как у тебя): не выдаём “гарантии”
    const matchPower = (String(home).length + String(away).length) % 10;

    let prediction = "";
    let percent = 0;

    if (matchPower > 7) {
      prediction = "⚽️ Т 0.5 (1-й тайм) + Т 2.5";
      percent = 84;
    } else if (matchPower < 3) {
      prediction = "🤝 ичья (X) в матче";
      percent = 62;
    } else {
      prediction = "🔥 Тотал ольше 2.0";
      percent = 75;
    }

    report += `🏟 *${home} — ${away}*\n`;
    report += `🎯 рогноз: ${prediction}\n`;
    report += `📊 Шанс: ${percent}%\n\n`;
  });

  report += "⚠️ то вероятностная модель, не гарантия.\n";
  return report;
}

async function postToChannel(text) {
  if (!CHANNEL) {
    throw new Error("CHANNEL is missing in env (e.g. @my_channel or -100...)");
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await axios.post(
    url,
    {
      chat_id: CHANNEL,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    },
    { timeout: 15000 }
  );
}

bot.action("find_signals", async (ctx) => {
  try {
    await ctx.answerCbQuery("щу матчи в базе...");

    const matches = await fetchMatches();
    if (!matches || matches.length === 0) {
      return ctx.reply("📭 а сегодня матчей в базе не найдено. опробуй позже.");
    }

    const report = buildReport(matches);
    if (!report) return ctx.reply("📭 е смог собрать отчет.");

    return ctx.reply(report, { parse_mode: "Markdown" });
  } catch (e) {
    console.error(e?.response?.data || e);
    return ctx.reply("❌ шибка: проверь BOT_TOKEN / FOOTBALL_DATA_API_KEY / доступы.");
  }
});

// Vercel: единый handler на все пути (из-за rewrites)
// /cron?secret=... -> постит в канал
// POST от Telegram -> bot.handleUpdate
module.exports = async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  // 1) Cron endpoint
  if (method === "GET" && url.startsWith("/cron")) {
    try {
      const u = new URL("http://localhost" + url);
      const secret = u.searchParams.get("secret");

      if (!CRON_SECRET) {
        return res.status(500).send("CRON_SECRET is not set");
      }
      if (secret !== CRON_SECRET) {
        return res.status(401).send("Unauthorized");
      }

      const matches = await fetchMatches();
      const report = buildReport(matches);

      if (!report) {
        return res.status(200).send("No matches / no report");
      }

      await postToChannel(report);
      return res.status(200).send("Posted");
    } catch (e) {
      console.error(e?.response?.data || e);
      return res.status(500).send("Cron error");
    }
  }

  // 2) Telegram webhook updates
  if (method === "POST") {
    try {
      await bot.handleUpdate(req.body, res);
    } catch (err) {
      console.error(err);
    }
    return res.status(200).send("OK");
  }

  // 3) Health
  return res.status(200).send("API is working");
};
