const fs=require('fs');
const path=require('path');
const sharp=require('sharp');
const pngToIco=require('png-to-ico');
(async()=>{
  const root=path.join(__dirname,'..');
  const source=path.join(root,'..','kassa','assets','a4-kassa-icon.svg');
  const build=path.join(root,'build');
  fs.mkdirSync(build,{recursive:true});
  const png=path.join(build,'icon.png');
  const ico=path.join(build,'icon.ico');
  await sharp(source,{density:256}).resize(512,512,{fit:'contain',background:'#ffffff'}).png().toFile(png);
  fs.writeFileSync(ico,await pngToIco(png));
  console.log('Prepared A4-Kassa Windows icon:',ico);
})().catch(err=>{console.error(err);process.exit(1)});
