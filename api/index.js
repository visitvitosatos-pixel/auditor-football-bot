const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

// лавное меню с кнопками
bot.start((ctx) => {
    return ctx.reply('💎 обро пожаловать в Auditor Football!\nыберите интересующий раздел:', 
        Markup.inlineKeyboard([
            [Markup.button.callback('🏟 лижайший матч', 'get_next')],
            [Markup.button.callback('🏆 Топ-5 лиг нглии', 'get_leagues')]
        ])
    );
});

// бработка нажатия на кнопку "лижайший матч"
bot.action('get_next', async (ctx) => {
    try {
        const res = await axios.get('https://api-football-v1.p.rapidapi.com/v3/fixtures?next=1', {
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
            }
        });
        const game = res.data.response[0];
        if (!game) return ctx.editMessageText('атчей не найдено 🤷‍♂️');
        
        const message = "🎯  Т:\n\n" + 
                        "🏠 " + game.teams.home.name + " vs " + game.teams.away.name + " 🚀\n" +
                        "🏆 ига: " + game.league.name + "\n" +
                        "⏰ Статус: " + game.fixture.status.long;
        
        await ctx.answerCbQuery(); // бираем "часики" с кнопки
        return ctx.reply(message);
    } catch (e) {
        return ctx.reply('❌ шибка API. роверь FOOTBALL_API_KEY в настройках Vercel.');
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