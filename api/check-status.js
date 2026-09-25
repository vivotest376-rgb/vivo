const https = require('https');

const BRAVOPAY_API_KEY = process.env.BRAVOPAY_API_KEY || 'bp_live_mwXI566Lf7nMQDAvJZD8rn5LLzJo6yHGyqSTCg';

function callBravoPay(endpoint) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'bravopay.club',
            port: 443,
            path: `/api/v1${endpoint}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${BRAVOPAY_API_KEY}`
            }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, raw: body, error: e.message });
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { id } = req.query || {};

    if (!id) {
        return res.status(400).json({ error: 'Parâmetro id obrigatório' });
    }

    try {
        const bpRes = await callBravoPay(`/transactions/${encodeURIComponent(id)}`);

        if (bpRes.statusCode === 200 && bpRes.data && bpRes.data.status) {
            const status = bpRes.data.status.toUpperCase();
            return res.status(200).json({
                success: true,
                id: bpRes.data.id,
                status: status,
                paid_at: bpRes.data.paid_at || null,
                amount_cents: bpRes.data.amount_cents
            });
        } else {
            return res.status(bpRes.statusCode || 404).json({
                error: 'Transação não encontrada',
                details: bpRes.data
            });
        }
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
