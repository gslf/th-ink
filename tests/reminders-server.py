"""Isolated PHP integration test. No production data or real pushes are used."""
import fcntl, os, json, base64, re, hashlib, stat, time, tempfile, subprocess, urllib.request, urllib.error, urllib.parse, http.cookiejar, pathlib, socket, secrets, sqlite3
ROOT=pathlib.Path(__file__).resolve().parents[1]
PHP=os.environ.get('PHP_BIN','php')
MODULES=os.environ.get('PHP_MODULES','')
args=[PHP]
if MODULES:
    args+=['-n']
    for module in ['curl','pdo_sqlite','iconv']:
        args+=['-d','extension='+str(pathlib.Path(MODULES)/(module+'.so'))]
base='http://127.0.0.1:4192'
with tempfile.TemporaryDirectory(prefix='think-reminder-test-') as private:
    key=secrets.token_hex(24);email='owner@example.test';password=secrets.token_urlsafe(24)
    pathlib.Path(private,'config.php').write_text("<?php return ['setup_key'=>'"+key+"'];")
    env={**os.environ,'THINK_PRIVATE_DIR':private,'THINK_TEST_LOCAL':'1'}
    log=open(pathlib.Path(private,'server.log'),'w+')
    server=subprocess.Popen(args+['-S','127.0.0.1:4192','-t',str(ROOT/'dist')],env=env,stdout=log,stderr=log)
    try:
        for _ in range(50):
            try:
                with socket.create_connection(('127.0.0.1',4192),timeout=.1):break
            except OSError:time.sleep(.1)
        cookies=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
        def request(action,data=None,headers=None,expected=200):
            req=urllib.request.Request(base+'/api/index.php?action='+action,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json',**(headers or {})})
            try: response=client.open(req)
            except urllib.error.HTTPError as e:response=e
            body=response.read().decode();assert response.status==expected,(action,response.status,body)
            return json.loads(body)
        def read_config():
            return json.loads(subprocess.check_output(args+['-r',"echo json_encode(require $argv[1]);",private+'/config.php']))
        def write_config(value):
            subprocess.run(args+['-r',"file_put_contents($argv[1], '<?php return '.var_export(json_decode(stream_get_contents(STDIN),true),true).';');",private+'/config.php'],input=json.dumps(value).encode(),check=True)
        # Reading setup migrates the legacy raw setup key before accepting credentials.
        client.open(base+'/api/setup.php').close()
        migrated=read_config()
        assert 'setup_key' not in migrated and migrated['setup_key_hash']==hashlib.sha256(key.encode()).hexdigest()
        req=urllib.request.Request(base+'/api/setup.php',data=urllib.parse.urlencode({'key':key,'email':email,'password':password,'base':'https://gslf.it/th-ink/'}).encode())
        output=client.open(req).read().decode();assert 'Your private account is ready' in output
        config=json.loads(subprocess.check_output(args+['-r',"echo json_encode(require $argv[1]);",private+'/config.php']))
        cron_key=re.search(r'Header value:</p><code>([a-f0-9]{64})</code>',output).group(1)
        assert not {'setup_key','setup_key_hash','cron_secret'} & config.keys()
        assert config['password_hash']!=password and config['cron_secret_hash']==hashlib.sha256(cron_key.encode()).hexdigest()
        # Exercise legacy bcrypt upgrade and raw cron migration without rotating the key.
        legacy={**config,'cron_secret':cron_key};del legacy['cron_secret_hash']
        legacy['password_hash']=subprocess.check_output(args+['-r',"echo password_hash(stream_get_contents(STDIN),PASSWORD_BCRYPT,['cost'=>10]);"],input=password.encode()).decode()
        write_config(legacy)

        request('status');request('list',headers={'X-CSRF-Token':'wrong'},expected=403)
        token=request('status')['csrf'];headers={'X-CSRF-Token':token}
        request('login',{'email':email,'password':'wrong-password'},headers,401)
        session=request('login',{'email':email,'password':password},headers);assert session['authenticated'];headers={'X-CSRF-Token':session['csrf']}
        request('list',headers=headers)
        upgraded=read_config()
        assert 'cron_secret' not in upgraded and upgraded['cron_secret_hash']==config['cron_secret_hash']
        assert upgraded['password_hash']!=legacy['password_hash']
        assert stat.S_IMODE(pathlib.Path(private).stat().st_mode)==0o700
        assert all(stat.S_IMODE(path.stat().st_mode)==0o600 for path in pathlib.Path(private).iterdir() if path.name!='server.log')
        now=int(time.time()*1000)
        r={'id':'r1','text':'Private reminder','at':'2027-01-15T09:00:00.000Z','zone':'Europe/Rome','repeat':'monthly','interval':1,'until':'','done':False,'snooze':'','active':True}
        n={'id':'n1','title':'Test note','updated':now,'reminders':[r]}
        request('sync',{'notes':[n]},headers)
        request('sync',{'notes':[n]},headers)
        assert len(request('list',headers=headers)['items'])==1
        old={**n,'updated':now-1,'reminders':[{**r,'text':'Stale'}]};assert request('sync',{'notes':[old]},headers)['conflicts']==['n1:r1']
        assert json.loads(request('list',headers=headers)['items'][0]['config'])['text']=='Private reminder'
        request('subscribe',{'subscription':{'endpoint':'https://127.0.0.1/private','keys':{}}},headers,400)
        # Accept official Chromium staging subscriptions without allowing arbitrary Google URLs.
        keys={'p256dh':config['vapid']['publicKey'],'auth':base64.urlsafe_b64encode(b'x'*16).decode().rstrip('=')}
        for endpoint in ['https://jmt17.google.com/fcm/send/test', 'https://fcm.googleapis.com/wp/test', 'https://fcm.googleapis.com/preprod/wp/test', 'https://updates.push.services.mozilla.com/wpush/test', 'https://web.push.apple.com/test', 'https://wns2-par02p.notify.windows.com/test']:
            result=request('subscribe',{'subscription':{'endpoint':endpoint,'keys':keys}},headers)
            request('unsubscribe',{'id':result['id']},headers)
        for endpoint in [None, {}, 12, 'http://jmt17.google.com/fcm/send/test', 'https://jmt17.google.com:444/fcm/send/test', 'https://jmt17.google.com.evil.test/fcm/send/test', 'https://eviljmt17.google.com/fcm/send/test', 'https://jmt17.google.com/log', 'https://other.google.com/fcm/send/test', 'https://jmt17.google.com@127.0.0.1/fcm/send/test', 'https://user@jmt17.google.com/fcm/send/test', 'https://jmt17.google.com/fcm/send/test#fragment', 'https://fcm.googleapis.com/with space', 'https://fcm.googleapis.com/line\nfeed']:
            request('subscribe',{'subscription':{'endpoint':endpoint,'keys':keys}},headers,400)
        device_ids=[]
        for i in range(8):
            sub={'endpoint':'https://fcm.googleapis.com/test-'+str(i),'keys':{'p256dh':config['vapid']['publicKey'],'auth':base64.urlsafe_b64encode(b'x'*16).decode().rstrip('=')}}
            device_ids.append(request('subscribe',{'subscription':sub,'label':'Test'},headers)['id'])
        sub['endpoint']='https://fcm.googleapis.com/test-limit'
        request('subscribe',{'subscription':sub},headers,409)
        assert len(request('list',headers=headers)['devices'])==8
        # A busy delivery lock must queue this test without claiming delivery or contacting a provider.
        with open(pathlib.Path(private,'cron.lock'),'a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            queued=request('test',{'id':device_ids[0]},headers)
            assert queued['status']=='queued' and queued['sent']==0 and queued['busy'] and queued['pushStatus'] is None
            fcntl.flock(lock,fcntl.LOCK_UN)
        for device in device_ids:request('unsubscribe',{'id':device},headers)
        request('cron',{}, {'X-Cron-Secret':'bad'},401)
        assert request('cron',{}, {'X-Cron-Secret':cron_key})['ok']
        assert request('list',headers=headers)['lastCron']
        request('sync',{'notes':[{**n,'updated':now+1,'reminders':[]}]},headers)
        assert request('list',headers=headers)['items']==[]
        # A stale device cannot resurrect a deleted ID, even after editing its note.
        newer={**n,'updated':now+2}
        assert request('sync',{'notes':[newer]},headers)['removed']==['n1:r1']
        assert request('deleted',{'ids':['n1:r1','n1:other']},headers)['removed']==['n1:r1']
        assert request('list',headers=headers)['items']==[]
        with sqlite3.connect(private+'/reminders.sqlite') as db:
            assert db.execute('SELECT length(digest),typeof(digest) FROM reminder_tombstones').fetchone()==(32,'blob')
        # Explicit deletion wins against any outstanding schedule revision and removes all payloads.
        second={**n,'id':'n2'}
        request('sync',{'notes':[second]},headers)
        with sqlite3.connect(private+'/reminders.sqlite') as db:
            for sent in [0,1]:db.execute('INSERT INTO jobs(id,reminder,device,payload,retry_at,created,sent) VALUES (?,?,?,?,?,?,?)',('queued-'+str(sent),'n2:r1','old-device','private payload',0,int(time.time()),sent))
        request('delete',{'ids':['n2:r1']},headers)
        request('delete',{'ids':['n2:r1']},headers)
        with sqlite3.connect(private+'/reminders.sqlite') as db:
            assert db.execute("SELECT COUNT(*) FROM reminders WHERE note_id='n2'").fetchone()[0]==0
            assert db.execute("SELECT COUNT(*) FROM jobs WHERE reminder='n2:r1'").fetchone()[0]==0
        assert b'private payload' not in pathlib.Path(private,'reminders.sqlite').read_bytes()
        request('logout',{},headers);request('list',headers={'X-CSRF-Token':request('status')['csrf']},expected=401)
        try:client.open(base+'/api/setup.php');raise AssertionError('Setup reopened')
        except urllib.error.HTTPError as e:assert e.code==410
        print('PASS: one-time setup, authentication, CSRF, sync, stale updates, cancellation, endpoint validation, cron authentication and logout',flush=True)
        ui_env={**os.environ,'REMINDER_TEST_URL':base,'REMINDER_TEST_EMAIL':email,'REMINDER_TEST_PASSWORD':password}
        with sqlite3.connect(private+'/reminders.sqlite') as db:
            db.execute("INSERT INTO status VALUES ('delivery',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",(json.dumps({'at':int(time.time()),'sent':1,'retrying':1,'expired':1,'outcomes':{'accepted':1,'authorization':1,'expired':1},'pending':1,'failed':0}),))
        subprocess.run(['node','tests/reminders-browser.mjs'],cwd=ROOT,env=ui_env,check=True)
        # Password reset preserves VAPID/cron and invalidates already authenticated sessions.
        token=request('status')['csrf']
        request('login',{'email':email,'password':password},{'X-CSRF-Token':token})
        reset_key=secrets.token_hex(32);new_password=secrets.token_urlsafe(24)
        current=read_config();del current['password_hash'];current['setup_key_hash']=hashlib.sha256(reset_key.encode()).hexdigest();write_config(current)
        req=urllib.request.Request(base+'/api/setup.php',data=urllib.parse.urlencode({'key':reset_key,'email':email,'password':new_password,'base':'https://gslf.it/th-ink/'}).encode())
        assert 'existing cron key is unchanged' in client.open(req).read().decode()
        status=request('status');assert not status['authenticated']
        request('list',headers={'X-CSRF-Token':status['csrf']},expected=401)
        request('login',{'email':email,'password':password},{'X-CSRF-Token':status['csrf']},401)
        assert request('login',{'email':email,'password':new_password},{'X-CSRF-Token':status['csrf']})['authenticated']
        reset=read_config();assert reset['vapid']==config['vapid'] and reset['cron_secret_hash']==config['cron_secret_hash']
        assert request('cron',{}, {'X-Cron-Secret':cron_key})['ok']
        # No passwords or reusable setup/cron keys in the app's private files or PHP log.
        for path in pathlib.Path(private).iterdir():
            if path.is_file():
                content=path.read_bytes()
                assert all(secret.encode() not in content for secret in [password,new_password,key,reset_key,cron_key]),path.name
        print('PASS: hash-only credentials, automatic migration, file permissions, password reset session revocation and no credential logging',flush=True)

    finally:
        server.terminate();server.wait(timeout=10)
