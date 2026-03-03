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

    await bot.handleUpdate(update, res);

  } catch (err) {
    console.error("Webhook error:", err);
  }

  return res.status(200).end();
};
