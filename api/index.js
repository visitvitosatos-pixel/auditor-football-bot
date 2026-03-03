const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

// спользуем твой домен напрямую для стабильности
const WEBAPP_URL = "https://auditor-football-bot.vercel.app/";

bot.start((ctx) => {
    try {
        return ctx.reply('💎 Premium Football Auditor\nнструменты готовы:', 
            Markup.inlineKeyboard([
                [Markup.button.callback('📊 лижайший матч', 'get_next')],
                [Markup.button.webApp('🚀 ткрыть ашборд', WEBAPP_URL)]
            ])
        );
    } catch (e) {
        console.error('шибка в старте:', e);
    }
});

bot.action('get_next', async (ctx) => {
    try {
        const res = await axios.get('https://api-football-v1.p.rapidapi.com/v3/fixtures?next=1', {
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
            }
        });
        const game = res.data.response[0];
        const text = game ? "🏟 " + game.teams.home.name + " vs " + game.teams.away.name : 'атчей нет';
        await ctx.answerCbQuery();
        return ctx.reply(text);
    } catch (e) {
        console.error('шибка API:', e);
        return ctx.reply('❌ шибка данных');
    }
});

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body, res);
        } catch (err) {
            console.error('ритическая ошибка Telegraf:', err);
        }
        if (!res.headersSent) res.status(200).send('OK');
    } else {
        res.status(200).send('SERVER READY');
    }
};