const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");

const bot = new Telegraf(BOT_TOKEN);

// тестовая команда
bot.start((ctx) => {
  return ctx.reply("от работает. Webhook стабилен.");
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
