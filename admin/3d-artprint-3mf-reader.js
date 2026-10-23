// Read slicer-generated .gcode.3mf ZIP container locally; never upload the toolpath.
const decoder=new TextDecoder('utf-8');
export async function unpackGcode3mf(file){
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(bytes.length<22||bytes.length>120*1024*1024)throw Error('Недопустимый размер G-code 3MF');
 const view=new DataView(bytes.buffer),u16=i=>view.getUint16(i,true),u32=i=>view.getUint32(i,true);
 let eocd=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
  if(u32(i)===0x06054b50){eocd=i;break}
 }
 if(eocd<0)throw Error('Не найден каталог 3MF');
 const count=u16(eocd+10),central=u32(eocd+16),max=bytes.length;
 if(count<1||count>2000||central>=max)throw Error('Некорректный каталог 3MF');
 let at=central,match=null;
 for(let i=0;i<count;i++){
  if(at+46>max||u32(at)!==0x02014b50)throw Error('Повреждён каталог 3MF');
  const method=u16(at+10),compressed=u32(at+20),size=u32(at+24),nameLen=u16(at+28),extra=u16(at+30),comment=u16(at+32),offset=u32(at+42);
  if(at+46+nameLen+extra+comment>max)throw Error('Повреждено имя файла 3MF');
  const name=decoder.decode(bytes.subarray(at+46,at+46+nameLen));
  if(/^Metadata\/plate_\d+\.gcode$/i.test(name)){
   if(match)throw Error('В 3MF несколько пластин. Экспортируйте G-code одной пластины.');
   match={name,method,compressed,size,offset};
  }
  at+=46+nameLen+extra+comment;
 }
 if(!match)throw Error('В 3MF нет G-code. Требуется нарезанный файл .gcode.3mf, не проект .3mf.');
 if(match.size>60*1024*1024||match.compressed>60*1024*1024)throw Error('G-code слишком большой');
 const {offset,compressed,size,method}=match;
 if(offset+30>max||u32(offset)!==0x04034b50)throw Error('Повреждён файл G-code');
 const start=offset+30+u16(offset+26)+u16(offset+28);
 if(start+compressed>max)throw Error('Неполные данные G-code');
 const payload=bytes.subarray(start,start+compressed);
 if(method===0)return decoder.decode(payload);
 if(method!==8)throw Error('Неподдерживаемое сжатие 3MF');
 if(typeof DecompressionStream==='undefined')throw Error('Браузер не поддерживает распаковку 3MF. Экспортируйте обычный G-code.');
 const decompressed=await new Response(new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
 if(decompressed.byteLength!==size)throw Error('Размер G-code после распаковки не совпал');
 return decoder.decode(decompressed);
}
