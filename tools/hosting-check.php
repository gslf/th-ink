<?php
/**
 * Temporary hosting capability check. Upload manually, run once, then delete.
 * No credentials, environment variables, server paths or PHP configuration dumps
 * are included in the report. This does not send notifications or access notes.
 */
ini_set('display_errors', '0');
header('Cache-Control: no-store, private');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
header('Content-Type: text/html; charset=utf-8');

if (PHP_VERSION_ID < 80200) {
    echo 'PHP ' . htmlspecialchars(PHP_VERSION, ENT_QUOTES, 'UTF-8') . ': PHP 8.2 or newer is required.';
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'POST'], true)) {
    http_response_code(405);
    header('Allow: GET, POST');
    exit;
}

// The form token prevents other websites from triggering the active checks.
$cookieName = 'think_hosting_check';
$token = $_COOKIE[$cookieName] ?? '';
if ($method === 'POST') {
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)
        || !is_string($_POST['token'] ?? null)
        || !hash_equals($token, $_POST['token'])
        || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') {
        http_response_code(403);
        echo 'Reopen this page and run the check again.';
        exit;
    }
} else {
    $token = bin2hex(random_bytes(32));
}
$cookieOptions = ['expires' => time() + 900, 'path' => '/',
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'httponly' => true, 'samesite' => 'Strict'];
setcookie($cookieName, $token, $cookieOptions);

function probe($callback) {
    try {
        return $callback();
    } catch (Throwable $error) {
        // Exception text may contain filesystem paths or server configuration.
        return false;
    }
}

