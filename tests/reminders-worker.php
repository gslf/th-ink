<?php
namespace Minishlink\WebPush {
 class Subscription {static function create($s){return $s;}}
 class WebPush {
  public static bool $configurationFailure=false; public static array $responses=[]; public static int $calls=0; public static int $http=201; public static bool $transport=false; public static bool $fail=false; public static bool $expired=false;
  function __construct(...$args){if(self::$configurationFailure)throw new \RuntimeException('invalid private configuration');}
  function sendOneNotification($s,$payload){self::$calls++;if(self::$responses){$response=array_shift(self::$responses);self::$http=$response;self::$expired=in_array($response,[404,410],true);self::$fail=$response>=400&&!self::$expired;}if(($s['contentEncoding']??'')!=='aes128gcm')throw new \RuntimeException('Wrong encoding');if(self::$transport)throw new \RuntimeException('sensitive endpoint and secret must not be logged');json_decode($payload, true,512,JSON_THROW_ON_ERROR);return new class {function getResponse(){return new class {function getStatusCode(){return WebPush::$http;}};}function isSuccess(){return !WebPush::$fail&&!WebPush::$expired;}function isSubscriptionExpired(){return WebPush::$expired;}};}
 }
}
namespace {
 $temp=sys_get_temp_dir().'/think-worker-'.bin2hex(random_bytes(6));mkdir($temp,0700);
 putenv('THINK_PRIVATE_DIR='.$temp);putenv('THINK_TEST_LOCAL=1');$_SERVER['REMOTE_ADDR']='127.0.0.1';
 require __DIR__.'/../dist/api/bootstrap.php';require __DIR__.'/../dist/api/schedule.php';require __DIR__.'/../dist/api/worker.php';
 set_exception_handler(function($e){fwrite(STDERR,$e->getMessage()."\n");exit(1);});
 register_shutdown_function(function()use($temp){foreach(glob($temp.'/*') as $f)unlink($f);rmdir($temp);});
 function check($ok,$message){if(!$ok)throw new \RuntimeException($message);}
 $config=['base_url'=>'https://gslf.it/th-ink/','email'=>'owner@example.test','vapid'=>['publicKey'=>'test','privateKey'=>'test']];
 $s=['endpoint'=>'https://fcm.googleapis.com/test','keys'=>['p256dh'=>base64_encode(chr(4).str_repeat('x',64)),'auth'=>base64_encode(str_repeat('x',16))]];
 sql('INSERT INTO devices VALUES (?,?,?,?)',['device-1',json_encode($s),'Test',time()]);
 $r=['id'=>'r','text'=>'Test reminder','at'=>gmdate('Y-m-d\TH:i:s\Z',time()-60),'zone'=>'UTC','repeat'=>'daily','interval'=>1,'until'=>''];
 sql('INSERT INTO reminders VALUES (?,?,?,?,?,?,?,?,?,?)',['n:r','n','r','Test',json_encode($r),'sig',1,time()-60,null,1]);
 check(runCron()['sent']===1,'first delivery');check(runCron()['sent']===0,'idempotent next cron');check(Minishlink\WebPush\WebPush::$calls===1,'no duplicate dispatch');
 check((int)sql('SELECT next_at FROM reminders')->fetchColumn()>time(),'recurrence advanced');
 $lock=fopen($temp.'/cron.lock','c');flock($lock,LOCK_EX);check(runCron()['busy']===true,'concurrent cron excluded');flock($lock,LOCK_UN);fclose($lock);
 sql('INSERT INTO jobs(id,reminder,device,payload,retry_at,created) VALUES (?,?,?,?,?,?)',['retry','n:r','device-1','{}',time(),time()]);
 Minishlink\WebPush\WebPush::$fail=true;check(runCron()['retrying']===1,'transient failure retained');check((int)sql("SELECT attempts FROM jobs WHERE id='retry'")->fetchColumn()===1,'retry counted');
 check(runCron()['retrying']===0,'backoff respected');
 sql("UPDATE jobs SET retry_at=0 WHERE id='retry'");Minishlink\WebPush\WebPush::$fail=false;check(runCron()['sent']===1,'retry recovered');
 sql('INSERT INTO jobs(id,reminder,device,payload,retry_at,created) VALUES (?,?,?,?,?,?)',['expired','n:r','device-1','{}',time(),time()]);
 Minishlink\WebPush\WebPush::$expired=true;$expiredResult=runCron();check($expiredResult['ok']&&$expiredResult['expired']===1,'expired subscriptions do not produce a false scheduler failure');check((int)sql('SELECT COUNT(*) FROM devices')->fetchColumn()===0,'expired subscription removed');
 // A delivered alert can coexist with cleanup, or with a genuine provider failure.
 foreach(['mixed-a','mixed-b'] as $id)sql('INSERT INTO devices VALUES (?,?,?,?)',[$id,json_encode($s),'Test',time()]);
 foreach([410,503] as $otherStatus){
  foreach(['mixed-a','mixed-b'] as $id)sql('INSERT INTO jobs(id,reminder,device,payload,retry_at,created) VALUES (?,?,?,?,?,?)',[$id,'test',$id,'{}',time(),time()]);
  Minishlink\WebPush\WebPush::$responses=[201,$otherStatus];$mixed=runCron();
  check($mixed['sent']===1,'one device received its alert');
  check($mixed['ok']&&$mixed['deliveryOk']===($otherStatus===410),'scheduler completion is separate from handled delivery failures');
  $savedSummary=json_decode(sql("SELECT value FROM status WHERE id='delivery'")->fetchColumn(),true);
  check($savedSummary['sent']===1&&($savedSummary['outcomes'][$otherStatus===410?'expired':'provider']??0)===1,'mixed delivery summary remains explicit');
  check($mixed['expired']===($otherStatus===410?1:0)&&$mixed['retrying']===($otherStatus===503?1:0),'mixed outcomes counted separately');
  sql("DELETE FROM jobs WHERE id IN ('mixed-a','mixed-b')");
  sql('INSERT OR IGNORE INTO devices VALUES (?,?,?,?)',['mixed-b',json_encode($s),'Test',time()]);
 }
 $activity=sql("SELECT value FROM status WHERE id='delivery'")->fetchColumn();runCron();check(sql("SELECT value FROM status WHERE id='delivery'")->fetchColumn()===$activity,'idle cron does not hide the previous delivery outcome');
 sql("DELETE FROM devices WHERE id IN ('mixed-a','mixed-b')");
 // Diagnostics must describe provider failures, never persist raw exception text.
 sql('INSERT INTO devices VALUES (?,?,?,?)',['device-2',json_encode($s),'Test',time()]);
 Minishlink\WebPush\WebPush::$expired=false;Minishlink\WebPush\WebPush::$fail=true;Minishlink\WebPush\WebPush::$http=403;
 sql('INSERT INTO jobs(id,reminder,device,payload,retry_at,created) VALUES (?,?,?,?,?,?)',['target','test','device-2','{}',time(),time()]);
 sql('INSERT INTO jobs(id,reminder,device,payload,retry_at,created) VALUES (?,?,?,?,?,?)',['unrelated','test','device-2','{}',time(),time()]);
 $calls=Minishlink\WebPush\WebPush::$calls;runCron(false,'target');
 check(Minishlink\WebPush\WebPush::$calls===$calls+1,'test processes only its own job');
 check((int)sql("SELECT attempts FROM jobs WHERE id='unrelated'")->fetchColumn()===0,'unrelated test remains queued');
 $diagnostic=json_decode(sql("SELECT value FROM status WHERE id='push'")->fetchColumn(),true);
 check($diagnostic['state']==='authorization'&&$diagnostic['http']===403,'provider failure is classified');
 Minishlink\WebPush\WebPush::$transport=true;sql("UPDATE jobs SET retry_at=0 WHERE id='target'");runCron(false,'target');
 check(!str_contains(sql("SELECT value FROM status WHERE id='push'")->fetchColumn(),'sensitive'),'no exception secrets in diagnostics');
 Minishlink\WebPush\WebPush::$configurationFailure=true;$threw=false;try{runCron();}catch(\RuntimeException){$threw=true;}check($threw,'fatal configuration failure propagates to the HTTP 503 handler');
 echo "PASS: mocked delivery, durable outbox, idempotence, concurrent cron lock, retry/backoff, expired subscriptions\n";
}
