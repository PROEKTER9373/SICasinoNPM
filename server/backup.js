// Shared backup helpers: used by the server (auto-backups) and by scripts/.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {DatabaseSync} from "node:sqlite";

const stamp=()=>new Date().toISOString().replace(/[:T]/g,"-").replace(/\..+$/,"");
export const sha256File=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const q=p=>"'"+String(p).replace(/'/g,"''")+"'";

// Consistent single-file snapshot of a live SQLite DB (safe while the server is running).
export function snapshotDb(handle,dir,label="auto"){
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,`sico-${stamp()}-${label}.sqlite`);
  handle.exec(`VACUUM INTO ${q(file)}`);
  return file;
}

export function pruneBackups(dir,keep=14){
  if(!fs.existsSync(dir))return;
  const files=fs.readdirSync(dir).filter(f=>/^sico-.*\.sqlite$/.test(f)).sort();
  for(const f of files.slice(0,Math.max(0,files.length-keep)))try{fs.unlinkSync(path.join(dir,f))}catch{}
}

export function readState(file){
  const d=new DatabaseSync(file,{readOnly:true});
  try{
    const row=d.prepare("SELECT value FROM sico_state WHERE key=?").get("db");
    if(!row)return null;
    return JSON.parse(row.value);
  }finally{d.close()}
}

export function summarize(state){
  if(!state)return {users:0,transactions:0,bets:0};
  return {users:state.users?.length||0,transactions:state.transactions?.length||0,bets:state.bets?.length||0,chat:state.chat?.length||0,posts:state.posts?.length||0};
}

// Full portable backup: DB snapshot + avatars + admin key + manifest.
export function fullBackup(dataDir,outRoot){
  const dbFile=path.join(dataDir,"sico.sqlite");
  if(!fs.existsSync(dbFile))throw new Error(`База не найдена: ${dbFile}`);
  const out=path.join(outRoot,`sico-backup-${stamp()}`);
  fs.mkdirSync(out,{recursive:true});
  const h=new DatabaseSync(dbFile);
  let snap;
  try{snap=snapshotDb(h,out,"export")}finally{h.close()}
  const target=path.join(out,"sico.sqlite");
  fs.renameSync(snap,target);
  const av=path.join(dataDir,"avatars");
  if(fs.existsSync(av))fs.cpSync(av,path.join(out,"avatars"),{recursive:true});
  const key=path.join(dataDir,"admin.key");
  if(fs.existsSync(key))fs.copyFileSync(key,path.join(out,"admin.key"));
  const manifest={format:1,createdAt:new Date().toISOString(),sha256:sha256File(target),
    avatars:fs.existsSync(path.join(out,"avatars"))?fs.readdirSync(path.join(out,"avatars")).length:0,
    adminKey:fs.existsSync(path.join(out,"admin.key")),summary:summarize(readState(target))};
  fs.writeFileSync(path.join(out,"manifest.json"),JSON.stringify(manifest,null,2));
  return {dir:out,manifest};
}

// Restore a backup folder into dataDir. The current data is moved aside first, never deleted.
export function restoreBackup(srcDir,dataDir){
  const src=path.join(srcDir,"sico.sqlite");
  if(!fs.existsSync(src))throw new Error(`В ${srcDir} нет sico.sqlite`);
  const mf=path.join(srcDir,"manifest.json");
  if(fs.existsSync(mf)){
    const m=JSON.parse(fs.readFileSync(mf,"utf8"));
    if(m.sha256&&m.sha256!==sha256File(src))throw new Error("Контрольная сумма не совпадает — бэкап повреждён");
  }
  const st=readState(src);
  if(!st||!Array.isArray(st.users))throw new Error("В файле нет данных SICO (sico_state/db)");
  let moved=null;
  if(fs.existsSync(dataDir)&&fs.readdirSync(dataDir).length){
    moved=`${dataDir}.before-restore-${stamp()}`;
    fs.renameSync(dataDir,moved);
  }
  fs.mkdirSync(path.join(dataDir,"avatars"),{recursive:true});
  fs.copyFileSync(src,path.join(dataDir,"sico.sqlite"));
  const av=path.join(srcDir,"avatars");
  if(fs.existsSync(av))fs.cpSync(av,path.join(dataDir,"avatars"),{recursive:true});
  const key=path.join(srcDir,"admin.key");
  if(fs.existsSync(key))fs.copyFileSync(key,path.join(dataDir,"admin.key"));
  return {moved,summary:summarize(st)};
}
