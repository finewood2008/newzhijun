"""Install user-level services; --system upgrades them after administrator authentication."""
import os,plistlib,subprocess,sys,pwd,time
from pathlib import Path
system='--system' in sys.argv
if system and os.geteuid()!=0:raise SystemExit('请使用 sudo 运行 --system 安装。')
uid=int(os.environ.get('SUDO_UID',os.getuid()));account=pwd.getpwuid(uid);home=Path(account.pw_dir)
service=home/'Library/Application Support/ZhijunServer'
if not (service/'identity.json').exists():raise SystemExit('先运行 prepare-mac-service.mjs')
jobs=[('ai.centaur.zhijun.server',['/opt/homebrew/bin/node',str(service/'server/desktop-service.mjs')],str(service),str(service/'logs/server.log')),('ai.centaur.zhijun.wanx',[str(home/'.octop/portable/runtime/bin/python3'),str(home/'.octop/portable/launch.py'),'run','--host','0.0.0.0','--port','8088'],str(home/'.octop'),str(service/'logs/wanx.log'))]
folder=Path('/Library/LaunchDaemons') if system else home/'Library/LaunchAgents';folder.mkdir(parents=True,exist_ok=True)
for label,args,cwd,log in jobs:
 domain='system' if system else f'gui/{uid}'
 if system:subprocess.run(['launchctl','bootout',f'gui/{uid}/{label}'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run(['launchctl','bootout',f'{domain}/{label}'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 # Stop only the exact already-running service being replaced, not arbitrary port owners.
 port='8088' if label.endswith('.wanx') else '28733'
 found=subprocess.run(['lsof','-t','-iTCP:'+port,'-sTCP:LISTEN'],capture_output=True,text=True)
 for raw in set(found.stdout.split()):
  command=subprocess.check_output(['ps','-p',raw,'-o','command='],text=True)
  expected='portable/launch.py run' if port=='8088' else 'server/desktop-service.mjs'
  if expected not in command:raise SystemExit('端口被其他进程占用，未停止它。')
  os.kill(int(raw),15)
 for _ in range(100):
  if subprocess.run(['lsof','-t','-iTCP:'+port,'-sTCP:LISTEN'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0:break
  time.sleep(.1)
 else:raise SystemExit('旧服务仍在停止，未启动重复进程。')
 job={'Label':label,'ProgramArguments':args,'WorkingDirectory':cwd,'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':10,'StandardOutPath':log,'StandardErrorPath':log,'EnvironmentVariables':{'HOME':str(home),'PATH':'/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'}}
 if system:job.update(UserName=account.pw_name,GroupName=pwd.getpwuid(uid).pw_name if account.pw_name=='root' else 'staff')
 file=folder/(label+'.plist');file.write_bytes(plistlib.dumps(job));file.chmod(0o644)
 subprocess.run(['launchctl','bootstrap',domain,str(file)],check=True)
 if system:
  userfile=home/'Library/LaunchAgents'/(label+'.plist')
  if userfile.exists():userfile.rename(userfile.with_suffix('.plist.disabled'))
 print(label+': '+('系统启动时运行' if system else '登录 Mac 后自动运行'))
