<?php
/**
 * Configurações da API BravoPay e Webhooks - Vivo 2ª Via
 */

// Chave da API BravoPay (Live)
define('BRAVOPAY_API_KEY', 'bp_live_mwXI566Lf7nMQDAvJZD8rn5LLzJo6yHGyqSTCg');

// Valor fixo da fatura em centavos (6254 = R$ 62,54)
define('AMOUNT_CENTS', 6254);

// Descrição exibida na cobrança e extrato
define('BILL_DESCRIPTION', 'Vivo 2ª Via de Fatura Digital');

// URL para onde enviar Webhooks de PENDENTE e APROVADO
// Pode ser um webhook do Discord, Telegram, n8n, Make, UTMify ou seu próprio sistema
// Deixe vazio '' se não quiser disparar webhook externo
define('EXTERNAL_WEBHOOK_URL', '');

// Secret do Webhook configurado na BravoPay (whsec_...), se houver
define('BRAVOPAY_WEBHOOK_SECRET', '');

// Arquivo de log dos webhooks
define('LOG_FILE', __DIR__ . '/webhooks.log');
