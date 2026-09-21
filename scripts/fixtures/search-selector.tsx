import React from 'react'
import { createRoot } from 'react-dom/client'
import { SearchConnectionSelector } from '../../src/client/SearchConnectionSelector.tsx'
const connections=[{id:'builtin:session-model',label:'跟随会话模型',kind:'model',configured:true},{id:'builtin:exa',label:'Exa',kind:'structured',configured:true},{id:'builtin:firecrawl',label:'Firecrawl',kind:'structured',configured:true},{id:'builtin:tavily',label:'Tavily',kind:'structured',configured:false,reason:'UNAVAILABLE_DETAIL_SHOULD_NOT_RENDER'},{id:'builtin:tinyfish',label:'Tinyfish',kind:'structured',configured:false}]
let state={selection:{connectionId:'builtin:session-model',revision:0},freshness:'auto',connections}
const writes:any[]=[]
const remote={get:async()=>({ok:true,value:structuredClone(state)}),set:async(request:any)=>{writes.push(request);if(request.connectionId!==undefined)state.selection.connectionId=request.connectionId;if(request.freshness!==undefined)state.freshness=request.freshness;state.selection.revision++;return {ok:true,value:structuredClone(state)}}}
createRoot(document.getElementById('picker')!).render(<SearchConnectionSelector sessionId="fixture-session" remote={remote as any}/>)
const tick=()=>new Promise(r=>setTimeout(r,30))
const results:string[]=[]
function check(ok:any,name:string){if(!ok)throw Error(name);results.push(name)}
setTimeout(async()=>{try{
 const root=document.querySelector('.v2s-selector')!;const trigger=document.querySelector<HTMLButtonElement>('.v2s-search-trigger')!;const panel=document.querySelector<HTMLDivElement>('.v2s-selector-panel')!
 check(root.getBoundingClientRect().height<=29,'closed trigger stays one line')
 trigger.click();await tick();check(panel.matches(':popover-open'),'native popover opens')
 const fits=()=>{const r=panel.getBoundingClientRect();return panel.matches(':popover-open')&&r.height>200&&r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}
 check(fits(),'visible popover fits viewport')
 const buttons=()=>[...panel.querySelectorAll<HTMLButtonElement>('button')]
 check(!buttons().some(x=>x.textContent==='Tinyfish'||x.textContent==='Tavily'),'unavailable services hidden');check(!panel.querySelector('.v2s-search-heading'),'redundant header removed')
 check(!panel.textContent!.includes('UNAVAILABLE_DETAIL'),'availability details removed')
 buttons().find(x=>x.textContent==='Exa')!.click();await tick();check(writes[0].connectionId==='builtin:exa'&&writes[0].expectedRevision===0,'connection saved with session revision')
 buttons().find(x=>x.textContent==='优先实时')!.click();await tick();check(writes[1].freshness==='realtime'&&!('connectionId' in writes[1])&&writes[1].expectedRevision===1,'freshness writes only current session preference')
 check(writes.every(x=>x.sessionId==='fixture-session'),'all writes target current session')
 check(trigger.textContent!.includes('实时'),'confirmed freshness shown compactly')
 check(root.getBoundingClientRect().height<=29,'saved feedback never expands composer')
 panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();check(!panel.matches(':popover-open')&&document.activeElement===trigger,'Escape closes and restores focus')
 trigger.click();await tick();const first=document.activeElement;first?.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));check(document.activeElement!==first,'keyboard navigation skips disabled options')
 await tick();check(fits(),'screenshot popover remains open and visible')
 document.getElementById('result')!.textContent=JSON.stringify({ok:true,checks:results})
}catch(error){document.getElementById('result')!.textContent=JSON.stringify({ok:false,error:String(error),checks:results})}},120)
