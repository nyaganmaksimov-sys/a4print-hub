#!/usr/bin/env python3
"""Read-only audit of repository local assets. Never auto-delete."""
import collections
import hashlib
import json
import pathlib
import re
import sys
from urllib.parse import urlsplit

ROOT=pathlib.Path(__file__).resolve().parents[1]
SKIP={'.git','node_modules','dist','build','coverage','release','.capacitor'}
EXT={'.html','.js','.mjs','.cjs','.css','.json','.svg','.webmanifest'}
ATTR=re.compile(r'<(?:script|link|img|source|iframe)\b[^>]*?\b(?:src|href)\s*=\s*["\x27]([^"\x27]+)["\x27]',re.I|re.S)
MODULE=re.compile(r'\b(?:import|export)\s+[^;\n]*?\bfrom\s*["\x27](\.{1,2}/[^"\x27]+)["\x27]',re.M)
LOAD=re.compile(r'\b(?:load|loadCss|loadModule)\s*\(\s*["\x27]([^"\x27]+\.(?:js|css))["\x27]',re.I)
def resolve(source,link):
    if not link or link.startswith(('#','//')) or re.match(r'^[a-z][\w+.-]*:',link,re.I) or '{' in link or '$' in link:return None
    target=urlsplit(link).path
    parts=[]
    path=target.lstrip('/') if target.startswith('/') else str(pathlib.PurePosixPath(source).parent/target)
    for piece in path.split('/'):
        if piece in ('','.'):continue
        if piece=='..':
            if parts:parts.pop()
        else:parts.append(piece)
    return '/'.join(parts)
def main():
    files={p.relative_to(ROOT).as_posix():p for p in ROOT.rglob('*') if p.is_file() and not SKIP.intersection(p.relative_to(ROOT).parts)}
    refs=set();missing=[];total=0;hashes=collections.defaultdict(list);contents={}
    for name,p in files.items():
        buf=p.read_bytes();hashes[hashlib.sha256(buf).hexdigest()].append(name)
        if p.suffix not in EXT:continue
        s=buf.decode('utf-8',errors='replace');contents[name]=s
        links=[]
        if p.suffix=='.html':links+=ATTR.findall(s)
        if p.suffix in ('.js','.mjs','.cjs'):
            links+=MODULE.findall(s)
            if name in ('admin/config.js','partner/config.js'):links+=LOAD.findall(s)
        for link in links:
            target=resolve(name,link)
            if not target or '.' not in pathlib.PurePosixPath(target).name:continue
            refs.add(target);total+=1
            if target not in files:missing.append({'source':name,'target':target})
    unused=[]
    for name in sorted(files):
        if not name.startswith(('admin/','kassa/','pos/','partner/','mobile/','shared/')) or not name.endswith(('.js','.css')) or name in refs:continue
        base=name.rsplit('/',1)[-1]
        if base not in ('config.js','app.js','sw.js') and not any(base in s for other,s in contents.items() if other!=name):unused.append(name)
    result={'files':len(files),'size_bytes':sum(p.stat().st_size for p in files.values()),'references_checked':total,'missing_references':missing,'identical_content_groups':[v for v in hashes.values() if len(v)>1],'unreferenced_candidates':unused,'note':'Do not delete based on this static audit alone: dynamic loading and external bookmarks may exist.'}
    if '--json' in sys.argv:print(json.dumps(result,ensure_ascii=False,indent=2))
    else:
        print('AUDIT files',result['files'],'references',total,'missing',len(missing),'candidate_unreferenced',len(unused))
        for x in missing[:90]:print('BROKEN',x['source'],'=>',x['target'])
        for name in unused[:70]:print('REVIEW',name)
if __name__=='__main__':main()
