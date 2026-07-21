(()=>{
  let activeModal=null, lastFocus=null, dirty=false;
  const modalStack=[], inertStates=new Map();
  const focusable='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const messages={save:'保存',publish:'发布',withdraw:'撤下',purge:'清除',retry:'重试',stop:'停止',keep:'保留',drop:'过滤',merge:'合并',regenerate:'重新生成',run:'运行',test:'测试',sync:'同步',refresh:'刷新',restore:'恢复',rollback:'回滚',pause:'暂停',edit:'更新'};
  const live=document.createElement('div');
  live.id='operation-status'; live.className='sr-status'; live.setAttribute('aria-live','polite'); live.setAttribute('aria-atomic','true');
  document.body.prepend(live);
  const announce=(text)=>{live.textContent=''; requestAnimationFrame(()=>live.textContent=text)};
  const titleFor=button=>{
    const id=(button.dataset.domId||'').toLowerCase();
    return Object.entries(messages).find(([key])=>id.includes(key))?.[1]||button.textContent.trim()||'操作';
  };
  const setDirty=value=>{
    dirty=value;
    document.querySelectorAll('[data-unsaved-indicator]').forEach(el=>{el.hidden=!value; el.textContent=value?'有未保存更改':'已保存'});
    document.body.classList.toggle('has-unsaved-changes',value);
  };
  const syncModalIsolation=()=>{
    const top=modalStack.at(-1)?.modal||null;
    activeModal=top;
    if(!top){
      inertStates.forEach((wasInert,root)=>{root.inert=wasInert;});
      inertStates.clear();
    }else{
      [...document.body.children].forEach(root=>{
        if(root===live||root.hasAttribute('aria-live'))return;
        if(root!==top){
          if(!inertStates.has(root))inertStates.set(root,root.inert);
          root.inert=true;
        }else if(inertStates.has(root)){
          root.inert=inertStates.get(root);
          inertStates.delete(root);
        }
      });
    }
    document.body.classList.toggle('modal-active',Boolean(top));
  };
  const openModal=modal=>{
    if(!modal)return;
    const existing=modalStack.findIndex(entry=>entry.modal===modal);
    if(existing!==-1)return;
    const opener=document.activeElement;
    modalStack.push({modal,opener}); lastFocus=opener;
    modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
    syncModalIsolation();
    const first=modal.querySelector('[autofocus],input,button,[tabindex="0"]'); setTimeout(()=>first?.focus(),0);
  };
  const closeModal=modal=>{
    const index=modalStack.findIndex(entry=>entry.modal===modal);
    if(index===-1)return;
    const closed=modalStack.splice(index), returnFocus=closed[0].opener;
    closed.forEach(entry=>{entry.modal.classList.remove('open');entry.modal.setAttribute('aria-hidden','true');});
    syncModalIsolation();
    const destination=modalStack.at(-1)?.modal||returnFocus;
    lastFocus=destination||null; destination?.focus?.();
  };
  const confirmNavigation=target=>{
    if(!dirty){location.href=target;return;}
    if(window.confirm('当前页面有未保存更改，确定离开吗？')){
      setDirty(false);
      location.href=target;
    }
  };
  window.addEventListener('beforeunload',event=>{
    if(!dirty)return;
    event.preventDefault();
    event.returnValue='';
  });
  document.addEventListener('input',event=>{if(event.target.closest('form,.panel-body'))setDirty(true); if(event.target.matches('[data-confirm-word]')){const modal=event.target.closest('.modal');const submit=modal?.querySelector('[data-confirm-withdraw]');if(submit)submit.disabled=event.target.value.trim()!==event.target.dataset.confirmWord;}});
  document.addEventListener('click',event=>{
    const nav=event.target.closest('a[href]');
    if(nav&&dirty){event.preventDefault();confirmNavigation(nav.href);return;}
    const opener=event.target.closest('[data-modal-open]');
    if(opener){event.preventDefault();openModal(document.getElementById(opener.dataset.modalOpen));return;}
    const closer=event.target.closest('[data-modal-close]');
    if(closer){closeModal(closer.closest('.modal'));return;}
    const drawerButton=event.target.closest('[data-admin-drawer-toggle]');
    if(drawerButton){const drawer=document.getElementById(drawerButton.dataset.adminDrawerToggle);const opened=drawer.classList.toggle('open');drawerButton.setAttribute('aria-expanded',String(opened));drawer.setAttribute('aria-hidden',String(!opened));if(opened)drawer.querySelector('a,button')?.focus();return;}
    const switcher=event.target.closest('.switch');
    if(switcher){const on=switcher.getAttribute('aria-pressed')!=='true';switcher.setAttribute('aria-pressed',String(on));switcher.setAttribute('aria-label',`${switcher.dataset.label||switcher.closest('.setting-row')?.querySelector('b')?.textContent||'开关'}：${on?'已开启':'已关闭'}`);announce(`${switcher.dataset.label||'设置'}已${on?'开启':'关闭'}。`);setDirty(true);return;}
    const filter=event.target.closest('.filter');
    if(filter){filter.closest('.filters')?.querySelectorAll('.filter').forEach(x=>x.setAttribute('aria-pressed','false'));filter.setAttribute('aria-pressed','true');announce(`已应用筛选：${filter.textContent.trim()}。`);return;}
    const tab=event.target.closest('.tab');
    if(tab){tab.parentElement.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected','false'));tab.setAttribute('aria-selected','true');const surface=document.querySelector('.preview-surface');if(surface){const type=tab.dataset.preview;surface.innerHTML=type==='手机'?'<div class="mobile-preview"><b>Morning Brief</b><h2>AI 产品开始从“会做”走向“可控”</h2><p>今天三件重要变化，8 分钟读完。</p></div>':type==='微信'?'<div class="wechat-preview"><b>Morning Brief · 07/21</b><h2>AI 产品开始从“会做”走向“可控”</h2><p>今天三件重要变化，8 分钟读完。</p></div>':'<div class="desktop-preview"><p class="kicker">2026年7月21日 · 已审核草稿</p><h1>AI 产品开始从“会做”走向“可控”</h1><p class="lede">今天的信号指向同一个变化。</p></div>';}announce(`已切换到${tab.textContent.trim()}预览。`);return;}
    const action=event.target.closest('[data-dom-id]');
    if(!action||action.hasAttribute('data-modal-open')||action.hasAttribute('data-modal-close'))return;
    const actionName=titleFor(action),id=action.dataset.domId||'';
    if(id.includes('close-')||id.includes('cancel-'))return;
    if(id==='confirm-withdraw'&&action.closest('.modal')?.querySelector('[data-confirm-word]')?.value.trim()!=='撤下'){announce('请输入“撤下”后再确认。');return;}
    action.disabled=true; const original=action.textContent; action.textContent='处理中…'; announce(`${actionName}处理中。`);
    window.setTimeout(()=>{action.disabled=false;action.textContent=original;if(id.includes('save'))setDirty(false);if(id.includes('confirm-')){const dialog=action.closest('.modal');const status=dialog?.previousElementSibling?.querySelector('.status');if(status)status.textContent=actionName==='撤下'?'已撤下':'已提交';closeModal(dialog);}announce(`演示：${actionName}已提交，等待服务端结果；如失败可重试。`);},450);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(activeModal)closeModal(activeModal);const drawer=document.querySelector('.admin-drawer.open');if(drawer){drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');document.querySelector('[data-admin-drawer-toggle]')?.setAttribute('aria-expanded','false');}return;}
    if(event.key==='Tab'&&activeModal){const items=[...activeModal.querySelectorAll(focusable)];if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  });
})();