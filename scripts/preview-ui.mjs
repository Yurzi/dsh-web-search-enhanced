import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { V2Settings } from '../lib/types/client/V2Settings.js'
const snapshot={status:'ready',writable:true,revision:1,value:{version:2,defaultConnection:'builtin:exa'},base:{defaultConnection:'builtin:exa'},user:{}}
const { zh } = await import('../lib/types/client/locales.js')
const markup=renderToStaticMarkup(React.createElement(V2Settings,{useSettings:selector=>selector(snapshot),mutateSettings:async()=>false,describeCredentials:async()=>({ok:true,value:[]}),setCredential:async()=>({ok:false,error:{message:'Preview is read-only'}}),t:key=>zh[key],defaultOpen:true}))
const theme = await readFile(new URL('./fixtures/dsh-theme.css', import.meta.url), 'utf8')
const dark = process.argv.includes('--dark')
await mkdir('.dsh-smoke-home', { recursive:true })
await writeFile('.dsh-smoke-home/settings-preview.html','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+theme+'body{font-family:system-ui,sans-serif;margin:24px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}main{max-width:960px;margin:auto}*{box-sizing:border-box}</style><body'+(dark ? ' data-ds-dark-theme' : '')+'><main><h2>搜索连接 · 设置预览</h2><p>独立组件预览，非当前 DSH GUI 挂载。</p>'+markup+'</main></body></html>')
console.log('preview rendered')
