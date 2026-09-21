import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFile, mkdir } from 'node:fs/promises'
import { V2Settings } from '../lib/types/client/V2Settings.js'
const snapshot={status:'ready',writable:true,revision:1,value:{version:2,defaultConnection:'builtin:exa'},base:{defaultConnection:'builtin:exa'},user:{}}
const scope={subscribe:()=>()=>{},getSnapshot:()=>snapshot}
const markup=renderToStaticMarkup(React.createElement(V2Settings,{scope,credentials:{describe:async()=>({ok:true,value:[]})},defaultOpen:true}))
const tokens='--dsw-alias-border-l2:#e5e7eb;--dsw-alias-border-l3:#d1d5db;--dsw-alias-bg-layer-2:#f7f8fa;--dsw-alias-bg-layer-3:#fff;--dsw-alias-bg-module-platform:#eef0f4;--dsw-alias-brand-primary:#4f6ef7;--dsw-alias-label-primary:#1f2328;--dsw-alias-label-secondary:#6b7280;--dsw-alias-label-tertiary:#8b93a1;--dsw-alias-label-dimmed:#c8ccd4;--dsw-alias-state-success-primary:#16834a;--dsw-alias-state-warn-primary:#a56310;'
const theme = process.argv.includes('--dark') ? '--dsw-alias-bg-layer-2:#202329;--dsw-alias-bg-layer-3:#15171c;--dsw-alias-bg-module-platform:#272b34;--dsw-alias-border-l2:#363b46;--dsw-alias-border-l3:#464d5b;--dsw-alias-label-primary:#edf0f5;--dsw-alias-label-secondary:#acb4c1;--dsw-alias-label-tertiary:#929dae;' : ''
await mkdir('.dsh-smoke-home', { recursive:true })
await writeFile('.dsh-smoke-home/settings-preview.html','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{'+tokens+theme+'}body{font-family:system-ui,sans-serif;margin:24px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}main{max-width:960px;margin:auto}*{box-sizing:border-box}</style><main><h2>搜索连接 · 设置预览</h2><p>独立组件预览，非当前 DSH GUI 挂载。</p>'+markup+'</main></html>')
console.log('preview rendered')