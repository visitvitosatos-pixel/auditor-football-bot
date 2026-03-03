const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

// станавливаем Webhook обработчик
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body, res);
        } else {
            res.status(200).send('от-удитор активен!');
        }
    } catch (e) {
        console.error('шибка в Webhook:', e);
        res.status(500).send('шибка сервера');
    }
};

bot.start((ctx) => ctx.reply('от-удитор на связи! тобы проверить футбол, нажми /check'));

bot.command('check', async (ctx) => {
    try {
        const response = await axios.get('https://api-football-v1.p.rapidapi.com/v3/timezone', {
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
            }
        });
        ctx.reply('✅ API Football на Vercel работает! айдено зон: ' + response.data.results);
    } catch (err) {
        ctx.reply('❌ шибка API: ' + err.message);
    }
});
