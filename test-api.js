const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
require('dotenv').config();

const port = 9022;
const targetUrl = 'https://api-football-v1.p.rapidapi.com/v3/timezone';
const apiKey = (process.env.FOOTBALL_API_KEY || '').trim();

async function testSpecificProxy() {
    console.log('--- Тестируем порт ' + port + ' ---');
    
    const agents = [
        { name: 'HTTP Proxy', agent: new HttpsProxyAgent('http://127.0.0.1:' + port) },
        { name: 'SOCKS5 Proxy', agent: new SocksProxyAgent('socks5://127.0.0.1:' + port) }
    ];

    for (let item of agents) {
        try {
            console.log('роверка: ' + item.name + '...');
            const res = await axios.get(targetUrl, { 
                httpsAgent: item.agent, 
                timeout: 5000,
                headers: {
                    'X-RapidAPI-Key': apiKey,
                    'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
                }
            });
            console.log('✅ ТТ! Тип: ' + item.name);
            console.log('твет API (статус):', res.status);
            return;
        } catch (err) {
            if (err.response && err.response.status === 451) {
                console.log('✅ Т ' + port + ' , но API выдает 451. ужно нажать Subscribe на сайте!');
                return;
            }
            console.log('❌ ' + item.name + ' не подошел: ' + err.message);
        }
    }
    console.log('\n💡 ывод: орт 9022 виден, но прокси на нем не отвечает. роверь, включен ли VPN и разрешены ли в нем системные подключения.');
}

testSpecificProxy();
