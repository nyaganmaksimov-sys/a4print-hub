(()=>{
  const DB_NAME='a4print-kassa-v1';
  const DB_VERSION=1;
  let dbPromise=null;

  function open(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('catalog'))db.createObjectStore('catalog',{keyPath:'id'});
        if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
        if(!db.objectStoreNames.contains('queue')){
          const s=db.createObjectStore('queue',{keyPath:'id'});
          s.createIndex('created_at','created_at');
          s.createIndex('stage','stage');
        }
        if(!db.objectStoreNames.contains('receipts')){
          const s=db.createObjectStore('receipts',{keyPath:'id'});
          s.createIndex('created_at','created_at');
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
    });
    return dbPromise;
  }

  async function store(name,mode='readonly'){
    const db=await open();
    return db.transaction(name,mode).objectStore(name);
  }

  async function getAll(name){
    const s=await store(name);
    return new Promise((resolve,reject)=>{const r=s.getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)});
  }
  async function get(name,key){
    const s=await store(name);
    return new Promise((resolve,reject)=>{const r=s.get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)});
  }
  async function put(name,value){
    const s=await store(name,'readwrite');
    return new Promise((resolve,reject)=>{const r=s.put(value);r.onsuccess=()=>resolve(value);r.onerror=()=>reject(r.error)});
  }
  async function del(name,key){
    const s=await store(name,'readwrite');
    return new Promise((resolve,reject)=>{const r=s.delete(key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)});
  }
  async function replaceAll(name,rows){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(name,'readwrite');
      const s=tx.objectStore(name);
      s.clear();
      for(const row of rows||[])s.put(row);
      tx.oncomplete=()=>resolve(rows||[]);
      tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed'));
      tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));
    });
  }
  async function setMeta(key,value){return put('meta',{key,value,updated_at:new Date().toISOString()})}
  async function getMeta(key,fallback=null){const r=await get('meta',key);return r?r.value:fallback}
  async function trimReceipts(limit=100){
    const rows=await getAll('receipts');
    if(rows.length<=limit)return;
    rows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
    await Promise.all(rows.slice(limit).map(x=>del('receipts',x.id)));
  }

  window.A4KassaDB={open,getAll,get,put,del,replaceAll,setMeta,getMeta,trimReceipts};
})();