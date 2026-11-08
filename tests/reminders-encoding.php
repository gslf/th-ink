<?php
// Real WebPush encryption and request construction, with an in-memory HTTP transport.
$temp=sys_get_temp_dir().'/think-encoding-'.bin2hex(random_bytes(6));mkdir($temp,0700);
putenv('THINK_PRIVATE_DIR='.$temp);putenv('THINK_TEST_LOCAL=1');$_SERVER['REMOTE_ADDR']='127.0.0.1';
require __DIR__.'/../dist/api/bootstrap.php';require __DIR__.'/../dist/api/vendor/autoload.php';
set_exception_handler(function($e){fwrite(STDERR,$e->getMessage()."\n");exit(1);});
register_shutdown_function(function()use($temp){foreach(glob($temp.'/*') as $f)unlink($f);rmdir($temp);});
$keys=Minishlink\WebPush\VAPID::createVapidKeys();$device=Minishlink\WebPush\VAPID::createVapidKeys();
$input=['endpoint'=>'https://fcm.googleapis.com/isolated-test','keys'=>['p256dh'=>$device['publicKey'],'auth'=>rtrim(strtr(base64_encode(random_bytes(16)),'+/','-_'),'=')]];
foreach([null,'aesgcm','aes128gcm'] as $legacy){
 $input['contentEncoding']=$legacy;$s=subscription($input);
 if($s['contentEncoding']!=='aes128gcm')throw new RuntimeException('Legacy subscription was not upgraded');
 $history=[];$handler=GuzzleHttp\HandlerStack::create(new GuzzleHttp\Handler\MockHandler([new GuzzleHttp\Psr7\Response(201)]));$handler->push(GuzzleHttp\Middleware::history($history));
 $push=new Minishlink\WebPush\WebPush(['VAPID'=>['subject'=>'mailto:owner@example.test',...$keys]],[],5,['handler'=>$handler]);
 $report=$push->sendOneNotification(Minishlink\WebPush\Subscription::create($s),json_encode(['title'=>'Test','body'=>'No real push is sent.']));
 $request=$history[0]['request'];
 if(!$report->isSuccess()||$request->getHeaderLine('Content-Encoding')!=='aes128gcm'||!str_starts_with($request->getHeaderLine('Authorization'),'vapid ')||strlen((string)$request->getBody())<100)throw new RuntimeException('Invalid modern Web Push request');
}
echo "PASS: real encryption/VAPID headers use aes128gcm for new and legacy subscriptions; no network transport\n";
