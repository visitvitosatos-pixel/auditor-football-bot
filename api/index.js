const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('Я ! сли ты это видишь, значит webhook работает.'));
bot.command('check', (ctx) => ctx.reply('Связь с API в порядке!'));

module.exports = async (req, res) => {
    console.log('ходящий метод:', req.method);
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body, res);
            console.log('Update обработан');
        } catch (err) {
            console.error('шибка Telegraf:', err);
        }
        if (!res.headersSent) res.status(200).send('OK');
    } else {
        res.status(200).send('С ТТ. Твой URL для webhook: https://' + req.headers.host + '/api');
    }
};