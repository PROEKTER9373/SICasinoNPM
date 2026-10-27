import express from "express";
import http from "http";
import https from "https";
import {WebSocketServer} from "ws";
import bcrypt from "bcryptjs";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "url";
import {snapshotDb,pruneBackups,summarize} from "./backup.js";

// Minimal .env loader (no extra dependency required).
function loadDotEnv(file){
  try{
    if(!fs.existsSync(file)) return;
    for(const raw of fs.readFileSync(file,"utf8").split(/\r?\n/)){
      const line=raw.trim();
      if(!line||line.startsWith("#")) continue;
      const m=line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if(!m||process.env[m[1]]!==undefined) continue;
      let v=m[2].trim();
      if((v.startsWith("\"")&&v.endsWith("\""))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
      process.env[m[1]]=v;
    }
  }catch{}
}

const __dirname=path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(__dirname,"..",".env"));
const ROOT=path.join(__dirname,".."),DATA=process.env.SICO_DATA_DIR?path.resolve(process.env.SICO_DATA_DIR):path.join(ROOT,"data"),PUBLIC=path.join(ROOT,"public"),UP=path.join(DATA,"avatars");
fs.mkdirSync(UP,{recursive:true});
const DB=path.join(DATA,"sico.sqlite");
const LEGACY_DB=path.join(DATA,"db.json");
const ADMIN_KEY_FILE=path.join(DATA,"admin.key");
const CERT_DIR=path.join(ROOT,"certs");
const hasHttps=fs.existsSync(path.join(CERT_DIR,"server.key"))&&fs.existsSync(path.join(CERT_DIR,"server.crt"));
const blank={users:[],likes:[],loans:[],transactions:[],bets:[],achievements:[],daily:[],chat:[],posts:[],follows:[],adminLogs:[],promocodes:[],crystalListings:[],market:{price:1,history:[],lastTick:0}};
const profileVisibilityDefaults={avatar:true,status:true,title:true,level:true,xp:true,stats:true,trading:true,achievements:true,createdAt:true};
const inventoryCatalog={
  'avatar-neon-s':{id:'avatar-neon-s',type:'avatar',name:'Neon S',rarity:'Редкий',icon:'⚡',value:'neon-s',desc:'Неоновая S для профиля.'},
  'avatar-ghost':{id:'avatar-ghost',type:'avatar',name:'Ghost',rarity:'Эпический',icon:'👻',value:'ghost',desc:'Призрачный аватар.'},
  'avatar-rocket':{id:'avatar-rocket',type:'avatar',name:'Rocket',rarity:'Эпический',icon:'🚀',value:'rocket',desc:'Аватар для тех, кто летит вверх.'},
  'avatar-cat':{id:'avatar-cat',type:'avatar',name:'Cyber Cat',rarity:'Легендарный',icon:'🐱',value:'cyber-cat',desc:'Кибер-кот SICO.'},
  'status-trader':{id:'status-trader',type:'status',name:'Трейдинг онлайн',rarity:'Редкий',icon:'📈',value:'Трейдинг онлайн',desc:'Статус профиля.'},
  'status-danger':{id:'status-danger',type:'status',name:'Иду на риск',rarity:'Эпический',icon:'🔥',value:'Иду на риск',desc:'Статус профиля.'},
  'status-night':{id:'status-night',type:'status',name:'Ночной игрок',rarity:'Редкий',icon:'🌙',value:'Ночной игрок',desc:'Статус профиля.'},
  'title-whale':{id:'title-whale',type:'title',name:'Кит рынка',rarity:'Легендарный',icon:'🐋',value:'Кит рынка',desc:'Титул профиля.'},
  'title-trader':{id:'title-trader',type:'title',name:'Ночной трейдер',rarity:'Эпический',icon:'📊',value:'Ночной трейдер',desc:'Титул профиля.'},
  'title-lucky':{id:'title-lucky',type:'title',name:'Везучий',rarity:'Редкий',icon:'🍀',value:'Везучий',desc:'Титул профиля.'},
  'badge-diamond':{id:'badge-diamond',type:'badge',name:'Diamond',rarity:'Легендарный',icon:'💎',value:'Diamond',desc:'Декоративный значок.'},
  'badge-hot':{id:'badge-hot',type:'badge',name:'Hot',rarity:'Эпический',icon:'🔥',value:'Hot',desc:'Декоративный значок.'},
  'frame-neon':{id:'frame-neon',type:'frame',name:'Neon Frame',rarity:'Редкий',icon:'🟣',value:'neon',desc:'Неоновая рамка профиля.'},
  'frame-gold':{id:'frame-gold',type:'frame',name:'Gold Frame',rarity:'Легендарный',icon:'🟡',value:'gold',desc:'Золотая рамка профиля.'},
  'frame-ice':{id:'frame-ice',type:'frame',name:'Ice Frame',rarity:'Эпический',icon:'🔷',value:'ice',desc:'Ледяная рамка профиля.'},
  'effect-pulse':{id:'effect-pulse',type:'effect',name:'Pulse',rarity:'Эпический',icon:'✨',value:'pulse',desc:'Мягкое свечение карточки.'},
  'effect-glow':{id:'effect-glow',type:'effect',name:'Glow',rarity:'Легендарный',icon:'🌟',value:'glow',desc:'Яркое свечение карточки.'},
  'avatar-autumn':{id:'avatar-autumn',type:'avatar',name:'Autumn Fox',rarity:'Эпический',icon:'🦊',value:'autumn-fox',desc:'Осенний лис SICO.'},
  'status-autumn':{id:'status-autumn',type:'status',name:'Осенний игрок',rarity:'Редкий',icon:'🍂',value:'Осенний игрок',desc:'Сезонный статус профиля.'},
  'title-autumn':{id:'title-autumn',type:'title',name:'Король листопада',rarity:'Эпический',icon:'🍁',value:'Король листопада',desc:'Сезонный титул профиля.'},
  'badge-autumn':{id:'badge-autumn',type:'badge',name:'Autumn 2026',rarity:'Редкий',icon:'🧡',value:'Autumn 2026',desc:'Осенний сезонный значок.'},
  'frame-autumn':{id:'frame-autumn',type:'frame',name:'Autumn Frame',rarity:'Эпический',icon:'🟠',value:'autumn',desc:'Тёплая осенняя рамка профиля.'},
  'effect-leaves':{id:'effect-leaves',type:'effect',name:'Leaffall',rarity:'Эпический',icon:'🍂',value:'leaves',desc:'Осенние листья вокруг профиля.'},
  'avatar-squirrel':{id:'avatar-squirrel',type:'avatar',name:'SICO Squirrel',rarity:'Легендарный',icon:'🐿️',value:'squirrel',desc:'Редкий сезонный аватар.'},
  'effect-ember':{id:'effect-ember',type:'effect',name:'Ember',rarity:'Легендарный',icon:'🔥',value:'ember',desc:'Тёплое янтарное свечение.'}
};
const cosmeticCase={cost:750,items:[
  ['avatar-neon-s',28],['status-trader',18],['title-lucky',16],['frame-neon',12],['badge-hot',10],['status-night',6],['title-trader',4],['avatar-ghost',3],['frame-ice',1.5],['effect-pulse',1.2],['avatar-rocket',0.8],['badge-diamond',0.45],['title-whale',0.3],['frame-gold',0.2],['effect-glow',0.15],['avatar-cat',0.1],['status-danger',0.3]
]};
const autumnCase={cost:1200,items:[['avatar-autumn',32],['status-autumn',22],['title-autumn',18],['frame-autumn',12],['badge-autumn',9],['effect-leaves',4],['avatar-squirrel',2],['effect-ember',1]]};
function profileVis(u){return {...profileVisibilityDefaults,...(u.profileVisibility||{})};}
function tradingPnl(u){const price=Number(db.market.price)||0;return Number(((u.scCoin||0)*price-(u.scCoinCostBasis||0)+(u.scCoinRealizedPnl||0)).toFixed(2));}
function itemView(id){const x=inventoryCatalog[id];return x?{...x}:null}
function pickWeightedItem(items){const total=items.reduce((a,[,w])=>a+w,0);const r=(crypto.randomInt(0,1_000_000_000)/1_000_000_000)*total;let acc=0;for(const [item,w] of items){acc+=w;if(r<acc)return item}return items[0][0]}
function pickCosmetic(){return pickWeightedItem(cosmeticCase.items)}
function pickAutumnCosmetic(){return pickWeightedItem(autumnCase.items)}
function normalizeUser(u){u.stats={games:0,won:0,winCount:0,chat:0,daily:0,cases:0,support:0,coinGames:0,coinWins:0,biggestWin:0,seasonalCases:0,...(u.stats||{})};u.lastDailySpin=Number(u.lastDailySpin||0);u.bankBalance=Number(u.bankBalance||0);u.bankDepositedAt=Number(u.bankDepositedAt||0);u.scCoin=Number(u.scCoin||0);u.scCoinCostBasis=Number(u.scCoinCostBasis||0);u.scCoinRealizedPnl=Number(u.scCoinRealizedPnl||0);u.inventory=Array.isArray(u.inventory)?u.inventory:[];u.crystals=[];u.artifacts=Array.isArray(u.artifacts)?u.artifacts:[];u.equipped={avatar:null,status:u.status||'Новичок',title:u.title||null,badge:null,frame:null,effect:null,...(u.equipped||{})};u.status=String(u.equipped.status||u.status||'Новичок').slice(0,80);u.title=u.equipped.title?String(u.equipped.title).slice(0,80):null;u.profileVisibility=profileVis(u);u.twoFactor=!!u.twoFactor;u.twoFactorSecret=u.twoFactorSecret||null;u.googleId=u.googleId||null;u.authProvider=u.authProvider||'local';u.questProgress=u.questProgress||{games:0,wins:0,chat:0,cases:0};u.following=Array.isArray(u.following)?u.following:[];}

const sqlite=new DatabaseSync(DB);
sqlite.exec("CREATE TABLE IF NOT EXISTS sico_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
let db=blank;
const stateGet=()=>{const row=sqlite.prepare("SELECT value FROM sico_state WHERE key=?").get("db");return row?JSON.parse(row.value):null};
const legacy=fs.existsSync(LEGACY_DB)?JSON.parse(fs.readFileSync(LEGACY_DB,"utf8")):null;
db=stateGet()||legacy||blank;
for(const k of Object.keys(blank))if(k!=="market"&&!Array.isArray(db[k]))db[k]=[];
if(!db.market||typeof db.market!=="object")db.market={price:1,history:[],lastTick:0};
if(!Array.isArray(db.market.history))db.market.history=[];
if(!Number.isFinite(db.market.price)||db.market.price<=0)db.market.price=1;
if(!Number.isFinite(db.market.lastTick))db.market.lastTick=0;
for(const u of db.users)normalizeUser(u);
// Shards/crystals and their marketplace are retired permanently.
db.crystalListings=[];db.promocodes=Array.isArray(db.promocodes)?db.promocodes:[];
const initialJsonExists=!!legacy&&!stateGet();
if(initialJsonExists){sqlite.prepare("INSERT OR REPLACE INTO sico_state(key,value) VALUES(?,?)").run("db",JSON.stringify(db));}
const app=express();
const server=hasHttps?https.createServer({key:fs.readFileSync(path.join(CERT_DIR,"server.key")),cert:fs.readFileSync(path.join(CERT_DIR,"server.crt"))},app):http.createServer(app);
const wss=new WebSocketServer({server});
app.set("trust proxy",true);app.use(express.json({limit:"1mb"}));app.use("/avatars",express.static(UP));app.use(express.static(PUBLIC));
const sessions=new Map(),rate=new Map(),requests=new Map(),devices=new Map(),loginFails=new Map(),chatCooldown=new Map(),adminSessions=new Map(),recoveryChallenges=new Map();
let adminKey="";
if(fs.existsSync(ADMIN_KEY_FILE)) adminKey=fs.readFileSync(ADMIN_KEY_FILE,"utf8").trim();
if(!adminKey){adminKey=crypto.randomBytes(18).toString("base64url");fs.writeFileSync(ADMIN_KEY_FILE,adminKey,{mode:0o600});}
const id=p=>p+"_"+crypto.randomBytes(8).toString("hex");
const hashSecret=s=>crypto.createHash("sha256").update(String(s||"").trim().toLocaleLowerCase("ru-RU")).digest("hex");
const b32Encode=buf=>{const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,val=0,out='';for(const b of buf){val=(val<<8)|b;bits+=8;while(bits>=5){bits-=5;out+=chars[(val>>bits)&31]}}if(bits)out+=chars[(val<<(5-bits))&31];return out};
const b32Decode=str=>{const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,val=0,out=[];for(const c of String(str||'').replace(/=+$/,'').toUpperCase()){const n=chars.indexOf(c);if(n<0)continue;val=(val<<5)|n;bits+=5;if(bits>=8){bits-=8;out.push((val>>bits)&255)}}return Buffer.from(out)};
const totpCode=(secret,step=Math.floor(Date.now()/30000))=>{const key=b32Decode(secret),msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(step));const h=crypto.createHmac('sha1',key).update(msg).digest(),o=h[h.length-1]&15;const n=((h[o]&127)<<24)|((h[o+1]&255)<<16)|((h[o+2]&255)<<8)|(h[o+3]&255);return String(n%1000000).padStart(6,'0')};
const verifyTotp=(secret,code)=>{const c=String(code||'').replace(/\s/g,'');if(!/^\d{6}$/.test(c))return false;const step=Math.floor(Date.now()/30000);return [-1,0,1].some(i=>totpCode(secret,step+i)===c)};
const sessionView=(t,s,reqToken)=>({id:crypto.createHash('sha256').update(t).digest('hex').slice(0,16),current:t===reqToken,createdAt:s.at,ip:s.ip||null,device:s.device&&s.device!=='unknown'?s.device:null});

