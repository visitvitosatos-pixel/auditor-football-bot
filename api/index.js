const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

// станавливаем команды для подсказок
bot.start((ctx) => ctx.reply('от-удитор готов! опробуй /next или /leagues'));

bot.command('next', async (ctx) => {
    try {
        const res = await axios.get('https://api-football-v1.p.rapidapi.com/v3/fixtures', {
            params: { next: '1' },
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
            }
        });
        const game = res.data.response[0];
        if (!game) return ctx.reply('атчей нет');
        ctx.reply('⚽ ' + game.teams.home.name + ' vs ' + game.teams.away.name);
    } catch (e) { ctx.reply('шибка API'); }
});

// кспорт для Vercel (Webhook)
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body, res);
        } catch (err) {
            console.error(err);
            res.status(500).send('Error');
        }
    } else {
        res.status(200).send('Server is running');
    }
};