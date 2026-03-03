const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");

const bot = new Telegraf(BOT_TOKEN);

function fakeSignal(home, away) {
  const base = (home.length + away.length) % 100;
  const score = 60 + (base % 40);
  return score;
}

bot.start((ctx) => {
  return ctx.reply(
    "от активен.",
    Markup.inlineKeyboard([
      [Markup.button.callback("🔍 айти сигналы", "signals")]
    ])
  );
});

bot.action("signals", async (ctx) => {
  try {
    const matches = [
      { home: "Arsenal", away: "Chelsea" },
      { home: "Liverpool", away: "Everton" },
      { home: "Real Madrid", away: "Barcelona" }
    ];

    let text = "⚡ омбинированный рейтинг\n\n";

    matches.forEach(m => {
      const score = fakeSignal(m.home, m.away);
      text += `${m.home} — ${m.away}\n`;
      text += `Signal Score: ${score}/100\n\n`;
    });

    await ctx.reply(text);
  } catch (e) {
    console.error(e);
    await ctx.reply("шибка анализа.");
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