$report = null;
if ($method === 'POST') {
    $report = ['diagnostic' => 'th.ink hosting check v1', 'checked_at_utc' => gmdate('c'),
        'php_version' => PHP_VERSION, 'php_requirement_met' => PHP_VERSION_ID >= 80200,
        'integer_bits' => PHP_INT_SIZE * 8, 'extensions' => []];
    foreach (['curl', 'mbstring', 'openssl', 'pdo_mysql', 'pdo_sqlite', 'sqlite3', 'session', 'gmp', 'bcmath'] as $extension) {
        $report['extensions'][$extension] = extension_loaded($extension);
    }
    $report['p256_sign_verify'] = probe(function () {
        if (!defined('OPENSSL_KEYTYPE_EC')) return false;
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        if (!$key) return false;
        $details = openssl_pkey_get_details($key);
        $signature = '';
        return openssl_sign('th.ink diagnostic', $signature, $key, OPENSSL_ALGO_SHA256)
            && openssl_verify('th.ink diagnostic', $signature, $details['key'], OPENSSL_ALGO_SHA256) === 1;
    });
    $report['aes_128_gcm_roundtrip'] = probe(function () {
        $key = random_bytes(16);
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt('th.ink diagnostic', 'aes-128-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        return $cipher !== false && openssl_decrypt($cipher, 'aes-128-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag) === 'th.ink diagnostic';
    });

    // Only dummy data is written, in the upload directory, with a random filename.
    $temporary = __DIR__ . '/.think-check-' . bin2hex(random_bytes(12));
    register_shutdown_function(function () use ($temporary) {
        foreach (['', '.sqlite', '.sqlite-journal', '.sqlite-wal', '.sqlite-shm'] as $suffix) {
            if (is_file($temporary . $suffix)) @unlink($temporary . $suffix);
        }
    });
    $report['local_file_write_and_lock'] = probe(function () use ($temporary) {
        $file = @fopen($temporary, 'x+b');
        if (!$file) return false;
        try {
            if (!flock($file, LOCK_EX | LOCK_NB)) return false;
            $ok = fwrite($file, 'diagnostic') === 10 && fflush($file);
            rewind($file);
            $ok = $ok && stream_get_contents($file) === 'diagnostic';
            flock($file, LOCK_UN);
            return $ok;
        } finally {
            fclose($file);
            @unlink($temporary);
        }
    });
    $report['sqlite_local_transaction'] = extension_loaded('pdo_sqlite') ? probe(function () use ($temporary) {
        $db = new PDO('sqlite:' . $temporary . '.sqlite');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->exec('CREATE TABLE diagnostic (value INTEGER)');
        $db->beginTransaction();
        $db->exec('INSERT INTO diagnostic VALUES (42)');
        $db->commit();
        $db = null;
        $db = new PDO('sqlite:' . $temporary . '.sqlite');
        return (int) $db->query('SELECT value FROM diagnostic')->fetchColumn() === 42;
    }) : null;
    $report['mysql_connection'] = 'Not tested: requires your database configuration; do not share its password.';
    $report['push_service_https'] = [];
    foreach (['Google' => 'https://fcm.googleapis.com/', 'Mozilla' => 'https://updates.push.services.mozilla.com/', 'Apple' => 'https://web.push.apple.com/'] as $name => $url) {
        $report['push_service_https'][$name] = probe(function () use ($url) {
            if (!function_exists('curl_init')) return ['reachable' => false, 'reason' => 'cURL unavailable'];
            $curl = curl_init($url);
            curl_setopt_array($curl, [CURLOPT_NOBODY => true, CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 5,
                CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_USERAGENT => 'th.ink-hosting-diagnostic/1']);
            curl_exec($curl);
            $error = curl_errno($curl);
            $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
            // A 4xx response at a service root still demonstrates HTTPS connectivity.
            return ['reachable' => $error === 0 && $status > 0, 'http_status' => $status, 'curl_error_code' => $error];
        });
    }
    $report['limitations'] = [
        'Connectivity is not proof of push delivery: a real device subscription must be tested later.',
        'The report does not identify your OVH plan, database quota, cron availability or session persistence.',
        'SQLite is optional; MySQL can be used instead. Local file locking does not test multi-server or concurrent database safety.',
        'No notes, accounts, notifications or existing databases were read or changed.'
    ];
    setcookie($cookieName, '', array_merge($cookieOptions, ['expires' => time() - 3600]));
}
?>
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>th.ink — Hosting check</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:#f6f4ef;color:#292820}
*{box-sizing:border-box}body{margin:0;padding:32px 20px}main{max-width:720px;margin:5vh auto}
h1{font-size:clamp(28px,6vw,40px);letter-spacing:-.05em;margin:0 0 20px}p,li{line-height:1.65}
.muted{color:#69675e}button,a{font:inherit}button{border:0;border-radius:12px;background:#35352e;color:white;padding:14px 24px;cursor:pointer}
button:focus-visible,a:focus-visible,textarea:focus-visible{outline:3px solid #b28b1e;outline-offset:4px}
textarea{width:100%;height:55vh;min-height:250px;padding:16px;border:1px solid #c6c1b2;border-radius:12px;font:13px/1.6 ui-monospace,monospace;background:#fff;color:#292820;resize:vertical}
a{color:inherit}label{display:block;margin-bottom:8px;font-weight:600}
@media(prefers-color-scheme:dark){:root{background:#1c1d19;color:#efeee5}.muted{color:#b9b7aa}textarea{background:#24251f;color:#efeee5;border-color:#505145}button{background:#e8d58a;color:#222}}
</style>
<main>
<h1>th.ink <span class="muted">/ hosting check</span></h1>
<?php if ($report === null): ?>
<p>Check whether this hosting can support private reminder notifications.</p>
<ul><li>PHP extensions and encryption support.</li><li>Temporary file storage and SQLite, if available.</li><li>Secure connections to Google, Mozilla and Apple push services.</li></ul>
<p class="muted">The check takes up to 15 seconds. It uses temporary dummy data and does not access your notes, passwords or existing databases. No notifications are sent.</p>
<form method="post"><input type="hidden" name="token" value="<?= htmlspecialchars($token, ENT_QUOTES, 'UTF-8') ?>"><button type="submit">Run hosting check</button></form>
<?php else: ?>
<p>The check is complete. Copy the report below and share it in our chat.</p>
<label for="report">Diagnostic report</label>
<textarea id="report" readonly spellcheck="false"><?= htmlspecialchars(json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), ENT_QUOTES, 'UTF-8') ?></textarea>
<p class="muted">This is a capability check, not confirmation that reminders are operational. Delete this diagnostic file from your hosting after reviewing the report.</p>
<p><a href="?">Start a new check</a></p>
<?php endif; ?>
</main>
</html>
