const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
// В Vercel переменная называется FOOTBALL_DATA_API_KEY
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");

// Важно для serverless: не полагаться на webhookReply
// (иногда на serverless ответ может отваливаться, лучше всегда через API)
const bot = new Telegraf(BOT_TOKEN, { telegram: { webhookReply: false } });

// ---------------- SIGNAL MODEL ----------------
function calculateSignal(home, away) {
  const base = (home.length + away.length) % 100;
  return 60 + (base % 40);
}

// ---------------- FETCH MATCHES ----------------
async function fetchMatches() {
  if (!API_KEY) throw new Error("FOOTBALL_DATA_API_KEY missing");

  const res = await axios.get(
    "https://api.football-data.org/v4/matches?status=SCHEDULED",
    {
      headers: { "X-Auth-Token": API_KEY },
      timeout: 15000
    }
  );

  const nowTs = Date.now();
  const next24hTs = nowTs + 24 * 60 * 60 * 1000;

  const matches = (res.data.matches || [])
    .filter((m) => {
      const kickoffTs = new Date(m.utcDate).getTime();
      if (kickoffTs <= nowTs) return false;
      if (kickoffTs > next24hTs) return false;
      return true;
    })
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  console.log("Matches total:", (res.data.matches || []).length);
  console.log("Matches filtered 24h:", matches.length);

  return matches;
}

// ---------------- BOT COMMANDS ----------------
bot.start((ctx) => {
  return ctx.reply(
    "Бот активен.\nВыберите действие:",
    Markup.inlineKeyboard([[Markup.button.callback("🔍 Найти сигналы", "signals")]])
  );
});

// На случай, если в группе неудобно жать кнопку
bot.command("signals", async (ctx) => {
  try {
    const matches = await fetchMatches();
    if (!matches.length) return ctx.reply("В ближайшие 24 часа матчей не найдено.");

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

        text += `${home} — ${away}\nНачало: ${localTime}\nSignal Score: ${score}/100\n\n`;
        count++;
      }

      if (count >= 3) break;
    }

    if (count === 0) return ctx.reply("Нет матчей выше порога 70.");
    return ctx.reply(text);
  } catch (err) {
    console.error("signals cmd error:", err?.message || err);
    return ctx.reply("Ошибка: " + (err?.message || "unknown"));
  }
});

bot.action("signals", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const matches = await fetchMatches();
    if (!matches.length) return ctx.reply("В ближайшие 24 часа матчей не найдено.");

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

        text += `${home} — ${away}\nНачало: ${localTime}\nSignal Score: ${score}/100\n\n`;
        count++;
      }

      if (count >= 3) break;
    }

    if (count === 0) return ctx.reply("Нет матчей выше порога 70.");
    return ctx.reply(text);
  } catch (err) {
    console.error("Signals action error:", err?.message || err);
    return ctx.reply("Ошибка: " + (err?.message || "unknown"));
  }
});

// ---------------- HELPERS ----------------
async function readRawBody(req) {
  // Vercel иногда уже кладёт распарсенное тело в req.body
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.length) {
    try { return JSON.parse(req.body); } catch { /* fallthrough */ }
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (e) {
    console.error("Bad JSON body:", body.slice(0, 200));
    throw new Error("Invalid JSON");
  }
}

// ---------------- WEBHOOK HANDLER ----------------
module.exports = async (req, res) => {
  // Всегда быстро отвечаем 200, чтобы Telegram не считал это ошибкой из-за тайминга
  // Но handleUpdate всё равно делаем до окончания запроса (без “фоновой магии”).
  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    const update = await readRawBody(req);
    await bot.handleUpdate(update);
  } catch (err) {
    console.error("Webhook handler error:", err?.message || err);
    // Всё равно 200, иначе Telegram будет ретраить и усугубит ситуацию
  }

  return res.status(200).send("OK");
};