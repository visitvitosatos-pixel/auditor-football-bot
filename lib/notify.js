const axios = require("axios");

async function sendMessage(token, chatId, text) {
  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { chat_id: chatId, text, disable_web_page_preview: true },
    { timeout: 15000 }
  );
}

async function notifyAdmins(token, adminIds, text) {
  if (!token) return;
  if (!Array.isArray(adminIds) || adminIds.length === 0) return;

  for (const id of adminIds) {
    try { await sendMessage(token, id, text); } catch (e) { /* не роняем */ }
  }
}

module.exports = { notifyAdmins, sendMessage };
