<?php
/**
 * Webhook Receiver - Vivo 2ª Via / BravoPay
 * 
 * Cadastre a URL deste arquivo no painel da BravoPay em:
 * Dashboard -> Integrações -> Adicionar Webhook
 * Ex: https://seudominio.com/webhook.php
 */

require_once __DIR__ . '/config.php';

// Responde sempre 200 rapidamente (< 5s) conforme solicitado pela BravoPay
header('Content-Type: application/json; charset=utf-8');

$rawBody = file_get_contents('php://input');
$signatureHeader = $_SERVER['HTTP_BRAVOPAY_SIGNATURE'] ?? $_SERVER['HTTP_X_BRAVOPAY_SIGNATURE'] ?? '';

// Função para registrar logs
function log_webhook($message, $data = null) {
    if (!defined('LOG_FILE')) return;
    $date = date('Y-m-d H:i:s');
    $log = "[{$date}] [WEBHOOK] {$message}";
    if ($data !== null) {
        $log .= " | " . (is_string($data) ? $data : json_encode($data, JSON_UNESCAPED_UNICODE));
    }
    $log .= PHP_EOL;
    @file_put_contents(LOG_FILE, $log, FILE_APPEND);
}

// Verificação de assinatura HMAC-SHA256 se o secret estiver configurado
if (defined('BRAVOPAY_WEBHOOK_SECRET') && !empty(BRAVOPAY_WEBHOOK_SECRET)) {
    if (empty($signatureHeader)) {
        log_webhook("Assinatura ausente");
        http_response_code(401);
        echo json_encode(['error' => 'Assinatura ausente']);
        exit;
    }

    $parts = [];
    foreach (explode(',', $signatureHeader) as $pair) {
        $kv = explode('=', trim($pair), 2);
        if (count($kv) === 2) {
            $parts[$kv[0]] = $kv[1];
        }
    }

    $t = isset($parts['t']) ? intval($parts['t']) : 0;
    $v1 = $parts['v1'] ?? '';

    // Anti-replay (janela de 5 minutos)
    if (abs(time() - $t) > 300) {
        log_webhook("Timestamp fora da janela de tolerância", ['t' => $t, 'now' => time()]);
        http_response_code(400);
        echo json_encode(['error' => 'Timestamp expirado']);
        exit;
    }

    $expectedSignature = hash_hmac('sha256', "{$t}.{$rawBody}", BRAVOPAY_WEBHOOK_SECRET);
    if (!hash_equals($expectedSignature, $v1)) {
        log_webhook("Assinatura inválida");
        http_response_code(401);
        echo json_encode(['error' => 'Assinatura inválida']);
        exit;
    }
}

$payload = json_decode($rawBody, true);

if (!$payload) {
    log_webhook("Corpo da requisição vazio ou JSON inválido");
    http_response_code(400);
    echo json_encode(['error' => 'Payload inválido']);
    exit;
}

$eventType = $payload['type'] ?? 'unknown';
$data = $payload['data'] ?? [];
$txId = $data['id'] ?? 'unknown';
$status = $data['status'] ?? 'unknown';
$email = $data['customer']['email'] ?? 'Não informado';
$amountCents = $data['amount_cents'] ?? 6254;

log_webhook("Evento recebido: {$eventType} | Status: {$status} | ID: {$txId} | Cliente: {$email}");

// Encaminha para Webhook Externo (ex: Discord, Telegram, UTMify, n8n) se configurado
if (defined('EXTERNAL_WEBHOOK_URL') && !empty(EXTERNAL_WEBHOOK_URL)) {
    $url = EXTERNAL_WEBHOOK_URL;
    $isDiscord = strpos($url, 'discord.com/api/webhooks') !== false;

    if ($isDiscord) {
        $isPaid = ($eventType === 'transaction.paid' || $status === 'PAID');
        $color = $isPaid ? 3066993 : 16753920; // Verde ou Laranja
        $title = $isPaid ? '✅ FATURA PAGA VIA PIX! - VIVO' : '⏳ COBRANÇA PIX GERADA (PENDENTE) - VIVO';

        $body = [
            'embeds' => [
                [
                    'title' => $title,
                    'color' => $color,
                    'fields' => [
                        ['name' => '📧 Cliente / Email', 'value' => $email, 'inline' => true],
                        ['name' => '💰 Valor', 'value' => 'R$ ' . number_format($amountCents / 100, 2, ',', '.'), 'inline' => true],
                        ['name' => '📊 Evento BravoPay', 'value' => $eventType, 'inline' => true],
                        ['name' => '🆔 ID Transação', 'value' => $txId, 'inline' => false],
                        ['name' => '⏱ Data', 'value' => date('d/m/Y H:i:s'), 'inline' => true]
                    ],
                    'footer' => ['text' => 'Vivo Regulariza • BravoPay Webhook']
                ]
            ]
        ];
    } else {
        $body = [
            'event' => $eventType,
            'source' => 'bravopay_webhook',
            'timestamp' => date('c'),
            'data' => $data
        ];
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_TIMEOUT => 4
    ]);
    curl_exec($ch);
    curl_close($ch);
}

// Responde 200 OK para a BravoPay confirmar entrega
http_response_code(200);
echo json_encode([
    'received' => true,
    'event' => $eventType,
    'id' => $txId
]);
