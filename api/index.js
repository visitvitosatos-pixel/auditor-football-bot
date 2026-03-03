module.exports = async (req, res) => {
  try {

    if (req.method === "POST") {

      // : собрать raw body
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");

      const update = JSON.parse(rawBody);

      await bot.handleUpdate(update);

      return res.status(200).send("OK");
    }

    if (req.url.startsWith("/health")) {
      return res.status(200).json({ ok: true });
    }

    if (req.url.startsWith("/cron")) {
      const signals = await buildSignals();
      if (signals.length) {
        let text = "AUTO AUDIT\n\n";
        signals.forEach(s => {
          text += `${s.home} vs ${s.away}\nChance: ${s.percent}%\n\n`;
        });
        await postToChannel(text);
      }
      return res.status(200).send("Cron done");
    }

    return res.status(200).send("API OK");

  } catch (e) {
    console.error("WEBHOOK ERROR:", e);
    await logError(e.message);
    return res.status(200).send("OK"); // : не отдаём 500 Telegram
  }
};
