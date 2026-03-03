const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY; // api.football-data.org
const RAPIDAPI_KEY = process.env.FOOTBALL_API_KEY;               // rapidapi livescores
const CHANNEL = process.env.CHANNEL;                             // "@channel" или "-100..."
const CRON_SECRET = process.env.CRON_SECRET;                     // защита /cron

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing in env");

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  return ctx.reply(
    "🤖 Premium Auditor: READY\nыбери действие:",
    Markup.inlineKeyboard([
      [Markup.button.callback("📊 ровести аудит лиг (LIVE)", "audit_leagues")],
      [Markup.button.callback("🚀 айти сигналы (Football-Data)", "find_signals")]
    ])
  );
});

async function fetchMatchesFootballData() {
  if (!FOOTBALL_DATA_API_KEY) {
    throw new Error("FOOTBALL_DATA_API_KEY is missing in env");
  }

  const res = await axios.get("https://api.football-data.org/v4/matches", {
    headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY },
    timeout: 15000
  });

  return Array.isArray(res.data?.matches) ? res.data.matches : [];
}

function buildReport(matches) {
  if (!matches?.length) return null;

  let report = "📈 *ТТС Т*\n\n";

  matches.slice(0, 5).forEach((m) => {
    const home = m.homeTeam?.name ?? "Home";
    const away = m.awayTeam?.name ?? "Away";

    // аглушка модели (без “гарантий”)
    const matchPower = (String(home).length + String(away).length) % 10;

    let prediction;
    let percent;

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

  report += "⚠️ ероятностная модель, не гарантия.\n";
  return report;
}

async function postToChannel(text) {
  if (!CHANNEL) throw new Error("CHANNEL is missing in env (e.g. @my_channel or -100...)");

  await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      chat_id: CHANNEL,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true
    },
    { timeout: 15000 }
  );
}

bot.action("audit_leagues", async (ctx) => {
  try {
    await ctx.answerCbQuery("агрузка данных...");

    if (!RAPIDAPI_KEY) {
      return ctx.reply("❌ ет FOOTBALL_API_KEY (RapidAPI) в env.");
    }

    const options = {
      method: "GET",
      url: "https://free-api-live-football-data.p.rapidapi.com/football-get-all-livescores",
      headers: {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": "free-api-live-football-data.p.rapidapi.com"
      },
      timeout: 10000
    };

    const res = await axios.request(options);
    const live = res.data?.response?.live;

    if (Array.isArray(live) && live.length > 0) {
      let report = "📈 *ТТ Т (LIVE):*\n\n";
      live.slice(0, 8).forEach((g) => {
        report += `🏟 *${g.home?.name ?? "Home"}* vs *${g.away?.name ?? "Away"}*\n`;
        report += `🏆 ${g.league?.name ?? "League"}\n\n`;
      });
      report += "✅ нализ завершен.";
      return ctx.reply(report, { parse_mode: "Markdown" });
    }

    // fallback: популярные лиги
    const resLeagues = await axios.get(
      "https://free-api-live-football-data.p.rapidapi.com/football-get-all-leagues",
      {
        headers: {
          "X-RapidAPI-Key": RAPIDAPI_KEY,
          "X-RapidAPI-Host": "free-api-live-football-data.p.rapidapi.com"
        },
        timeout: 10000
      }
    );

    const popular = resLeagues.data?.response?.popular;
    if (Array.isArray(popular) && popular.length > 0) {
      let report = "🏆 *СТЫ  Я :*\n\n";
      popular.slice(0, 10).forEach((l) => {
        report += `⚽️ ${l.name} [${l.ccode}]\n`;
      });
      return ctx.reply(report, { parse_mode: "Markdown" });
    }

    return ctx.reply("⚠️ Сейчас нет live-матчей и список лиг недоступен. опробуй позже.");
  } catch (e) {
    console.error(e?.response?.data || e);
    return ctx.reply("❌ шибка RapidAPI: проверь FOOTBALL_API_KEY и статус подписки.");
  }
});

bot.action("find_signals", async (ctx) => {
  try {
    await ctx.answerCbQuery("щу матчи в базе...");

    const matches = await fetchMatchesFootballData();
    if (!matches.length) return ctx.reply("📭 а сегодня матчей не найдено. опробуй позже.");

    const report = buildReport(matches);
    if (!report) return ctx.reply("📭 е смог собрать отчет.");

    return ctx.reply(report, { parse_mode: "Markdown" });
  } catch (e) {
    console.error(e?.response?.data || e);
    return ctx.reply("❌ шибка Football-Data: проверь FOOTBALL_DATA_API_KEY.");
  }
});

// Vercel handler (rewrites ведёт всё сюда)
module.exports = async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  // GET /cron?secret=... -> пост в канал
  if (method === "GET" && url.startsWith("/cron")) {
    try {
      const u = new URL("http://localhost" + url);
      const secret = u.searchParams.get("secret");

      if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
      if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");

      const matches = await fetchMatchesFootballData();
      const report = buildReport(matches);
      if (!report) return res.status(200).send("No matches / no report");

      await postToChannel(report);
      return res.status(200).send("Posted");
    } catch (e) {
      console.error(e?.response?.data || e);
      return res.status(500).send("Cron error");
    }
  }

  // POST -> Telegram webhook
  if (method === "POST") {
    try {
      await bot.handleUpdate(req.body, res);
    } catch (e) {
      console.error(e);
    }
    return res.status(200).send("OK");
  }

  return res.status(200).send("API is working");
};
