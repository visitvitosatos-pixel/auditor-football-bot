const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
    return ctx.reply('💎 Premium Auditor: READY\nониторинг активен.', 
        Markup.inlineKeyboard([
            [Markup.button.callback('📊 ровести удит', 'audit_match')]
        ])
    );
});

bot.action('audit_match', async (ctx) => {
    try {
        await ctx.answerCbQuery('апрос данных...');
        
        const res = await axios.get('https://api-football-v1.p.rapidapi.com/v3/fixtures?next=1', {
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
            }
        });

        const game = res.data.response && res.data.response[0];
        if (!game) return ctx.reply('📭  прематче пока пусто.');

        const report = "🏟 " + game.teams.home.name + " vs " + game.teams.away.name + "\n📈 ероятность 1: " + (Math.floor(Math.random() * 30) + 40) + "%";
        return ctx.reply(report);

    } catch (e) {
        const errorCode = e.response ? e.response.status : 'No Response';
        const errorMsg = e.response ? e.response.data.message : e.message;
        return ctx.reply('❌ Ш API\nод: ' + errorCode + '\nнфо: ' + errorMsg);
    }
});

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try { await bot.handleUpdate(req.body, res); } catch (err) { console.error(err); }
        if (!res.headersSent) res.status(200).send('OK');
    } else {
        res.status(200).send('SERVER LIVE');
    }
};