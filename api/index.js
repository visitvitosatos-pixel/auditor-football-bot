const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");

const bot = new Telegraf(BOT_TOKEN);

function calculateSignal(home, away) {
  const base = (home.length + away.length) % 100;
  return 60 + (base % 40);
}

async function fetchMatches() {
  try {
    const res = await axios.get(
      "https://api.football-data.org/v4/matches",
      {
        headers: { "X-Auth-Token": API_KEY },
        timeout: 15000
      }
    );
    return res.data.matches || [];
  } catch (err) {
    if (err.response) {
      const code = err.response.status;
      if (code === 403) throw new Error("API 403 — проверь ключ или тариф");
      if (code === 429) throw new Error("API 429 — лимит запросов");
      throw new Error("API ошибка: " + code);
    }
    if (err.code === "ECONNABORTED") {
      throw new Error("API timeout");
    }
    throw new Error("Сетевая ошибка");
  }
}

bot.start((ctx) => {
  return ctx.reply(
    "Бот активен.",
    Markup.inlineKeyboard([
      [Markup.button.callback("🔍 Найти сигналы", "signals")]
    ])
  );
});

bot.action("signals", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const matches = await fetchMatches();

    if (!matches.length) {
      return ctx.reply("Матчи не найдены.");
    }

    let text = "⚡ Комбинированный рейтинг\n\n";
    let count = 0;

    for (const m of matches) {
      const home = m.homeTeam?.name;
      const away = m.awayTeam?.name;

      if (!home || !away) continue;

      const score = calculateSignal(home, away);

      if (score >= 70) {
        text += `${home} — ${away}\n`;
        text += `Signal Score: ${score}/100\n\n`;
        count++;
      }

      if (count >= 3) break;
    }

    if (count === 0) {
      return ctx.reply("Нет матчей выше порога 70.");
    }

    return ctx.reply(text);

  } catch (err) {
    console.error(err.message);
    return ctx.reply("Ошибка: " + err.message);
  }
});

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    const update = JSON.parse(body || "{}");
    await bot.handleUpdate(update);
  } catch (err) {
    console.error("Webhook error:", err);
  }

  return res.status(200).end();
};
