const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..','..');
const dest=path.resolve(__dirname,'..','web');

function copyDir(name){
  const from=path.join(root,name);
  const to=path.join(dest,name);
  fs.rmSync(to,{recursive:true,force:true});
  fs.mkdirSync(path.dirname(to),{recursive:true});
  fs.cpSync(from,to,{recursive:true,force:true});
}

fs.rmSync(dest,{recursive:true,force:true});
fs.mkdirSync(dest,{recursive:true});
copyDir('kassa');
copyDir('admin');
console.log('Prepared local Kassa web runtime at',dest);
