'use strict';
/* FarmConnect: website + API in one process. Zero dependencies. Needs Node 22.5+ (node:sqlite).  Run: node server.js */
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');

const ENV=process.env,on=(v,d)=>v===undefined||v===''?d:v!=='0';
const CFG={
  port:+ENV.PORT||8787,
  db:ENV.DB_PATH||path.join(__dirname,'farmconnect.db'),
  origin:ENV.ALLOWED_ORIGIN||'',               // only needed when the website is hosted somewhere else
  secureCookie:ENV.INSECURE_COOKIE!=='1',
  trustProxy:ENV.TRUST_PROXY==='1',            // set to 1 behind Render, Fly, Railway, nginx
  rzpKey:ENV.RAZORPAY_KEY_ID||'',
  rzpSecret:ENV.RAZORPAY_KEY_SECRET||'',
  rzpWebhookSecret:ENV.RAZORPAY_WEBHOOK_SECRET||'',
  mock:ENV.RAZORPAY_MOCK==='1',                // tests only: never set in production
  requireOtp:on(ENV.REQUIRE_OTP,true),         // phone code at sign-up and password reset
  otpDev:ENV.OTP_DEV==='1',                    // tests only: returns the code in the response
  requireApproval:on(ENV.REQUIRE_APPROVAL,true), // new sellers need your OK before customers see their produce
  smsProvider:ENV.SMS_PROVIDER||'console',     // console | twilio | msg91
  adminPhone:ENV.ADMIN_PHONE||'',adminPassword:ENV.ADMIN_PASSWORD||'',
  site:{
    name:ENV.BUSINESS_NAME||'FarmConnect',address:ENV.BUSINESS_ADDRESS||'',
    email:ENV.SUPPORT_EMAIL||'',phone:ENV.SUPPORT_PHONE||'',whatsapp:ENV.SUPPORT_WHATSAPP||'',
    grievanceName:ENV.GRIEVANCE_NAME||'',grievanceEmail:ENV.GRIEVANCE_EMAIL||ENV.SUPPORT_EMAIL||'',
    fssai:ENV.FSSAI_NO||'',gstin:ENV.GSTIN||''
  },
  fee:30,freeOver:500,minDelivery:150,payHoldMin:15
};
const PUB=path.join(__dirname,'public');
const db=new DatabaseSync(CFG.db);
db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,role TEXT NOT NULL,login_id TEXT UNIQUE,name TEXT,phone TEXT NOT NULL,email TEXT,salt TEXT,hash TEXT,iter INTEGER,farm TEXT,address TEXT,pin TEXT,created TEXT,status TEXT DEFAULT 'active',phone_ok INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS users_phone ON users(role,phone);
CREATE TABLE IF NOT EXISTS sessions(th TEXT PRIMARY KEY,user_id TEXT NOT NULL,exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS markets(id TEXT PRIMARY KEY,owner_id TEXT,name TEXT,area TEXT,hours TEXT,contact TEXT,lat REAL,lng REAL);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT,market_id TEXT,farmer TEXT,name TEXT,category TEXT,emoji TEXT,price_paise INTEGER,unit TEXT,qty REAL,online_price REAL,online_retailer TEXT,description TEXT);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,ref TEXT UNIQUE,user_id TEXT NOT NULL,market_id TEXT,type TEXT,status TEXT,pay_method TEXT,pay_status TEXT,subtotal INTEGER,fee INTEGER,total INTEGER,name TEXT,phone TEXT,address TEXT,slot TEXT,date TEXT,note TEXT,rzp_order TEXT,rzp_payment TEXT,rzp_refund TEXT,created TEXT,updated TEXT,paid_at TEXT,refunded_at TEXT,cancel_note TEXT);
CREATE TABLE IF NOT EXISTS order_items(order_id TEXT,product_id INTEGER,owner_id TEXT,name TEXT,unit TEXT,qty REAL,price_paise INTEGER,emoji TEXT);
CREATE TABLE IF NOT EXISTS order_events(order_id TEXT,status TEXT,at TEXT);
CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT,body TEXT,at TEXT,read INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS notes_user ON notes(user_id,at);
CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,product_id INTEGER,order_id TEXT,user_id TEXT,rating INTEGER,text TEXT,name TEXT,at TEXT,UNIQUE(order_id,product_id));
CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,phone TEXT,email TEXT,ref TEXT,message TEXT,status TEXT DEFAULT 'open',reply TEXT,at TEXT);
CREATE TABLE IF NOT EXISTS otps(k TEXT PRIMARY KEY,hash TEXT,exp INTEGER,tries INTEGER DEFAULT 0,sent INTEGER);
CREATE TABLE IF NOT EXISTS audit(at TEXT,actor TEXT,action TEXT,target TEXT);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,kind TEXT,at TEXT);
CREATE TABLE IF NOT EXISTS fails(k TEXT PRIMARY KEY,n INTEGER,until INTEGER);`);

for(const a of ['ALTER TABLE products ADD COLUMN updated TEXT','ALTER TABLE products ADD COLUMN photo_v INTEGER DEFAULT 0','ALTER TABLE users ADD COLUMN photo_v INTEGER DEFAULT 0'])try{db.exec(a)}catch{}
db.exec(`CREATE TABLE IF NOT EXISTS photos(k TEXT PRIMARY KEY,mime TEXT,data BLOB,v INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS price_log(day TEXT,pid INTEGER,market_id TEXT,nk TEXT,p INTEGER,PRIMARY KEY(day,pid));
CREATE INDEX IF NOT EXISTS price_nk ON price_log(nk,market_id,day);`);

/* ---------- helpers ---------- */
const uid=()=>crypto.randomBytes(9).toString('base64url');
const now=()=>new Date().toISOString();
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const eq=(a,b)=>{a=Buffer.from(String(a));b=Buffer.from(String(b));return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const ITER=210000;
const hashPw=(pw,salt,it=ITER)=>new Promise((res,rej)=>crypto.pbkdf2(pw,salt,it,32,'sha256',(e,k)=>e?rej(e):res(k.toString('base64'))));
const normPhone=p=>{let d=String(p||'').replace(/\D/g,'');if(d.length===12&&d.startsWith('91'))d=d.slice(2);if(d.length===11&&d[0]==='0')d=d.slice(1);return d};
const okPhone=p=>/^[6-9]\d{9}$/.test(normPhone(p));
const okEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const pwProblem=p=>String(p||'').length<8?'Use at least 8 characters for your password.':(!/[A-Za-z]/.test(p)||!/\d/.test(p))?'Your password needs letters and at least one number.':'';
const str=(v,max=200)=>String(v==null?'':v).trim().slice(0,max);
const paise=r=>Math.round(Number(r)*100);
const okDate=d=>{d=String(d||'');for(let i=0;i<=2;i++)if(istDay(i)===d)return d;return istDay()};
const istDay=(off=0)=>new Date(Date.now()+330*60e3+off*864e5).toISOString().slice(0,10);   // today's date in India
const nkey=n=>String(n||'').toLowerCase().replace(/\s+/g,' ').trim();
function logPrice(pid){const p=db.prepare('SELECT id,market_id,name,price_paise FROM products WHERE id=?').get(pid);if(p)db.prepare('INSERT OR REPLACE INTO price_log VALUES(?,?,?,?,?)').run(istDay(),p.id,p.market_id,nkey(p.name),p.price_paise)}
let snapDay='';
function snapshotPrices(){const d=istDay();if(snapDay===d)return;
  tx(()=>{for(const p of db.prepare('SELECT id,market_id,name,price_paise FROM products').all())db.prepare('INSERT OR IGNORE INTO price_log VALUES(?,?,?,?,?)').run(d,p.id,p.market_id,nkey(p.name),p.price_paise);
    db.prepare('DELETE FROM price_log WHERE day<?').run(istDay(-120))});
  snapDay=d}
function dropPhoto(k){db.prepare('DELETE FROM photos WHERE k=?').run(k)}
function readPhoto(b){
  const m=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+\/=]+)$/.exec(String(b.data||''));if(!m)bad('Choose a photo (JPEG, PNG or WebP).');
  const buf=Buffer.from(m[2],'base64');if(buf.length<200||buf.length>180*1024)bad('That photo is too large. Try a smaller one.');
  const jpeg=buf[0]===0xFF&&buf[1]===0xD8,png=buf.subarray(0,4).toString('hex')==='89504e47',webp=buf.subarray(0,4).toString()==='RIFF'&&buf.subarray(8,12).toString()==='WEBP';
  const mime=jpeg?'image/jpeg':png?'image/png':webp?'image/webp':'';if(!mime||mime!=='image/'+m[1])bad('That file is not a valid image.');
  return{mime,buf};
}
function putPhoto(k,ph){db.prepare('INSERT INTO photos(k,mime,data,v) VALUES(?,?,?,1) ON CONFLICT(k) DO UPDATE SET mime=excluded.mime,data=excluded.data,v=v+1').run(k,ph.mime,ph.buf);return db.prepare('SELECT v FROM photos WHERE k=?').get(k).v}
class HttpErr extends Error{constructor(s,m){super(m);this.status=s}}
const bad=(m,s=400)=>{throw new HttpErr(s,m)};
function farmerId(){const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';let s='';const r=crypto.randomBytes(6);for(let i=0;i<6;i++)s+=A[r[i]%A.length];const id='FARM-'+s;return db.prepare('SELECT 1 FROM users WHERE login_id=?').get(id)?farmerId():id}
function tx(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}
const audit=(actor,action,target)=>db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(now(),actor,action,String(target||''));
function clientIp(req){if(CFG.trustProxy){const x=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();if(x)return x}return req.socket.remoteAddress||''}

/* in-memory rate limits (fine for one server; use Redis if you ever run several) */
const buckets=new Map();
function limit(key,max,win,msg){const t=Date.now();let b=buckets.get(key);if(!b||b.reset<t){b={n:0,reset:t+win};buckets.set(key,b)}if(++b.n>max)bad(msg||'Too many requests. Please wait a little and try again.',429)}
setInterval(()=>{const t=Date.now();for(const[k,b]of buckets)if(b.reset<t)buckets.delete(k)},60000).unref();

/* ---------- SMS (OTP and order messages) ---------- */
async function sendSms(phone,text){
  const to=normPhone(phone);
  if(CFG.smsProvider==='twilio'){
    const sid=ENV.TWILIO_SID,tok=ENV.TWILIO_TOKEN,from=ENV.TWILIO_FROM;if(!sid||!tok||!from)throw new Error('Twilio is not configured');
    const r=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+sid+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(sid+':'+tok).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:'+91'+to,From:from,Body:text})});
    if(!r.ok)throw new Error('Twilio '+r.status);return;
  }
  if(CFG.smsProvider==='msg91'){
    const key=ENV.MSG91_AUTHKEY,tpl=ENV.MSG91_TEMPLATE_ID;if(!key||!tpl)throw new Error('MSG91 is not configured');
    // MSG91 Flow API: the template (registered with DLT) holds the wording and uses ##message## as its variable.
    const r=await fetch('https://control.msg91.com/api/v5/flow/',{method:'POST',headers:{authkey:key,'Content-Type':'application/json'},body:JSON.stringify({template_id:tpl,short_url:'0',recipients:[{mobiles:'91'+to,message:text}]})});
    if(!r.ok)throw new Error('MSG91 '+r.status);return;
  }
  console.log('[sms:console] to '+to+': '+text);
}
const smsQuiet=(phone,text)=>{sendSms(phone,text).catch(e=>console.error('sms failed:',e.message))};

/* ---------- Razorpay (REST, no SDK) ---------- */
async function rzp(method,url,body){
  if(CFG.mock){
    if(url==='/orders')return{id:'order_'+uid(),amount:body.amount,currency:'INR',receipt:body.receipt};
    if(/\/refund$/.test(url))return{id:'rfnd_'+uid(),amount:body.amount,status:'processed'};
  }
  if(!CFG.rzpKey||!CFG.rzpSecret)bad('Online payments are not configured.',503);
  const r=await fetch('https://api.razorpay.com/v1'+url,{method,headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(CFG.rzpKey+':'+CFG.rzpSecret).toString('base64')},body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){console.error('razorpay error',r.status,JSON.stringify(j).slice(0,300));bad('The payment provider could not process this request. Try again.',502)}
  return j;
}
const paySig=(orderId,payId,secret=CFG.rzpSecret)=>crypto.createHmac('sha256',secret).update(orderId+'|'+payId).digest('hex');

/* ---------- sessions ---------- */
function setCookie(res,name,val,maxAge){
  const c=[`${name}=${val}`,'Path=/','HttpOnly','SameSite=Lax',`Max-Age=${maxAge}`];if(CFG.secureCookie)c.push('Secure');
  const prev=res.getHeader('Set-Cookie')||[];res.setHeader('Set-Cookie',[].concat(prev,c.join('; ')));
}
function startSession(res,userId,remember){
  const tok=crypto.randomBytes(32).toString('base64url'),age=remember?30*86400:86400;
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(tok),userId,Date.now()+age*1000);setCookie(res,'fc',tok,age);
}
function authUser(req){
  const m=/(?:^|;\s*)fc=([^;]+)/.exec(req.headers.cookie||'');if(!m)return null;
  const s=db.prepare('SELECT user_id,exp FROM sessions WHERE th=?').get(sha(m[1]));
  if(!s||s.exp<Date.now())return null;
  const u=db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
  return u&&u.status!=='deleted'&&u.status!=='suspended'?u:null;
}
const pub=u=>u&&{id:u.id,role:u.role,loginId:u.login_id,name:u.name,phone:u.phone,email:u.email,address:u.address,pin:u.pin,status:u.status,created:u.created,photoV:u.photo_v||0,farm:u.farm?JSON.parse(u.farm):null};
const need=(u,role)=>{if(!u)bad('Please sign in first.',401);if(role&&u.role!==role)bad('This needs a '+role+' account.',403);return u};

/* ---------- sign-in throttle ---------- */
function failKey(req,login){return sha(clientIp(req)+'|'+String(login).toLowerCase())}
function lockLeft(k){const r=db.prepare('SELECT until FROM fails WHERE k=?').get(k);return r&&r.until>Date.now()?Math.ceil((r.until-Date.now())/1000):0}
function noteFail(k){const r=db.prepare('SELECT n FROM fails WHERE k=?').get(k)||{n:0};const n=r.n+1;db.prepare('INSERT OR REPLACE INTO fails VALUES(?,?,?)').run(k,n>=5?0:n,n>=5?Date.now()+60000:0)}

/* ---------- notifications ---------- */
function note(userId,title,body){if(userId)db.prepare('INSERT INTO notes VALUES(?,?,?,?,?,0)').run(uid(),userId,title,body,now())}
function tell(userId,title,body,sms){
  note(userId,title,body);
  if(sms){const u=db.prepare('SELECT phone FROM users WHERE id=?').get(userId);if(u&&u.phone&&u.phone!=='0000000000')smsQuiet(u.phone,sms)}
}
function ev(orderId,status){db.prepare('INSERT INTO order_events VALUES(?,?,?)').run(orderId,status,now())}

/* ---------- OTP ---------- */
const OTP_TTL=10*60e3;
function otpKey(phone,purpose){return sha(purpose+'|'+phone)}
function verifyOtp(phone,purpose,code){
  if(!CFG.requireOtp)return;
  const k=otpKey(phone,purpose),r=db.prepare('SELECT * FROM otps WHERE k=?').get(k);
  if(!r||r.exp<Date.now())bad('Enter the 6-digit code we sent you. It may have expired, so request a new one.',400);
  if(r.tries>=5){db.prepare('DELETE FROM otps WHERE k=?').run(k);bad('Too many wrong codes. Request a new code.',429)}
  if(!eq(sha(String(code||'').trim()+'|'+k),r.hash)){db.prepare('UPDATE otps SET tries=tries+1 WHERE k=?').run(k);bad('That code is not right. Check it and try again.',400)}
  db.prepare('DELETE FROM otps WHERE k=?').run(k);
}

/* ---------- handlers ---------- */
const H={};
H['GET /api/config']=async()=>bootCfg();
H['POST /api/otp/send']=async(req,res,b)=>{
  const purpose=b.purpose==='reset'?'reset':'register',phone=normPhone(b.phone);
  if(!okPhone(phone))bad('Enter a valid 10-digit mobile number.');
  limit('otp-ip:'+clientIp(req),20,3600e3);limit('otp-ph:'+phone,3,600e3,'We already sent codes to this number. Wait a few minutes before asking again.');
  const k=otpKey(phone,purpose),prev=db.prepare('SELECT sent FROM otps WHERE k=?').get(k);
  if(prev&&Date.now()-prev.sent<30000)bad('Please wait 30 seconds before asking for another code.',429);
  if(purpose==='reset'&&!db.prepare("SELECT 1 FROM users WHERE phone=? AND role IN ('customer','farmer')").get(phone))return{ok:true};   // same answer either way
  const code=String(crypto.randomInt(100000,1000000));
  db.prepare('INSERT OR REPLACE INTO otps VALUES(?,?,?,0,?)').run(k,sha(code+'|'+k),Date.now()+OTP_TTL,Date.now());
  await sendSms(phone,code+' is your FarmConnect code. It expires in 10 minutes. Do not share it with anyone.').catch(e=>{console.error('otp sms failed:',e.message);bad('We could not send the code right now. Try again in a minute.',503)});
  return CFG.otpDev?{ok:true,devCode:code}:{ok:true};
};
H['POST /api/register']=async(req,res,b)=>{
  limit('reg-ip:'+clientIp(req),20,3600e3);
  const role=b.role==='farmer'?'farmer':'customer',phone=normPhone(b.phone),email=str(b.email).toLowerCase();
  const name=str(role==='farmer'?b.owner:b.name,80);
  if(!name)bad('Enter your name.');if(!okPhone(phone))bad('Enter a valid 10-digit mobile number.');
  if(email&&!okEmail(email))bad('Enter a valid email address.');
  const pe=pwProblem(b.password);if(pe)bad(pe);if(!b.terms)bad('Please accept the terms.');
  let farm=null;
  if(role==='farmer'){
    farm={farm:str(b.farm,80),owner:name,area:str(b.area,80),grow:str(b.grow,120),marketId:str(b.marketId,40),fssai:str(b.fssai,14)};
    if(!farm.farm||!farm.area)bad('Enter your farm name and area.');
    if(farm.fssai&&!/^\d{14}$/.test(farm.fssai))bad('An FSSAI licence number has 14 digits. Leave it blank if you do not have one.');
  }
  if(db.prepare("SELECT 1 FROM users WHERE role=? AND status<>'deleted' AND (phone=? OR (?<>'' AND email=?))").get(role,phone,email,email))bad('An account with this mobile number or email already exists. Sign in instead.',409);
  verifyOtp(phone,'register',b.otp);
  const salt=crypto.randomBytes(16).toString('base64'),hash=await hashPw(b.password,salt);
  const id=uid(),loginId=role==='farmer'?farmerId():null,status=role==='farmer'&&CFG.requireApproval?'pending':(role==='farmer'?'verified':'active');
  db.prepare('INSERT INTO users(id,role,login_id,name,phone,email,salt,hash,iter,farm,address,pin,created,status,phone_ok) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)').run(id,role,loginId,name,phone,email,salt,hash,ITER,farm?JSON.stringify(farm):null,'','',now(),status);
  startSession(res,id,true);return{user:pub(db.prepare('SELECT * FROM users WHERE id=?').get(id))};
};
const findLogin=(role,login)=>{const ph=normPhone(login);return db.prepare("SELECT * FROM users WHERE role=? AND status<>'deleted' AND (login_id=? OR (?<>'' AND email=?) OR (?<>'' AND phone=?))").get(role,login.toUpperCase(),login.toLowerCase(),login.toLowerCase(),ph.length===10?ph:'',ph)};
H['POST /api/login']=async(req,res,b)=>{
  const role=['farmer','admin'].includes(b.role)?b.role:'customer',login=str(b.login,120);if(!login||!b.password)bad('Enter your ID and password.');
  limit('login-ip:'+clientIp(req),60,600e3);
  const k=failKey(req,login),left=lockLeft(k);if(left)bad('Too many attempts. Try again in '+left+' seconds.',429);
  const u=findLogin(role,login);
  const h=u?await hashPw(b.password,u.salt,u.iter):await hashPw(b.password,'AAAAAAAAAAAAAAAAAAAAAA==');
  if(!u||!eq(h,u.hash)){noteFail(k);bad('That ID or password is not right. Check both and try again.',401)}
  if(u.status==='suspended')bad('This account is suspended. Contact support.',403);
  db.prepare('DELETE FROM fails WHERE k=?').run(k);startSession(res,u.id,!!b.remember);return{user:pub(u)};
};
H['POST /api/reset']=async(req,res,b)=>{
  limit('reset-ip:'+clientIp(req),15,3600e3);
  const role=b.role==='farmer'?'farmer':'customer',login=str(b.login,120),phone=normPhone(b.phone),generic='We could not match those details. Check your '+(role==='farmer'?'Farmer ID':'mobile number or email')+' and the mobile number on the account.';
  const pe=pwProblem(b.password);if(pe)bad(pe);
  const u=login?findLogin(role,login):null;if(!u||u.phone!==phone)bad(generic,400);
  verifyOtp(phone,'reset',b.otp);
  const salt=crypto.randomBytes(16).toString('base64');
  db.prepare('UPDATE users SET salt=?,hash=?,iter=? WHERE id=?').run(salt,await hashPw(b.password,salt),ITER,u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);db.prepare('DELETE FROM fails').run();
  tell(u.id,'Password changed','Your password was changed. If this was not you, contact support right away.');
  return{ok:true};
};
H['POST /api/logout']=async(req,res)=>{const m=/(?:^|;\s*)fc=([^;]+)/.exec(req.headers.cookie||'');if(m)db.prepare('DELETE FROM sessions WHERE th=?').run(sha(m[1]));setCookie(res,'fc','',0);return{ok:true}};
H['GET /api/me']=async(req)=>({user:pub(authUser(req))});
H['POST /api/me']=async(req,res,b)=>{
  const u=need(authUser(req));const name=str(b.name,80)||u.name,email=b.email===undefined?u.email:str(b.email).toLowerCase();
  if(!okPhone(b.phone))bad('Enter a valid 10-digit mobile number.');if(email&&!okEmail(email))bad('Enter a valid email address.');
  const ph=normPhone(b.phone);if(db.prepare("SELECT 1 FROM users WHERE role=? AND id<>? AND phone=? AND status<>'deleted'").get(u.role,u.id,ph))bad('Another account uses that mobile number.',409);
  if(ph!==u.phone&&CFG.requireOtp)verifyOtp(ph,'register',b.otp);       // changing the number needs a code sent to the new number
  let farm=u.farm;if(u.role==='farmer'&&b.farm){const f=JSON.parse(u.farm||'{}');
    const fssai=b.farm.fssai===undefined?f.fssai:str(b.farm.fssai,14);if(fssai&&!/^\d{14}$/.test(fssai))bad('An FSSAI licence number has 14 digits.');
    farm=JSON.stringify({...f,owner:name,farm:str(b.farm.farm,80)||f.farm,area:str(b.farm.area,80)||f.area,grow:str(b.farm.grow,120),story:b.farm.story===undefined?f.story:str(b.farm.story,500),since:b.farm.since===undefined?f.since:(/^(19|20)\d\d$/.test(String(b.farm.since))?String(b.farm.since):''),marketId:str(b.farm.marketId,40),fssai});db.prepare('UPDATE products SET farmer=? WHERE owner_id=?').run(JSON.parse(farm).farm,u.id)}
  db.prepare('UPDATE users SET name=?,phone=?,email=?,address=?,pin=?,farm=? WHERE id=?').run(name,ph,email,b.address===undefined?u.address:str(b.address,300),b.pin===undefined?u.pin:(/^\d{6}$/.test(b.pin||'')?b.pin:''),farm,u.id);
  return{user:pub(db.prepare('SELECT * FROM users WHERE id=?').get(u.id))};
};
H['POST /api/password']=async(req,res,b)=>{
  const u=need(authUser(req));if(!eq(await hashPw(String(b.current||''),u.salt,u.iter),u.hash))bad('Your current password is not right.',401);
  const pe=pwProblem(b.password);if(pe)bad(pe);const salt=crypto.randomBytes(16).toString('base64');
  db.prepare('UPDATE users SET salt=?,hash=?,iter=? WHERE id=?').run(salt,await hashPw(b.password,salt),ITER,u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);startSession(res,u.id,true);return{ok:true};
};
H['POST /api/account/delete']=async(req,res,b)=>{
  const u=need(authUser(req));if(u.role==='admin')bad('Admin accounts cannot be deleted here.',403);
  if(!eq(await hashPw(String(b.password||''),u.salt,u.iter),u.hash))bad('Your password is not right.',401);
  const open=db.prepare(u.role==='farmer'?"SELECT 1 FROM orders o JOIN order_items i ON i.order_id=o.id WHERE i.owner_id=? AND o.status IN ('new','accepted','ready') LIMIT 1":"SELECT 1 FROM orders WHERE user_id=? AND status IN ('awaiting_payment','new','accepted','ready') LIMIT 1").get(u.id);
  if(open)bad('Finish or cancel your open orders first.',409);
  tx(()=>{
    db.prepare("UPDATE users SET status='deleted',name='Deleted user',phone='0000000000',email='',login_id=NULL,salt=NULL,hash=NULL,farm=NULL,address='',pin='' WHERE id=?").run(u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);db.prepare('DELETE FROM notes WHERE user_id=?').run(u.id);
    if(u.role==='farmer'){for(const x of db.prepare('SELECT id FROM products WHERE owner_id=?').all(u.id))dropPhoto('p:'+x.id);dropPhoto('f:'+u.id);db.prepare('DELETE FROM products WHERE owner_id=?').run(u.id)}
  });
  setCookie(res,'fc','',0);audit(u.id,'account.delete',u.id);return{ok:true};
};

/* catalog */
function catalog(viewer){
  const gate=CFG.requireApproval?"AND (p.owner_id IS NULL OR u.status='verified')":'';
  const rows=db.prepare(`SELECT p.id,p.owner_id AS ownerId,p.market_id AS marketId,p.farmer,p.name,p.category,p.emoji,p.price_paise/100.0 AS price,p.unit,p.qty,p.online_price AS onlinePrice,p.online_retailer AS onlineRetailer,p.description,u.farm AS _farm FROM products p LEFT JOIN users u ON u.id=p.owner_id WHERE p.qty>0 ${gate}`).all();
  const out=rows.map(r=>{const f=r._farm?JSON.parse(r._farm):{};delete r._farm;r.fssai=f.fssai||'';return r});
  if(viewer&&viewer.role==='farmer'){
    const have=new Set(out.map(p=>p.id));
    for(const r of db.prepare('SELECT id,owner_id AS ownerId,market_id AS marketId,farmer,name,category,emoji,price_paise/100.0 AS price,unit,qty,online_price AS onlinePrice,online_retailer AS onlineRetailer,description FROM products WHERE owner_id=?').all(viewer.id))if(!have.has(r.id))out.push(r);
  }
  snapshotPrices();
  const meta=new Map(db.prepare('SELECT id,updated,photo_v FROM products').all().map(r=>[r.id,r]));
  const old=new Map(),d7=istDay(-7),d9=istDay(-9);
  for(const r of db.prepare('SELECT market_id,nk,AVG(p) AS a FROM price_log WHERE day<=? AND day>=? GROUP BY market_id,nk').all(d7,d9))old.set(r.market_id+'|'+r.nk,r.a/100);
  for(const r of out){const m=meta.get(r.id)||{};r.updatedAt=m.updated||null;r.photoV=m.photo_v||0;const o=old.get(r.marketId+'|'+nkey(r.name));r.was7=o?Math.round(o*100)/100:null}
  const fids=[...new Set(out.map(p=>p.ownerId).filter(Boolean))],farmers=[];
  for(const id of fids){const u=db.prepare('SELECT id,name,farm,photo_v,created FROM users WHERE id=?').get(id);if(!u||!u.farm)continue;const f=JSON.parse(u.farm);
    farmers.push({id:u.id,farm:f.farm||u.name,owner:String(u.name||'').split(/\s+/)[0],area:f.area||'',grow:f.grow||'',story:f.story||'',since:f.since||'',photoV:u.photo_v||0,joined:u.created,verified:!!f.fssai})}
  return{markets:db.prepare('SELECT id,owner_id AS ownerId,name,area,hours,contact,lat,lng FROM markets').all(),products:out,farmers,
    reviews:db.prepare('SELECT id,product_id AS pid,order_id AS oid,rating,text,name,at FROM reviews ORDER BY at DESC LIMIT 2000').all()};
}
H['GET /api/catalog']=async(req)=>catalog(authUser(req));

/* products and markets (farmers) */
function readProduct(b){
  const price=Number(b.price),qty=Number(b.qty);
  if(!(price>0)||price>100000)bad('Enter a valid price.');if(!(qty>=0)||qty>100000)bad('Enter a valid quantity.');
  const name=str(b.name,80);if(!name)bad('Enter a product name.');
  if(!db.prepare('SELECT 1 FROM markets WHERE id=?').get(str(b.marketId,40)))bad('Choose a market.');
  const unit=['kg','dozen','bunch','piece','bag','litre'].includes(b.unit)?b.unit:'kg';
  const online=b.online?Number(b.online):null;if(online!==null&&!(online>0&&online<=100000))bad('Enter a valid online price or leave it blank.');
  return{name,price:paise(price),qty,unit,category:['Vegetables','Fruits','Greens','Grains','Other'].includes(b.category)?b.category:'Vegetables',emoji:str(b.emoji,8),marketId:str(b.marketId,40),online,retailer:online?str(b.retailer,60):'',description:str(b.description,400)};
}
H['POST /api/products']=async(req,res,b)=>{
  const u=need(authUser(req),'farmer'),p=readProduct(b),farm=JSON.parse(u.farm||'{}');limit('prod:'+u.id,200,3600e3);
  const r=db.prepare('INSERT INTO products(owner_id,market_id,farmer,name,category,emoji,price_paise,unit,qty,online_price,online_retailer,description,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(u.id,p.marketId,farm.farm||u.name,p.name,p.category,p.emoji,p.price,p.unit,p.qty,p.online,p.retailer,p.description,now());
  logPrice(Number(r.lastInsertRowid));return{id:Number(r.lastInsertRowid)};
};
H['PUT /api/products/:id']=async(req,res,b,pr)=>{
  const u=need(authUser(req),'farmer'),own=db.prepare('SELECT * FROM products WHERE id=? AND owner_id=?').get(+pr.id,u.id);if(!own)bad('Listing not found.',404);
  const p=readProduct(b);db.prepare('UPDATE products SET market_id=?,name=?,category=?,emoji=?,price_paise=?,unit=?,qty=?,online_price=?,online_retailer=?,description=?,updated=? WHERE id=?').run(p.marketId,p.name,p.category,p.emoji,p.price,p.unit,p.qty,p.online,p.retailer,p.description,now(),own.id);logPrice(own.id);return{ok:true};
};
H['DELETE /api/products/:id']=async(req,res,b,pr)=>{const u=need(authUser(req),'farmer');const r=db.prepare('DELETE FROM products WHERE id=? AND owner_id=?').run(+pr.id,u.id);if(!r.changes)bad('Listing not found.',404);dropPhoto('p:'+pr.id);return{ok:true}};
function readMarket(b){
  const name=str(b.name,80),lat=Number(b.lat),lng=Number(b.lng);
  if(!name||!(lat>12&&lat<14)||!(lng>77&&lng<78.2))bad('Enter a name and a pin inside Bengaluru.');
  return{name,lat,lng,area:str(b.area,120)||name,hours:str(b.hours,60)||'Hours not verified',contact:str(b.contact,20)};
}
H['POST /api/markets']=async(req,res,b)=>{
  const u=need(authUser(req),'farmer'),m=readMarket(b);limit('mkt:'+u.id,20,3600e3);
  if(db.prepare('SELECT 1 FROM markets WHERE lower(name)=lower(?)').get(m.name))bad('A market with this name already exists.',409);
  const id='m'+uid();db.prepare('INSERT INTO markets VALUES(?,?,?,?,?,?,?,?)').run(id,u.id,m.name,m.area,m.hours,m.contact,m.lat,m.lng);return{id};
};
H['PUT /api/markets/:id']=async(req,res,b,pr)=>{
  const u=need(authUser(req),'farmer'),own=db.prepare('SELECT * FROM markets WHERE id=? AND owner_id=?').get(pr.id,u.id);if(!own)bad('Market not found.',404);const m=readMarket(b);
  if(db.prepare('SELECT 1 FROM markets WHERE lower(name)=lower(?) AND id<>?').get(m.name,own.id))bad('A market with this name already exists.',409);
  db.prepare('UPDATE markets SET name=?,area=?,hours=?,contact=?,lat=?,lng=? WHERE id=?').run(m.name,m.area,m.hours,m.contact,m.lat,m.lng,own.id);return{ok:true};
};
H['DELETE /api/markets/:id']=async(req,res,b,pr)=>{
  const u=need(authUser(req),'farmer'),own=db.prepare('SELECT * FROM markets WHERE id=? AND owner_id=?').get(pr.id,u.id);if(!own)bad('Market not found.',404);
  if(db.prepare('SELECT 1 FROM products WHERE market_id=?').get(own.id))bad('Move or delete the products listed there first.',409);
  db.prepare('DELETE FROM markets WHERE id=?').run(own.id);return{ok:true};
};

/* freshness: sellers confirm that the stock is still there today */
H['POST /api/products/:id/confirm']=async(req,res,b,pr)=>{const u=need(authUser(req),'farmer');const r=db.prepare('UPDATE products SET updated=? WHERE id=? AND owner_id=?').run(now(),+pr.id,u.id);if(!r.changes)bad('Listing not found.',404);logPrice(+pr.id);return{ok:true}};
H['POST /api/farmer/confirm-all']=async(req)=>{const u=need(authUser(req),'farmer');const r=db.prepare('UPDATE products SET updated=? WHERE owner_id=? AND qty>0').run(now(),u.id);for(const x of db.prepare('SELECT id FROM products WHERE owner_id=?').all(u.id))logPrice(x.id);return{ok:true,n:Number(r.changes)}};

/* price history for one item in one market, and across the city */
H['GET /api/prices']=async(req)=>{
  snapshotPrices();const q=new URL(req.url,'http://x').searchParams,nk=nkey(q.get('name')),mk=str(q.get('market'),40);
  if(!nk)bad('Choose a product.');const from=istDay(-29);
  const city=new Map(db.prepare('SELECT day,AVG(p) AS a,MIN(p) AS lo,MAX(p) AS hi,COUNT(*) AS n FROM price_log WHERE nk=? AND day>=? GROUP BY day').all(nk,from).map(r=>[r.day,r]));
  const here=new Map(db.prepare('SELECT day,AVG(p) AS a FROM price_log WHERE nk=? AND market_id=? AND day>=? GROUP BY day').all(nk,mk,from).map(r=>[r.day,r]));
  const days=[];for(let i=29;i>=0;i--){const d=istDay(-i),c=city.get(d),h=here.get(d);if(c||h)days.push({day:d,market:h?Math.round(h.a)/100:null,city:c?Math.round(c.a)/100:null,lo:c?c.lo/100:null,hi:c?c.hi/100:null,n:c?c.n:0})}
  return{days};
};

/* photos: shrunk in the browser, checked here, kept in the database */
H['POST /api/photo/farm']=async(req,res,b)=>{const u=need(authUser(req),'farmer');limit('photo:'+u.id,40,3600e3);const v=putPhoto('f:'+u.id,readPhoto(b));db.prepare('UPDATE users SET photo_v=? WHERE id=?').run(v,u.id);return{v}};
H['DELETE /api/photo/farm']=async(req)=>{const u=need(authUser(req),'farmer');dropPhoto('f:'+u.id);db.prepare('UPDATE users SET photo_v=0 WHERE id=?').run(u.id);return{ok:true}};
H['POST /api/photo/product/:id']=async(req,res,b,pr)=>{const u=need(authUser(req),'farmer');limit('photo:'+u.id,40,3600e3);if(!db.prepare('SELECT 1 FROM products WHERE id=? AND owner_id=?').get(+pr.id,u.id))bad('Listing not found.',404);const v=putPhoto('p:'+pr.id,readPhoto(b));db.prepare('UPDATE products SET photo_v=? WHERE id=?').run(v,+pr.id);return{v}};
H['DELETE /api/photo/product/:id']=async(req,res,b,pr)=>{const u=need(authUser(req),'farmer');if(!db.prepare('SELECT 1 FROM products WHERE id=? AND owner_id=?').get(+pr.id,u.id))bad('Listing not found.',404);dropPhoto('p:'+pr.id);db.prepare('UPDATE products SET photo_v=0 WHERE id=?').run(+pr.id);return{ok:true}};

/* ---------- orders ---------- */
function feeFor(type,sub){return type==='delivery'&&sub<paise(CFG.freeOver)?paise(CFG.fee):0}
function releaseStock(orderId){for(const i of db.prepare('SELECT product_id,qty FROM order_items WHERE order_id=?').all(orderId))db.prepare('UPDATE products SET qty=round(qty+?,3) WHERE id=?').run(i.qty,i.product_id)}
function ownersOf(orderId){return db.prepare('SELECT DISTINCT owner_id FROM order_items WHERE order_id=? AND owner_id IS NOT NULL').all(orderId).map(r=>r.owner_id)}
function expireHolds(){
  const cut=new Date(Date.now()-CFG.payHoldMin*60000).toISOString();
  for(const o of db.prepare("SELECT id,user_id,ref FROM orders WHERE status='awaiting_payment' AND created<?").all(cut))tx(()=>{releaseStock(o.id);db.prepare("UPDATE orders SET status='cancelled',pay_status='expired',cancel_note='The payment window closed.',updated=? WHERE id=? AND status='awaiting_payment'").run(now(),o.id);ev(o.id,'cancelled')});
}
function announceNew(o){
  const paid=o.pay_method==='online';
  for(const f of ownersOf(o.id))tell(f,'New '+o.type+' request'+(paid?' (paid)':''),'From '+o.name+': '+(o.total/100).toFixed(0)+' rupees'+(paid?', paid online':'')+'. Reference '+o.ref+'.','FarmConnect: new '+o.type+' request '+o.ref+' for Rs '+(o.total/100).toFixed(0)+'. Open your seller workspace to accept it.');
  tell(o.user_id,paid?'Payment received':'Request sent',paid?'We received your payment for order '+o.ref+'. The seller will confirm it.':'Order '+o.ref+' is waiting for the seller to accept it.');
}
function paymentFor(o,u){return{keyId:CFG.rzpKey||'rzp_test_mock',orderId:o.rzp_order,amount:o.total,currency:'INR',name:'FarmConnect',description:'Order '+o.ref,prefill:{name:o.name,contact:o.phone,email:u&&u.email||undefined}}}
H['POST /api/orders']=async(req,res,b)=>{
  const u=need(authUser(req),'customer');expireHolds();limit('order:'+u.id,30,3600e3,'You have placed many orders in a short time. Please wait a little.');
  const type=b.type==='delivery'?'delivery':'pickup',method=b.payMethod==='online'?'online':'cod';
  const name=str(b.name,80),phone=normPhone(b.phone),addr=str(b.address,300),pin=str(b.pin,6);
  if(!name)bad('Enter your name.');if(!okPhone(phone))bad('Enter a valid 10-digit mobile number.');
  if(type==='delivery'){if(!addr)bad('Enter a delivery address.');if(!/^\d{6}$/.test(pin))bad('Enter a 6-digit pincode.')}
  if(!b.terms)bad('Please accept the terms.');
  const items=Array.isArray(b.items)?b.items.slice(0,60):[];if(!items.length)bad('Your basket is empty.');
  const out=tx(()=>{
    let sub=0,market=null;const lines=[];
    for(const it of items){
      const p=db.prepare('SELECT p.*,u.status AS ostatus FROM products p LEFT JOIN users u ON u.id=p.owner_id WHERE p.id=?').get(+it.id),q=Number(it.qty);
      if(!p||!(q>0)||q>10000||(CFG.requireApproval&&p.owner_id&&p.ostatus!=='verified'))bad('A product in your basket is no longer available.',409);
      if(lines.some(l=>l.p.id===p.id))bad('A product appears twice in your basket.');
      if(market&&market!==p.market_id)bad('A basket can hold one market only.');market=p.market_id;
      if(q>p.qty+1e-9)bad('Only '+p.qty+' '+p.unit+' of '+p.name+' is left.',409);
      lines.push({p,q});sub+=Math.round(p.price_paise*q);
    }
    if(type==='delivery'&&sub<paise(CFG.minDelivery))bad('Delivery needs a basket of at least ₹'+CFG.minDelivery+'.');
    const fee=feeFor(type,sub),total=sub+fee,id=uid(),ref='FC-'+crypto.randomBytes(4).toString('hex').toUpperCase().slice(0,6),t=now();
    const st=method==='online'?'awaiting_payment':'new';
    db.prepare('INSERT INTO orders(id,ref,user_id,market_id,type,status,pay_method,pay_status,subtotal,fee,total,name,phone,address,slot,date,note,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,ref,u.id,market,type,st,method,method==='online'?'pending':'cod',sub,fee,total,name,phone,type==='delivery'?addr+', '+pin:'',str(b.slot,40),okDate(b.date),str(b.note,300),t,t);
    ev(id,st);
    for(const {p,q} of lines){
      db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?,?,?,?)').run(id,p.id,p.owner_id,p.name,p.unit,q,p.price_paise,p.emoji||'');
      db.prepare('UPDATE products SET qty=round(qty-?,3) WHERE id=?').run(q,p.id);
    }
    return{id,ref,total};
  });
  if(method==='online'){
    try{
      const ro=await rzp('POST','/orders',{amount:out.total,currency:'INR',receipt:out.ref,notes:{order:out.ref}});
      db.prepare('UPDATE orders SET rzp_order=? WHERE id=?').run(ro.id,out.id);
      return{order:out,payment:paymentFor(db.prepare('SELECT * FROM orders WHERE id=?').get(out.id),u)};
    }catch(e){tx(()=>{releaseStock(out.id);db.prepare("UPDATE orders SET status='cancelled',pay_status='failed',updated=? WHERE id=?").run(now(),out.id);ev(out.id,'cancelled')});throw e}
  }
  announceNew(db.prepare('SELECT * FROM orders WHERE id=?').get(out.id));
  return{order:out};
};
H['POST /api/orders/:id/pay']=async(req,res,b,pr)=>{
  const u=need(authUser(req),'customer');expireHolds();
  const o=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(pr.id,u.id);if(!o)bad('Order not found.',404);
  if(o.status!=='awaiting_payment'||!o.rzp_order)bad('This order is not waiting for payment.',409);
  return{payment:paymentFor(o,u)};
};
function markPaid(order,payId){
  const r=tx(()=>{
    const o=db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
    if(o.pay_status==='paid')return false;                      // idempotent
    if(o.status==='cancelled'){db.prepare("UPDATE orders SET pay_status='paid_after_cancel',rzp_payment=?,updated=? WHERE id=?").run(payId,now(),o.id);return 'refund'}
    db.prepare("UPDATE orders SET pay_status='paid',status='new',rzp_payment=?,paid_at=?,updated=? WHERE id=?").run(payId,now(),now(),o.id);ev(o.id,'new');return true;
  });
  if(r===true)announceNew(db.prepare('SELECT * FROM orders WHERE id=?').get(order.id));
  return r;
}
async function refundIfNeeded(o){
  if(!o.rzp_payment||o.rzp_refund)return;
  const r=await rzp('POST','/payments/'+o.rzp_payment+'/refund',{amount:o.total,notes:{order:o.ref}});
  db.prepare("UPDATE orders SET rzp_refund=?,pay_status='refunded',refunded_at=?,updated=? WHERE id=?").run(r.id,now(),now(),o.id);
  tell(o.user_id,'Refund started','We refunded '+(o.total/100).toFixed(0)+' rupees for order '+o.ref+'. It reaches your account in 5 to 7 working days.','FarmConnect: your refund of Rs '+(o.total/100).toFixed(0)+' for order '+o.ref+' has started. It takes 5 to 7 working days.');
}
H['POST /api/payments/verify']=async(req,res,b)=>{
  const u=need(authUser(req),'customer');
  const o=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(str(b.orderId,40),u.id);if(!o||!o.rzp_order)bad('Order not found.',404);
  if(!eq(paySig(o.rzp_order,str(b.razorpay_payment_id,60)),str(b.razorpay_signature,128))||!eq(o.rzp_order,str(b.razorpay_order_id,60)))bad('Payment could not be verified.',400);
  const r=markPaid(o,b.razorpay_payment_id);if(r==='refund')await refundIfNeeded(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id));
  return{ok:true,status:db.prepare('SELECT status,pay_status FROM orders WHERE id=?').get(o.id)};
};
H['POST /api/orders/:id/payment-failed']=async(req,res,b,pr)=>{
  const u=need(authUser(req),'customer');const o=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(pr.id,u.id);if(!o)bad('Order not found.',404);
  return{ok:true,retry:o.status==='awaiting_payment'};            // order stays on hold until it expires or is cancelled
};
H['POST /api/webhooks/razorpay']=async(req,res,b,pr,raw)=>{
  const sig=req.headers['x-razorpay-signature']||'',evId=req.headers['x-razorpay-event-id']||'';
  if(!CFG.rzpWebhookSecret||!eq(crypto.createHmac('sha256',CFG.rzpWebhookSecret).update(raw).digest('hex'),sig))bad('Invalid signature.',400);
  if(evId){if(db.prepare('SELECT 1 FROM events WHERE id=?').get(evId))return{ok:true,duplicate:true};db.prepare('INSERT INTO events VALUES(?,?,?)').run(evId,b.event,now())}
  const pay=b.payload&&b.payload.payment&&b.payload.payment.entity;
  if(b.event==='payment.captured'&&pay){
    const o=db.prepare('SELECT * FROM orders WHERE rzp_order=?').get(pay.order_id);
    if(o&&pay.amount===o.total){const r=markPaid(o,pay.id);if(r==='refund')await refundIfNeeded(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id))}
  }
  if(b.event==='payment.failed'&&pay){db.prepare("UPDATE orders SET pay_status='failed',updated=? WHERE rzp_order=? AND pay_status='pending'").run(now(),pay.order_id)}
  return{ok:true};
};
function orderOut(o,forFarmer){
  const items=db.prepare('SELECT product_id AS pid,name,unit,qty,price_paise/100.0 AS price,owner_id AS ownerId,emoji FROM order_items WHERE order_id=?').all(o.id);
  const events=db.prepare('SELECT status AS s,at FROM order_events WHERE order_id=? ORDER BY rowid').all(o.id);
  const out={id:o.id,ref:o.ref,type:o.type,status:o.status,payMethod:o.pay_method,payStatus:o.pay_status,total:o.total/100,fee:o.fee/100,subtotal:o.subtotal/100,marketId:o.market_id,name:o.name,phone:o.phone,address:o.address,slot:o.slot,date:o.date,note:o.note,createdAt:o.created,updatedAt:o.updated,paidAt:o.paid_at||null,refundedAt:o.refunded_at||null,payId:o.rzp_payment||'',cancelNote:o.cancel_note||'',events,items:forFarmer?items.filter(i=>i.ownerId===forFarmer):items};
  if(forFarmer)out.ownerIds=[forFarmer];else{out.uid=o.user_id;out.reviewed=!!db.prepare('SELECT 1 FROM reviews WHERE order_id=?').get(o.id)}
  return out;
}
H['GET /api/orders']=async(req)=>{expireHolds();const u=need(authUser(req),'customer');return{orders:db.prepare("SELECT * FROM orders WHERE user_id=? AND NOT (status='cancelled' AND pay_status='expired') ORDER BY created DESC LIMIT 200").all(u.id).map(o=>orderOut(o))}};
H['GET /api/farmer/orders']=async(req)=>{
  expireHolds();const u=need(authUser(req),'farmer');
  const ids=db.prepare("SELECT DISTINCT o.id FROM orders o JOIN order_items i ON i.order_id=o.id WHERE i.owner_id=? AND o.status<>'awaiting_payment'").all(u.id).map(r=>r.id);
  return{orders:ids.map(id=>orderOut(db.prepare('SELECT * FROM orders WHERE id=?').get(id),u.id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))};
};
const NEXT={new:['accepted','cancelled'],accepted:['ready','cancelled'],ready:['done']};
const SAYS={
  accepted:o=>['Request accepted','The seller accepted order '+o.ref+'.','FarmConnect: your order '+o.ref+' was accepted by the seller.'],
  ready:o=>o.type==='delivery'?['Out for delivery','Order '+o.ref+' is on its way.','FarmConnect: order '+o.ref+' is out for delivery.']:['Ready for pickup','Order '+o.ref+' is ready to collect.','FarmConnect: order '+o.ref+' is ready for pickup.'],
  done:o=>o.type==='delivery'?['Delivered','Order '+o.ref+' was delivered. You can rate it in My orders.','']:['Collected','Order '+o.ref+' was collected. You can rate it in My orders.',''],
  cancelled:o=>['Request declined','The seller could not fulfil order '+o.ref+'. The stock was released.','FarmConnect: the seller could not fulfil order '+o.ref+'. You were not charged, or any payment is being refunded.']
};
H['POST /api/orders/:id/status']=async(req,res,b,pr)=>{
  const u=need(authUser(req),'farmer');
  const o=db.prepare('SELECT o.* FROM orders o WHERE o.id=? AND EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=o.id AND i.owner_id=?)').get(pr.id,u.id);if(!o)bad('Order not found.',404);
  if(!(NEXT[o.status]||[]).includes(b.status))bad('That change is not allowed for this order.',409);
  tx(()=>{
    const done=b.status==='done'&&o.pay_method==='cod'?",pay_status='cod_collected'":'';
    db.prepare("UPDATE orders SET status=?,updated=?,cancel_note=?"+done+" WHERE id=?").run(b.status,now(),b.status==='cancelled'?'The seller could not fulfil this request.':o.cancel_note||'',o.id);ev(o.id,b.status);
    if(b.status==='cancelled')releaseStock(o.id);
  });
  const t=SAYS[b.status](o);tell(o.user_id,t[0],t[1],t[2]);
  if(b.status==='cancelled'&&o.pay_status==='paid')await refundIfNeeded(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id));
  return{ok:true};
};
H['POST /api/orders/:id/cancel']=async(req,res,b,pr)=>{
  const u=need(authUser(req),'customer');const o=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(pr.id,u.id);if(!o)bad('Order not found.',404);
  if(!['new','awaiting_payment'].includes(o.status))bad('This order can no longer be cancelled here. Contact the seller.',409);
  tx(()=>{const c=db.prepare("UPDATE orders SET status='cancelled',cancel_note='You cancelled this order.',updated=? WHERE id=? AND status IN ('new','awaiting_payment')").run(now(),o.id);if(c.changes){releaseStock(o.id);ev(o.id,'cancelled')}});
  if(o.status==='new')for(const f of ownersOf(o.id))tell(f,'Order cancelled','Customer cancelled order '+o.ref+'. The stock was released.');
  if(o.pay_status==='paid')await refundIfNeeded(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id));
  return{ok:true,refund:o.pay_status==='paid'};
};
H['GET /api/farmer/products']=async(req)=>{const u=need(authUser(req),'farmer');return{products:db.prepare('SELECT id,owner_id AS ownerId,market_id AS marketId,farmer,name,category,emoji,price_paise/100.0 AS price,unit,qty,online_price AS onlinePrice,online_retailer AS onlineRetailer,description FROM products WHERE owner_id=?').all(u.id)}};

/* reviews, notifications, support */
H['POST /api/reviews']=async(req,res,b)=>{
  const u=need(authUser(req),'customer'),o=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(str(b.orderId,40),u.id);if(!o)bad('Order not found.',404);
  if(o.status!=='done')bad('You can rate an order once it is collected or delivered.',409);
  const list=Array.isArray(b.ratings)?b.ratings.slice(0,40):[];let n=0;
  for(const r of list){
    const rating=Number(r.rating),pid=+r.pid;if(!(rating>=1&&rating<=5)||!db.prepare('SELECT 1 FROM order_items WHERE order_id=? AND product_id=?').get(o.id,pid))continue;
    const c=db.prepare('INSERT OR IGNORE INTO reviews VALUES(?,?,?,?,?,?,?,?)').run(uid(),pid,o.id,u.id,Math.round(rating),str(r.text,200),str(o.name,40).split(' ')[0]||'Customer',now());n+=c.changes;
  }
  if(!n)bad('Choose at least one star rating.');return{ok:true,saved:n};
};
H['GET /api/notes']=async(req)=>{const u=need(authUser(req));return{notes:db.prepare('SELECT id,title,body,at,read FROM notes WHERE user_id=? ORDER BY at DESC LIMIT 60').all(u.id).map(n=>({...n,read:!!n.read,for:u.id}))}};
H['POST /api/notes/read']=async(req)=>{const u=need(authUser(req));db.prepare('UPDATE notes SET read=1 WHERE user_id=?').run(u.id);return{ok:true}};
H['POST /api/support']=async(req,res,b)=>{
  limit('support:'+clientIp(req),6,3600e3,'You sent several messages already. We will reply soon.');
  if(b.website)return{ok:true};                                    // honeypot: real people leave this empty
  const u=authUser(req),name=str(b.name,80)||(u&&u.name)||'',phone=normPhone(b.phone)||(u&&u.phone)||'',email=str(b.email,120).toLowerCase(),msg=str(b.message,2000);
  if(msg.length<10)bad('Tell us a little more so we can help (at least 10 characters).');
  if(!okPhone(phone)&&!okEmail(email))bad('Add a mobile number or email so we can reply.');
  const id='T'+crypto.randomBytes(3).toString('hex').toUpperCase();
  db.prepare('INSERT INTO tickets VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,u?u.id:null,name,phone,email,str(b.ref,20),msg,'open','',now());
  return{ok:true,id};
};

/* ---------- admin ---------- */
const ADM=(req)=>need(authUser(req),'admin');
H['GET /api/admin/summary']=async(req)=>{ADM(req);
  const c=(q,...a)=>db.prepare(q).get(...a).n;
  return{customers:c("SELECT COUNT(*) n FROM users WHERE role='customer' AND status='active'"),sellersPending:c("SELECT COUNT(*) n FROM users WHERE role='farmer' AND status='pending'"),sellersVerified:c("SELECT COUNT(*) n FROM users WHERE role='farmer' AND status='verified'"),
    products:c('SELECT COUNT(*) n FROM products'),ordersToday:c("SELECT COUNT(*) n FROM orders WHERE created>=?",new Date(new Date().setHours(0,0,0,0)).toISOString()),ordersOpen:c("SELECT COUNT(*) n FROM orders WHERE status IN ('new','accepted','ready')"),
    sales:db.prepare("SELECT COALESCE(SUM(total),0)/100.0 n FROM orders WHERE status='done'").get().n,ticketsOpen:c("SELECT COUNT(*) n FROM tickets WHERE status='open'")};
};
H['GET /api/admin/sellers']=async(req)=>{ADM(req);return{sellers:db.prepare("SELECT id,login_id AS loginId,name,phone,email,farm,status,created,(SELECT COUNT(*) FROM products p WHERE p.owner_id=users.id) AS listings FROM users WHERE role='farmer' AND status<>'deleted' ORDER BY (status='pending') DESC,created DESC LIMIT 500").all().map(s=>({...s,farm:s.farm?JSON.parse(s.farm):{}}))}};
H['POST /api/admin/sellers/:id']=async(req,res,b,pr)=>{
  const a=ADM(req),s=db.prepare("SELECT * FROM users WHERE id=? AND role='farmer'").get(pr.id);if(!s)bad('Seller not found.',404);
  if(!['verified','pending','suspended'].includes(b.status))bad('Choose verified, pending or suspended.');
  db.prepare('UPDATE users SET status=? WHERE id=?').run(b.status,s.id);if(b.status==='suspended')db.prepare('DELETE FROM sessions WHERE user_id=?').run(s.id);
  audit(a.id,'seller.'+b.status,s.id);
  if(b.status==='verified')tell(s.id,'Your seller account is approved','Customers can now see and order your produce.','FarmConnect: your seller account is approved. Customers can now order your produce.');
  return{ok:true};
};
H['GET /api/admin/products']=async(req)=>{ADM(req);return{products:db.prepare('SELECT p.id,p.name,p.farmer,p.price_paise/100.0 AS price,p.unit,p.qty,p.market_id AS marketId,p.owner_id AS ownerId FROM products p ORDER BY p.id DESC LIMIT 500').all()}};
H['DELETE /api/admin/products/:id']=async(req,res,b,pr)=>{const a=ADM(req);const r=db.prepare('DELETE FROM products WHERE id=?').run(+pr.id);if(!r.changes)bad('Listing not found.',404);dropPhoto('p:'+pr.id);audit(a.id,'product.remove',pr.id);return{ok:true}};
H['DELETE /api/admin/markets/:id']=async(req,res,b,pr)=>{const a=ADM(req);if(db.prepare('SELECT 1 FROM products WHERE market_id=?').get(pr.id))bad('Remove the listings there first.',409);const r=db.prepare('DELETE FROM markets WHERE id=?').run(pr.id);if(!r.changes)bad('Market not found.',404);audit(a.id,'market.remove',pr.id);return{ok:true}};
H['GET /api/admin/orders']=async(req)=>{ADM(req);expireHolds();return{orders:db.prepare('SELECT * FROM orders ORDER BY created DESC LIMIT 300').all().map(o=>orderOut(o))}};
H['POST /api/admin/orders/:id/cancel']=async(req,res,b,pr)=>{
  const a=ADM(req),o=db.prepare('SELECT * FROM orders WHERE id=?').get(pr.id);if(!o)bad('Order not found.',404);
  if(!['awaiting_payment','new','accepted','ready'].includes(o.status))bad('This order is already closed.',409);
  tx(()=>{db.prepare("UPDATE orders SET status='cancelled',cancel_note='Cancelled by FarmConnect support.',updated=? WHERE id=?").run(now(),o.id);releaseStock(o.id);ev(o.id,'cancelled')});
  tell(o.user_id,'Order cancelled','Support cancelled order '+o.ref+'.');for(const f of ownersOf(o.id))tell(f,'Order cancelled','Support cancelled order '+o.ref+'.');
  if(o.pay_status==='paid')await refundIfNeeded(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id));
  audit(a.id,'order.cancel',o.id);return{ok:true};
};
H['GET /api/admin/tickets']=async(req)=>{ADM(req);return{tickets:db.prepare("SELECT * FROM tickets ORDER BY (status='open') DESC,at DESC LIMIT 300").all()}};
H['POST /api/admin/tickets/:id']=async(req,res,b,pr)=>{const a=ADM(req);const r=db.prepare('UPDATE tickets SET status=?,reply=? WHERE id=?').run(b.status==='closed'?'closed':'open',str(b.reply,1000),pr.id);if(!r.changes)bad('Ticket not found.',404);audit(a.id,'ticket.'+b.status,pr.id);return{ok:true}};

/* ---------- pages ---------- */
function bootCfg(){return{live:true,razorpay:!!(CFG.rzpKey&&CFG.rzpSecret)||CFG.mock,otp:CFG.requireOtp,otpDev:CFG.otpDev,approval:CFG.requireApproval,site:CFG.site,fee:CFG.fee,freeOver:CFG.freeOver,minDelivery:CFG.minDelivery,holdMin:CFG.payHoldMin}}
const pageCache={};
function page(name,inject){
  const f=path.join(PUB,name);let st;try{st=fs.statSync(f)}catch{return null}
  let c=pageCache[name];if(!c||c.m!==st.mtimeMs){c=pageCache[name]={m:st.mtimeMs,html:fs.readFileSync(f,'utf8')}}
  return inject?c.html.replace('<!--FC_BOOT-->','<script>window.__FC='+JSON.stringify(bootCfg()).replace(/</g,'\\u003c')+'</script>'):c.html;
}
const CSP="default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; connect-src 'self' https://lumberjack.razorpay.com https://api.razorpay.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'";
const FAVICON='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1c6b3e"/><path d="M18 46c0-16 10-26 28-28 0 18-10 28-28 28zM18 46l14-14" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>';

/* ---------- http ---------- */
const routes=Object.keys(H).map(k=>{const[m,p]=k.split(' ');return{m,re:new RegExp('^'+p.replace(/:(\w+)/g,'(?<$1>[^/]+)')+'$'),f:H[k]}});
function readBody(req,max=64*1024){return new Promise((res,rej)=>{let n=0;const c=[];req.on('data',d=>{n+=d.length;if(n>max){rej(new HttpErr(413,'Request too large.'));req.destroy()}else c.push(d)});req.on('end',()=>res(Buffer.concat(c)));req.on('error',rej)})}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
  if(CFG.secureCookie)res.setHeader('Strict-Transport-Security','max-age=31536000');
  const origin=req.headers.origin;
  if(CFG.origin&&origin===CFG.origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');res.setHeader('Vary','Origin')}
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  const url=new URL(req.url,'http://x'),send=(s,o)=>{res.setHeader('Cache-Control','no-store');res.statusCode=s;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(o))};
  const html=(s,h)=>{res.statusCode=s;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Security-Policy',CSP);res.end(h)};
  try{
    if(url.pathname==='/health')return send(200,{ok:true});
    if(req.method==='GET'&&!url.pathname.startsWith('/api/')){
      if(url.pathname==='/favicon.svg'||url.pathname==='/favicon.ico'){res.setHeader('Content-Type','image/svg+xml');res.setHeader('Cache-Control','public,max-age=86400');return res.end(FAVICON)}
      if(url.pathname==='/robots.txt'){res.setHeader('Content-Type','text/plain');return res.end('User-agent: *\nDisallow: /admin\nDisallow: /api/\n')}
      if(url.pathname==='/admin'){const h=page('admin.html',true);return h?html(200,h):send(404,{error:'Not found.'})}
      const h=page('index.html',true);return h?html(200,h):send(404,{error:'Website file missing. Put index.html in the public folder.'});
    }
    if(req.method!=='GET'&&origin&&url.pathname!=='/api/webhooks/razorpay'){
      let okOrigin=origin===CFG.origin;try{okOrigin=okOrigin||new URL(origin).host===req.headers.host}catch{}
      if(!okOrigin)bad('Origin not allowed.',403);   // CSRF guard
    }
    limit('api:'+clientIp(req),600,300e3);
    const ph=req.method==='GET'&&/^\/api\/photo\/(farm|product)\/([\w-]+)$/.exec(url.pathname);
    if(ph){const row=db.prepare('SELECT mime,data FROM photos WHERE k=?').get((ph[1]==='farm'?'f:':'p:')+ph[2]);if(!row)return send(404,{error:'No photo.'});
      res.statusCode=200;res.setHeader('Content-Type',row.mime);res.setHeader('Cache-Control','public,max-age=31536000,immutable');res.setHeader('Content-Security-Policy',"default-src 'none'");return res.end(Buffer.from(row.data))}
    for(const r of routes){
      if(r.m!==req.method)continue;const m=r.re.exec(url.pathname);if(!m)continue;
      let raw=Buffer.alloc(0),body={};
      if(req.method!=='GET'&&req.method!=='DELETE'){raw=await readBody(req,url.pathname.startsWith('/api/photo/')?260*1024:undefined);if(raw.length){try{body=JSON.parse(raw.toString())}catch{bad('Invalid JSON.')}}}
      const out=await r.f(req,res,body,m.groups||{},raw.toString());return send(200,out);
    }
    send(404,{error:'Not found.'});
  }catch(e){
    if(e instanceof HttpErr)return send(e.status,{error:e.message});
    console.error(e);send(500,{error:'Something went wrong. Please try again.'});
  }
});
async function ensureAdmin(){
  if(!CFG.adminPhone||!CFG.adminPassword)return;
  if(!okPhone(CFG.adminPhone)||pwProblem(CFG.adminPassword)){console.warn('ADMIN_PHONE or ADMIN_PASSWORD is not valid (10-digit phone, 8+ characters with a number). No admin was created.');return}
  const salt=crypto.randomBytes(16).toString('base64'),hash=await hashPw(CFG.adminPassword,salt);
  if(db.prepare("SELECT 1 FROM users WHERE role='admin'").get())db.prepare("UPDATE users SET salt=?,hash=?,iter=?,phone=? WHERE role='admin'").run(salt,hash,ITER,normPhone(CFG.adminPhone));
  else db.prepare("INSERT INTO users(id,role,login_id,name,phone,email,salt,hash,iter,created,status,phone_ok) VALUES(?,?,?,?,?,?,?,?,?,?,'active',1)").run(uid(),'admin','ADMIN','Admin',normPhone(CFG.adminPhone),'',salt,hash,ITER,now());
}
if(require.main===module){
  if(!CFG.mock&&(!CFG.rzpKey||!CFG.rzpSecret))console.warn('Razorpay keys missing: online payments are switched off. Cash on delivery still works.');
  if(CFG.requireOtp&&CFG.smsProvider==='console')console.warn('SMS_PROVIDER is "console": sign-up codes are only printed in this log. Set SMS_PROVIDER=twilio or msg91 before going public.');
  ensureAdmin().then(()=>{
    server.listen(CFG.port,()=>console.log('FarmConnect on :'+CFG.port));
    setInterval(()=>{try{expireHolds();db.prepare('DELETE FROM sessions WHERE exp<?').run(Date.now());db.prepare('DELETE FROM otps WHERE exp<?').run(Date.now())}catch(e){console.error(e)}},60000).unref();
  });
}
module.exports={server,db,CFG,paySig,ensureAdmin};
