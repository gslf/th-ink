<?php
// Persist only a bounded outcome code, never provider bodies, endpoints or keys.
function recordPushStatus(string $state,?int $http=null): array {
 $value=['state'=>$state,'http'=>$http,'at'=>time()];sql("INSERT INTO status VALUES ('push',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",[json_encode($value)]);return $value;
}
function runCron(bool $scheduled=true,?string $onlyJob=null): array {
 global $private,$config;
 $lock=deliveryLock(true);if(!$lock)return ['ok'=>true,'busy'=>true];
 try{
 $start=microtime(true);$now=time();$db=database();
 // Persist occurrence jobs and advance recurrence atomically before delivery.
 $db->exec('BEGIN IMMEDIATE');
 try{
  $devices=sql('SELECT id FROM devices')->fetchAll(PDO::FETCH_COLUMN);
  if($devices&&$onlyJob===null)foreach(sql('SELECT * FROM reminders WHERE active=1 AND next_at<=? ORDER BY next_at LIMIT 100',[$now])->fetchAll(PDO::FETCH_ASSOC) as $row){
   $r=json_decode($row['config'],true);$at=(int)$row['next_at'];
   $payload=json_encode(['title'=>'th.ink · '.($row['title']?:'Reminder'),'body'=>$r['text'],'url'=>$config['base_url'].'?note='.rawurlencode($row['note_id']).'&reminder='.rawurlencode($row['reminder_id']),'tag'=>'think-'.$row['id']]);
   foreach($devices as $device)sql('INSERT OR IGNORE INTO jobs(id,reminder,device,payload,retry_at,created) VALUES (?,?,?,?,?,?)',[hash('sha256',$row['id'].':'.$at.':'.$device),$row['id'],$device,$payload,$now,$now]);
   // Coalesce missed repetitions into one alert, then resume the original schedule.
   $next=nextOccurrence($r,max($at,$now));sql('UPDATE reminders SET next_at=? WHERE id=?',[$next,$row['id']]);
  }
  sql("DELETE FROM jobs WHERE reminder!='test' AND NOT EXISTS (SELECT 1 FROM reminders WHERE reminders.id=jobs.reminder)");
  sql('DELETE FROM jobs WHERE created<?',[$now-604800]);$db->exec('COMMIT');
 }catch(Throwable $e){$db->exec('ROLLBACK');throw $e;}
 try{require_once __DIR__.'/vendor/autoload.php';
 $push=new Minishlink\WebPush\WebPush(['VAPID'=>['subject'=>'mailto:'.$config['email'],'publicKey'=>$config['vapid']['publicKey'],'privateKey'=>$config['vapid']['privateKey']]],['TTL'=>86400,'urgency'=>'high'],5,['connect_timeout'=>3,'allow_redirects'=>false]);
 }catch(Throwable $e){recordPushStatus('configuration');throw $e;}
 $sent=0;$failed=0;$expired=0;$lastAttempt=null;$outcomes=[];
 foreach(sql('SELECT jobs.*,devices.subscription FROM jobs JOIN devices ON devices.id=jobs.device WHERE sent=0 AND attempts<5 AND retry_at<=? AND (? IS NULL OR jobs.id=?) ORDER BY retry_at LIMIT 30',[$now,$onlyJob,$onlyJob])->fetchAll(PDO::FETCH_ASSOC) as $job){
  if(microtime(true)-$start>20)break;
  if(!sql('SELECT id FROM jobs WHERE id=? AND sent=0',[$job['id']])->fetchColumn())continue;
  $state='transport';$http=null;
  try{$s=subscription(json_decode($job['subscription'],true));$result=$push->sendOneNotification(Minishlink\WebPush\Subscription::create($s),$job['payload']);
   $http=$result->getResponse()?->getStatusCode();
   if($result->isSuccess()){sql('UPDATE jobs SET sent=1 WHERE id=?',[$job['id']]);sql('UPDATE reminders SET last_sent=? WHERE id=?',[$now,$job['reminder']]);$sent++;$outcomes['accepted']=($outcomes['accepted']??0)+1;$lastAttempt=recordPushStatus('accepted',$http);continue;}
   if($result->isSubscriptionExpired()){sql('DELETE FROM devices WHERE id=?',[$job['device']]);sql('DELETE FROM jobs WHERE device=?',[$job['device']]);$expired++;$outcomes['expired']=($outcomes['expired']??0)+1;$lastAttempt=recordPushStatus('expired',$http);continue;}
   $state=match(true){in_array($http,[401,403],true)=>'authorization',$http===413=>'payload',$http===429=>'rate-limit',$http!==null&&$http>=500=>'provider',$http===null=>'transport',default=>'rejected'};
  }catch(Throwable $e){$state=$e instanceof \GuzzleHttp\Exception\TransferException?'transport':'encryption';}
  $outcomes[$state]=($outcomes[$state]??0)+1;$lastAttempt=recordPushStatus($state,$http);
  $attempt=(int)$job['attempts']+1;sql('UPDATE jobs SET attempts=?,retry_at=? WHERE id=?',[$attempt,$now+min(3600,60*(2**$attempt)),$job['id']]);$failed++;
 }
 $summary=['at'=>$now,'sent'=>$sent,'retrying'=>$failed,'expired'=>$expired,'outcomes'=>$outcomes,'pending'=>(int)sql('SELECT COUNT(*) FROM jobs WHERE sent=0 AND attempts<5')->fetchColumn(),'failed'=>(int)sql('SELECT COUNT(*) FROM jobs WHERE sent=0 AND attempts>=5')->fetchColumn()];
 if($scheduled){
  sql("INSERT INTO status VALUES ('cron',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",[(string)$now]);
  // Keep the last non-empty delivery batch, so the next idle minute cannot hide its result.
  if($outcomes)sql("INSERT INTO status VALUES ('delivery',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",[json_encode($summary)]);
 }
 // HTTP success describes a completed scheduler run. Handled provider failures
 // stay explicit in deliveryOk/outcomes and durable retries; fatal errors still throw 503.
 return ['ok'=>true,'deliveryOk'=>$failed===0,'lastAttempt'=>$lastAttempt,'devices'=>(int)sql('SELECT COUNT(*) FROM devices')->fetchColumn(),...$summary];

 }finally{flock($lock,LOCK_UN);fclose($lock);}
}