const save=()=>{sqlite.prepare("INSERT OR REPLACE INTO sico_state(key,value) VALUES(?,?)").run("db",JSON.stringify(db));};
const BACKUP_DIR=path.join(DATA,"backups"),BACKUP_KEEP=Math.max(3,Number(process.env.SICO_BACKUP_KEEP||14)),BACKUP_EVERY_H=Math.max(1,Number(process.env.SICO_BACKUP_HOURS||6));
let lastBackupAt=0;
function autoBackup(label,minGapMs=0){if(!db.users.length||Date.now()-lastBackupAt<minGapMs)return;try{save();const f=snapshotDb(sqlite,BACKUP_DIR,label);pruneBackups(BACKUP_DIR,BACKUP_KEEP);lastBackupAt=Date.now();console.log("SICO backup:",path.basename(f),JSON.stringify(summarize(db)))}catch(e){console.error("SICO backup failed:",e.message)}}
const user=uid=>db.users.find(u=>u.id===uid);
const pub=u=>({id:u.id,login:u.login,avatar:u.avatar||null,level:u.level,xp:u.xp,balance:u.balance,createdAt:u.createdAt,stats:u.stats||{},theme:u.theme||"graphite",badges:u.badges||[],dailyStreak:u.dailyStreak||0,scCoin:Number(u.scCoin||0),scCoinCostBasis:Number(u.scCoinCostBasis||0),scCoinRealizedPnl:Number(u.scCoinRealizedPnl||0),tradingPnl:tradingPnl(u),status:u.status||"Новичок",title:u.title||null,profileVisibility:profileVis(u),twoFactorEnabled:!!u.twoFactor,inventory:(u.inventory||[]).map(itemView).filter(Boolean),equipped:Object.fromEntries(Object.entries(u.equipped||{}).map(([k,v])=>[k,itemView(v)||null]))});
const publicSummary=u=>({id:u.id,login:u.login,avatar:profileVis(u).avatar?(u.equipped?.avatar?itemView(u.equipped.avatar):u.avatar||null):null,level:profileVis(u).level?u.level:null,title:profileVis(u).title?u.title:null,status:profileVis(u).status?u.status:null,equipped:Object.fromEntries(Object.entries(u.equipped||{}).map(([k,v])=>[k,itemView(v)||null]))});
const deviceOf=req=>String(req.headers["x-device-id"]||"").slice(0,100);
function token(u,req){const t=crypto.randomBytes(32).toString("hex"),d=deviceOf(req)||"unknown";sessions.set(t,{uid:u.id,at:Date.now(),ip:req.ip,device:d});devices.set(d,(devices.get(d)||0)+1);return t}
function revokeSession(t){const s=sessions.get(t);if(!s)return false;sessions.delete(t);if(s.device&&s.device!=="unknown"){const n=Math.max(0,(devices.get(s.device)||1)-1);if(n)devices.set(s.device,n);else devices.delete(s.device)}for(const ws of sockets||[]){if(ws.sessionToken===t){ws.userId=null;ws.sessionToken=null;try{ws.close(4001,"Session revoked")}catch{}}}return true}
function revokeUserSessions(uid,except=null){let n=0;for(const [t,s] of sessions){if(s.uid===uid&&t!==except){if(revokeSession(t))n++}}if(n)pushOnline();return n}
function auth(req,res,next){const t=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");const s=sessions.get(t),u=s&&user(s.uid);if(!u)return res.status(401).json({error:"Сессия истекла"});if(u.banned){revokeSession(t);return res.status(403).json({error:`Аккаунт заблокирован: ${u.banReason||"нарушение правил"}`})}const d=deviceOf(req);if(s.device!=="unknown"&&d&&s.device!==d){revokeSession(t);return res.status(401).json({error:"Сессия привязана к другому устройству"});}req.user=u;req.token=t;req.session=s;next()}

function adminAuth(req,res,next){const t=(req.headers.authorization||"").replace("Bearer ","");const s=adminSessions.get(t);if(!s)return res.status(401).json({error:"Нужен вход администратора"});if(Date.now()-s.at>7*86400000){adminSessions.delete(t);return res.status(401).json({error:"Сессия администратора истекла"});}s.at=Date.now();req.adminToken=t;next()}
function adminChat(text){const m={id:id("msg"),userId:null,login:"SICO",text,system:true,at:Date.now()};db.chat.unshift(m);db.chat=db.chat.slice(0,30);save();push("chat",m)}
function limited(req,res,next){const key=(req.ip||"unknown")+":"+req.path,x=rate.get(key)||{n:0,t:Date.now()};if(Date.now()-x.t>10000){x.n=0;x.t=Date.now()}x.n++;rate.set(key,x);if(x.n>80)return res.status(429).json({error:"Слишком много запросов"});next()}
app.use("/api",limited);
app.disable("x-powered-by");
app.use((req,res,next)=>{if(req.path==="/"||req.path==="/index.html"||req.path==="/app.js"||req.path==="/style.css"||req.path==="/sw.js")res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");next()});
app.use((req,res,next)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("X-Frame-Options","DENY");res.setHeader("Referrer-Policy","no-referrer");next()});
function requestOnce(req,res,next){const rid=String(req.headers["x-request-id"]||"").slice(0,80);if(!rid)return next();const key=req.user.id+":"+req.path+":"+rid,old=requests.get(key);if(old){if(Date.now()-old.at<120000)return res.status(old.status).json(old.body);requests.delete(key)}const json=res.json.bind(res);res.json=(body)=>{requests.set(key,{at:Date.now(),status:res.statusCode||200,body});return json(body)};next()}
function addXP(u,n){u.xp+=Math.max(0,n);while(u.xp>=u.level*1000){u.xp-=u.level*1000;u.level++}}
function wallet(u,delta,type,meta={}){if(!u||!Number.isSafeInteger(delta))throw Error("bad delta");if(delta<0&&u.balance+delta<0)throw Error("Недостаточно SC");u.balance+=delta;addXP(u,Math.floor(Math.abs(delta)/25));checkAchievements(u);db.transactions.unshift({id:id("tx"),userId:u.id,delta,type,meta,at:Date.now()});save();push("wallet",{userId:u.id,balance:u.balance,level:u.level,xp:u.xp});}
const BANK_FEE=0.15; const feeFor=n=>Math.ceil(Math.max(0,n)*BANK_FEE);
function forceWallet(u,delta,type,meta={}){if(!u||!Number.isSafeInteger(delta))throw Error("bad delta");u.balance+=delta;addXP(u,Math.floor(Math.abs(delta)/25));checkAchievements(u);db.transactions.unshift({id:id("tx"),userId:u.id,delta,type,meta,at:Date.now()});save();push("wallet",{userId:u.id,balance:u.balance,level:u.level,xp:u.xp});}
function marketPoint(){return {at:Date.now(),price:Number(db.market.price.toFixed(6))}}
function tickMarket(force=false){
  const now=Date.now();
  if(!force&&now-(db.market.lastTick||0)<120000)return false;
  const old=Number(db.market.price)||1;
  // SCoin is intentionally a volatile in-game asset. Most ticks are modest,
  // but occasional strong moves make larger swings (for example 1.20 -> ~3.00)
  // possible over several ticks. The market is still server-authoritative.
  const r=crypto.randomInt(0,1_000_000)/1_000_000;
  let change;
  if(r<0.08) change=crypto.randomInt(-35, -18)/100;       // sharp drop
  else if(r<0.20) change=crypto.randomInt(18, 45)/100;     // strong rise
  else if(r<0.26) change=crypto.randomInt(45, 90)/100;     // rare big pump
  else change=crypto.randomInt(-12, 13)/100;               // normal movement
  const next=Math.max(0.05,Math.min(10,old*(1+change)));
  db.market.price=Number(next.toFixed(6));db.market.lastTick=now;db.market.history.push({at:now,price:db.market.price});db.market.history=db.market.history.slice(-180);save();push("market",{price:db.market.price,history:db.market.history,lastTick:db.market.lastTick,changePct:Number(((db.market.price/old-1)*100).toFixed(2))});return true}
if(!db.market.history.length){db.market.lastTick=Date.now();for(let i=29;i>=0;i--)db.market.history.push({at:Date.now()-i*120000,price:Number(db.market.price.toFixed(6))});save();}
setInterval(()=>tickMarket(false),15000);
function expireLoans(){const now=Date.now();for(const l of db.loans.filter(x=>x.status==="open"&&x.dueAt&&x.dueAt<=now)){const borrower=user(l.to),lender=user(l.from);if(!borrower||!lender){l.status="closed";continue}const fee=feeFor(l.principal);forceWallet(borrower,-(l.principal+fee),"loan_auto_repay",{loan:l.id,fee});forceWallet(lender,l.principal,"loan_repaid",{loan:l.id,fee});l.status="closed";l.closedAt=now;l.autoRepaid=true;l.fee=fee;l.remaining=0;push("loan",{loan:l});}save();}
setInterval(expireLoans,15000);
function stat(u,key,n=1){u.stats=u.stats||{};u.stats[key]=(u.stats[key]||0)+n;checkAchievements(u)}
function recordWin(u,amount){u.stats.winCount=(u.stats.winCount||0)+1;if(Number.isFinite(amount))u.stats.biggestWin=Math.max(u.stats.biggestWin||0,Math.floor(amount))}
const achievementDefs=[
 ["first_game","Первый раунд","Сыграй первую игру","Игры",1],
 ["games10","В ритме","Сыграй 10 игр","Игры",10],
 ["games50","Завсегдатай","Сыграй 50 игр","Игры",50],
 ["games100","Легенда лобби","Сыграй 100 игр","Игры",100],
 ["big_win","Красивый занос","Получи выигрыш от 500 SC","Выигрыши",500],
 ["mega_win","Большой занос","Получи выигрыш от 2 000 SC","Выигрыши",2000],
 ["supporter","Свой человек","Поддержи проект","Поддержка",1],
 ["chatty","На связи","Отправь 10 сообщений","Общение",10],
 ["chat50","Голос лобби","Отправь 50 сообщений","Общение",50],
 ["chat100","Главный болтун","Отправь 100 сообщений","Общение",100],
 ["daily3","Серия","Забери 3 ежедневных бонуса","Бонусы",3],
 ["daily7","Неделя в SICO","Забери 7 ежедневных бонусов","Бонусы",7],
 ["case5","Коллекционер","Открой 5 кейсов","Кейсы",5],
 ["case15","Охотник за дропом","Открой 15 кейсов","Кейсы",15],
 ["case30","Вскрыватель","Открой 30 кейсов","Кейсы",30],
 ["level5","Разогрелся","Достигни 5 уровня","Прогресс",5],
 ["level10","На десятке","Достигни 10 уровня","Прогресс",10],
 ["coin10","Монетка","Сыграй 10 Coin Flip","Монетка",10],
 ["coin25","Орёл или решка","Выиграй 25 Coin Flip","Победы монетки",25],
 ["bank1000","Копилка","Положи 1 000 SC в банк","Банк",1000],
 ["rich","Крупный баланс","Держи 5 000 SC на балансе","Баланс",5000],
 ["richest","Серьёзный запас","Держи 10 000 SC на балансе","Баланс",10000],
 ["autumn1","Первый лист","Открой 1 Autumn Case","Осень",1],
 ["autumn3","Листопад","Открой 3 Autumn Case","Осень",3]
];
function checkAchievements(u){for(const [key,, ,field,target] of achievementDefs){const stats=u.stats||{};let val=field==="Игры"?stats.games:field==="Выигрыши"?stats.won:field==="Поддержка"?stats.support:field==="Общение"?stats.chat:field==="Бонусы"?stats.daily:field==="Кейсы"?stats.cases:field==="Монетка"?stats.coinGames:field==="Победы монетки"?stats.coinWins:field==="Банк"?(u.bankBalance||0):field==="Баланс"?u.balance:field==="Осень"?(stats.seasonalCases||0):u.level;if(val>=target&&!(u.badges||[]).includes(key)){u.badges=[...(u.badges||[]),key];db.achievements.push({id:id("ach"),userId:u.id,key,at:Date.now()});}}}
function safeChat(s){return String(s||"").trim().slice(0,280)}
app.post("/api/register",async(req,res)=>{
  const login=String(req.body.login||"").trim(),pass=String(req.body.password||""),question=String(req.body.secretQuestion||"").trim(),answer=String(req.body.secretAnswer||"").trim();
  if(!/^[A-Za-z0-9_]{3,24}$/.test(login))return res.status(400).json({error:"Логин: 3–24 символа, A-Z, 0-9 и _"});
  if(pass.length<6||pass.length>72)return res.status(400).json({error:"Пароль: 6–72 символа"});
  if(question.length<5||question.length>160)return res.status(400).json({error:"Секретный вопрос: 5–160 символов"});
  if(answer.length<2||answer.length>160)return res.status(400).json({error:"Ответ на секретный вопрос: 2–160 символов"});
  if(db.users.some(u=>u.login.toLowerCase()===login.toLowerCase()))return res.status(409).json({error:"Логин уже занят"});
  const u={id:id("usr"),login,password:await bcrypt.hash(pass,12),secretQuestion:question,secretAnswerHash:hashSecret(answer),avatar:null,level:1,xp:0,balance:150,createdAt:Date.now(),lastDailySpin:0,stats:{games:0,won:0,winCount:0,chat:0,daily:0,cases:0,support:0,coinGames:0,coinWins:0,biggestWin:0,seasonalCases:0},bankBalance:0,bankDepositedAt:0,badges:[],theme:"graphite",dailyStreak:0,lastDaily:0,scCoinCostBasis:0,scCoinRealizedPnl:0,inventory:[],equipped:{avatar:null,status:"Новичок",title:null,badge:null,frame:null,effect:null},status:"Новичок",title:null,profileVisibility:{...profileVisibilityDefaults},twoFactor:false,twoFactorSecret:null,questProgress:{games:0,wins:0,chat:0,cases:0},following:[]};
  db.users.push(u);save();res.json({login,token:token(u,req),user:pub(u)});
});
app.post("/api/verify-email",async(req,res)=>res.status(410).json({error:"Подтверждение почты отключено"}));
app.post("/api/resend-email",async(req,res)=>res.status(410).json({error:"Подтверждение почты отключено"}));
function recoveryKey(req,login){return `${req.ip||"unknown"}:${String(login||"").trim().toLowerCase()}`}
function recoveryLimited(req,login){
  const key=recoveryKey(req,login),now=Date.now(),x=recoveryChallenges.get(key)||{n:0,t:now};
  if(now-x.t>10*60*1000){x.n=0;x.t=now}
  x.n++;recoveryChallenges.set(key,x);return x.n<=5;
}
function recoveryToken(){return crypto.randomBytes(32).toString("hex")}
function hashRecoveryToken(t){return crypto.createHash("sha256").update(String(t||"")).digest("hex")}
app.post("/api/recovery-question",async(req,res)=>{const login=String(req.body.login||"").trim();if(!recoveryLimited(req,login))return res.status(429).json({error:"Слишком много попыток восстановления. Подожди 10 минут."});const u=db.users.find(x=>x.login.toLowerCase()===login.toLowerCase());if(!u)return res.status(404).json({error:"Аккаунт не найден"});if(!u.secretQuestion)return res.status(400).json({error:"Для этого аккаунта секретный вопрос не настроен"});res.json({question:u.secretQuestion});});
app.post("/api/forgot-password",async(req,res)=>{
  const login=String(req.body.login||"").trim(),answer=String(req.body.secretAnswer||"").trim(),u=db.users.find(x=>x.login.toLowerCase()===login.toLowerCase());
  if(!recoveryLimited(req,login))return res.status(429).json({error:"Слишком много попыток восстановления. Подожди 10 минут."});
  if(!u)return res.status(404).json({error:"Аккаунт не найден"});
  if(!u.secretAnswerHash)return res.status(400).json({error:"Для этого старого аккаунта восстановление ещё не настроено"});
  if(hashSecret(answer)!==u.secretAnswerHash)return res.status(400).json({error:"Неверный ответ на секретный вопрос"});
  const raw=recoveryToken();recoveryChallenges.set(`token:${hashRecoveryToken(raw)}`,{uid:u.id,expiresAt:Date.now()+10*60*1000,used:false});
  res.json({ok:true,question:u.secretQuestion,emailVerified:!!u.emailVerified,recoveryToken:raw});
});
app.post("/api/reset-password",async(req,res)=>{
  const recoveryTokenValue=String(req.body.recoveryToken||""),newPass=String(req.body.newPassword||""),entry=recoveryChallenges.get(`token:${hashRecoveryToken(recoveryTokenValue)}`);
  if(!entry||entry.used||entry.expiresAt<Date.now())return res.status(400).json({error:"Ссылка восстановления недействительна или истекла"});
  if(newPass.length<6||newPass.length>72)return res.status(400).json({error:"Новый пароль: 6–72 символа"});
  const u=user(entry.uid);if(!u)return res.status(404).json({error:"Аккаунт не найден"});
  entry.used=true;u.password=await bcrypt.hash(newPass,12);save();revokeUserSessions(u.id);recoveryChallenges.delete(`token:${hashRecoveryToken(recoveryTokenValue)}`);res.json({ok:true});
});
app.post("/api/login",async(req,res)=>{const lk=(req.ip||"unknown")+":"+String(req.body.login||"").trim().toLowerCase(),lf=loginFails.get(lk)||{n:0,t:Date.now()};if(Date.now()-lf.t>60000){lf.n=0;lf.t=Date.now()}if(lf.n>=8)return res.status(429).json({error:"Слишком много попыток входа. Подожди минуту."});const u=db.users.find(x=>x.login.toLowerCase()===String(req.body.login||"").trim().toLowerCase());if(!u||!(await bcrypt.compare(String(req.body.password||""),u.password))){lf.n++;loginFails.set(lk,lf);return res.status(401).json({error:"Неверный логин или пароль"});}loginFails.delete(lk);if(u.banned)return res.status(403).json({error:`Аккаунт заблокирован: ${u.banReason||"нарушение правил"}`});if(u.twoFactor)return res.status(202).json({twoFactorRequired:true});if(!u.stats)u.stats={games:0,won:0,chat:0,daily:0,cases:0,support:0,coinGames:0,coinWins:0,biggestWin:0};u.stats={games:0,won:0,chat:0,daily:0,cases:0,support:0,coinGames:0,coinWins:0,biggestWin:0,seasonalCases:0,...u.stats};u.bankBalance=Number(u.bankBalance||0);u.bankDepositedAt=Number(u.bankDepositedAt||0);u.scCoin=Number(u.scCoin||0);if(!u.badges)u.badges=[];save();res.json({token:token(u,req),user:pub(u)});});
const GOOGLE_CLIENT_ID=String(process.env.GOOGLE_CLIENT_ID||"").trim();
app.get("/api/auth/google/config",(req,res)=>{
  res.json({enabled:!!GOOGLE_CLIENT_ID,clientId:GOOGLE_CLIENT_ID||null});
});

function googleLoginName(email,sub){
  const base=String(email||"").split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g,"").slice(0,17)||"player";
  let name=`${base}_g`;
  if(name.length<3) name=`google_${String(sub||"").slice(-8)}`;
  name=name.slice(0,24);
  if(!db.users.some(u=>u.login.toLowerCase()===name.toLowerCase())) return name;
  const suffix=String(sub||crypto.randomBytes(4).toString("hex")).replace(/[^a-z0-9]/gi,"").slice(-8);
  return (`${name.slice(0,15)}_${suffix}`).slice(0,24);
}

app.post("/api/auth/google",async(req,res)=>{
  if(!GOOGLE_CLIENT_ID)return res.status(503).json({error:"Google Login не настроен на сервере. Укажи GOOGLE_CLIENT_ID в .env и перезапусти сервер."});
  const credential=String(req.body?.credential||"").trim();
  if(!credential)return res.status(400).json({error:"Google credential не передан"});
  try{
    const r=await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    const info=await r.json().catch(()=>({}));
    if(!r.ok||info.aud!==GOOGLE_CLIENT_ID||!info.sub||String(info.email_verified).toLowerCase()!=="true")
      return res.status(401).json({error:"Не удалось подтвердить Google аккаунт"});
    const googleId=String(info.sub).slice(0,200),email=String(info.email||"").trim().toLowerCase().slice(0,200);
    let u=db.users.find(x=>x.googleId===googleId);
    let createdByGoogle=false;
    if(!u&&email) u=db.users.find(x=>x.email&&String(x.email).toLowerCase()===email);
    if(!u){
      const login=googleLoginName(email,googleId);
      u={id:id("usr"),login,password:await bcrypt.hash(crypto.randomBytes(32).toString("hex"),12),secretQuestion:null,secretAnswerHash:null,email,emailVerified:true,googleId,authProvider:"google",avatar:null,level:1,xp:0,balance:150,createdAt:Date.now(),lastDailySpin:0,stats:{games:0,won:0,winCount:0,chat:0,daily:0,cases:0,support:0,coinGames:0,coinWins:0,biggestWin:0,seasonalCases:0},bankBalance:0,bankDepositedAt:0,badges:[],theme:"graphite",dailyStreak:0,lastDaily:0,scCoinCostBasis:0,scCoinRealizedPnl:0,inventory:[],equipped:{avatar:null,status:"Новичок",title:null,badge:null,frame:null,effect:null},status:"Новичок",title:null,profileVisibility:{...profileVisibilityDefaults},twoFactor:false,twoFactorSecret:null,questProgress:{games:0,wins:0,chat:0,cases:0},following:[]};
      db.users.push(u);createdByGoogle=true;
    }else{
      u.googleId=googleId;u.email=email||u.email;u.emailVerified=true;u.authProvider="google";
    }
    normalizeUser(u);save();
    res.json({token:token(u,req),user:pub(u),createdByGoogle});
  }catch(e){
    res.status(502).json({error:"Google Login временно недоступен"});
  }
});

app.post("/api/admin/login",(req,res)=>{const login=String(req.body.login||"").trim();const key=String(req.body.key||"");const lk=(req.ip||"unknown")+":admin:"+login.toLowerCase(),lf=loginFails.get(lk)||{n:0,t:Date.now()};if(Date.now()-lf.t>10*60*1000){lf.n=0;lf.t=Date.now()}if(lf.n>=5)return res.status(429).json({error:"Слишком много попыток входа администратора. Подожди 10 минут."});const ok=login===String(process.env.SICO_ADMIN_LOGIN||"admin")&&key.length===adminKey.length&&crypto.timingSafeEqual(Buffer.from(key),Buffer.from(adminKey));if(!ok){lf.n++;loginFails.set(lk,lf);return res.status(401).json({error:"Неверные данные администратора"});}loginFails.delete(lk);const t=crypto.randomBytes(32).toString("hex");adminSessions.set(t,{at:Date.now()});res.json({token:t});});
app.post("/api/admin/logout",adminAuth,(req,res)=>{adminSessions.delete(req.adminToken);res.json({ok:true})});
app.post("/api/admin/users/:id/ban",adminAuth,(req,res)=>{const u=user(req.params.id);if(!u)return res.status(404).json({error:"Игрок не найден"});const reasons=["Нарушение правил сообщества","Баг/эксплойт","Спам/флуд","Оскорбления в чате","Другое"];const reason=reasons.includes(req.body.reason)?req.body.reason:"Нарушение правил сообщества";u.banned=true;u.banReason=reason;u.bannedAt=Date.now();revokeUserSessions(u.id);adminChat(`Игрок ${u.login} заблокирован из-за нарушений правил сообщества. Причина: ${reason}.`);adminLog("ban_user",{userId:u.id,login:u.login,reason});save();pushOnline();res.json({ok:true});});
app.post("/api/admin/users/:id/unban",adminAuth,(req,res)=>{const u=user(req.params.id);if(!u)return res.status(404).json({error:"Игрок не найден"});u.banned=false;u.banReason=null;u.bannedAt=null;adminLog("unban_user",{userId:u.id,login:u.login});save();adminChat(`Игрок ${u.login} разблокирован администрацией.`);res.json({ok:true});});
app.get("/api/admin/log",adminAuth,(req,res)=>res.json({messages:db.chat.filter(m=>m.system).slice(0,50)}));
function adminLog(action,details={}){db.adminLogs=db.adminLogs||[];db.adminLogs.unshift({id:id("alog"),action,details,at:Date.now()});db.adminLogs=db.adminLogs.slice(0,500);save();}
function adminGuard(res,ok){if(!ok){res.status(400).json({error:"Некорректные данные"});return false}return true}
app.get("/api/admin/overview",adminAuth,(req,res)=>{
  const users=db.users||[], tx=db.transactions||[], now=Date.now(), day=now-86400000;
  const volume=tx.filter(x=>x.at>=day).reduce((n,x)=>n+Math.abs(Number(x.delta)||0),0);
  const active=[...sessions.values()].filter(s=>now-s.at<30*60*1000).length;
  res.json({players:users.length,banned:users.filter(u=>u.banned).length,activeSessions:active,transactions24h:tx.filter(x=>x.at>=day).length,volume24h:volume,posts:(db.posts||[]).length,chat:(db.chat||[]).length,scInCirculation:users.reduce((n,u)=>n+(Number(u.balance)||0),0),games:tx.filter(x=>/bet|win|game|crash|roulette|blackjack|mine|dice|coinflip/i.test(x.type||"")).length});
});
app.get("/api/admin/users",adminAuth,(req,res)=>{
  const q=String(req.query.q||"").trim().toLowerCase(), page=Math.max(1,Number(req.query.page)||1), limit=Math.min(100,Math.max(10,Number(req.query.limit)||30));
  const all=db.users.map(u=>({id:u.id,login:u.login,balance:u.balance,level:u.level,xp:u.xp,banned:!!u.banned,banReason:u.banReason||null,createdAt:u.createdAt,stats:u.stats||{},twoFactor:!!u.twoFactor,mutedUntil:muteLeft(u)?u.mutedUntil:0,inventory:(u.inventory||[]).length})).filter(u=>!q||u.login.toLowerCase().includes(q)||u.id.toLowerCase().includes(q));
  res.json({users:all.slice((page-1)*limit,page*limit),total:all.length,page,limit});
});
app.get("/api/admin/users/:id",adminAuth,(req,res)=>{const u=user(req.params.id);if(!u)return res.status(404).json({error:"Игрок не найден"});res.json({user:{id:u.id,login:u.login,balance:u.balance,level:u.level,xp:u.xp,createdAt:u.createdAt,banned:!!u.banned,banReason:u.banReason||null,mutedUntil:muteLeft(u)?u.mutedUntil:0,muteReason:u.muteReason||null,twoFactor:!!u.twoFactor,stats:u.stats||{},inventory:u.inventory||[],following:u.following||[]},sessions:[...sessions.entries()].filter(([,s])=>s.uid===u.id).map(([t,s])=>sessionView(t,s,null)),transactions:db.transactions.filter(x=>x.userId===u.id).slice(0,50)});});
app.post("/api/admin/users/:id/balance",adminAuth,(req,res)=>{const u=user(req.params.id),amount=Math.trunc(Number(req.body.amount)),reason=String(req.body.reason||"").trim().slice(0,160);if(!u)return res.status(404).json({error:"Игрок не найден"});if(!adminGuard(res,Number.isSafeInteger(amount)&&amount!==0&&reason.length>=3))return;try{forceWallet(u,amount,"admin_adjust",{reason});adminLog("balance_adjust",{userId:u.id,login:u.login,amount,reason});res.json({ok:true,user:pub(u)});}catch(e){res.status(400).json({error:e.message})}});
app.post("/api/admin/users/:id/logout",adminAuth,(req,res)=>{const u=user(req.params.id);if(!u)return res.status(404).json({error:"Игрок не найден"});const n=revokeUserSessions(u.id);adminLog("force_logout",{userId:u.id,login:u.login,sessions:n});res.json({ok:true,sessions:n})});
function purgeUserData(uid){
  db.users=db.users.filter(x=>x.id!==uid);
  db.likes=db.likes.filter(x=>x.userId!==uid);
  db.loans=db.loans.filter(x=>x.from!==uid&&x.to!==uid);
  db.transactions=db.transactions.filter(x=>x.userId!==uid);
  db.bets=db.bets.filter(x=>x.userId!==uid);
  db.achievements=db.achievements.filter(x=>x.userId!==uid);
  db.daily=db.daily.filter(x=>x.userId!==uid);
  db.chat=db.chat.filter(x=>x.userId!==uid);
  db.posts=db.posts.filter(x=>x.userId!==uid);
  db.follows=db.follows.filter(x=>x.userId!==uid&&x.targetId!==uid&&x.from!==uid&&x.to!==uid);
  for(const u of db.users){
    if(Array.isArray(u.following))u.following=u.following.filter(id=>id!==uid);
  }
  db.adminLogs=db.adminLogs.map(x=>x);
  revokeUserSessions(uid);
  for(const [k,v] of recoveryChallenges){if(v.uid===uid||k.includes(uid))recoveryChallenges.delete(k)}
}
app.delete("/api/admin/users/:id",adminAuth,(req,res)=>{const u=user(req.params.id);if(!u)return res.status(404).json({error:"Игрок не найден"});if(u.login===String(process.env.SICO_ADMIN_LOGIN||"admin"))return res.status(400).json({error:"Нельзя удалить системного администратора"});const uid=u.id,login=u.login;purgeUserData(uid);adminLog("delete_user",{userId:uid,login});save();pushOnline();res.json({ok:true})});
app.get("/api/admin/transactions",adminAuth,(req,res)=>{const q=String(req.query.q||"").toLowerCase(),limit=Math.min(200,Math.max(20,Number(req.query.limit)||80));const rows=db.transactions.filter(t=>{const u=user(t.userId);return !q||String(t.type).toLowerCase().includes(q)||String(u?.login||"").toLowerCase().includes(q)}).slice(0,limit).map(t=>({...t,login:user(t.userId)?.login||"Удалён"}));res.json({transactions:rows})});
app.get("/api/admin/content",adminAuth,(req,res)=>res.json({posts:(db.posts||[]).slice(0,80).map(p=>({...p,login:user(p.userId)?.login||"Удалён",likes:(p.likes||[]).length})),chat:(db.chat||[]).slice(0,80),logs:(db.adminLogs||[]).slice(0,100)}));
app.delete("/api/admin/posts/:id",adminAuth,(req,res)=>{const i=db.posts.findIndex(p=>p.id===req.params.id);if(i<0)return res.status(404).json({error:"Пост не найден"});const p=db.posts[i];db.posts.splice(i,1);adminLog("delete_post",{postId:p.id,userId:p.userId});save();res.json({ok:true})});
app.delete("/api/admin/chat/:id",adminAuth,(req,res)=>{const i=db.chat.findIndex(m=>m.id===req.params.id);if(i<0)return res.status(404).json({error:"Сообщение не найдено"});const m=db.chat[i];db.chat.splice(i,1);adminLog("delete_chat",{messageId:m.id,userId:m.userId||null});save();res.json({ok:true})});
app.post("/api/admin/broadcast",adminAuth,(req,res)=>{const text=String(req.body.text||"").trim().slice(0,280);if(!text)return res.status(400).json({error:"Текст пустой"});adminChat(`📢 ${text}`);adminLog("broadcast",{text});res.json({ok:true})});
// Admin operations: live monitor, reports, events and diagnostics.
app.get("/api/admin/live",adminAuth,(req,res)=>{const now=Date.now();const active=[...sessions.entries()].filter(([,v])=>now-(v.at||0)<30*60*1000).map(([token,v])=>({user:pub(user(v.uid)||{}),lastSeen:v.at})).filter(x=>x.user&&x.user.id);res.json({active,totalSessions:sessions.size,recentChat:(db.chat||[]).slice(0,12).map(m=>({...m,login:user(m.userId)?.login||m.login||'SICO'})),recentTransactions:(db.transactions||[]).slice(0,12).map(t=>({...t,login:user(t.userId)?.login||'Удалён'}))})});
app.get("/api/admin/diagnostics",adminAuth,(req,res)=>{const users=db.users||[];res.json({uptime:process.uptime(),node:process.version,memory:process.memoryUsage(),database:{users:users.length,chat:(db.chat||[]).length,transactions:(db.transactions||[]).length,posts:(db.posts||[]).length,logs:(db.adminLogs||[]).length},timestamp:Date.now(),checks:{database:!!sqlite,adminKey:!!adminKey,storage:!!db}})});
app.get("/api/admin/reports",adminAuth,(req,res)=>res.json({reports:(db.reports||[]).slice(0,200)}));
app.post("/api/admin/reports/:id/resolve",adminAuth,(req,res)=>{db.reports=db.reports||[];const r=db.reports.find(x=>x.id===req.params.id);if(!r)return res.status(404).json({error:'Жалоба не найдена'});r.status='resolved';r.resolvedAt=Date.now();r.resolution=String(req.body.resolution||'Рассмотрено администрацией').slice(0,300);adminLog('resolve_report',{reportId:r.id,resolution:r.resolution});save();res.json({ok:true,report:r})});
// ===== v45: жалобы игроков, мут, кик, экспорт CSV, журнал =====
const REPORT_REASONS={spam:"Спам/флуд",abuse:"Оскорбления",scam:"Мошенничество",exploit:"Баг/эксплойт",other:"Другое"};
const reportCooldown=new Map();
function csvCell(v){let s=v==null?"":(typeof v==="object"?JSON.stringify(v):String(v));if(typeof v==="string"&&/^[=+\-@\t\r]/.test(s))s="'"+s;return /[";\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function csvSend(res,name,header,rows){const body="\ufeff"+[header,...rows].map(r=>r.map(csvCell).join(";")).join("\r\n");res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename="${name}-${new Date().toISOString().slice(0,10)}.csv"`);res.send(body)}
const iso=t=>t?new Date(t).toISOString():"";
function muteLeft(u){const left=(u.mutedUntil||0)-Date.now();return left>0?left:0}
function fmtLeft(ms){const m=Math.ceil(ms/60000);return m>=60?`${Math.floor(m/60)} ч ${m%60} мин`:`${m} мин`}
app.post("/api/report",auth,requestOnce,(req,res)=>{
  const now=Date.now(),last=reportCooldown.get(req.user.id)||0;
  if(now-last<15000)return res.status(429).json({error:"Подожди немного перед следующей жалобой"});
  const reason=REPORT_REASONS[String(req.body.reason||"other")];
  if(!reason)return res.status(400).json({error:"Выбери причину жалобы"});
  const details=String(req.body.text||"").trim().slice(0,300);
  let target=null,msg=null;
  if(req.body.messageId){msg=(db.chat||[]).find(m=>m.id===String(req.body.messageId));if(!msg)return res.status(404).json({error:"Сообщение уже недоступно"});if(msg.system||!msg.userId)return res.status(400).json({error:"На системное сообщение пожаловаться нельзя"});target=user(msg.userId)}
  else target=user(String(req.body.targetId||""));
  if(!target)return res.status(404).json({error:"Игрок не найден"});
  if(target.id===req.user.id)return res.status(400).json({error:"Нельзя пожаловаться на себя"});
  db.reports=db.reports||[];
  if(db.reports.some(r=>r.status!=="resolved"&&r.reporterId===req.user.id&&r.targetId===target.id&&now-(r.at||0)<86400000))return res.status(409).json({error:"Ты уже отправлял жалобу на этого игрока — её рассматривают"});
  db.reports.unshift({id:id("rep"),type:msg?"message":"user",subject:`${reason}: ${target.login}`,reporterId:req.user.id,reporterLogin:req.user.login,targetId:target.id,targetLogin:target.login,messageId:msg?msg.id:null,messageText:msg?String(msg.text||"").slice(0,280):null,reason,text:details,status:"open",at:now});
  db.reports=db.reports.slice(0,300);reportCooldown.set(req.user.id,now);save();res.json({ok:true});
});
app.post("/api/admin/users/:id/mute",adminAuth,(req,res)=>{const u=user(req.params.id);if(!u)return res.status(404).json({error:"Игрок не найден"});const minutes=Math.trunc(Number(req.body.minutes));if(!adminGuard(res,Number.isFinite(minutes)&&minutes>=1&&minutes<=43200))return;const reason=String(req.body.reason||"").trim().slice(0,120)||"Нарушение правил чата";u.mutedUntil=Date.now()+minutes*60000;u.muteReason=reason;adminLog("mute_user",{userId:u.id,login:u.login,minutes,reason});save();res.json({ok:true,mutedUntil:u.mutedUntil})});
app.post("/api/admin/users/:id/unmute",adminAuth,(req,res)=>{const u=user(req.params.id);if(!u)return res.status(404).json({error:"Игрок не найден"});u.mutedUntil=0;u.muteReason=null;adminLog("unmute_user",{userId:u.id,login:u.login});save();res.json({ok:true})});
app.post("/api/admin/users/:id/kick",adminAuth,(req,res)=>{const u=user(req.params.id);if(!u)return res.status(404).json({error:"Игрок не найден"});const reason=String(req.body.reason||"").trim().slice(0,120)||"Без причины";const n=revokeUserSessions(u.id);adminLog("kick_user",{userId:u.id,login:u.login,sessions:n,reason});res.json({ok:true,sessions:n})});
app.get("/api/admin/logs",adminAuth,(req,res)=>res.json({logs:(db.adminLogs||[]).slice(0,500)}));
app.get("/api/admin/export/:what",adminAuth,(req,res)=>{
  const w=req.params.what;
  if(w==="players")return csvSend(res,"sico-players",["id","login","balance","level","xp","banned","banReason","mutedUntil","twoFactor","games","createdAt"],(db.users||[]).map(u=>[u.id,u.login,u.balance,u.level,u.xp,!!u.banned,u.banReason||"",iso(muteLeft(u)?u.mutedUntil:0),!!u.twoFactor,(u.stats||{}).games||0,iso(u.createdAt)]));
  if(w==="transactions")return csvSend(res,"sico-transactions",["at","login","userId","type","delta","meta"],(db.transactions||[]).map(t=>[iso(t.at),user(t.userId)?.login||"Удалён",t.userId,t.type,t.delta,t.meta||""]));
  if(w==="logs")return csvSend(res,"sico-admin-log",["at","action","details"],(db.adminLogs||[]).map(l=>[iso(l.at),l.action,l.details||""]));
  if(w==="reports")return csvSend(res,"sico-reports",["at","status","reason","reporter","target","message","details","resolution"],(db.reports||[]).map(r=>[iso(r.at),r.status||"open",r.reason||r.subject||"",r.reporterLogin||"",r.targetLogin||"",r.messageText||"",r.text||"",r.resolution||""]));
  res.status(404).json({error:"Неизвестный экспорт"});
});
app.get("/api/admin/events",adminAuth,(req,res)=>res.json({events:(db.adminEvents||[]).slice(0,100)}));
app.post("/api/admin/events",adminAuth,(req,res)=>{const title=String(req.body.title||'').trim().slice(0,100),description=String(req.body.description||'').trim().slice(0,500),startAt=Number(req.body.startAt)||Date.now(),endAt=Number(req.body.endAt)||startAt+3600000;if(title.length<3||endAt<=startAt)return res.status(400).json({error:'Проверь название и даты события'});db.adminEvents=db.adminEvents||[];const event={id:id('evt'),title,description,startAt,endAt,createdAt:Date.now(),active:true};db.adminEvents.unshift(event);adminLog('create_event',{eventId:event.id,title});save();res.json({ok:true,event})});
app.post("/api/admin/events/:id/toggle",adminAuth,(req,res)=>{const e=(db.adminEvents||[]).find(x=>x.id===req.params.id);if(!e)return res.status(404).json({error:'Событие не найдено'});e.active=!e.active;adminLog('toggle_event',{eventId:e.id,active:e.active});save();res.json({ok:true,event:e})});
app.delete("/api/admin/events/:id",adminAuth,(req,res)=>{const i=(db.adminEvents||[]).findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:'Событие не найдено'});const [e]=db.adminEvents.splice(i,1);adminLog('delete_event',{eventId:e.id});save();res.json({ok:true})});
app.get("/api/admin/promocodes",adminAuth,(req,res)=>res.json({promocodes:(db.promocodes||[]).map(p=>({...p,uses:(p.usedBy||[]).length,usedBy:undefined}))}));
app.post("/api/admin/promocodes",adminAuth,(req,res)=>{
 const code=String(req.body.code||"").trim().toUpperCase().replace(/\s+/g,"").slice(0,40);
 const reward=String(req.body.reward||"sc"); const amount=Math.trunc(Number(req.body.amount)); const limit=Math.trunc(Number(req.body.limit));
 const caseName=String(req.body.caseName||"");
 if(!/^[A-Z0-9_-]{3,40}$/.test(code))return res.status(400).json({error:"Код: 3–40 символов A–Z, 0–9, _ или -"});
 if((db.promocodes||[]).some(p=>p.code===code))return res.status(409).json({error:"Такой промокод уже существует"});
 if(!["sc","xp","case"].includes(reward))return res.status(400).json({error:"Неизвестный тип награды"});
 if(reward==="case"?!Object.hasOwn(cases,caseName):(!Number.isSafeInteger(amount)||amount<1||amount>100000000))return res.status(400).json({error:"Проверь награду и её количество"});
 if(!Number.isSafeInteger(limit)||limit<1||limit>1000000)return res.status(400).json({error:"Лимит активаций должен быть от 1 до 1 000 000"});
 const promo={id:id("promo"),code,reward,amount:reward==="case"?1:amount,caseName:reward==="case"?caseName:null,limit,usedBy:[],createdAt:Date.now(),active:true};
 db.promocodes.unshift(promo);adminLog("promo_create",{code,reward,amount:promo.amount,caseName:promo.caseName,limit});save();res.json({ok:true,promo:{...promo,uses:0,usedBy:undefined}});
});
app.post("/api/admin/promocodes/:id/toggle",adminAuth,(req,res)=>{const p=(db.promocodes||[]).find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:"Промокод не найден"});p.active=!p.active;adminLog("promo_toggle",{code:p.code,active:p.active});save();res.json({ok:true,active:p.active})});
app.delete("/api/admin/promocodes/:id",adminAuth,(req,res)=>{const i=(db.promocodes||[]).findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Промокод не найден"});const [p]=db.promocodes.splice(i,1);adminLog("promo_delete",{code:p.code});save();res.json({ok:true})});
app.post("/api/promocodes/redeem",auth,requestOnce,(req,res)=>{
 const code=String(req.body.code||"").trim().toUpperCase().replace(/\s+/g,"").slice(0,40);const p=(db.promocodes||[]).find(x=>x.code===code&&x.active);
 if(!p)return res.status(404).json({error:"Промокод не найден или отключён"});p.usedBy=Array.isArray(p.usedBy)?p.usedBy:[];
 if(p.usedBy.includes(req.user.id))return res.status(409).json({error:"Ты уже использовал этот промокод"});if(p.usedBy.length>=p.limit)return res.status(409).json({error:"Лимит активаций исчерпан"});
 if(p.reward==="sc"){wallet(req.user,p.amount,"promo_reward",{code:p.code});}
 else if(p.reward==="xp"){addXP(req.user,p.amount);save();push("wallet",{userId:req.user.id,balance:req.user.balance,level:req.user.level,xp:req.user.xp});}
 else if(p.reward==="case"){req.user.promoCases=Array.isArray(req.user.promoCases)?req.user.promoCases:[];req.user.promoCases.push({id:id("pcase"),name:p.caseName,at:Date.now()});save();}
 p.usedBy.push(req.user.id);adminLog("promo_redeem",{code:p.code,userId:req.user.id,reward:p.reward});save();res.json({ok:true,message:p.reward==="sc"?`Начислено ${p.amount} SC`:p.reward==="xp"?`Начислено ${p.amount} XP`:`Получен кейс ${p.caseName}`,user:pub(req.user)});
});
app.get("/api/admin/cases",adminAuth,(req,res)=>res.json({cases}));


app.get('/api/security/2fa',auth,(req,res)=>res.json({enabled:!!req.user.twoFactor}));
app.post('/api/security/2fa/setup',auth,requestOnce,(req,res)=>{if(req.user.twoFactor)return res.status(409).json({error:'2FA уже включена'});const secret=b32Encode(crypto.randomBytes(20));req.user.twoFactorSecret=secret;save();const issuer='SICO';const label=encodeURIComponent(`${issuer}:${req.user.login}`);res.json({secret,otpauth:`otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`});});
app.post('/api/security/2fa/enable',auth,requestOnce,(req,res)=>{if(!req.user.twoFactorSecret)return res.status(400).json({error:'Сначала начни настройку 2FA'});if(!verifyTotp(req.user.twoFactorSecret,req.body.code))return res.status(400).json({error:'Неверный код 2FA'});req.user.twoFactor=true;save();res.json({ok:true,user:pub(req.user)});});
app.post('/api/security/2fa/disable',auth,requestOnce,(req,res)=>{if(req.user.twoFactor&&!verifyTotp(req.user.twoFactorSecret,req.body.code))return res.status(400).json({error:'Неверный код 2FA'});req.user.twoFactor=false;req.user.twoFactorSecret=null;revokeUserSessions(req.user.id,req.token);save();res.json({ok:true,user:pub(req.user)});});
app.get('/api/security/sessions',auth,(req,res)=>res.json({sessions:[...sessions.entries()].filter(([,s])=>s.uid===req.user.id).map(([t,s])=>sessionView(t,s,req.token)).sort((a,b)=>b.createdAt-a.createdAt)}));
app.delete('/api/security/sessions/:id',auth,(req,res)=>{const target=[...sessions.entries()].find(([t,s])=>s.uid===req.user.id&&sessionView(t,s,req.token).id===req.params.id);if(!target)return res.status(404).json({error:'Сессия не найдена'});revokeSession(target[0]);pushOnline();res.json({ok:true});});
app.post('/api/security/sessions/logout-others',auth,requestOnce,(req,res)=>{revokeUserSessions(req.user.id,req.token);pushOnline();res.json({ok:true});});
app.post('/api/security/password',auth,requestOnce,async(req,res)=>{const old=String(req.body.currentPassword||''),next=String(req.body.newPassword||''),code=String(req.body.code||'');if(!(await bcrypt.compare(old,req.user.password)))return res.status(400).json({error:'Текущий пароль неверен'});if(next.length<6||next.length>72)return res.status(400).json({error:'Новый пароль: 6–72 символа'});if(req.user.twoFactor&&!verifyTotp(req.user.twoFactorSecret,code))return res.status(400).json({error:'Нужен действующий код 2FA'});req.user.password=await bcrypt.hash(next,12);revokeUserSessions(req.user.id,req.token);save();res.json({ok:true});});
app.post('/api/login/2fa',async(req,res)=>{const login=String(req.body.login||'').trim(),password=String(req.body.password||''),code=String(req.body.code||''),lk=(req.ip||'unknown')+':2fa:'+login.toLowerCase(),lf=loginFails.get(lk)||{n:0,t:Date.now()};if(Date.now()-lf.t>60000){lf.n=0;lf.t=Date.now()}if(lf.n>=8)return res.status(429).json({error:'Слишком много попыток кода 2FA. Подожди минуту.'});const u=db.users.find(x=>x.login.toLowerCase()===login.toLowerCase());if(!u||!(await bcrypt.compare(password,u.password))){lf.n++;loginFails.set(lk,lf);return res.status(401).json({error:'Неверные данные'})}if(!u.twoFactor||!verifyTotp(u.twoFactorSecret,code)){lf.n++;loginFails.set(lk,lf);return res.status(401).json({error:'Неверный код 2FA'})}loginFails.delete(lk);if(u.banned)return res.status(403).json({error:`Аккаунт заблокирован: ${u.banReason||'нарушение правил'}`});res.json({token:token(u,req),user:pub(u)});});
app.post("/api/logout",auth,(req,res)=>{revokeSession(req.token);pushOnline();res.json({ok:true})});
app.get("/api/me",auth,(req,res)=>res.json({user:pub(req.user)}));
const storage=multer.diskStorage({destination:UP,filename:(_,f,cb)=>cb(null,id("av")+path.extname(f.originalname).toLowerCase())});
const upload=multer({storage,limits:{fileSize:25*1024*1024},fileFilter:(_,f,cb)=>{if(/^image\/(png|jpe?g|webp|gif)$/i.test(f.mimetype))return cb(null,true);cb(new Error("Неподдерживаемый формат изображения"));}});
app.post("/api/avatar",auth,upload.single("avatar"),(req,res)=>{if(!req.file)return res.status(400).json({error:"Изображение PNG/JPG/WEBP/GIF до 25 МБ"});if(req.user.avatar)try{fs.unlinkSync(path.join(UP,path.basename(req.user.avatar)))}catch{}req.user.avatar="/avatars/"+req.file.filename;save();res.json({user:pub(req.user)});});
app.post("/api/theme",auth,(req,res)=>{const allowed=["graphite","ice","violet","lime","autumn"];if(!allowed.includes(req.body.theme))return res.status(400).json({error:"Неизвестная тема"});req.user.theme=req.body.theme;save();res.json({user:pub(req.user)});});
app.get("/api/inventory",auth,(req,res)=>res.json({items:(req.user.inventory||[]).map(itemView).filter(Boolean),equipped:req.user.equipped||{},catalog:Object.values(inventoryCatalog),cosmeticCase:{cost:cosmeticCase.cost}}));
app.post("/api/inventory/equip",auth,requestOnce,(req,res)=>{
  const itemId=String(req.body.itemId||'').trim(), item=inventoryCatalog[itemId];
  if(!item||!(req.user.inventory||[]).includes(itemId))return res.status(400).json({error:"Предмет не найден в инвентаре"});
  req.user.equipped=req.user.equipped||{};
  req.user.equipped[item.type]=itemId;
  if(item.type==='status')req.user.status=item.value;
  if(item.type==='title')req.user.title=item.value;
  save();res.json({user:pub(req.user)});
});
app.post("/api/inventory/unequip",auth,requestOnce,(req,res)=>{const type=String(req.body.type||'').trim();if(!['avatar','status','title','badge','frame','effect'].includes(type))return res.status(400).json({error:"Неизвестный тип"});req.user.equipped=req.user.equipped||{};req.user.equipped[type]=null;if(type==='status')req.user.status='Новичок';if(type==='title')req.user.title=null;save();res.json({user:pub(req.user)});});
app.post("/api/profile/settings",auth,requestOnce,(req,res)=>{
  const status=String(req.body.status??req.user.status??'Новичок').trim().slice(0,80), title=String(req.body.title??req.user.title??'').trim().slice(0,80);
  if(status){req.user.status=status;req.user.equipped=req.user.equipped||{};req.user.equipped.status=null;}
  req.user.title=title||null;req.user.equipped=req.user.equipped||{};req.user.equipped.title=null;
  const vis=profileVis(req.user), incoming=req.body.visibility||{};
  for(const k of Object.keys(profileVisibilityDefaults))if(typeof incoming[k]==='boolean')vis[k]=incoming[k];
  req.user.profileVisibility=vis;save();res.json({user:pub(req.user)});
});

app.delete("/api/account",auth,(req,res)=>{const uid=req.user.id;for(const ws of sockets)if(ws.userId===uid){ws.userId=null}pushOnline();db.users=db.users.filter(u=>u.id!==uid);for(const k of ["likes","transactions","loans","bets","achievements","daily","chat"])db[k]=db[k].filter(x=>x.userId!==uid&&x.from!==uid&&x.to!==uid);revokeUserSessions(uid);save();res.json({ok:true});});
app.get("/api/support",(_,res)=>res.json({count:db.likes.length}));
app.post("/api/support",auth,(req,res)=>{if(!db.likes.some(x=>x.userId===req.user.id)){db.likes.push({userId:req.user.id,at:Date.now()});stat(req.user,"support");save();push("support",{count:db.likes.length});}res.json({count:db.likes.length,liked:true});});
app.get("/api/players",auth,(_,res)=>res.json(db.users.map(publicSummary)));
app.get("/api/history",auth,(req,res)=>res.json({transactions:db.transactions.filter(x=>x.userId===req.user.id).slice(0,60),loans:db.loans.filter(x=>x.from===req.user.id||x.to===req.user.id).slice(0,30),bets:db.bets.filter(x=>x.userId===req.user.id).slice(0,40)}));
app.get("/api/achievements",auth,(req,res)=>res.json({defs:achievementDefs.map(([key,title,desc])=>({key,title,desc,unlocked:(req.user.badges||[]).includes(key)}))}));
app.get("/api/daily",auth,(req,res)=>res.json({streak:req.user.dailyStreak||0,claimed:req.user.lastDaily&&new Date(req.user.lastDaily).toDateString()===new Date().toDateString()}));
app.post("/api/daily",auth,requestOnce,(req,res)=>{const now=Date.now(),day=86400000;if(req.user.lastDaily&&new Date(req.user.lastDaily).toDateString()===new Date(now).toDateString())return res.status(409).json({error:"Сегодня бонус уже забран"});const yesterday=new Date(now-day).toDateString();req.user.dailyStreak=(req.user.lastDaily&&new Date(req.user.lastDaily).toDateString()===yesterday)?(req.user.dailyStreak||0)+1:1;const reward=25+Math.min(req.user.dailyStreak,7)*10;req.user.lastDaily=now;stat(req.user,"daily");wallet(req.user,reward,"daily_bonus",{streak:req.user.dailyStreak});checkAchievements(req.user);db.daily.push({id:id("daily"),userId:req.user.id,reward,streak:req.user.dailyStreak,at:now});save();res.json({reward,streak:req.user.dailyStreak,user:pub(req.user)});});
app.get("/api/chat",auth,(_,res)=>res.json({messages:db.chat.slice(0,80)}));
app.post("/api/chat",auth,requestOnce,(req,res)=>{const mLeft=muteLeft(req.user);if(mLeft)return res.status(403).json({error:`Ты в муте ещё ${fmtLeft(mLeft)}. Причина: ${req.user.muteReason||"нарушение правил чата"}`});const now=Date.now(),last=chatCooldown.get(req.user.id)||0;if(now-last<5000)return res.status(429).json({error:`Подожди ${Math.ceil((5000-(now-last))/1000)} сек. перед следующим сообщением`});const text=safeChat(req.body.text);if(text.length<1)return res.status(400).json({error:"Сообщение пустое"});const m={id:id("msg"),userId:req.user.id,login:req.user.login,text,at:now};chatCooldown.set(req.user.id,now);db.chat.unshift(m);db.chat=db.chat.slice(0,30);stat(req.user,"chat");save();push("chat",m);res.json({message:m});});
app.post("/api/transfer",auth,requestOnce,(req,res)=>{const to=db.users.find(u=>u.login.toLowerCase()===String(req.body.login||"").trim().toLowerCase()),amount=Math.floor(Number(req.body.amount));if(!to||to.id===req.user.id||!Number.isSafeInteger(amount)||amount<1||amount>1000000)return res.status(400).json({error:"Проверь игрока и сумму"});const fee=feeFor(amount),total=amount+fee;if(req.user.balance<total)return res.status(400).json({error:`Нужно ${total} SC с учётом комиссии 15%`});wallet(req.user,-total,"transfer_sent",{to:to.id,fee});wallet(to,amount,"transfer_received",{from:req.user.id,fee});res.json({user:pub(req.user),amount,fee,total});});
app.post("/api/loan",auth,requestOnce,(req,res)=>{const to=db.users.find(u=>u.login.toLowerCase()===String(req.body.login||"").trim().toLowerCase()),amount=Math.floor(Number(req.body.amount));if(!to||to.id===req.user.id||!Number.isSafeInteger(amount)||amount<1||amount>1000000)return res.status(400).json({error:"Проверь игрока и сумму"});const fee=feeFor(amount),totalDebit=amount+fee;if(req.user.balance<totalDebit)return res.status(400).json({error:`Нужно ${totalDebit} SC с учётом комиссии 15%`});if(db.loans.some(x=>x.from===req.user.id&&x.to===to.id&&x.status==="pending"))return res.status(409).json({error:"У тебя уже есть ожидающий запрос этому игроку"});const loan={id:id("loan"),from:req.user.id,to:to.id,principal:amount,fee,total:amount+fee,remaining:amount,status:"pending",days:null,at:Date.now()};db.loans.push(loan);save();push("loan",{loan});res.json({loan});});
app.post("/api/loan/:id/accept",auth,requestOnce,(req,res)=>{const l=db.loans.find(x=>x.id===req.params.id&&x.to===req.user.id&&x.status==="pending");if(!l)return res.status(404).json({error:"Запрос займа не найден"});const days=Math.floor(Number(req.body.days));if(![1,2].includes(days))return res.status(400).json({error:"Выбери срок займа: 1 или 2 суток"});const from=user(l.from);if(!from)return res.status(400).json({error:"Отправитель недоступен"});const fee=feeFor(l.principal),total=l.principal+fee;if(from.balance<total)return res.status(400).json({error:`У отправителя недостаточно SC: нужно ${total} с комиссией`});try{wallet(from,-total,"loan_sent",{to:l.to,loan:l.id,fee});wallet(req.user,l.principal,"loan_received",{from:l.from,loan:l.id});}catch(e){return res.status(400).json({error:e.message})}l.status="open";l.acceptedAt=Date.now();l.dueAt=l.acceptedAt+days*86400000;l.days=days;l.fee=fee;l.total=l.principal+fee;l.remaining=l.principal;save();push("loan",{loan:l});res.json({loan:l,user:pub(req.user)});});
app.post("/api/loan/:id/decline",auth,requestOnce,(req,res)=>{const l=db.loans.find(x=>x.id===req.params.id&&x.to===req.user.id&&x.status==="pending");if(!l)return res.status(404).json({error:"Запрос займа не найден"});l.status="declined";l.declinedAt=Date.now();save();push("loan",{loan:l});res.json({loan:l});});
app.post("/api/loan/:id/pay",auth,requestOnce,(req,res)=>{const l=db.loans.find(x=>x.id===req.params.id&&x.to===req.user.id&&x.status==="open");if(!l)return res.status(404).json({error:"Активный займ не найден"});const fee=feeFor(l.principal),total=l.principal+fee;if(req.user.balance<total)return res.status(400).json({error:`Нужно ${total} SC для полного погашения`});wallet(req.user,-total,"loan_payment",{loan:l.id,fee});wallet(user(l.from),l.principal,"loan_repaid",{loan:l.id,fee});l.remaining=0;l.status="closed";l.closedAt=Date.now();l.fee=fee;save();push("loan",{loan:l});res.json({loan:l,user:pub(req.user)});});
app.get("/api/bank/overview",auth,(req,res)=>{expireLoans();const loans=db.loans.filter(x=>x.from===req.user.id||x.to===req.user.id).slice(0,50);const ids=[...new Set(loans.flatMap(x=>[x.from,x.to]))];const players=ids.map(uid=>user(uid)).filter(Boolean).map(pub);res.json({balance:req.user.balance,feePercent:15,loans,players,transactions:db.transactions.filter(x=>x.userId===req.user.id).slice(0,60)});});
app.get("/api/turnover",auth,(req,res)=>{const tx=db.transactions.filter(x=>x.userId===req.user.id).slice(0,500),incoming=tx.filter(x=>x.delta>0).map(x=>x.delta),outgoing=tx.filter(x=>x.delta<0).map(x=>Math.abs(x.delta)),all=tx.map(x=>Math.abs(x.delta));const avg=a=>a.length?Math.round(a.reduce((s,n)=>s+n,0)/a.length):0;res.json({count:tx.length,incoming:avg(incoming),outgoing:avg(outgoing),combined:avg(all),totalIn:incoming.reduce((s,n)=>s+n,0),totalOut:outgoing.reduce((s,n)=>s+n,0)});});

const sockets=new Set();
function onlineUsers(){const ids=new Set();for(const ws of sockets)if(ws.readyState===1&&ws.userId)ids.add(ws.userId);return ids.size}
function push(type,payload){const s=JSON.stringify({type,payload});for(const ws of sockets)if(ws.readyState===1)ws.send(s)}
function pushOnline(){push("online",{count:onlineUsers()})}
wss.on("connection",ws=>{sockets.add(ws);ws.userId=null;ws.sessionToken=null;ws.isAlive=true;ws.on("pong",()=>{ws.isAlive=true});ws.on("message",raw=>{try{const m=JSON.parse(raw.toString());if(m.type!=="auth")return;const t=String(m.token||""),d=String(m.device||"").slice(0,100);const ses=sessions.get(t),u=ses&&user(ses.uid);if(!u||u.banned||!ses||ses.device!=="unknown"&&d&&ses.device!==d){try{ws.close(4003,"Unauthorized")}catch{}return}ws.sessionToken=t;ws.userId=u.id;ws.send(JSON.stringify({type:"ws-auth",payload:{ok:true}}));pushOnline()}catch{}});ws.on("close",()=>{sockets.delete(ws);pushOnline()});ws.send(JSON.stringify({type:"state",payload:{crash,roulette}}));});
const wsHeartbeat=setInterval(()=>{for(const ws of sockets){if(ws.isAlive===false){try{ws.terminate()}catch{}continue}ws.isAlive=false;try{ws.ping()}catch{}}},30000);

let crash={round:0,state:"waiting",multiplier:1,crashAt:1.01,startedAt:0,bets:[],history:[]};let roulette={round:0,state:"open",endsAt:0,bets:[],last:null,history:[]};
function tri(min,max){const a=crypto.randomInt(0,1_000_000)/1_000_000,b=crypto.randomInt(0,1_000_000)/1_000_000;return min+(max-min)*(a+b)/2}
function crashPoint(){
  const r=crypto.randomInt(0,1_000_000)/1_000_000;
  if(r<0.18)return +tri(1.55,1.75).toFixed(2);
  if(r<0.52)return +tri(1.35,2.35).toFixed(2);
  if(r<0.80)return +tri(2.15,3.45).toFixed(2);
  if(r<0.96)return +tri(3.15,6.5).toFixed(2);
  return +tri(6.0,20).toFixed(2);
}
function beginCrash(){crash={...crash,round:crash.round+1,state:"waiting",multiplier:1,crashAt:crashPoint(),startedAt:0,bets:[]};push("crash",crash);setTimeout(()=>{crash.state="running";crash.startedAt=Date.now();push("crash",crash)},10000)}
function crashTick(){if(crash.state!=="running")return;crash.multiplier=+Math.min(crash.crashAt,Math.exp((Date.now()-crash.startedAt)/1000*.085)).toFixed(2);push("crash",crash);if(crash.multiplier>=crash.crashAt){crash.state="crashed";crash.history.unshift({round:crash.round,x:crash.crashAt});crash.history=crash.history.slice(0,20);for(const b of crash.bets){if(b.status==="active")b.status="lost";db.bets.push({...b,game:"crash",status:b.status,result:crash.crashAt,at:Date.now()});}save();push("crash",crash);setTimeout(beginCrash,3200)}}
function beginRoulette(){roulette={...roulette,round:roulette.round+1,state:"open",endsAt:Date.now()+10000,bets:[],last:null};push("roulette",roulette);setTimeout(spinRoulette,10000)}
function spinRoulette(){if(roulette.state!=="open")return;roulette.state="spinning";push("roulette",roulette);setTimeout(()=>{const n=crypto.randomInt(0,37),color=n===0?"green":([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(n)?"red":"black");roulette.last={n,color};roulette.state="result";for(const b of roulette.bets){const win=b.choice===color||b.choice===n;if(win){const mult=b.choice==="green"?14:2;try{wallet(user(b.userId),b.amount*mult,"roulette_win",{round:roulette.round});stat(user(b.userId),"won",b.amount*mult);}catch{}b.status="won";b.payout=b.amount*mult}else b.status="lost";db.bets.push({...b,game:"roulette",result:roulette.last,at:Date.now()});stat(user(b.userId),"games");}roulette.history.unshift(roulette.last);roulette.history=roulette.history.slice(0,20);save();push("roulette",roulette);setTimeout(beginRoulette,3000)},4200)}
setInterval(crashTick,120);beginCrash();beginRoulette();

const levelMilestones=[{level:5,reward:100,label:'Разогрев',desc:'+100 SC за 5 уровень'},{level:10,reward:250,label:'Десятка',desc:'+250 SC за 10 уровень'},{level:15,reward:500,label:'Ветеран',desc:'+500 SC за 15 уровень'},{level:20,reward:1000,label:'Элита',desc:'+1 000 SC за 20 уровень'}];
app.get('/api/progression',auth,(req,res)=>{const u=req.user;const next=u.level*1000;const quests=[{key:'games',title:'Игровой ритм',desc:'Сыграть 10 игр',value:u.stats.games||0,target:10},{key:'wins',title:'Победитель',desc:'Получить 5 побед',value:u.stats.winCount||0,target:5},{key:'chat',title:'На связи',desc:'Отправить 10 сообщений',value:u.stats.chat||0,target:10},{key:'cases',title:'Коллекционер',desc:'Открыть 3 кейса',value:u.stats.cases||0,target:3}];res.json({level:u.level,xp:u.xp,nextXp:next,progress:Math.round(u.xp/next*100),milestones:levelMilestones.map(x=>({...x,unlocked:u.level>=x.level})),quests});});
app.get('/api/social',auth,(req,res)=>{const following=new Set(req.user.following||[]);const people=db.users.filter(u=>u.id!==req.user.id).map(u=>({id:u.id,login:u.login,level:u.level,avatar:publicSummary(u).avatar,title:publicSummary(u).title,status:publicSummary(u).status,following:following.has(u.id)})).sort((a,b)=>Number(b.following)-Number(a.following)||b.level-a.level).slice(0,40);const posts=db.posts.slice(0,40).map(p=>({...p,author:publicSummary(user(p.userId)||{id:p.userId,login:'Удалён',level:0,profileVisibility:{}}),liked:(p.likes||[]).includes(req.user.id),likes:(p.likes||[]).length}));res.json({people,posts});});
app.post('/api/social/follow/:id',auth,requestOnce,(req,res)=>{const target=user(req.params.id);if(!target||target.id===req.user.id)return res.status(400).json({error:'Игрок не найден'});req.user.following=req.user.following||[];const i=req.user.following.indexOf(target.id);if(i>=0)req.user.following.splice(i,1);else req.user.following.push(target.id);save();res.json({following:req.user.following.includes(target.id)});});
app.post('/api/social/posts',auth,requestOnce,(req,res)=>{const text=String(req.body.text||'').trim().slice(0,280);if(!text)return res.status(400).json({error:'Пост пустой'});const post={id:id('post'),userId:req.user.id,text,at:Date.now(),likes:[]};db.posts.unshift(post);db.posts=db.posts.slice(0,100);save();res.json({post});});
app.post('/api/social/posts/:id/like',auth,requestOnce,(req,res)=>{const p=db.posts.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:'Пост не найден'});p.likes=p.likes||[];const i=p.likes.indexOf(req.user.id);if(i>=0)p.likes.splice(i,1);else p.likes.push(req.user.id);save();res.json({liked:p.likes.includes(req.user.id),likes:p.likes.length});});
const blackjackGames=new Map(),minesGames=new Map(),hiloGames=new Map(),towerGames=new Map();
const cardValue=c=>{const r=c%13;return r===0?11:r>=10?10:r+1};
const drawCard=()=>crypto.randomInt(0,52);
const handValue=h=>{let v=h.reduce((s,c)=>s+cardValue(c),0),aces=h.filter(c=>c%13===0).length;while(v>21&&aces--)v-=10;return v};
function finishBlackjack(req,g,state,multiplier=0){
  const amount=Math.floor(g.amount);
  let payout=0;
  if(multiplier>0){
    payout=Math.floor(amount*multiplier);
    wallet(req.user,payout,'blackjack_win',{amount,multiplier,profit:payout-amount});
    stat(req.user,'won',payout);
    recordWin(req.user,payout);
  }else if(state==='push'){
    payout=amount;
    wallet(req.user,amount,'blackjack_push',{amount,profit:0});
  }
  g.state=state;
  g.payout=payout;
  g.profit=payout-amount;
  g.balanceAfter=req.user.balance;
  db.bets.push({id:id('bet'),userId:req.user.id,login:req.user.login,amount,status:state==='lost'?'lost':state==='push'?'push':'won',game:'blackjack',result:state,multiplier:multiplier||1,payout,profit:payout-amount,at:Date.now()});
  blackjackGames.delete(req.user.id);
  save();
}
app.get('/api/blackjack',auth,(req,res)=>res.json({game:blackjackGames.get(req.user.id)||null}));
app.post('/api/blackjack/start',auth,requestOnce,(req,res)=>{
  if(blackjackGames.has(req.user.id))return res.status(409).json({error:'Раздача уже идёт'});
  const amount=Math.floor(Number(req.body.amount));
  if(!Number.isSafeInteger(amount)||amount<1||amount>100000)return res.status(400).json({error:'Некорректная ставка'});
  try{wallet(req.user,-amount,'blackjack_bet',{amount})}catch(e){return res.status(400).json({error:e.message})}
  const g={amount,player:[drawCard(),drawCard()],dealer:[drawCard(),drawCard()],state:'playing',payout:0,profit:-amount};
  blackjackGames.set(req.user.id,g);stat(req.user,'games');
  if(handValue(g.player)===21)finishBlackjack(req,g,'blackjack',2.5);
  save();res.json({game:g,user:pub(req.user)});
});
app.post('/api/blackjack/hit',auth,requestOnce,(req,res)=>{
  const g=blackjackGames.get(req.user.id);
  if(!g||g.state!=='playing')return res.status(400).json({error:'Нет активной раздачи'});
  g.player.push(drawCard());
  if(handValue(g.player)>21)finishBlackjack(req,g,'lost',0);
  else save();
  res.json({game:g,user:pub(req.user)});
});
app.post('/api/blackjack/stand',auth,requestOnce,(req,res)=>{
  const g=blackjackGames.get(req.user.id);
  if(!g||g.state!=='playing')return res.status(400).json({error:'Нет активной раздачи'});
  while(handValue(g.dealer)<17)g.dealer.push(drawCard());
  const pv=handValue(g.player),dv=handValue(g.dealer);
  if(dv>21||pv>dv)finishBlackjack(req,g,'won',2);
  else if(pv===dv)finishBlackjack(req,g,'push',0);
  else finishBlackjack(req,g,'lost',0);
  res.json({game:g,user:pub(req.user)});
});
app.get('/api/mines/state',auth,(req,res)=>{const g=minesGames.get(req.user.id);res.json({game:g?{...g,mines:undefined}:null})});
app.post('/api/mines/start',auth,requestOnce,(req,res)=>{if(minesGames.has(req.user.id))return res.status(409).json({error:'Игра уже идёт'});const amount=Math.floor(Number(req.body.amount)),mines=Math.floor(Number(req.body.mines));if(!Number.isSafeInteger(amount)||amount<1||amount>100000||!Number.isSafeInteger(mines)||mines<1||mines>24)return res.status(400).json({error:'Проверь ставку и число мин'});try{wallet(req.user,-amount,'mines_bet',{amount,mines})}catch(e){return res.status(400).json({error:e.message})}const set=new Set();while(set.size<mines)set.add(crypto.randomInt(25));const g={amount,mines:[...set],mineCount:mines,opened:[],multiplier:1,state:'playing'};minesGames.set(req.user.id,g);stat(req.user,'games');save();res.json({game:{...g,mines:undefined},user:pub(req.user)});});
app.post('/api/mines/open',auth,requestOnce,(req,res)=>{const g=minesGames.get(req.user.id),cell=Number(req.body.cell);if(!g||g.state!=='playing'||!Number.isInteger(cell)||cell<0||cell>24)return res.status(400).json({error:'Некорректная клетка'});if(g.opened.includes(cell))return res.status(400).json({error:'Клетка уже открыта'});g.opened.push(cell);if(g.mines.includes(cell)){g.state='lost';g.revealed=true;minesGames.delete(req.user.id);save();return res.json({game:{...g,mines:g.mines},user:pub(req.user)})}const safe=25-g.mineCount,opened=g.opened.length;g.multiplier=Number(Math.max(1.02,(25/safe)*(safe/(safe-opened+1))).toFixed(2));if(opened>=safe){const payout=Math.floor(g.amount*g.multiplier);wallet(req.user,payout,'mines_win',{amount:g.amount,multiplier:g.multiplier});stat(req.user,'won',payout);recordWin(req.user,payout);g.state='won';g.payout=payout;minesGames.delete(req.user.id)}save();res.json({game:{...g,mines:g.state==='lost'||g.state==='won'?g.mines:undefined},user:pub(req.user)});});
app.post('/api/mines/cashout',auth,requestOnce,(req,res)=>{const g=minesGames.get(req.user.id);if(!g||g.state!=='playing')return res.status(400).json({error:'Нет активной игры'});const payout=Math.floor(g.amount*g.multiplier);wallet(req.user,payout,'mines_win',{amount:g.amount,multiplier:g.multiplier});stat(req.user,'won',payout);recordWin(req.user,payout);g.state='won';g.payout=payout;minesGames.delete(req.user.id);save();res.json({game:g,user:pub(req.user)});});
app.post('/api/dice',auth,requestOnce,(req,res)=>{const amount=Math.floor(Number(req.body.amount)),chance=Math.max(2,Math.min(98,Number(req.body.chance))),side=req.body.side==='under'?'under':'over';if(!Number.isSafeInteger(amount)||amount<1||amount>100000)return res.status(400).json({error:'Некорректная ставка'});try{wallet(req.user,-amount,'dice_bet',{amount,chance,side})}catch(e){return res.status(400).json({error:e.message})}const roll=crypto.randomInt(1,101),win=side==='over'?roll>100-chance:roll<=chance,payout=win?Math.floor(amount*100/chance):0;stat(req.user,'games');if(win){wallet(req.user,payout,'dice_win',{roll,chance,side});stat(req.user,'won',payout);recordWin(req.user,payout)}save();res.json({roll,win,payout,user:pub(req.user)});});
const PLINKO_SLOTS=[0.75,1.2,1.5,2,3,5,10,5,3,2,1.5,1.2,0.75];
function plinkoResult(){const weights=[18,15,12,9,6,3,1,3,6,9,12,15,18],missChance=5;const roll=crypto.randomInt(0,1000);if(roll<missChance*10)return {miss:true,slot:null,multiplier:0};const total=weights.reduce((a,b)=>a+b,0),r=crypto.randomInt(0,total),target=(()=>{let a=0;for(let i=0;i<weights.length;i++){a+=weights[i];if(r<a)return i}return 6})();return {miss:false,slot:target,multiplier:PLINKO_SLOTS[target]}}
function plinkoPath(target,miss){const path=[{x:50,y:3}],targetX=target===null?(crypto.randomInt(2)?2:98):8+target*7;let x=50;for(let row=0;row<12;row++){const y=8+row*6.15;const pull=(targetX-x)*0.18;const jitter=(crypto.randomInt(-100,101)/100)*3.4;x=Math.max(3,Math.min(97,x+pull+jitter));path.push({x:Number(x.toFixed(2)),y:Number(y.toFixed(2))})}if(miss){path.push({x:Number(targetX.toFixed(2)),y:83},{x:Number((targetX+(targetX<50?-5:5)).toFixed(2)),y:91})}else path.push({x:Number(targetX.toFixed(2)),y:83},{x:Number(targetX.toFixed(2)),y:91});return path}
app.post('/api/plinko/play',auth,requestOnce,(req,res)=>{const amount=Math.floor(Number(req.body.amount));if(!Number.isSafeInteger(amount)||amount<1||amount>100000)return res.status(400).json({error:'Некорректная ставка'});try{wallet(req.user,-amount,'plinko_bet',{amount})}catch(e){return res.status(400).json({error:e.message})}const result=plinkoResult(),path=plinkoPath(result.slot,result.miss);let payout=0;if(!result.miss){payout=Math.floor(amount*result.multiplier);if(payout>0)wallet(req.user,payout,'plinko_win',{amount,multiplier:result.multiplier,slot:result.slot})}stat(req.user,'games');if(payout>=amount&&payout>0){stat(req.user,'won',payout);recordWin(req.user,payout)}db.bets.push({id:id('bet'),userId:req.user.id,login:req.user.login,amount,status:result.miss?'lost':payout>=amount?'won':'partial',game:'plinko',result:result.miss?'miss':result.multiplier,slot:result.slot,payout,at:Date.now()});save();res.json({ok:true,amount,payout,multiplier:result.multiplier,slot:result.slot,miss:result.miss,path,user:pub(req.user)})});

// ── Upgrader ────────────────────────────────────────────────────────────────
// Игрок вкладывает `amount` SC и выбирает желаемую сумму `target`.
// Шанс = amount / target × 95% (RTP 95%), считается в базисных пунктах (10000 = 100%).
// Бросок делает сервер (crypto.randomInt), клиент только анимирует стрелку в точку `roll`.
const UPG_RTP_BP=9500,UPG_MIN_BP=100,UPG_MAX_BP=9000,UPG_MAX_AMOUNT=100000,UPG_MAX_PAYOUT=5000000;
const upgChanceBp=(amount,target)=>Math.floor(amount*UPG_RTP_BP/target);
app.post('/api/upgrader/play',auth,requestOnce,(req,res)=>{
  const amount=Math.floor(Number(req.body.amount)),target=Math.floor(Number(req.body.target));
  if(!Number.isSafeInteger(amount)||amount<1||amount>UPG_MAX_AMOUNT)return res.status(400).json({error:'Ставка: от 1 до 100 000 SC'});
  if(!Number.isSafeInteger(target)||target<=amount)return res.status(400).json({error:'Желаемая сумма должна быть больше ставки'});
  if(target>UPG_MAX_PAYOUT)return res.status(400).json({error:'Максимальный выигрыш — 5 000 000 SC'});
  const bp=upgChanceBp(amount,target);
  if(bp<UPG_MIN_BP)return res.status(400).json({error:'Шанс меньше 1% — уменьши желаемую сумму'});
  if(bp>UPG_MAX_BP)return res.status(400).json({error:'Шанс не может быть больше 90% — подними желаемую сумму'});
  try{wallet(req.user,-amount,'upgrader_bet',{amount,target,chance:bp/100})}catch(e){return res.status(400).json({error:e.message})}
  const roll=crypto.randomInt(0,10000),win=roll<bp;
  let payout=0;
  if(win){payout=target;wallet(req.user,payout,'upgrader_win',{amount,target,chance:bp/100,roll});stat(req.user,'won',payout);recordWin(req.user,payout)}
  stat(req.user,'games');
  db.bets.push({id:id('bet'),userId:req.user.id,login:req.user.login,amount,target,status:win?'won':'lost',game:'upgrader',result:roll,chance:bp/100,payout,at:Date.now()});
  save();
  res.json({ok:true,amount,target,chance:bp/100,roll,win,payout,user:pub(req.user)});
});
app.get('/api/upgrader/feed',auth,(req,res)=>{
  const rows=[];
  for(let i=db.bets.length-1;i>=0&&rows.length<14;i--){const b=db.bets[i];if(b.game==='upgrader')rows.push({login:b.login,amount:b.amount,target:b.target,chance:b.chance,win:b.status==='won',at:b.at})}
  res.json({rows});
});

// Crystal inventory: server-authoritative buying, selling and guaranteed 3-to-1 upgrades.
const CRYSTALS=[
  {rarity:'common',name:'Кристалл',label:'Common',icon:'💠',color:'#62d9ff',buy:150,sell:100},
  {rarity:'rare',name:'Изумрудный кристалл',label:'Rare',icon:'💚',color:'#55e6a5',buy:null,sell:300},
  {rarity:'epic',name:'Аметистовый кристалл',label:'Epic',icon:'🔮',color:'#bb83ff',buy:null,sell:900},
  {rarity:'legendary',name:'Золотой кристалл',label:'Legendary',icon:'💛',color:'#ffc857',buy:null,sell:2700},
  {rarity:'mythic',name:'Мифический кристалл',label:'Mythic',icon:'❤️',color:'#ff6584',buy:null,sell:8100}
];
const crystalDef=r=>CRYSTALS.find(x=>x.rarity===r);
const crystalView=c=>{const d=crystalDef(c.rarity);return d?{id:c.id,rarity:d.rarity,name:d.name,label:d.label,icon:d.icon,color:d.color,sell:d.sell,at:c.at}:null};
app.get('/api/upgrader/crystals',auth,(_,res)=>res.status(410).json({error:'Кристаллы удалены из SICO'}));
app.post('/api/upgrader/crystals/:action',auth,(_,res)=>res.status(410).json({error:'Кристаллы удалены из SICO'}));
app.get('/api/items/crafting',auth,(_,res)=>res.status(410).json({error:'Крафт осколков удалён из SICO'}));
app.post('/api/items/crafting/craft',auth,(_,res)=>res.status(410).json({error:'Крафт осколков удалён из SICO'}));
// --- Extra games: Hi-Lo, Keno, Tower, Dice Duel, Baccarat, Daily Spin ---
const drawFreshDeck=()=>{const d=Array.from({length:52},(_,i)=>i);for(let i=d.length-1;i>0;i--){const j=crypto.randomInt(i+1);[d[i],d[j]]=[d[j],d[i]]}return d};
const rankOfCard=c=>{const r=c%13;return r===0?14:r+1};
const simpleBetAmount=req=>Math.floor(Number(req.body.amount));
function finishHilo(req,g,status,payout=0){
  const amount=g.amount;
  if(payout>0){wallet(req.user,payout,'hilo_win',{amount,multiplier:g.multiplier,rounds:g.rounds});stat(req.user,'won',payout);recordWin(req.user,payout)}
  g.state=status;g.payout=payout;g.profit=payout-amount;g.balanceAfter=req.user.balance;db.bets.push({id:id('bet'),userId:req.user.id,login:req.user.login,amount,status:status==='lost'?'lost':status==='push'?'push':'won',game:'hilo',result:g.current,multiplier:g.multiplier,payout,profit:payout-amount,rounds:g.rounds,at:Date.now()});hiloGames.delete(req.user.id);save();
}
app.get('/api/hilo/state',auth,(req,res)=>{const g=hiloGames.get(req.user.id);res.json({game:g?{amount:g.amount,current:g.current,multiplier:g.multiplier,rounds:g.rounds,state:g.state}:null})});
app.post('/api/hilo/start',auth,requestOnce,(req,res)=>{
  if(hiloGames.has(req.user.id))return res.status(409).json({error:'Раунд Hi-Lo уже идёт'});
  const amount=simpleBetAmount(req);if(!Number.isSafeInteger(amount)||amount<1||amount>100000)return res.status(400).json({error:'Некорректная ставка'});
  try{wallet(req.user,-amount,'hilo_bet',{amount})}catch(e){return res.status(400).json({error:e.message})}
  const deck=drawFreshDeck(),g={amount,deck,current:deck.pop(),multiplier:1,rounds:0,state:'playing'};hiloGames.set(req.user.id,g);stat(req.user,'games');save();res.json({game:{amount:g.amount,current:g.current,multiplier:g.multiplier,rounds:0,state:'playing'},user:pub(req.user)});
});
app.post('/api/hilo/guess',auth,requestOnce,(req,res)=>{
  const g=hiloGames.get(req.user.id),guess=req.body.guess==='lower'?'lower':'higher';if(!g||g.state!=='playing')return res.status(400).json({error:'Нет активной игры Hi-Lo'});
  if(!g.deck.length)g.deck=drawFreshDeck();
  const next=g.deck.pop(),a=rankOfCard(g.current),b=rankOfCard(next),win=guess==='higher'?b>a:b<a;
  g.current=next;g.rounds++;
  if(!win){finishHilo(req,g,'lost',0);return res.json({game:g,win:false,guess,user:pub(req.user)})}
  g.multiplier=Number(Math.min(12,Math.max(1.15,g.multiplier*1.35)).toFixed(2));save();res.json({game:{amount:g.amount,current:g.current,multiplier:g.multiplier,rounds:g.rounds,state:g.state},win:true,guess,user:pub(req.user)});
});
app.post('/api/hilo/cashout',auth,requestOnce,(req,res)=>{const g=hiloGames.get(req.user.id);if(!g||g.state!=='playing')return res.status(400).json({error:'Нет активной игры Hi-Lo'});if(g.rounds<1)return res.status(400).json({error:'Сначала угадай хотя бы одну карту'});const payout=Math.floor(g.amount*g.multiplier);finishHilo(req,g,'won',payout);res.json({game:g,user:pub(req.user)});});

function uniqueNumbers(count,max){const set=new Set();while(set.size<count)set.add(crypto.randomInt(1,max+1));return [...set]}
const KENO_PAYOUTS={3:2,4:4,5:12,6:40,7:150,8:500,9:1000,10:2500};
app.post('/api/keno/play',auth,requestOnce,(req,res)=>{
  const picks=Array.isArray(req.body.numbers)?[...new Set(req.body.numbers.map(Number))]:[];
  const amount=simpleBetAmount(req);if(!Number.isSafeInteger(amount)||amount<1||amount>100000)return res.status(400).json({error:'Некорректная ставка'});
  if(picks.length<2||picks.length>10||picks.some(n=>!Number.isInteger(n)||n<1||n>40))return res.status(400).json({error:'Выбери от 2 до 10 чисел от 1 до 40'});
  try{wallet(req.user,-amount,'keno_bet',{amount,picks})}catch(e){return res.status(400).json({error:e.message})}
  const drawn=uniqueNumbers(10,40),set=new Set(drawn),hits=picks.filter(n=>set.has(n)).length,multiplier=Number(KENO_PAYOUTS[hits]||0),payout=Math.floor(amount*multiplier);
  if(payout){wallet(req.user,payout,'keno_win',{amount,multiplier,hits});stat(req.user,'won',payout);recordWin(req.user,payout)}
  stat(req.user,'games');db.bets.push({id:id('bet'),userId:req.user.id,login:req.user.login,amount,status:payout?'won':'lost',game:'keno',result:hits,multiplier,payout,profit:payout-amount,picks,drawn,at:Date.now()});save();res.json({amount,picks,drawn,hits,multiplier,payout,profit:payout-amount,user:pub(req.user)});
});

const TOWER_MULTIPLIERS=[1.2,1.5,2,3,5,10];
app.get('/api/tower/state',auth,(req,res)=>{const g=towerGames.get(req.user.id);if(!g)return res.json({game:null});res.json({game:{amount:g.amount,floor:g.floor,multiplier:g.multiplier,state:g.state,safe:g.state==='lost'?g.safe:null,payout:g.payout||0,profit:g.profit||(-g.amount)}})});
app.post('/api/tower/start',auth,requestOnce,(req,res)=>{if(towerGames.has(req.user.id))return res.status(409).json({error:'Башня уже запущена'});const amount=simpleBetAmount(req);if(!Number.isSafeInteger(amount)||amount<1||amount>100000)return res.status(400).json({error:'Некорректная ставка'});try{wallet(req.user,-amount,'tower_bet',{amount})}catch(e){return res.status(400).json({error:e.message})}const g={amount,floor:0,multiplier:1,state:'playing',safe:Array.from({length:6},()=>crypto.randomInt(0,3)),payout:0};towerGames.set(req.user.id,g);stat(req.user,'games');save();res.json({game:{amount,floor:0,multiplier:1,state:'playing'},user:pub(req.user)});});
app.post('/api/tower/choose',auth,requestOnce,(req,res)=>{const g=towerGames.get(req.user.id),choice=Number(req.body.choice);if(!g||g.state!=='playing')return res.status(400).json({error:'Нет активной башни'});if(!Number.isInteger(choice)||choice<0||choice>2)return res.status(400).json({error:'Некорректная клетка'});const safe=g.safe[g.floor];if(choice!==safe){g.state='lost';g.revealed=true;g.payout=0;g.profit=-g.amount;towerGames.delete(req.user.id);save();return res.json({game:{...g,safe:g.safe},win:false,user:pub(req.user)})}g.floor++;g.multiplier=TOWER_MULTIPLIERS[g.floor-1]||TOWER_MULTIPLIERS.at(-1);if(g.floor>=6){const payout=Math.floor(g.amount*g.multiplier);wallet(req.user,payout,'tower_win',{amount:g.amount,multiplier:g.multiplier});stat(req.user,'won',payout);recordWin(req.user,payout);g.state='won';g.payout=payout;g.profit=payout-g.amount;towerGames.delete(req.user.id)}save();res.json({game:{amount:g.amount,floor:g.floor,multiplier:g.multiplier,state:g.state,payout:g.payout||0,profit:g.profit||0},win:true,user:pub(req.user)});});
app.post('/api/tower/cashout',auth,requestOnce,(req,res)=>{const g=towerGames.get(req.user.id);if(!g||g.state!=='playing')return res.status(400).json({error:'Нет активной башни'});if(g.floor<1)return res.status(400).json({error:'Сначала поднимись на один этаж'});const payout=Math.floor(g.amount*g.multiplier);wallet(req.user,payout,'tower_win',{amount:g.amount,multiplier:g.multiplier});stat(req.user,'won',payout);recordWin(req.user,payout);g.state='won';g.payout=payout;g.profit=payout-g.amount;towerGames.delete(req.user.id);save();res.json({game:g,user:pub(req.user)});});

app.post('/api/dice-duel',auth,requestOnce,(req,res)=>{const amount=simpleBetAmount(req);if(!Number.isSafeInteger(amount)||amount<1||amount>100000)return res.status(400).json({error:'Некорректная ставка'});try{wallet(req.user,-amount,'dice_duel_bet',{amount})}catch(e){return res.status(400).json({error:e.message})}const player=[crypto.randomInt(1,7),crypto.randomInt(1,7)],dealer=[crypto.randomInt(1,7),crypto.randomInt(1,7)],ps=player[0]+player[1],ds=dealer[0]+dealer[1];let outcome=ps>ds?'won':ps===ds?'push':'lost';const payout=outcome==='won'?amount*2:outcome==='push'?amount:0;if(payout)wallet(req.user,payout,outcome==='won'?'dice_duel_win':'dice_duel_push',{amount,player,dealer});stat(req.user,'games');if(outcome==='won'){stat(req.user,'won',payout);recordWin(req.user,payout)}db.bets.push({id:id('bet'),userId:req.user.id,login:req.user.login,amount,status:outcome,game:'dice_duel',result:{player,dealer,ps,ds},multiplier:outcome==='won'?2:outcome==='push'?1:0,payout,profit:payout-amount,at:Date.now()});save();res.json({amount,player,dealer,playerTotal:ps,dealerTotal:ds,outcome,payout,profit:payout-amount,user:pub(req.user)});});

function baccaratValue(c){const r=c%13;return r===0?1:r>=10?0:r+1}
function baccaratRound(){
  const p=[drawCard(),drawCard()],b=[drawCard(),drawCard()];let pv=(baccaratValue(p[0])+baccaratValue(p[1]))%10,bv=(baccaratValue(b[0])+baccaratValue(b[1]))%10;let natural=pv>=8||bv>=8,p3=null;
  if(!natural && pv<=5){p3=drawCard();p.push(p3);pv=(pv+baccaratValue(p3))%10}
  if(!natural){let drawB=false;if(p3===null)drawB=bv<=5;else{const v=baccaratValue(p3);drawB=bv<=2||(bv===3&&v!==8)||(bv===4&&v>=2&&v<=7)||(bv===5&&v>=4&&v<=7)||(bv===6&&v>=6&&v<=7)}if(drawB){b.push(drawCard());bv=(bv+baccaratValue(b[b.length-1]))%10}}
  const outcome=pv>bv?'player':pv<bv?'banker':'tie';return {player:p,dealer:b,playerTotal:pv,bankerTotal:bv,outcome};
}
app.post('/api/baccarat/play',auth,requestOnce,(req,res)=>{const amount=simpleBetAmount(req),choice=['player','banker','tie'].includes(req.body.choice)?req.body.choice:null;if(!Number.isSafeInteger(amount)||amount<10||amount>100000)return res.status(400).json({error:'Ставка Baccarat: от 10 до 100 000 SC'});if(!choice)return res.status(400).json({error:'Выбери Player, Banker или Tie'});try{wallet(req.user,-amount,'baccarat_bet',{amount,choice})}catch(e){return res.status(400).json({error:e.message})}const result=baccaratRound();let payout=0,status='lost';if(result.outcome==='tie'){if(choice==='tie'){payout=amount*9;status='won'}else{payout=amount;status='push'}}else if(choice===result.outcome){payout=choice==='banker'?Math.floor(amount*1.95):amount*2;status='won'}if(payout)wallet(req.user,payout,status==='won'?'baccarat_win':'baccarat_push',{amount,choice,result:result.outcome});stat(req.user,'games');if(status==='won'){stat(req.user,'won',payout);recordWin(req.user,payout)}db.bets.push({id:id('bet'),userId:req.user.id,login:req.user.login,amount,status,game:'baccarat',result:result.outcome,multiplier:payout?Number((payout/amount).toFixed(2)):0,payout,profit:payout-amount,at:Date.now()});save();res.json({...result,choice,amount,payout,profit:payout-amount,status,user:pub(req.user)});});

const DAILY_SPIN_REWARDS=[{reward:10,weight:40},{reward:25,weight:25},{reward:50,weight:18},{reward:100,weight:10},{reward:250,weight:5},{reward:500,weight:2}];
const dailySpinReward=()=>{const total=DAILY_SPIN_REWARDS.reduce((s,x)=>s+x.weight,0);let r=crypto.randomInt(total);for(const x of DAILY_SPIN_REWARDS){if(r<x.weight)return x.reward;r-=x.weight}return 10};
app.get('/api/daily-spin',auth,(req,res)=>res.json({available:!req.user.lastDailySpin||new Date(req.user.lastDailySpin).toDateString()!==new Date().toDateString(),lastSpinAt:req.user.lastDailySpin||0,rewards:DAILY_SPIN_REWARDS.map(x=>x.reward)}));
app.post('/api/daily-spin',auth,requestOnce,(req,res)=>{const now=Date.now();if(req.user.lastDailySpin&&new Date(req.user.lastDailySpin).toDateString()===new Date(now).toDateString())return res.status(409).json({error:'Сегодня Daily Spin уже использован'});const reward=dailySpinReward();req.user.lastDailySpin=now;stat(req.user,'daily');wallet(req.user,reward,'daily_spin',{reward});save();res.json({reward,spinAt:now,user:pub(req.user)});});

app.get("/api/game/state",(_,res)=>res.json({crash,roulette}));
app.post("/api/crash/bet",auth,requestOnce,(req,res)=>{if(crash.state!=="waiting")return res.status(400).json({error:crash.state==="running"?"Ставки уже закрыты":"Раунд завершён"});const amount=Math.floor(Number(req.body.amount));if(!Number.isSafeInteger(amount)||amount<1||amount>100000)return res.status(400).json({error:"Некорректная ставка"});if(crash.bets.some(b=>b.userId===req.user.id))return res.status(409).json({error:"Ты уже поставил в этом раунде"});try{wallet(req.user,-amount,"crash_bet",{round:crash.round});}catch(e){return res.status(400).json({error:e.message})}const b={id:id("bet"),userId:req.user.id,login:req.user.login,amount,status:"active"};crash.bets.push(b);stat(req.user,"games");push("crash",crash);res.json({ok:true,user:pub(req.user)});});
app.post("/api/crash/cashout",auth,requestOnce,(req,res)=>{const b=crash.bets.find(x=>x.userId===req.user.id&&x.status==="active");if(!b||crash.state!=="running")return res.status(400).json({error:"Забрать сейчас нельзя"});const payout=Math.floor(b.amount*crash.multiplier);b.status="cashed";b.cashout=crash.multiplier;b.payout=payout;wallet(req.user,payout,"crash_win",{round:crash.round,multiplier:crash.multiplier});stat(req.user,"won",payout);recordWin(req.user,payout);push("crash",crash);res.json({payout,multiplier:crash.multiplier,user:pub(req.user)});});
app.post("/api/roulette/bet",auth,requestOnce,(req,res)=>{if(roulette.state!=="open")return res.status(400).json({error:"Ставки закрыты"});const amount=Math.floor(Number(req.body.amount)),choice=req.body.choice;if(!Number.isSafeInteger(amount)||amount<1||amount>100000||!['red','black','green'].includes(choice))return res.status(400).json({error:"Некорректная ставка"});if(roulette.bets.some(b=>b.userId===req.user.id))return res.status(409).json({error:"Одна ставка на раунд"});try{wallet(req.user,-amount,"roulette_bet",{round:roulette.round,choice});}catch(e){return res.status(400).json({error:e.message})}roulette.bets.push({id:id("bet"),userId:req.user.id,login:req.user.login,amount,choice,status:"active"});stat(req.user,"games");push("roulette",roulette);res.json({ok:true,user:pub(req.user)});});
const cases={Moon:{cost:160,rewards:[25,50,75,120,200,600],weights:[45,25,15,8,5,2]},Nova:{cost:440,rewards:[100,180,300,600,1200,2500],weights:[45,25,15,8,5,2]},Black:{cost:4000,rewards:[250,400,800,1500,3000,8000],weights:[45,25,15,8,5,2]},Vault:{cost:cosmeticCase.cost,kind:'cosmetic'},Autumn:{cost:autumnCase.cost,kind:'autumnCosmetic'}};
function weightedReward(c){const total=c.weights.reduce((a,b)=>a+b,0),roll=(crypto.randomInt(0,1_000_000_000)/1_000_000_000)*total;let acc=0;for(let i=0;i<c.rewards.length;i++){acc+=c.weights[i];if(roll<acc)return c.rewards[i]}return c.rewards[c.rewards.length-1]}
app.get("/api/cases",auth,(_,res)=>res.json({...cases,cosmeticCase:{cost:cosmeticCase.cost,items:cosmeticCase.items.map(([id,w])=>({item:itemView(id),weight:w}))},autumnCase:{cost:autumnCase.cost,items:autumnCase.items.map(([id,w])=>({item:itemView(id),weight:w}))}}));
app.post("/api/cases/open",auth,requestOnce,(req,res)=>{
  const c=cases[req.body.name];if(!c)return res.status(400).json({error:"Неизвестный кейс"});
  req.user.promoCases=Array.isArray(req.user.promoCases)?req.user.promoCases:[];
  const freeIndex=req.user.promoCases.findIndex(x=>x.name===req.body.name);
  if(freeIndex>=0){req.user.promoCases.splice(freeIndex,1);save();}
  else {try{wallet(req.user,-c.cost,"case_open",{case:req.body.name});}catch(e){return res.status(400).json({error:e.message})}}
  if(c.kind==='cosmetic' || c.kind==='autumnCosmetic'){
    const itemId=c.kind==='autumnCosmetic'?pickAutumnCosmetic():pickCosmetic();req.user.inventory.push(itemId);stat(req.user,"cases");if(c.kind==='autumnCosmetic')stat(req.user,"seasonalCases");checkAchievements(req.user);save();
    const item=itemView(itemId);
    return res.json({case:req.body.name,cost:c.cost,item,user:pub(req.user)});
  }
  const reward=weightedReward(c);wallet(req.user,reward,"case_reward",{case:req.body.name});stat(req.user,"cases");save();res.json({case:req.body.name,cost:c.cost,reward,user:pub(req.user),odds:c.weights});
});
app.get("/api/autumn",auth,(req,res)=>{const progress=Number(req.user.stats?.seasonalCases||0);res.json({season:'Осень 2026',caseName:'Autumn',caseCost:autumnCase.cost,progress,goal:3,reward:'Сезонные предметы и достижения',featured:autumnCase.items.map(([id,w])=>({item:itemView(id),weight:w}))});});
app.get("/api/leaderboard",auth,(req,res)=>{
  const modes={balance:["Баланс",u=>u.balance],level:["Уровень",u=>u.level],scoin:["SCoin",u=>Number(u.scCoin||0)],achievements:["Достижения",u=>(u.badges||[]).length]};
  const mode=modes[req.query.mode]||modes.balance;
  const rows=db.users.map(u=>({id:u.id,login:u.login,avatar:u.avatar||null,equipped:Object.fromEntries(Object.entries(u.equipped||{}).map(([k,v])=>[k,itemView(v)||null])),level:u.level,balance:u.balance,scCoin:Number(u.scCoin||0),value:mode[1](u),stats:u.stats||{},badges:(u.badges||[]).length,title:u.title,status:u.status})).sort((a,b)=>b.value-a.value).slice(0,20);
  res.json({mode:mode[0],rows});
});
app.get("/api/player/:id",auth,(req,res)=>{
  const u=user(req.params.id);if(!u)return res.status(404).json({error:"Игрок не найден"});normalizeUser(u);
  const vis=profileVis(u), base={id:u.id,login:u.login,visibility:vis,badgesCount:(u.badges||[]).length};
  base.avatar=vis.avatar?(u.equipped?.avatar?itemView(u.equipped.avatar):u.avatar||null):null;
  base.status=vis.status?u.status:null;
  base.title=vis.title?u.title:null;
  base.level=vis.level?u.level:null;
  base.xp=vis.xp?u.xp:null;
  base.stats=vis.stats?(u.stats||{}):null;
  base.trading=vis.trading?{scCoin:Number(u.scCoin||0),pnl:tradingPnl(u)}:null;
  base.achievements=vis.achievements?u.badges||[]:null;
  base.createdAt=vis.createdAt?u.createdAt:null;
  base.equipped=(vis.avatar||vis.title||vis.status)?Object.fromEntries(Object.entries(u.equipped||{}).map(([k,v])=>[k,itemView(v)||null])):{};
  res.json({player:base});
});
app.get("/api/news",auth,(_,res)=>{
  const now=Date.now(),hist=db.market.history||[],prev=hist.length>1?hist[hist.length-2]?.price:db.market.price,change=prev?((db.market.price/prev-1)*100):0;
  const items=[{at:now+100,type:'season',icon:'🍂',title:'SICO Autumn 2026',text:`Осенний сезон открыт · Autumn Case — ${autumnCase.cost.toLocaleString()} SC · цель сезона — 3 открытия`},{at:now,type:'market',icon:change>=0?'📈':'📉',title:'SCoin Market',text:`SCoin сейчас ${Number(db.market.price).toFixed(4)} SC · тик ${change>=0?'+':''}${change.toFixed(2)}%`}];
  const top=db.users.slice().sort((a,b)=>b.balance-a.balance)[0];if(top)items.push({at:now-500,type:'player',icon:'🏆',title:'Баланс',text:`${top.login} сейчас держит ${Number(top.balance).toLocaleString()} SC`});
  const latest=db.users.slice().sort((a,b)=>b.createdAt-a.createdAt)[0];if(latest)items.push({at:latest.createdAt,type:'social',icon:'👤',title:'Новый игрок',text:`В SICO появился ${latest.login}`});
  const recentCase=db.transactions.find(t=>t.type==='case_open');if(recentCase){const cu=user(recentCase.userId);if(cu)items.push({at:recentCase.at,type:'case',icon:'🎁',title:'Кейс',text:`${cu.login} открыл кейс ${recentCase.meta?.case||'SICO'}`});}
  const biggest=db.users.slice().sort((a,b)=>(b.stats?.biggestWin||0)-(a.stats?.biggestWin||0))[0];if(biggest?.stats?.biggestWin)items.push({at:now-1500,type:'win',icon:'💰',title:'Крупный выигрыш',text:`Лучший зарегистрированный выигрыш — ${biggest.stats.biggestWin.toLocaleString()} SC у ${biggest.login}`});
  res.json({items:items.sort((a,b)=>b.at-a.at).slice(0,6)});
});
app.post("/api/coinflip",auth,requestOnce,(req,res)=>{const amount=Math.floor(Number(req.body.amount));if(!Number.isSafeInteger(amount)||amount<1||amount>100000)return res.status(400).json({error:"Некорректная ставка"});try{wallet(req.user,-amount,"coinflip_bet");}catch(e){return res.status(400).json({error:e.message})}const win=crypto.randomInt(2)===1;const payout=win?amount*2:0;if(win){wallet(req.user,payout,"coinflip_win");stat(req.user,"coinWins");recordWin(req.user,payout)}stat(req.user,"coinGames");save();res.json({win,payout,side:win?"Орёл":"Решка",user:pub(req.user)});});
app.get("/api/trading",auth,(req,res)=>{tickMarket(false);res.json({price:db.market.price,history:db.market.history.slice(-90),lastTick:db.market.lastTick,scCoin:Number(req.user.scCoin||0),buyFeePercent:0,sellFeePercent:15})});
app.post("/api/trading/buy",auth,requestOnce,(req,res)=>{tickMarket(false);const amount=Math.floor(Number(req.body.amount));if(!Number.isSafeInteger(amount)||amount<1||amount>1000000)return res.status(400).json({error:"Укажи сумму покупки от 1 SC"});const fee=0,total=amount,net=amount;if(req.user.balance<total)return res.status(400).json({error:`Нужно ${total} SC`});const qty=Number((net/db.market.price).toFixed(6));if(qty<=0)return res.status(400).json({error:"Слишком маленькая сумма"});wallet(req.user,-total,"scoin_buy",{price:db.market.price,fee,coinQty:qty});req.user.scCoin=Number(((req.user.scCoin||0)+qty).toFixed(6));req.user.scCoinCostBasis=Number(((req.user.scCoinCostBasis||0)+total).toFixed(2));save();res.json({user:pub(req.user),price:db.market.price,scCoin:req.user.scCoin,fee,coinQty:qty});});
app.post("/api/trading/sell",auth,requestOnce,(req,res)=>{tickMarket(false);const qty=Number(req.body.amount);const held=Number(req.user.scCoin||0);if(!Number.isFinite(qty)||qty<=0||qty>held)return res.status(400).json({error:"Недостаточно SCoin"});const gross=Math.floor(qty*db.market.price);const fee=feeFor(gross),net=gross-fee;if(net<1)return res.status(400).json({error:"Сумма после комиссии слишком мала"});const basisPerCoin=held>0?(req.user.scCoinCostBasis||0)/held:0;const basisPortion=Math.min(req.user.scCoinCostBasis||0,basisPerCoin*qty);req.user.scCoin=Number((held-qty).toFixed(6));req.user.scCoinCostBasis=Number(Math.max(0,(req.user.scCoinCostBasis||0)-basisPortion).toFixed(2));req.user.scCoinRealizedPnl=Number(((req.user.scCoinRealizedPnl||0)+(net-basisPortion)).toFixed(2));wallet(req.user,net,"scoin_sell",{price:db.market.price,fee,coinQty:qty,gross});save();res.json({user:pub(req.user),price:db.market.price,scCoin:req.user.scCoin,fee,coinQty:qty,gross,net});});
app.get("/api/bank",auth,(req,res)=>{const b=req.user.bankBalance||0;const age=req.user.bankDepositedAt?Date.now()-req.user.bankDepositedAt:0;const mature=age>=24*60*60*1000;res.json({balance:b,depositAt:req.user.bankDepositedAt||0,mature,rate:5,available:b+(mature?Math.floor(b*0.05):0)});});
app.post("/api/bank/deposit",auth,requestOnce,(req,res)=>{const amount=Math.floor(Number(req.body.amount));if(!Number.isSafeInteger(amount)||amount<1)return res.status(400).json({error:"Некорректная сумма"});if(req.user.bankBalance>0)return res.status(400).json({error:"Сначала забери текущий вклад"});try{wallet(req.user,-amount,"bank_deposit");}catch(e){return res.status(400).json({error:e.message})}req.user.bankBalance=amount;req.user.bankDepositedAt=Date.now();checkAchievements(req.user);save();res.json({user:pub(req.user),balance:req.user.bankBalance,depositAt:req.user.bankDepositedAt});});
app.post("/api/bank/withdraw",auth,requestOnce,(req,res)=>{const b=req.user.bankBalance||0;if(!b)return res.status(400).json({error:"В банке пока ничего нет"});if(Date.now()-(req.user.bankDepositedAt||0)<24*60*60*1000)return res.status(400).json({error:"Вклад можно забрать через 24 часа"});const payout=b+Math.floor(b*0.05);req.user.bankBalance=0;req.user.bankDepositedAt=0;wallet(req.user,payout,"bank_withdraw",{interest:5});save();res.json({user:pub(req.user),payout});});
app.get("/api/dashboard",auth,(req,res)=>{const u=req.user,online=onlineUsers();res.json({user:pub(u),online,support:db.likes.length,recent:db.transactions.filter(x=>x.userId===u.id).slice(0,6),achievements:(u.badges||[]).length,players:db.users.length,crash:{round:crash.round,state:crash.state,multiplier:crash.multiplier,history:crash.history.slice(0,8)},roulette:{round:roulette.round,last:roulette.last,history:roulette.history.slice(0,8)}})});
app.use((err,req,res,next)=>{
  if(err instanceof multer.MulterError)return res.status(400).json({error:err.code==="LIMIT_FILE_SIZE"?"Максимум 25 МБ":"Ошибка загрузки"});
  if(err?.message==="Неподдерживаемый формат изображения")return res.status(400).json({error:"Поддерживаются PNG/JPG/WEBP/GIF"});
  if(err?.type==="entity.parse.failed")return res.status(400).json({error:"Некорректный JSON"});
  console.error("SICO request error",err);
  return res.status(500).json({error:"Ошибка сервера"});
});
app.get("/*splat",(_,res)=>res.sendFile(path.join(PUBLIC,"index.html")));
const PORT=Number(process.env.PORT||3000);
let shuttingDown=false;
const shutdown=()=>{if(shuttingDown)return;shuttingDown=true;clearInterval(wsHeartbeat);setTimeout(()=>process.exit(0),4000).unref();try{for(const ws of sockets)try{ws.close(1001,"Server shutting down")}catch{}save();autoBackup("shutdown",10*60*1000)}catch(e){console.error("SICO shutdown error:",e.message)}finally{server.close(()=>process.exit(0))}};
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
process.on("uncaughtException",err=>console.error("SICO uncaughtException",err));
process.on("unhandledRejection",err=>console.error("SICO unhandledRejection",err));
setInterval(()=>{const now=Date.now();for(const [k,v] of rate)if(now-v.t>60000)rate.delete(k);for(const [k,v] of loginFails)if(now-v.t>120000)loginFails.delete(k);for(const [k,v] of requests)if(now-v.at>180000)requests.delete(k);for(const [k,v] of recoveryChallenges)if(v.expiresAt&&v.expiresAt<=now)recoveryChallenges.delete(k);for(const [t,s] of sessions)if(now-s.at>7*86400000)revokeSession(t)},60000);
autoBackup("startup");
setInterval(()=>autoBackup("auto"),BACKUP_EVERY_H*3600*1000).unref();
server.listen(PORT,"0.0.0.0",()=>console.log(`SICO Local: ${hasHttps?"https":"http"}://0.0.0.0:${PORT}${hasHttps?" (HTTPS enabled)":""} | data: ${DATA} | users: ${db.users.length}`));
