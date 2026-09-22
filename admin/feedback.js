/* A4PRINT HUB — shared user feedback. No blocking alert() for recoverable errors. */
(function(){
  if(window.A4Feedback)return;
  const ensureStack=()=>{
    let stack=document.getElementById('a4ToastStack');
    if(stack)return stack;
    stack=document.createElement('div');
    stack.id='a4ToastStack';
    stack.className='a4-toast-stack';
    stack.setAttribute('aria-live','polite');
    stack.setAttribute('aria-relevant','additions');
    document.body.appendChild(stack);
    return stack;
  };
  const show=({tone='info',title='',message='',duration=5200,actionLabel='',onAction=null}={})=>{
    const stack=ensureStack();
    const toast=document.createElement('div');
    toast.className=`a4-toast a4-toast-${tone}`;
    toast.setAttribute('role',tone==='error'?'alert':'status');
    const copy=document.createElement('div');
    copy.className='a4-toast-copy';
    if(title){const strong=document.createElement('strong');strong.textContent=String(title);copy.appendChild(strong)}
    if(message){const span=document.createElement('span');span.textContent=String(message);copy.appendChild(span)}
    toast.appendChild(copy);
    if(actionLabel&&typeof onAction==='function'){
      const action=document.createElement('button');
      action.type='button';
      action.className='a4-toast-action';
      action.textContent=String(actionLabel);
      action.onclick=()=>{try{onAction()}finally{toast.remove()}};
      toast.appendChild(action);
    }
    const close=document.createElement('button');
    close.type='button';
    close.className='a4-toast-close';
    close.setAttribute('aria-label','Закрыть уведомление');
    close.textContent='×';
    close.onclick=()=>toast.remove();
    toast.appendChild(close);
    stack.appendChild(toast);
    if(duration>0)setTimeout(()=>toast.remove(),duration);
    return toast;
  };
  window.A4Feedback={
    show,
    info:(title,message,opts={})=>show({...opts,tone:'info',title,message}),
    success:(title,message,opts={})=>show({...opts,tone:'success',title,message}),
    warning:(title,message,opts={})=>show({...opts,tone:'warning',title,message}),
    error:(title,message,opts={})=>show({...opts,tone:'error',title,message,duration:opts.duration??8000})
  };
})();