"""Fail-closed storage, transport and session checks with isolated PHP processes."""
import json, os, pathlib, subprocess, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
PHP=os.environ.get('PHP_BIN','php')
BOOT=str(ROOT/'dist/api/bootstrap.php')
with tempfile.TemporaryDirectory(prefix='think-security-') as work:
    work=pathlib.Path(work);public=work/'www';public.mkdir();private=work/'private';private.mkdir()
    marker=work/'config-executed'
    # An unsafe private path must be rejected BEFORE executing its PHP config.
    unsafe=public/'private';unsafe.mkdir()
    (unsafe/'config.php').write_text("<?php file_put_contents("+repr(str(marker))+", 'unsafe'); return [];")
    def run(directory,https=True,remote='127.0.0.1',test=False,tail='echo "accepted";'):
        env={**os.environ,'THINK_PRIVATE_DIR':str(directory),'THINK_TEST_LOCAL':'1' if test else '0'}
        code="$_SERVER['DOCUMENT_ROOT']=$argv[1];$_SERVER['SCRIPT_NAME']='/th-ink/api/index.php';$_SERVER['REMOTE_ADDR']=$argv[2];$_SERVER['HTTPS']=$argv[3];require $argv[4];"+tail
        return subprocess.check_output([PHP,'-n','-r',code,str(public),remote,'on' if https else 'off',BOOT],env=env).decode()
    assert 'outside the public document root' in run(unsafe) and not marker.exists()
    alias=work/'alias';alias.symlink_to(unsafe,target_is_directory=True)
    assert 'outside the public document root' in run(alias) and not marker.exists()
    (private/'config.php').symlink_to(unsafe/'config.php')
    assert 'symbolic link' in run(private) and not marker.exists()
    (private/'config.php').unlink()
    assert 'HTTPS required' in run(private,https=False)
    assert 'HTTPS required' in run(private,https=False,remote='192.0.2.1',test=True)
    assert run(private,https=False,test=True)=='accepted'
    params=json.loads(run(private,tail="startSession();echo json_encode([session_get_cookie_params(),ini_get('session.use_only_cookies'),ini_get('session.use_strict_mode'),ini_get('session.use_trans_sid')]);"))
    assert params[0]['secure'] and params[0]['httponly'] and params[0]['samesite']=='Strict'
    assert params[1:]==['1','1','0']
    assert all(path.stat().st_mode & 0o777==0o600 for path in private.iterdir())
print('PASS: public/symlink storage rejection before config execution, HTTPS enforcement, restricted test bypass and secure session cookies')
