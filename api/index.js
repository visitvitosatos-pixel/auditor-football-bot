const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;

// В Vercel переменная называется FOOTBALL_DATA_API_KEY
// Здесь сохраняем её в API_KEY
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");

const bot = new Telegraf(BOT_TOKEN);

// ---------------- SIGNAL MODEL ----------------
// Временная модель (плейсхолдер)
function calculateSignal(home, away) {
  const base = (home.length + away.length) % 100;
  return 60 + (base % 40);
}

// ---------------- FETCH MATCHES ----------------
// Берём только ближайшие 24 часа
async function fetchMatches() {
  try {
    const res = await axios.get(
      "https://api.football-data.org/v4/matches?status=SCHEDULED",
      {
        headers: { "X-Auth-Token": API_KEY },
        timeout: 15000
      }
    );

    // Текущее время в миллисекундах (локальное)
    const nowTs = new Date().getTime(); 

    // Время через 24 часа в миллисекундах
    const next24hTs = nowTs + 24 * 60 * 60 * 1000; 

    const matches = (res.data.matches || [])
      .filter(m => {
        const kickoffTs = new Date(m.utcDate).getTime();  // Время начала матча (в миллисекундах)

        // Исключаем матчи, которые уже прошли или не в пределах ближайших 24 часов
        if (kickoffTs <= nowTs) return false;  // Если матч уже начался или начнётся раньше
        if (kickoffTs > next24hTs) return false; // Если матч позже чем через 24 часа

        return true;
      })
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)); // Сортировка по времени начала

    console.log("Всего матчей из API:", res.data.matches.length);
    console.log("После строгой фильтрации:", matches.length);

    return matches;

  } catch (err) {
    if (err.response) {
      const code = err.response.status;

      if (code === 403) throw new Error("API 403 — проверь ключ");
      if (code === 429) throw new Error("API 429 — лимит");

      throw new Error("API ошибка: " + code);
    }

    if (err.code === "ECONNABORTED") {
      throw new Error("API timeout");
    }

    throw new Error("Сетевая ошибка");
  }
}

// ---------------- BOT START ----------------
bot.start((ctx) => {
  return ctx.reply(
    "Бот активен.\nВыберите действие:",
    Markup.inlineKeyboard([
      [Markup.button.callback("🔍 Найти сигналы", "signals")]
    ])
  );
});

// ---------------- SIGNAL ACTION ----------------
bot.action("signals", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const matches = await fetchMatches();

    if (!matches.length) {
      return ctx.reply("В ближайшие 24 часа матчей не найдено.");
    }

    let text = "⚡ Комбинированный рейтинг (24ч)\n\n";
    let count = 0;

    for (const m of matches) {

      const home = m.homeTeam?.name;
      const away = m.awayTeam?.name;
      const kickoff = new Date(m.utcDate);

      if (!home || !away) continue;

      const score = calculateSignal(home, away);

      if (score >= 70) {

        const localTime = kickoff.toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        });

        text += `${home} — ${away}\n`;
        text += `Начало: ${localTime}\n`;
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
    console.error("Signals error:", err.message);
    return ctx.reply("Ошибка: " + err.message);
  }
});

// ---------------- WEBHOOK HANDLER ----------------
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