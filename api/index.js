const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

function safeEnv(name) {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length ? v.trim() : "";
}

const BOT_TOKEN = safeEnv("BOT_TOKEN");
const API_KEY = safeEnv("FOOTBALL_DATA_API_KEY");

// В serverless лучше отключить webhookReply
const bot = BOT_TOKEN
  ? new Telegraf(BOT_TOKEN, { telegram: { webhookReply: false } })
  : null;

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
    { headers: { "X-Auth-Token": API_KEY }, timeout: 15000 }
  );

  const nowTs = Date.now();
  const next24hTs = nowTs + 24 * 60 * 60 * 1000;

  const all = res.data.matches || [];
  const matches = all
    .filter((m) => {
      const kickoffTs = new Date(m.utcDate).getTime();
      return kickoffTs > nowTs && kickoffTs <= next24hTs;
    })
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  console.log("Matches total:", all.length);
  console.log("Matches filtered 24h:", matches.length);

  return matches;
}

// ---------------- BOT HANDLERS ----------------
function formatTopSignals(matches) {
  let text = "⚡ Комбинированный рейтинг (24ч)\n\n";
  let count = 0;

  for (const m of matches) {
    const home = m.homeTeam?.name;
    const away = m.awayTeam?.name;
    const kickoff = new Date(m.utcDate);
    if (!home || !away) continue;

    const score = calculateSignal(home, away);
    if (score < 70) continue;

    const localTime = kickoff.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });

    text += `${home} — ${away}\nНачало: ${localTime}\nSignal Score: ${score}/100\n\n`;
    count++;
    if (count >= 3) break;
  }

  return { text, count };
}

if (bot) {
  bot.start((ctx) =>
    ctx.reply(
      "Бот активен.\nВыберите действие:",
      Markup.inlineKeyboard([[Markup.button.callback("🔍 Найти сигналы", "signals")]])
    )
  );

  bot.command("signals", async (ctx) => {
    try {
      const matches = await fetchMatches();
      if (!matches.length) return ctx.reply("В ближайшие 24 часа матчей не найдено.");

      const { text, count } = formatTopSignals(matches);
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

      const { text, count } = formatTopSignals(matches);
      if (count === 0) return ctx.reply("Нет матчей выше порога 70.");
      return ctx.reply(text);
    } catch (err) {
      console.error("signals action error:", err?.message || err);
      return ctx.reply("Ошибка: " + (err?.message || "unknown"));
    }
  });

  bot.catch((err) => console.error("telegraf error:", err));
}

async function readRawBody(req) {
  // На Vercel иногда уже есть req.body
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.length) {
    try { return JSON.parse(req.body); } catch { /* ignore */ }
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

// ---------------- WEBHOOK HANDLER ----------------
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(200).send("OK");

  console.log("Incoming webhook. Has bot:", !!bot);

  if (!bot) {
    console.error("BOT_TOKEN missing on runtime. Check Vercel env (Production).");
    return res.status(200).send("OK");
  }

  try {
    const update = await readRawBody(req);
    await bot.handleUpdate(update);
  } catch (err) {
    console.error("Webhook handler error:", err?.message || err);
  }

  return res.status(200).send("OK");
};