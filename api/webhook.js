const https = require('https');
const http = require('http');

const EXTERNAL_WEBHOOK_URL = process.env.WEBHOOK_URL || '';

function dispatchWebhook(event, data) {
    if (!EXTERNAL_WEBHOOK_URL) return;
    try {
        const parsedUrl = new URL(EXTERNAL_WEBHOOK_URL);
        const isDiscord = parsedUrl.hostname.includes('discord.com');
        let bodyPayload;

        if (isDiscord) {
            const isPaid = event === 'transaction.paid';
            bodyPayload = {
                embeds: [{
                    title: isPaid ? '✅ PIX PAGO COM SUCESSO! - VIVO' : `📢 EVENTO: ${event.toUpperCase()}`,
                    color: isPaid ? 3066993 : 16753920,
                    fields: [
                        { name: '📧 Cliente / Email', value: data.customer?.email || 'N/A', inline: true },
                        { name: '💰 Valor', value: 'R$ ' + ((data.amount_cents || 6254) / 100).toFixed(2).replace('.', ','), inline: true },
                        { name: '🆔 ID da Transação', value: data.id || 'N/A', inline: false },
                        { name: '⏱ Data/Hora', value: new Date().toLocaleString('pt-BR'), inline: true }
                    ],
                    footer: { text: 'Vivo Regulariza • BravoPay Integration' }
                }]
            };
        } else {
            bodyPayload = { event, timestamp: new Date().toISOString(), data };
        }

        const reqData = JSON.stringify(bodyPayload);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const req = client.request(parsedUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(reqData)
            }
        });
        req.on('error', () => {});
        req.write(reqData);
        req.end();
    } catch (e) {}
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const payload = req.body || {};
        const { type, data } = payload;

        if (type && data) {
            dispatchWebhook(type, data);
        }

        // Responde 200 rápido conforme documentação da BravoPay (< 5s)
        return res.status(200).json({ received: true });
    } catch (e) {
        return res.status(400).json({ error: 'Invalid payload' });
    }
};
