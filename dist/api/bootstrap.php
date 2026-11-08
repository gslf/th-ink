<?php
ini_set('display_errors','0');
ini_set('display_startup_errors','0');
ini_set('zend.exception_ignore_args','1');
umask(0077);
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex, nofollow');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
set_exception_handler(function(Throwable $e) { http_response_code(500); header('Content-Type: application/json'); echo '{"error":"Server unavailable. Check private storage and PHP configuration."}'; });
function out(array $value,int $status=200): never {http_response_code($status);header('Content-Type: application/json');echo json_encode($value,JSON_UNESCAPED_SLASHES);exit;}
function need(bool $test,string $message,int $status=400): void {if(!$test)out(['error'=>$message],$status);}
function localTestRequest(): bool {
 return in_array(PHP_SAPI,['cli','cli-server'],true)&&getenv('THINK_TEST_LOCAL')==='1'&&in_array($_SERVER['REMOTE_ADDR']??'', ['127.0.0.1','::1'],true);
}
function secureRequest(): bool {return (!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off')||localTestRequest();}
need(secureRequest(),'HTTPS required.',403);
$private = getenv('THINK_PRIVATE_DIR') ?: dirname(__DIR__,3).'/think-private';
$dir=realpath($private);$root=realpath($_SERVER['DOCUMENT_ROOT']??'');
need($dir!==false&&(PHP_SAPI==='cli'||$root!==false),'Private storage is unavailable.',503);
need((empty($_SERVER['DOCUMENT_ROOT'])&&PHP_SAPI==='cli')||($root!==false&&!str_starts_with($dir.'/',rtrim($root,'/').'/')),'Private storage must be outside the public document root.',503);
$private=$dir;
need(chmod($private,0700),'Cannot protect private storage.',503);
function readConfig(): array {
 global $private;$file=$private.'/config.php';
 if(!file_exists($file))return [];
 need(realpath($file)===$file&&!is_link($file),'Private configuration must not be a symbolic link.',503);
 need(chmod($file,0600),'Cannot protect private configuration.',503);
 if(function_exists('opcache_invalidate'))opcache_invalidate($file,true);
 $value=require $file;need(is_array($value),'Invalid private configuration.',503);return $value;
}
// All configuration changes use the same lock and an atomic, owner-only replacement.
function updateConfig(callable $change): array {
 global $private;$lock=fopen($private.'/config.lock','c');
 if(!$lock||!flock($lock,LOCK_EX))throw new RuntimeException('Private configuration unavailable');
 $tmp=null;
 try{
  $current=readConfig();$saved=$change($current);
  if($saved!==$current){
   $tmp=$private.'/config-'.bin2hex(random_bytes(16)).'.tmp';$data="<?php\nreturn ".var_export($saved,true).";\n";
   if(file_put_contents($tmp,$data,LOCK_EX)!==strlen($data)||!chmod($tmp,0600)||!rename($tmp,$private.'/config.php'))throw new RuntimeException('Cannot save private configuration');
   if(function_exists('opcache_invalidate'))opcache_invalidate($private.'/config.php',true);
  }
  return $saved;
 }finally{if($tmp!==null&&is_file($tmp))unlink($tmp);flock($lock,LOCK_UN);fclose($lock);}
}
function tokenMatches($digest,$token): bool {
 return is_string($digest)&&preg_match('/^[a-f0-9]{64}$/D',$digest)&&is_string($token)&&strlen($token)>=32&&strlen($token)<=256&&hash_equals($digest,hash('sha256',$token));
}
function passwordAlgorithm(): string {return in_array('argon2id',password_algos(),true)?PASSWORD_ARGON2ID:PASSWORD_BCRYPT;}
function passwordOptions(): array {return passwordAlgorithm()===PASSWORD_BCRYPT?['cost'=>12]:['memory_cost'=>19456,'time_cost'=>2,'threads'=>1];}
$config=readConfig();
// Upgrade old installations without changing the key held by cron-job.org.
if(isset($config['setup_key'])||isset($config['cron_secret']))$config=updateConfig(function(array $current): array {
 foreach(['setup_key','cron_secret'] as $key)if(isset($current[$key])){
  $raw=$current[$key];
  if(is_string($raw)&&strlen($raw)>=32&&strlen($raw)<=256&&!str_starts_with($raw,'REPLACE_')&&empty($current[$key.'_hash']))$current[$key.'_hash']=hash('sha256',$raw);
  unset($current[$key]);
 }
 return $current;
});
function body(): array {
 need((int)($_SERVER['CONTENT_LENGTH']??0)<=524288,'Request too large.',413);
 $raw=file_get_contents('php://input',false,null,0,524289);need(strlen($raw)<=524288,'Request too large.',413);
 $data=json_decode($raw,true);need(is_array($data),'Invalid JSON.');return $data;
}
function database(): PDO {
 global $private; static $db=null;if($db)return $db;
 $db=new PDO('sqlite:'.$private.'/reminders.sqlite');need(chmod($private.'/reminders.sqlite',0600),'Cannot protect private database.',503);$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
 $db->exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
 $db->exec('CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY,note_id TEXT NOT NULL,reminder_id TEXT NOT NULL,title TEXT NOT NULL,config TEXT NOT NULL,signature TEXT NOT NULL,modified REAL NOT NULL,next_at INTEGER,last_sent INTEGER,active INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS reminder_tombstones (digest BLOB PRIMARY KEY) WITHOUT ROWID;
 CREATE INDEX IF NOT EXISTS reminders_by_note ON reminders(note_id);
 CREATE INDEX IF NOT EXISTS due_reminders ON reminders(active,next_at);
 CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY,subscription TEXT NOT NULL,label TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,reminder TEXT NOT NULL,device TEXT NOT NULL,payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL,created INTEGER NOT NULL,sent INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS jobs_by_reminder ON jobs(reminder);
 CREATE INDEX IF NOT EXISTS due_jobs ON jobs(sent,retry_at);
 CREATE TABLE IF NOT EXISTS rates (id TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS status (id TEXT PRIMARY KEY,value TEXT NOT NULL);');return $db;
}
function sql(string $query,array $values=[]): PDOStatement {$q=database()->prepare($query);$q->execute($values);return $q;}
// This content-free digest is the only retained trace of a deleted reminder.
// It prevents stale devices from recreating the same identity, even with a
// newer note timestamp. An explicit Undo creates a fresh reminder identity.
function erasedReminder(string $id): bool {return (bool)sql('SELECT 1 FROM reminder_tombstones WHERE digest=CAST(? AS BLOB)',[hash('sha256',$id,true)])->fetchColumn();}
function eraseReminder(string $id): void {
 sql('INSERT OR IGNORE INTO reminder_tombstones VALUES (CAST(? AS BLOB))',[hash('sha256',$id,true)]);
 sql('DELETE FROM jobs WHERE reminder=?',[$id]);
 sql('DELETE FROM reminders WHERE id=?',[$id]);
}
function deliveryLock(bool $nonBlocking=false){
 global $private;$lock=fopen($private.'/cron.lock','c');
 if(!flock($lock,LOCK_EX|($nonBlocking?LOCK_NB:0))){fclose($lock);return null;}
 return $lock;
}
function rate(string $key,int $limit,int $seconds): void {
 $key=hash('sha256',$key);$now=time();$db=database();$db->exec('BEGIN IMMEDIATE');
 try {sql('DELETE FROM rates WHERE expires<?',[$now]);sql('INSERT INTO rates VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1',[$key,$now+$seconds]);$n=(int)sql('SELECT count FROM rates WHERE id=?',[$key])->fetchColumn();$db->exec('COMMIT');}catch(Throwable $e){$db->exec('ROLLBACK');throw $e;}
 need($n<=$limit,'Too many attempts. Try again later.',429);
}
function startSession(): void {
 global $private,$config;session_name('think_owner');session_save_path($private);
 ini_set('session.use_strict_mode','1');ini_set('session.use_only_cookies','1');ini_set('session.use_trans_sid','0');ini_set('session.gc_maxlifetime','604800');
 session_set_cookie_params(['lifetime'=>604800,'path'=>rtrim(dirname($_SERVER['SCRIPT_NAME']),'/').'/','secure'=>!localTestRequest(),'httponly'=>true,'samesite'=>'Strict']);
 need(session_start(),'Cannot start private session.',503);$_SESSION['csrf']??=bin2hex(random_bytes(32));
 if(($_SESSION['expires']??0)<time()||!hash_equals(hash('sha256',$config['password_hash']??''),$_SESSION['credential_version']??'')){
  unset($_SESSION['owner'],$_SESSION['credential_version']);
 }
}
function csrf(): void {need(hash_equals($_SESSION['csrf'],$_SERVER['HTTP_X_CSRF_TOKEN']??''),'Reload and try again.',403);}
function validId($id): bool {return is_string($id)&&preg_match('/^[a-zA-Z0-9_-]{1,64}$/D',$id);}
function subscription(array $s): array {
 $endpoint=$s['endpoint']??null;
 need(is_string($endpoint)&&strlen($endpoint)<=2048&&!preg_match('/[\\\\\x00-\x20\x7f]/',$endpoint),'Unsupported push endpoint.');
 $url=parse_url($endpoint);$host=strtolower($url['host']??'');
 // Chromium also issued subscriptions on Google's staging host before moving to /preprod/wp/.
 // Keep this exact host, not a wildcard for arbitrary google.com services.
 $google=$host==='fcm.googleapis.com'||($host==='jmt17.google.com'&&str_starts_with($url['path']??'','/fcm/send/'));
 $allowed=$google||$host==='updates.push.services.mozilla.com'||str_ends_with($host,'.push.services.mozilla.com')||$host==='web.push.apple.com'||str_ends_with($host,'.push.apple.com')||str_ends_with($host,'.notify.windows.com');
 need($allowed&&strtolower($url['scheme']??'')==='https'&&($url['port']??443)===443&&!isset($url['user'])&&!isset($url['pass'])&&!isset($url['fragment']),'Unsupported push endpoint.');
 foreach(['p256dh'=>65,'auth'=>16] as $key=>$length){$v=$s['keys'][$key]??'';need(is_string($v)&&strlen($v)<128,'Invalid subscription.');$decoded=base64_decode(strtr($v,'-_','+/'),true);need($decoded!==false&&strlen($decoded)===$length,'Invalid subscription.');if($key==='p256dh')need(ord($decoded[0])===4,'Invalid subscription.');}
 return ['endpoint'=>$s['endpoint'],'contentEncoding'=>'aes128gcm','keys'=>['p256dh'=>$s['keys']['p256dh'],'auth'=>$s['keys']['auth']]];
}
function reminder(array $r): array {
 need(validId($r['id']??null),'Invalid reminder ID.');
 need(is_bool($r['done']??null)&&is_bool($r['active']??null),'Invalid reminder state.');
 need(is_string($r['text']??null)&&mb_strlen(trim($r['text']))>0&&mb_strlen($r['text'])<=240,'Invalid reminder text.');
 need(in_array($r['repeat']??'', ['none','daily','weekdays','weekly','monthly','yearly'],true),'Invalid recurrence.');
 need(is_int($r['interval']??null)&&$r['interval']>=1&&$r['interval']<=99,'Invalid interval.');
 need(is_string($r['zone']??null)&&in_array($r['zone'],timezone_identifiers_list(DateTimeZone::ALL_WITH_BC),true),'Invalid time zone.');
 foreach(['at','until','snooze'] as $field){$value=$r[$field]??'';need(is_string($value),'Invalid date.');if($value!=='')need((bool)preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/D',$value)&&($t=strtotime($value))!==false&&$t>=946684800&&$t<=4133980800,'Invalid date.');}
 need(!empty($r['at'])&&(empty($r['until'])||strtotime($r['until'])>=strtotime($r['at'])),'Invalid end date.');
 return array_intersect_key($r,array_flip(['id','text','at','zone','repeat','interval','until','done','snooze','active']));
}
