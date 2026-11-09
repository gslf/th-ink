<?php
require __DIR__.'/bootstrap.php';
require __DIR__.'/schedule.php';
need(!empty($config['password_hash']),'Reminders server is not configured.',503);
$action=$_GET['action']??'status';$method=$_SERVER['REQUEST_METHOD'];
need($method===($action==='status'||$action==='list'?'GET':'POST'),'Method not allowed.',405);
if($action==='cron'){
 need(tokenMatches($config['cron_secret_hash']??null,$_SERVER['HTTP_X_CRON_SECRET']??''),'Unauthorized.',401);
 require __DIR__.'/worker.php';$result=runCron();out($result,$result['ok']?200:503);
}
startSession();
if($action==='status')out(['authenticated'=>!empty($_SESSION['owner']),'csrf'=>$_SESSION['csrf'],'publicKey'=>!empty($_SESSION['owner'])?$config['vapid']['publicKey']:null]);
csrf();
if($action==='login'){
 rate('login:'.($_SERVER['REMOTE_ADDR']??''),12,900);$data=body();
 need(is_string($data['email']??null)&&is_string($data['password']??null)&&strlen($data['password'])<=72&&!str_contains($data['password'],"\0"),'Invalid credentials.',401);
 $config=updateConfig(function(array $current)use($data): array {
  $valid=password_verify($data['password'],$current['password_hash']??'');
  need($valid&&hash_equals($current['email']??'',trim($data['email'])),'Invalid credentials.',401);
  if(password_needs_rehash($current['password_hash'],passwordAlgorithm(),passwordOptions()))$current['password_hash']=password_hash($data['password'],passwordAlgorithm(),passwordOptions());
  return $current;
 });
 unset($data['password']);
 need(session_regenerate_id(true),'Cannot renew private session.',503);$_SESSION['owner']=true;$_SESSION['credential_version']=hash('sha256',$config['password_hash']);$_SESSION['expires']=time()+604800;$_SESSION['csrf']=bin2hex(random_bytes(32));out(['authenticated'=>true,'csrf'=>$_SESSION['csrf'],'publicKey'=>$config['vapid']['publicKey']]);
}
need(!empty($_SESSION['owner']),'Sign in to your private account.',401);
if($action==='logout') {$_SESSION=[];session_destroy();setcookie('think_owner','',['expires'=>1,'path'=>rtrim(dirname($_SERVER['SCRIPT_NAME']),'/').'/','secure'=>true,'httponly'=>true,'samesite'=>'Strict']);out(['ok'=>true]);}
session_write_close();
if($action==='list'){
 $items=sql('SELECT id,note_id,reminder_id,title,config,next_at,last_sent,active FROM reminders')->fetchAll(PDO::FETCH_ASSOC);
 $devices=sql('SELECT id,label,created FROM devices ORDER BY created DESC')->fetchAll(PDO::FETCH_ASSOC);
 $last=sql("SELECT value FROM status WHERE id='cron'")->fetchColumn();
 $failed=(int)sql('SELECT COUNT(*) FROM jobs WHERE sent=0 AND attempts>=5')->fetchColumn();
 out(['items'=>$items,'devices'=>$devices,'lastCron'=>$last?(int)$last:null,'lastDelivery'=>json_decode(sql("SELECT value FROM status WHERE id='delivery'")->fetchColumn()?:'null',true),'pending'=>(int)sql('SELECT COUNT(*) FROM jobs WHERE sent=0 AND attempts<5')->fetchColumn(),'failed'=>$failed,'pushStatus'=>json_decode(sql("SELECT value FROM status WHERE id='push'")->fetchColumn()?:'null',true)]);
}
if($action==='deleted'){
 $data=body();$ids=$data['ids']??null;need(is_array($ids)&&count($ids)<=2000,'Maximum 2000 IDs per request.');
 $removed=[];foreach($ids as $id){need(is_string($id)&&strlen($id)<=129,'Invalid reminder ID.');if(erasedReminder($id))$removed[]=$id;}
 out(['removed'=>$removed]);
}
if($action==='delete'){
 $data=body();$ids=$data['ids']??null;need(is_array($ids)&&count($ids)<=100,'Maximum 100 deletions per request.');
 foreach($ids as $id)need(is_string($id)&&(bool)preg_match('/^[a-zA-Z0-9_-]{1,64}:[a-zA-Z0-9_-]{1,64}$/D',$id),'Invalid reminder ID.');
 $lock=deliveryLock();$db=database();$db->exec('BEGIN IMMEDIATE');
 try{foreach($ids as $id)eraseReminder($id);$db->exec('COMMIT');}catch(Throwable $e){$db->exec('ROLLBACK');throw $e;}
 out(['ok'=>true]);
}
if($action==='sync'){
 $data=body();$notes=$data['notes']??null;need(is_array($notes)&&count($notes)<=50,'Maximum 50 notes per request.');
 // Validate the entire batch before entering a transaction.
 foreach($notes as &$n){need(validId($n['id']??null)&&is_numeric($n['updated']??null)&&$n['updated']>0&&$n['updated']<=(microtime(true)*1000+300000),'Invalid note version. Check your device clock.');need(is_string($n['title']??null)&&mb_strlen($n['title'])<=200&&is_array($n['reminders']??null)&&count($n['reminders'])<=32,'Invalid note.');$ids=[];foreach($n['reminders'] as &$r){$r=reminder($r);need(!isset($ids[$r['id']]),'Duplicate reminder.');$ids[$r['id']]=true;}unset($r);}unset($n);
 $lock=deliveryLock();$db=database();$db->exec('BEGIN IMMEDIATE');$conflicts=[];$removed=[];
 try{foreach($notes as $n){
   $present=[];
   foreach($n['reminders'] as $r){$id=$n['id'].':'.$r['id'];$present[]=$id;if(erasedReminder($id)){$removed[]=$id;continue;}$old=sql('SELECT * FROM reminders WHERE id=?',[$id])->fetch(PDO::FETCH_ASSOC);
    if($old && (float)$old['modified']>(float)$n['updated']){$conflicts[]=$id;continue;}
    $active=!empty($r['active'])&&empty($r['done']);$r['active']=$active;
    $schedule=$r;unset($schedule['text']);$signature=hash('sha256',json_encode($schedule));$changed=!$old||$old['signature']!==$signature;
    $next=$changed?($active?strtotime($r['snooze']?:$r['at']):null):$old['next_at'];
    if($changed)sql('DELETE FROM jobs WHERE reminder=? AND sent=0',[$id]);
    elseif($old && ($old['title']!==$n['title'] || json_decode($old['config'],true)['text']!==$r['text'])){
     $payload=json_encode(['title'=>'th.ink · '.($n['title']?:'Reminder'),'body'=>$r['text'],'url'=>$config['base_url'].'?note='.rawurlencode($n['id']).'&reminder='.rawurlencode($r['id']),'tag'=>'think-'.$id]);
     sql('UPDATE jobs SET payload=? WHERE reminder=? AND sent=0',[$payload,$id]);
    }
    sql('INSERT INTO reminders VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,config=excluded.config,signature=excluded.signature,modified=excluded.modified,next_at=excluded.next_at,active=excluded.active',[$id,$n['id'],$r['id'],$n['title'],json_encode($r),$signature,$n['updated'],$next,null,(int)$active]);
   }
   // Missing metadata in a newer revision cancels only that note's reminders.
   foreach(sql('SELECT id,modified FROM reminders WHERE note_id=?',[$n['id']])->fetchAll(PDO::FETCH_ASSOC) as $old)if(!in_array($old['id'],$present,true)&&(float)$old['modified']<=(float)$n['updated']){eraseReminder($old['id']);}
  }
  if((int)sql('SELECT COUNT(*) FROM reminders WHERE active=1')->fetchColumn()>2000)throw new RuntimeException('limit');
  $db->exec('COMMIT');
 }catch(Throwable $e){$db->exec('ROLLBACK');out(['error'=>'Could not save reminders. Maximum 2000 active reminders.'],409);}
 out(['ok'=>true,'conflicts'=>$conflicts,'removed'=>$removed]);
}
if($action==='subscribe'){
 $data=body();$s=subscription($data['subscription']??[]);$id=hash('sha256',$s['endpoint']);database()->exec('BEGIN IMMEDIATE');
 need(sql('SELECT id FROM devices WHERE id=?',[$id])->fetchColumn()||(int)sql('SELECT COUNT(*) FROM devices')->fetchColumn()<8,'Maximum 8 devices. Remove an old device first.',409);
 $label=mb_substr((string)($data['label']??'Browser'),0,80);sql('INSERT INTO devices VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,label=excluded.label',[$id,json_encode($s),$label,time()]);database()->exec('COMMIT');out(['id'=>$id]);
}
if($action==='unsubscribe'){$data=body();sql('DELETE FROM devices WHERE id=?',[(string)($data['id']??'')]);sql('DELETE FROM jobs WHERE device=?',[(string)($data['id']??'')]);out(['ok'=>true]);}
if($action==='test'){
 rate('owner-test',5,300);$data=body();$device=sql('SELECT id FROM devices WHERE id=?',[(string)($data['id']??'')])->fetchColumn();need((bool)$device,'Enable this device first.');
 $job=bin2hex(random_bytes(16));
 sql('INSERT INTO jobs(id,reminder,device,payload,retry_at,created) VALUES (?,?,?,?,?,?)',[$job,'test',$device,json_encode(['title'=>'th.ink','body'=>'Notifications are working. / Le notifiche funzionano.','url'=>$config['base_url'],'tag'=>'think-test-'.$job]),time(),time()]);
 require __DIR__.'/worker.php';$result=runCron(false,$job);
 $saved=sql('SELECT sent,attempts FROM jobs WHERE id=?',[$job])->fetch(PDO::FETCH_ASSOC);
 $state=$saved?($saved['sent']?'accepted':($saved['attempts']?'retrying':'queued')):'expired';
 out(['status'=>$state,'sent'=>$state==='accepted'?1:0,'retrying'=>$state==='retrying'?1:0,'busy'=>!empty($result['busy']),'pushStatus'=>$state==='queued'?null:($result['lastAttempt']??null)]);
}
out(['error'=>'Unknown action.'],404);
