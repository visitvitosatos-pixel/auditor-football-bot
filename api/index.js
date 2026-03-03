const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const { Redis } = require("@upstash/redis");

const BOT_TOKEN = process.env.BOT_TOKEN;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const CHANNEL = process.env.CHANNEL;
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(x => x.trim());
const CRON_SECRET = process.env.CRON_SECRET;

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");

const bot = new Telegraf(BOT_TOKEN);

async function getSetting(key, def) {
  const v = await redis.get(key);
  return v ?? def;
}

async function setSetting(key, val) {
  await redis.set(key, val);
}

async function logError(msg) {
  const arr = (await redis.get("errors")) || [];
  arr.unshift({ msg, time: new Date().toISOString() });
  await redis.set("errors", arr.slice(0, 10));
}

function isAdmin(id) {
  return ADMIN_IDS.includes(String(id));
}

async function fetchMatches() {
  const cached = await redis.get("matches_cache");
  if (cached) return cached;

  const start = Date.now();
  const res = await axios.get("https://api.football-data.org/v4/matches", {
    headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY },
    timeout: 15000
  });

  const matches = res.data?.matches || [];
  await redis.set("matches_cache", matches, { ex: 600 }); // 10 min cache
  return matches;
}

function scoreMatch(home, away) {
  const base = (home.length + away.length) % 100;
  return 60 + (base % 40);
}

async function buildSignals() {
  const matches = await fetchMatches();
  const min = await getSetting("min_percent_channel", 75);

  return matches
    .slice(0, 10)
    .map(m => ({
      home: m.homeTeam?.name,
      away: m.awayTeam?.name,
      percent: scoreMatch(m.homeTeam?.name || "", m.awayTeam?.name || "")
    }))
    .filter(x => x.percent >= min)
    .slice(0, 2);
}

async function postToChannel(text) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: CHANNEL,
    text
  });
}

bot.start(async (ctx) => {
  await ctx.reply(
    "анель управления",
    Markup.inlineKeyboard([
      [Markup.button.callback("📊 Статистика", "stats")],
      [Markup.button.callback("🚀 апустить анализ", "run")],
      [Markup.button.callback("⚙ орог канала", "threshold")],
      [Markup.button.callback("📋 оги", "logs")]
    ])
  );
});

bot.action("run", async (ctx) => {
  try {
    const signals = await buildSignals();
    if (!signals.length) return ctx.reply("ет сигналов выше порога");

    let text = "AUTO AUDIT\n\n";
    signals.forEach(s => {
      text += `${s.home} vs ${s.away}\nChance: ${s.percent}%\n\n`;
    });

    await postToChannel(text);
    ctx.reply("публиковано");
  } catch (e) {
    await logError(e.message);
    ctx.reply("шибка анализа");
  }
});

bot.action("stats", async (ctx) => {
  const errors = await redis.get("errors") || [];
  ctx.reply(`шибок за сессию: ${errors.length}`);
});

bot.action("threshold", async (ctx) => {
  await setSetting("min_percent_channel", 80);
  ctx.reply("орог установлен 80%");
});

bot.action("logs", async (ctx) => {
  const errors = await redis.get("errors") || [];
  if (!errors.length) return ctx.reply("шибок нет");
  ctx.reply(errors.map(e => e.msg).join("\n"));
});

module.exports = async (req, res) => {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    return res.status(200).send("OK");
  }

  if (req.url.startsWith("/health")) {
    return res.json({ ok: true });
  }

  if (req.url.startsWith("/cron")) {
    try {
      const signals = await buildSignals();
      if (signals.length) {
        let text = "AUTO AUDIT\n\n";
        signals.forEach(s => {
          text += `${s.home} vs ${s.away}\nChance: ${s.percent}%\n\n`;
        });
        await postToChannel(text);
      }
      return res.send("Cron done");
    } catch (e) {
      await logError(e.message);
      return res.status(500).send("Cron error");
    }
  }

  res.send("API OK");
};
