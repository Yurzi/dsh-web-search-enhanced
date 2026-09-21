/** Isolated real-browser checks; never connects to or changes a running DSH session. */
import { build } from 'tsdown'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const temp=await mkdtemp(join(tmpdir(),'dsh-search-picker-'))
const screenshots=process.argv.includes('--screenshots')
const timeoutMs=30000
function deadline(promise,label,ms=timeoutMs) {
  let timer
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms)})]).finally(()=>clearTimeout(timer))
}
async function browser(name,width,height,dark) {
  const process=spawn(globalThis.process.env.CHROMIUM ?? 'chromium',[
    '--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--disable-sync','--no-first-run',
    '--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',
    '--user-data-dir='+join(temp,'profile-'+name),'about:blank',
  ],{stdio:['ignore','ignore','pipe']})
  let socket,stderr='',sequence=0,sessionId
  const pending=new Map()
  const exited=new Promise(resolve=>{process.once('exit',resolve);process.once('error',resolve)})
  try {
    const endpoint=await deadline(new Promise((resolve,reject)=>{
      const onError=error=>{cleanup();reject(error)}
      const onExit=()=>onError(Error('Chromium exited before CDP startup: '+stderr))
      const onData=data=>{
        stderr=(stderr+data.toString()).slice(-16384)
        const match=stderr.match(new RegExp('DevTools listening on (ws://[^\\s]+)'))
        if(match){cleanup();resolve(match[1])}
      }
      const cleanup=()=>{process.off('error',onError);process.off('exit',onExit);process.stderr.off('data',onData)}
      process.once('error',onError);process.once('exit',onExit);process.stderr.on('data',onData)
    }),'Chromium CDP startup')
    // Drain logs without retaining unbounded output.
    process.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-16384)})
    socket=new WebSocket(endpoint)
    await deadline(once(socket,'open'),'CDP connection')
    const rejectPending=()=>{for(const call of pending.values())call.reject(Error('CDP socket closed'));pending.clear()}
    socket.addEventListener('close',rejectPending)
    socket.addEventListener('error',rejectPending)
    socket.addEventListener('message',event=>{
      const message=JSON.parse(String(event.data)),call=pending.get(message.id)
      if(!call)return
      pending.delete(message.id)
      if(message.error)call.reject(Error(JSON.stringify(message.error)))
      else call.resolve(message.result)
    })
    const send=(method,params={},target=sessionId)=>{
      const id=++sequence
      const result=new Promise((resolve,reject)=>{
        pending.set(id,{resolve,reject})
        socket.send(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})}))
      })
      return deadline(result,method).finally(()=>pending.delete(id))
    }
    const {targetId}=await send('Target.createTarget',{url:'about:blank'})
    sessionId=(await send('Target.attachToTarget',{targetId,flatten:true})).sessionId
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:dark?'dark':'light'}]})
    let onLoad
    const loaded=new Promise(resolve=>{
      onLoad=event=>{const message=JSON.parse(String(event.data));if(message.sessionId===sessionId&&message.method==='Page.loadEventFired')resolve()}
      socket.addEventListener('message',onLoad)
    })
    try {
      await send('Page.navigate',{url:pathToFileURL(join(temp,'index.html')).href})
      await deadline(loaded,'Fixture document load')
    } finally {socket.removeEventListener('message',onLoad)}
    const evaluate=async expression=>{
      const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
      if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const result=await evaluate(`new Promise((resolve,reject)=>{
      let observer;
      const timer=setTimeout(()=>{observer?.disconnect();reject(Error('Fixture result timed out'))},20000);
      const inspect=()=>{
        const text=document.getElementById('result')?.textContent;
        if(text?.startsWith('{')){clearTimeout(timer);observer?.disconnect();resolve(JSON.parse(text))}
      };
      observer=new MutationObserver(inspect);observer.observe(document,{childList:true,subtree:true,characterData:true});inspect();
    })`)
    if(!result.ok)throw Error(JSON.stringify(result))
    const visible=await evaluate(`(()=>{
      const panel=document.querySelector('.v2s-selector-panel'),rect=panel?.getBoundingClientRect();
      return {open:panel?.matches(':popover-open'),width:rect?.width,height:rect?.height,left:rect?.left,right:rect?.right,top:rect?.top,bottom:rect?.bottom,viewport:{width:innerWidth,height:innerHeight}};
    })()`)
    if(!visible.open||visible.height<=200||visible.width<=0||visible.left<0||visible.right>width||visible.top<0||visible.bottom>height||visible.viewport.width!==width||visible.viewport.height!==height)throw Error('Popover is not visibly open in fixed viewport: '+JSON.stringify(visible))
    if(screenshots){
      const {data}=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})
      await writeFile(join(root,'docs/assets/search-picker-'+name+'.png'),Buffer.from(data,'base64'))
    }
    console.log(name+': '+result.checks.length+' browser checks passed; visible popover '+Math.round(visible.width)+'x'+Math.round(visible.height)+' in '+width+'x'+height)
  } finally {
    if(socket && socket.readyState<2)socket.close()
    for(const call of pending.values())call.reject(Error('Browser cleanup'))
    pending.clear()
    if(process.exitCode===null && process.signalCode===null)process.kill('SIGTERM')
    try {await deadline(exited,'Chromium shutdown',3000)}
    catch {process.kill('SIGKILL');await deadline(exited,'Chromium forced shutdown',3000)}
  }
}
try {
  await build({config:false,cwd:root,entry:join(root,'scripts/fixtures/search-selector.tsx'),outDir:temp,format:'iife',platform:'browser',dts:false,deps:{alwaysBundle:()=>true,onlyBundle:false},define:{'process.env.NODE_ENV':'"production"'}})
  await writeFile(join(temp,'index.html'),"<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>:root{--dsw-alias-label-primary:#262626;--dsw-alias-label-secondary:#666;--dsw-alias-label-caption:#999;--dsw-alias-label-tertiary:#888;--dsw-alias-label-dimmed:#bfc2c7;--dsw-alias-border-l1:#eee;--dsw-alias-border-l2:#e5e7eb;--dsw-alias-border-l3:#bfc2c7;--dsw-alias-bg-layer-3:#fff;--dsw-alias-interactive-bg-hover:#f2f3f5;--dsw-specific-menu:#fff;--dsw-elevation-prominent:0 6px 32px #0002;--dsw-alias-state-error-primary:#c22}*{box-sizing:border-box}body{margin:24px;font-family:Arial,sans-serif;color:#262626;background:#fafafa}.composer{position:absolute;bottom:60px;left:16px;right:16px;border:1px solid #e5e7eb;border-radius:24px;background:#fff;padding:20px;container-type:inline-size}.placeholder{color:#aaa;height:68px}.toolbar{display:flex;align-items:center;gap:16px;justify-content:flex-end}.model{font-size:13px;color:#666}.model span{color:#999}#result{display:none;font-size:11px;white-space:pre-wrap;position:absolute;top:10px;left:24px;right:24px}@media(prefers-color-scheme:dark){:root{--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#bbb;--dsw-alias-label-caption:#888;--dsw-alias-label-tertiary:#999;--dsw-alias-label-dimmed:#60646c;--dsw-alias-border-l1:#333;--dsw-alias-border-l2:#3b3d42;--dsw-alias-border-l3:#666;--dsw-alias-bg-layer-3:#242628;--dsw-alias-interactive-bg-hover:#35373a;--dsw-specific-menu:#242628}body{background:#171819}.composer{background:#202123;border-color:#343638}.model{color:#bbb}}</style><pre id=\"result\">waiting</pre><div class=\"composer\"><div class=\"placeholder\">发送消息或创建任务</div><div class=\"toolbar\"><div id=\"picker\"></div><div class=\"model\">GPT-6 Astra <span>Medium⌄</span></div></div></div><script src=\"search-selector.iife.js\"></script></html>")
  if(screenshots)await mkdir(join(root,'docs/assets'),{recursive:true})
  for(const [name,width,height,dark] of [['desktop',1000,680,false],['narrow',390,760,false],['dark',1000,680,true]]) {
    await browser(name,width,height,dark)
  }
} finally { await rm(temp,{recursive:true,force:true}) }
