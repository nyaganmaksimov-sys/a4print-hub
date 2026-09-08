// Outer mobile proxy can begin accepting traffic a fraction earlier than the
// spawned internal API on port 3001. Retry only that loopback connection so a
// deploy does not produce transient 500/ECONNREFUSED responses.
const originalFetch=globalThis.fetch?.bind(globalThis);
const internalPort=Number(process.env.MOBILE_INTERNAL_API_PORT||3001);
const prefix=`http://127.0.0.1:${internalPort}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

if(originalFetch&&!globalThis.__A4_INTERNAL_FETCH_RETRY__){
  globalThis.__A4_INTERNAL_FETCH_RETRY__=true;
  globalThis.fetch=async function a4InternalReadyFetch(input,init){
    const url=typeof input==='string'?input:input instanceof URL?input.href:input?.url||'';
    if(!String(url).startsWith(prefix))return originalFetch(input,init);

    let lastError;
    for(let attempt=0;attempt<8;attempt++){
      try{return await originalFetch(input,init)}catch(error){
        lastError=error;
        const code=error?.cause?.code||error?.code||'';
        if(code!=='ECONNREFUSED')throw error;
        if(attempt<7)await sleep(Math.min(850,120+attempt*120));
      }
    }
    throw lastError;
  };
}
