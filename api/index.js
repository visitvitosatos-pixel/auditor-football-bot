const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
    return ctx.reply('💎 Premium Auditor: READY\nМониторинг активен.', 
        Markup.inlineKeyboard([
            [Markup.button.callback('📊 Провести аудит', 'audit_match')]
        ])
    );
});

bot.action('audit_match', async (ctx) => {
    try {
        await ctx.answerCbQuery('Запрос к API...');
        // Используем хост с твоего последнего скрина
        const res = await axios.get('https://free-api-live-football-data.p.rapidapi.com/football-get-all-leagues', {
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'free-api-live-football-data.p.rapidapi.com'
            }
        });
        return ctx.reply('✅ Связь с API установлена! Данные получены.');
    } catch (e) {
        return ctx.reply('❌ Ошибка 403: Нужно нажать ту самую синюю кнопку Subscribe на сайте!');
    }
});

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try { await bot.handleUpdate(req.body, res); } catch (err) { console.error(err); }
        res.status(200).send('OK');
    }
};