const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
    return ctx.reply('💎 Premium Football Auditor\nыберите инструмент аналитики:', 
        Markup.inlineKeyboard([
            [Markup.button.callback('📊 лижайший матч', 'get_next')],
            [Markup.button.callback('🏆 Топ-5 лиг', 'get_leagues')],
            [Markup.button.webApp('🚀 ткрыть ашборд (TMA)', 'https://' + ctx.host + '/')]
        ])
    );
});

// бработка кнопки "лижайший матч"
bot.action('get_next', async (ctx) => {
    try {
        const res = await axios.get('https://api-football-v1.p.rapidapi.com/v3/fixtures?next=1', {
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
            }
        });
        const game = res.data.response[0];
        const text = game ? "🏟 MATCH: " + game.teams.home.name + " vs " + game.teams.away.name : 'атчей нет';
        await ctx.answerCbQuery();
        return ctx.reply(text);
    } catch (e) {
        return ctx.reply('❌ шибка API');
    }
});

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        await bot.handleUpdate(req.body, res);
        if (!res.headersSent) res.status(200).send('OK');
    } else {
        res.status(200).send('SERVER READY');
    }
};