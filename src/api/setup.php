<?php
require __DIR__.'/bootstrap.php';
need(empty($config['password_hash']),'Setup is already complete. Remove setup.php from the public server.',410);
need(is_string($config['setup_key_hash']??null)&&(bool)preg_match('/^[a-f0-9]{64}$/D',$config['setup_key_hash']),'Create a private config.php with the setup key generator.',503);
$finished=false;$error='';
if($_SERVER['REQUEST_METHOD']==='POST'){
 rate('setup:'.($_SERVER['REMOTE_ADDR']??''),10,900);
 need(tokenMatches($config['setup_key_hash'],$_POST['key']??''),'Invalid setup key.',403);
 foreach(['email','password','base','key'] as $field)need(is_string($_POST[$field]??null),'Invalid setup input.');
 $email=trim($_POST['email']??'');$password=$_POST['password']??'';$base=rtrim(trim($_POST['base']??''),'/').'/';
 need((bool)filter_var($email,FILTER_VALIDATE_EMAIL)&&strlen($email)<=200,'Enter a valid owner email.');
 need(strlen($password)>=16&&strlen($password)<=72&&!str_contains($password,"\0"),'Use a password between 16 and 72 bytes.');
 $url=parse_url($base);need(($url['scheme']??'')==='https'&&!isset($url['query'])&&!isset($url['fragment'])&&!isset($url['user'])&&!isset($url['pass'])&&filter_var($base,FILTER_VALIDATE_URL),'Enter the public HTTPS app URL.');
 require __DIR__.'/vendor/autoload.php';
 $secret=null;
 $config=updateConfig(function(array $current)use($email,$password,$base,&$secret): array {
  need(empty($current['password_hash']),'Setup already complete.',410);
  need(tokenMatches($current['setup_key_hash']??null,$_POST['key']??''),'Invalid setup key.',403);
  $keys=$current['vapid']??Minishlink\WebPush\VAPID::createVapidKeys();
  $cronHash=$current['cron_secret_hash']??null;
  if(!is_string($cronHash)||!preg_match('/^[a-f0-9]{64}$/D',$cronHash)){$secret=bin2hex(random_bytes(32));$cronHash=hash('sha256',$secret);}
  database();
  return ['email'=>$email,'password_hash'=>password_hash($password,passwordAlgorithm(),passwordOptions()),'base_url'=>$base,'cron_secret_hash'=>$cronHash,'vapid'=>$keys];
 });
 unset($password,$_POST['password'],$_POST['key']);$finished=true;
}
function h(string $v): string {return htmlspecialchars($v,ENT_QUOTES,'UTF-8');}
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>th.ink — Private reminders</title>
<style>:root{font:16px/1.6 system-ui;color:#292820;background:#faf9f6}*{box-sizing:border-box}main{max-width:620px;margin:6vh auto;padding:24px}h1{letter-spacing:-.04em}label{display:block;margin:16px 0 4px}input,button{font:inherit;padding:12px;border-radius:9px;border:1px solid #ccc;width:100%}button{margin-top:24px;background:#eed484;color:#292820;cursor:pointer}code{display:block;overflow-wrap:anywhere;padding:12px;background:#eee;border-radius:8px}small{color:#666}</style><main><h1>th.ink / private reminders</h1>
<?php if($finished): ?>
<p>Your private account is ready. Your password is stored only as a one-way hash.</p>
<p>cron-job.org URL (POST, every minute):</p><code><?=h($base.'api/index.php?action=cron')?></code>
<?php if($secret!==null): ?><p>Save this cron key in your password manager. It is shown only once and cannot be recovered from the server.</p>
<p>Custom header name: <strong>X-Cron-Secret</strong><br>Header value:</p><code><?=h($secret)?></code>
<?php else: ?><p>Your existing cron key is unchanged. Keep the current cron-job.org header.</p><?php endif; ?>
<p>Sign in from th.ink → Settings → Reminders. Enable this device and send a test notification.</p>
<p>Delete <strong>api/setup.php</strong> and the temporary hosting diagnostic from the public server. Keep <strong>think-private</strong> outside www and back it up securely.</p>
<?php else: ?>
<p>Creates one owner account. There is no public registration. Notification text and schedules are stored privately on this hosting.</p>
<form method="post"><label for="key">Setup key from the offline key generator</label><input id="key" name="key" type="password" required autocomplete="off">
<label for="email">Owner email / sign-in</label><input id="email" name="email" type="email" required autocomplete="username">
<label for="password">Owner password (16–72 bytes)</label><input id="password" name="password" type="password" minlength="16" maxlength="72" required autocomplete="new-password">
<label for="base">Public app URL</label><input id="base" name="base" type="url" value="https://gslf.it/th-ink/" required>
<button>Create private account</button></form>
<?php endif; ?></main></html>
