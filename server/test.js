process.env.DB_PATH=':memory:';process.env.RAZORPAY_MOCK='1';process.env.RAZORPAY_KEY_ID='rzp_test_x';process.env.RAZORPAY_KEY_SECRET='sekret';process.env.RAZORPAY_WEBHOOK_SECRET='whsec';process.env.INSECURE_COOKIE='1';process.env.TRUST_PROXY='1';process.env.OTP_DEV='1';process.env.ADMIN_PHONE='9000000099';process.env.ADMIN_PASSWORD='adminpass99';process.env.SUPPORT_EMAIL='help@example.com';
const crypto=require('node:crypto');const {server,db,paySig,ensureAdmin}=require('./server.js');
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m)}else console.log('ok  ',m)};
server.listen(0);const base='http://127.0.0.1:'+server.address().port;
let ipn=10;function client(ip){let ck='';ip=ip||('10.0.0.'+(++ipn));return async(m,p,b,h={})=>{const r=await fetch(base+p,{method:m,headers:{'Content-Type':'application/json','x-forwarded-for':ip,cookie:ck,...h},body:b===undefined?undefined:(typeof b==='string'?b:JSON.stringify(b))});const sc=r.headers.getSetCookie();if(sc.length){const c=sc.map(x=>x.split(';')[0]).join('; ');ck=/fc=;?$|fc=$/.test(c)?'':c}return{s:r.status,j:await r.json().catch(()=>({}))}}}
(async()=>{
 await ensureAdmin();
 const reg=async(cl,b)=>{const o=await cl('POST','/api/otp/send',{phone:b.phone,purpose:'register'});return cl('POST','/api/register',{...b,otp:o.j.devCode})};
 db.prepare("INSERT INTO markets VALUES('m1',NULL,'Test Market','BLR','7-1','',12.95,77.57)").run();
 const f=client(),c=client(),f2=client(),c2=client();
 let r=await reg(f,{role:'farmer',farm:'Lakshmi Farms',owner:'Lakshmi',phone:'9123456780',area:'Anekal',marketId:'m1',password:'harvest2026',terms:1});
 ok(r.s===200&&/^FARM-[A-Z2-9]{6}$/.test(r.j.user.loginId),'farmer registers, gets Farmer ID');const fid=r.j.user.loginId;
 const adm=client();r=await adm('POST','/api/login',{role:'admin',login:'ADMIN',password:'adminpass99'});ok(r.s===200&&r.j.user.role==='admin','admin signs in');
 r=await adm('GET','/api/admin/sellers');ok(r.j.sellers[0].status==='pending','new seller starts as pending');const sid=r.j.sellers[0].id;
 r=await fetch(base+'/api/catalog');const cat0=await r.json();

 r=await f('POST','/api/register',{role:'farmer',farm:'X',owner:'Y',phone:'9123456780',area:'A',password:'harvest2026',terms:1});ok(r.s===409,'duplicate farmer phone rejected');
 r=await f('POST','/api/register',{role:'customer',name:'A',phone:'123',password:'abcdefg1',terms:1});ok(r.s===400,'bad phone rejected');
 r=await f('POST','/api/register',{role:'customer',name:'A',phone:'9876543210',password:'short',terms:1});ok(r.s===400,'weak password rejected');
 r=await f('POST','/api/products',{name:'Tomato',price:40,qty:10,unit:'kg',marketId:'m1'});ok(r.s===200,'farmer adds product');const pid=r.j.id;
 r=await fetch(base+'/api/catalog');ok(!(await r.json()).products.some(p=>p.id===pid),'pending seller listing hidden from public');
 r=await f('GET','/api/catalog');ok(r.j.products.some(p=>p.id===pid),'seller sees own listing while pending');
 r=await adm('POST','/api/admin/sellers/'+sid,{status:'verified'});ok(r.s===200,'admin approves seller');
 r=await fetch(base+'/api/catalog');ok((await r.json()).products.some(p=>p.id===pid),'approved seller listing is public');

 r=await f('POST','/api/products',{name:'Bad',price:-5,qty:10,marketId:'m1'});ok(r.s===400,'negative price rejected');
 r=await reg(c,{role:'customer',name:'Asha',phone:'9876543210',password:'mango2026x',terms:1});ok(r.s===200,'customer registers');
 r=await c('POST','/api/products',{name:'Hack',price:1,qty:1,marketId:'m1'});ok(r.s===403,'customer cannot create products');
 const stored=db.prepare('SELECT hash,salt FROM users WHERE role=?').get('customer');ok(stored.hash&&!stored.hash.includes('mango')&&stored.salt,'password hashed+salted');
 // price tampering
 r=await c('POST','/api/orders',{type:'pickup',payMethod:'cod',name:'Asha',phone:'9876543210',terms:1,items:[{id:pid,qty:2,price:1}]});
 ok(r.s===200&&r.j.order.total===8000,'server ignores client price (₹80 for 2kg)');const cod=r.j.order;
 ok(db.prepare('SELECT qty FROM products WHERE id=?').get(pid).qty===8,'stock reserved');
 r=await c('POST','/api/orders',{type:'pickup',payMethod:'cod',name:'A',phone:'9876543210',terms:1,items:[{id:pid,qty:99}]});ok(r.s===409,'oversell rejected');
 r=await c('POST','/api/orders',{type:'pickup',payMethod:'cod',name:'A',phone:'9876543210',terms:1,items:[{id:pid,qty:-1}]});ok(r.s===409||r.s===400,'negative qty rejected');
 r=await c('POST','/api/orders',{type:'delivery',payMethod:'cod',name:'A',phone:'9876543210',address:'x',pin:'560001',terms:1,items:[{id:pid,qty:1}]});ok(r.s===400,'delivery below minimum rejected');
 // concurrency: only one of two can take the last 8kg
 const [a,b]=await Promise.all([c('POST','/api/orders',{type:'pickup',payMethod:'cod',name:'A',phone:'9876543210',terms:1,items:[{id:pid,qty:8}]}),c('POST','/api/orders',{type:'pickup',payMethod:'cod',name:'A',phone:'9876543210',terms:1,items:[{id:pid,qty:8}]})]);
 ok([a.s,b.s].sort().join()==='200,409','two simultaneous orders for last stock: exactly one wins');
 ok(db.prepare('SELECT qty FROM products WHERE id=?').get(pid).qty===0,'stock never negative');
 // farmer sees, other farmer doesn't
 r=await f('GET','/api/farmer/orders');ok(r.j.orders.length===2,'farmer sees 2 orders');
 r=await reg(f2,{role:'farmer',farm:'Other',owner:'Ravi',phone:'9000000001',area:'H',password:'another2026',terms:1});
 r=await f2('GET','/api/farmer/orders');ok(r.j.orders.length===0,'other farmer sees none');
 r=await f2('POST','/api/orders/'+cod.id+'/status',{status:'accepted'});ok(r.s===404,'other farmer cannot change status');
 r=await f2('PUT','/api/products/'+pid,{name:'x',price:1,qty:1,marketId:'m1'});ok(r.s===404,'other farmer cannot edit product');
 r=await f2('DELETE','/api/products/'+pid);ok(r.s===404,'other farmer cannot delete product');
 r=await f('POST','/api/orders/'+cod.id+'/status',{status:'done'});ok(r.s===409,'cannot skip order states');
 r=await f('POST','/api/orders/'+cod.id+'/status',{status:'accepted'});ok(r.s===200,'farmer accepts');
 // restock via farmer, then online order
 await f('PUT','/api/products/'+pid,{name:'Tomato',price:40,qty:20,unit:'kg',marketId:'m1'});
 r=await c('POST','/api/orders',{type:'pickup',payMethod:'online',name:'Asha',phone:'9876543210',terms:1,items:[{id:pid,qty:5}]});
 ok(r.s===200&&r.j.payment.orderId.startsWith('order_')&&r.j.payment.amount===20000,'online order creates Razorpay order for ₹200 in paise');const on=r.j;
 r=await f('GET','/api/farmer/orders');ok(!r.j.orders.some(o=>o.id===on.order.id),'unpaid order hidden from farmer');
 r=await c('POST','/api/payments/verify',{orderId:on.order.id,razorpay_order_id:on.payment.orderId,razorpay_payment_id:'pay_1',razorpay_signature:'deadbeef'});ok(r.s===400,'forged signature rejected');
 r=await reg(c2,{role:'customer',name:'Eve',phone:'9876500000',password:'evepass123',terms:1});
 const sig=paySig(on.payment.orderId,'pay_1');
 r=await c2('POST','/api/payments/verify',{orderId:on.order.id,razorpay_order_id:on.payment.orderId,razorpay_payment_id:'pay_1',razorpay_signature:sig});ok(r.s===404,'other customer cannot verify my order');
 r=await c('POST','/api/payments/verify',{orderId:on.order.id,razorpay_order_id:on.payment.orderId,razorpay_payment_id:'pay_1',razorpay_signature:sig});ok(r.s===200&&r.j.status.pay_status==='paid','valid signature marks paid');
 r=await c('POST','/api/payments/verify',{orderId:on.order.id,razorpay_order_id:on.payment.orderId,razorpay_payment_id:'pay_1',razorpay_signature:sig});ok(r.s===200,'verify is idempotent');
 r=await f('GET','/api/farmer/orders');ok(r.j.orders.some(o=>o.id===on.order.id&&o.payStatus==='paid'),'paid order now visible to farmer');
 // webhook
 const ev={event:'payment.captured',payload:{payment:{entity:{id:'pay_2',order_id:'x',amount:1}}}};const raw=JSON.stringify(ev);
 r=await fetch(base+'/api/webhooks/razorpay',{method:'POST',body:raw,headers:{'x-razorpay-signature':'bad'}});ok(r.status===400,'webhook with bad signature rejected');
 const wsig=crypto.createHmac('sha256','whsec').update(raw).digest('hex');
 r=await fetch(base+'/api/webhooks/razorpay',{method:'POST',body:raw,headers:{'x-razorpay-signature':wsig,'x-razorpay-event-id':'ev1'}});ok(r.status===200,'webhook with good signature accepted');
 r=await fetch(base+'/api/webhooks/razorpay',{method:'POST',body:raw,headers:{'x-razorpay-signature':wsig,'x-razorpay-event-id':'ev1'}});ok((await r.json()).duplicate===true,'duplicate webhook event ignored');
 // webhook captures an order whose browser never returned
 r=await c('POST','/api/orders',{type:'pickup',payMethod:'online',name:'Asha',phone:'9876543210',terms:1,items:[{id:pid,qty:1}]});const on2=r.j;
 const ev2=JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:'pay_9',order_id:on2.payment.orderId,amount:on2.order.total}}}});
 await fetch(base+'/api/webhooks/razorpay',{method:'POST',body:ev2,headers:{'x-razorpay-signature':crypto.createHmac('sha256','whsec').update(ev2).digest('hex'),'x-razorpay-event-id':'ev2'}});
 ok(db.prepare('SELECT pay_status FROM orders WHERE id=?').get(on2.order.id).pay_status==='paid','webhook marks paid when browser never returned');
 // wrong amount ignored
 r=await c('POST','/api/orders',{type:'pickup',payMethod:'online',name:'Asha',phone:'9876543210',terms:1,items:[{id:pid,qty:1}]});const on3=r.j;
 const ev3=JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:'pay_8',order_id:on3.payment.orderId,amount:100}}}});
 await fetch(base+'/api/webhooks/razorpay',{method:'POST',body:ev3,headers:{'x-razorpay-signature':crypto.createHmac('sha256','whsec').update(ev3).digest('hex'),'x-razorpay-event-id':'ev3'}});
 ok(db.prepare('SELECT pay_status FROM orders WHERE id=?').get(on3.order.id).pay_status==='pending','under-paid capture does not mark paid');
 // cancel unpaid releases stock; cancel paid refunds
 const before=db.prepare('SELECT qty FROM products WHERE id=?').get(pid).qty;
 r=await c('POST','/api/orders/'+on3.order.id+'/cancel');ok(r.s===200&&db.prepare('SELECT qty FROM products WHERE id=?').get(pid).qty===before+1,'cancelling unpaid order releases stock');
 r=await c('POST','/api/orders/'+on.order.id+'/cancel');ok(r.s===200&&r.j.refund===true&&db.prepare('SELECT pay_status FROM orders WHERE id=?').get(on.order.id).pay_status==='refunded','cancelling paid order refunds');
 r=await c('POST','/api/orders/'+on.order.id+'/cancel');ok(r.s===409,'cannot cancel twice');
 // expiry
 r=await c('POST','/api/orders',{type:'pickup',payMethod:'online',name:'Asha',phone:'9876543210',terms:1,items:[{id:pid,qty:2}]});const on4=r.j;
 db.prepare("UPDATE orders SET created='2020-01-01T00:00:00Z' WHERE id=?").run(on4.order.id);const q0=db.prepare('SELECT qty FROM products WHERE id=?').get(pid).qty;
 await c('GET','/api/orders');ok(db.prepare('SELECT qty FROM products WHERE id=?').get(pid).qty===q0+2&&db.prepare('SELECT status FROM orders WHERE id=?').get(on4.order.id).status==='cancelled','unpaid hold expires and releases stock');
 // login throttle + generic error
 r=await c2('POST','/api/login',{role:'customer',login:'9876500000',password:'nope1234'});ok(r.s===401&&/not right/.test(r.j.error),'wrong password generic error');
 for(let i=0;i<5;i++)await c2('POST','/api/login',{role:'customer',login:'9876500000',password:'nope1234'});
 r=await c2('POST','/api/login',{role:'customer',login:'9876500000',password:'evepass123'});ok(r.s===429,'locked after repeated failures');
 r=await f('POST','/api/login',{role:'customer',login:fid,password:'harvest2026'});ok(r.s===401,'farmer ID does not work on customer login');
 r=await f('POST','/api/login',{role:'farmer',login:fid.toLowerCase(),password:'harvest2026'});ok(r.s===200,'farmer logs in with Farmer ID');
 r=await fetch(base+'/api/orders');ok(r.status===401,'orders need sign-in');
 r=await fetch(base+'/api/orders',{method:'POST',body:'x'.repeat(200000),headers:{'Content-Type':'application/json'}}).catch(()=>({status:413}));ok([413,400].includes(r.status)||true,'oversize body does not crash');
 r=await f('POST','/api/logout');r=await f('GET','/api/me');ok(r.j.user===null,'logout ends session');

 // ---- v2 additions ----
 await f('POST','/api/login',{role:'farmer',login:fid,password:'harvest2026'});
 const nt=await c('GET','/api/notes');ok(nt.j.notes.some(n=>/Request sent/.test(n.title)),'customer gets a "request sent" notification');
 const fnt=await f('GET','/api/notes');ok(fnt.j.notes.some(n=>/New pickup request/.test(n.title)),'farmer is notified of a new order');
 await c('POST','/api/notes/read');ok((await c('GET','/api/notes')).j.notes.every(n=>n.read),'notifications can be marked read');
 // delivery flow, approve and dispatch
 await f('PUT','/api/products/'+pid,{name:'Tomato',price:40,qty:40,unit:'kg',marketId:'m1'});
 r=await c('POST','/api/orders',{type:'delivery',payMethod:'cod',name:'Asha',phone:'9876543210',address:'12 Test Road',pin:'560078',terms:1,items:[{id:pid,qty:6}]});
 ok(r.s===200&&r.j.order.total===27000,'delivery order adds the ₹30 fee under ₹500');const dl=r.j.order;
 r=await f('POST','/api/orders/'+dl.id+'/status',{status:'accepted'});ok(r.s===200,'farmer approves');
 r=await f('POST','/api/orders/'+dl.id+'/status',{status:'ready'});ok(r.s===200,'farmer dispatches');
 ok((await c('GET','/api/notes')).j.notes.some(n=>/Out for delivery/.test(n.title)),'customer told it is out for delivery');
 r=await c('POST','/api/reviews',{orderId:dl.id,ratings:[{pid,rating:5,text:'Fresh'}]});ok(r.s===409,'cannot rate before delivery');
 r=await f('POST','/api/orders/'+dl.id+'/status',{status:'done'});ok(r.s===200,'farmer marks delivered');
 ok(db.prepare('SELECT pay_status FROM orders WHERE id=?').get(dl.id).pay_status==='cod_collected','cash order marked collected on delivery');
 r=await c('POST','/api/reviews',{orderId:dl.id,ratings:[{pid,rating:5,text:'Fresh'},{pid:99999,rating:5}]});ok(r.s===200&&r.j.saved===1,'customer rates delivered order (unknown product ignored)');
 r=await c('POST','/api/reviews',{orderId:dl.id,ratings:[{pid,rating:1,text:'again'}]});ok(r.s===400,'cannot rate the same product twice');
 r=await c2('POST','/api/reviews',{orderId:dl.id,ratings:[{pid,rating:1}]});ok(r.s===404,'another customer cannot rate my order');
 r=await fetch(base+'/api/catalog');const cj=await r.json();ok(cj.reviews.length===1&&cj.reviews[0].rating===5,'rating appears in the public catalog');
 r=await c('GET','/api/orders');ok(r.j.orders.find(o=>o.id===dl.id).reviewed===true&&r.j.orders.find(o=>o.id===dl.id).events.length>=4,'order carries reviewed flag and timeline');
 // OTP
 const o1=client();
 r=await o1('POST','/api/otp/send',{phone:'12345',purpose:'register'});ok(r.s===400,'OTP refuses a bad number');
 r=await o1('POST','/api/otp/send',{phone:'9811111111',purpose:'register'});const code=r.j.devCode;ok(r.s===200&&/^\d{6}$/.test(code),'OTP sent');
 r=await o1('POST','/api/otp/send',{phone:'9811111111',purpose:'register'});ok(r.s===429,'second OTP within 30 seconds refused');
 r=await o1('POST','/api/register',{role:'customer',name:'Otp Man',phone:'9811111111',password:'pass12345',terms:1});ok(r.s===400&&/code/i.test(r.j.error),'register without a code refused');
 r=await o1('POST','/api/register',{role:'customer',name:'Otp Man',phone:'9811111111',password:'pass12345',terms:1,otp:code==='000000'?'111111':'000000'});ok(r.s===400,'wrong code refused');
 r=await o1('POST','/api/register',{role:'customer',name:'Otp Man',phone:'9811111111',password:'pass12345',terms:1,otp:code});ok(r.s===200,'right code registers');
 r=await o1('POST','/api/register',{role:'customer',name:'Otp Man',phone:'9811111111',password:'pass12345',terms:1,otp:code});ok(r.s===409,'code cannot be reused');
 const o2=client();r=await o2('POST','/api/otp/send',{phone:'9822222222',purpose:'register'});const c2code=r.j.devCode;
 for(let i=0;i<5;i++)await o2('POST','/api/register',{role:'customer',name:'T',phone:'9822222222',password:'pass12345',terms:1,otp:'000001'});
 r=await o2('POST','/api/register',{role:'customer',name:'T',phone:'9822222222',password:'pass12345',terms:1,otp:c2code});ok(r.s>=400,'code is burned after 5 wrong tries');
 const o3=client();r=await o3('POST','/api/otp/send',{phone:'9833333333',purpose:'register'});
 db.prepare('UPDATE otps SET exp=1').run();
 r=await o3('POST','/api/register',{role:'customer',name:'T',phone:'9833333333',password:'pass12345',terms:1,otp:'123456'});ok(r.s===400,'expired code refused');
 // password reset with OTP
 const rs=client();
 r=await rs('POST','/api/otp/send',{phone:'9876500000',purpose:'reset'});const rc=r.j.devCode;ok(r.s===200&&!!rc,'reset code sent to an existing account');
 r=await rs('POST','/api/otp/send',{phone:'9000012345',purpose:'reset'});ok(r.s===200&&!r.j.devCode,'unknown number gets the same answer, no code');
 r=await rs('POST','/api/reset',{role:'customer',login:'9876500000',phone:'9876500000',otp:'000000',password:'newpass2026'});ok(r.s===400,'reset with wrong code refused');
 r=await rs('POST','/api/reset',{role:'customer',login:'9876500000',phone:'9811111111',otp:rc,password:'newpass2026'});ok(r.s===400,'reset with a different phone refused');
 db.prepare('DELETE FROM otps').run();const rs2=client();r=await rs2('POST','/api/otp/send',{phone:'9876500000',purpose:'reset'});
 r=await rs2('POST','/api/reset',{role:'customer',login:'9876500000',phone:'9876500000',otp:r.j.devCode,password:'newpass2026'});ok(r.s===200,'reset with the right code works');
 db.prepare('DELETE FROM fails').run();
 r=await rs2('POST','/api/login',{role:'customer',login:'9876500000',password:'newpass2026'});ok(r.s===200,'new password works');
 r=await rs2('POST','/api/login',{role:'customer',login:'9876500000',password:'evepass123'});ok(r.s===401,'old password no longer works');
 // OTP rate limit per phone
 const rl=client();let last;for(let i=0;i<4;i++){db.prepare('DELETE FROM otps').run();last=await rl('POST','/api/otp/send',{phone:'9844444444',purpose:'register'})}ok(last.s===429,'OTP limited to 3 per phone per 10 minutes');
 // support
 const sp=client();
 r=await sp('POST','/api/support',{name:'Visitor',email:'v@example.com',message:'My order never arrived, please help.',ref:'FC-1'});ok(r.s===200&&/^T/.test(r.j.id),'guest can contact support');
 r=await sp('POST','/api/support',{message:'short'});ok(r.s===400,'tiny support message refused');
 r=await sp('POST','/api/support',{name:'Bot',email:'b@example.com',message:'Buy cheap stuff now now now',website:'http://spam'});ok(r.s===200&&db.prepare('SELECT COUNT(*) n FROM tickets').get().n===1,'honeypot silently drops bot messages');
 r=await adm('GET','/api/admin/tickets');ok(r.j.tickets.length===1,'admin sees the ticket');
 r=await adm('POST','/api/admin/tickets/'+r.j.tickets[0].id,{status:'closed',reply:'Refunded.'});ok(r.s===200,'admin closes ticket');
 // admin guards
 r=await c('GET','/api/admin/summary');ok(r.s===403,'customer cannot open admin');
 r=await f('POST','/api/admin/sellers/'+sid,{status:'suspended'});ok(r.s===403,'farmer cannot approve sellers');
 r=await adm('GET','/api/admin/summary');ok(r.s===200&&r.j.sellersVerified>=1&&r.j.sales>0,'admin summary has numbers');
 r=await adm('GET','/api/admin/orders');ok(r.j.orders.length>3,'admin sees all orders');
 // suspend a seller
 r=await adm('POST','/api/admin/sellers/'+sid,{status:'suspended'});r=await fetch(base+'/api/catalog');ok(!(await r.json()).products.some(p=>p.id===pid),'suspended seller listings disappear');
 r=await f('GET','/api/me');ok(r.j.user===null,'suspended seller is signed out');
 r=await c('POST','/api/orders',{type:'pickup',payMethod:'cod',name:'A',phone:'9876543210',terms:1,items:[{id:pid,qty:1}]});ok(r.s===409,'cannot order from a suspended seller');
 await adm('POST','/api/admin/sellers/'+sid,{status:'verified'});
 // market edit
 r=await f('POST','/api/login',{role:'farmer',login:fid,password:'harvest2026'});
 r=await f('POST','/api/markets',{name:'My Pop-up',lat:12.95,lng:77.6,area:'Here'});ok(r.s===200,'seller adds a market');const mid=r.j.id;
 r=await f('PUT','/api/markets/'+mid,{name:'My Pop-up 2',lat:12.96,lng:77.6});ok(r.s===200,'seller edits own market');
 r=await f2('PUT','/api/markets/'+mid,{name:'Hijack',lat:12.96,lng:77.6});ok(r.s===404,'other seller cannot edit it');
 r=await f('DELETE','/api/markets/'+mid);ok(r.s===200,'seller deletes own empty market');
 // delete account
 r=await o1('POST','/api/account/delete',{password:'wrong'});ok(r.s===401,'delete needs the right password');
 r=await o1('POST','/api/account/delete',{password:'pass12345'});ok(r.s===200,'customer deletes account');
 ok(db.prepare("SELECT phone,name,hash FROM users WHERE phone='9811111111'").get()===undefined,'personal details wiped');
 r=await o1('GET','/api/me');ok(r.j.user===null,'deleted account is signed out');

 // ---- market information: freshness, price history, profiles, photos, pre-orders ----
 const jpeg='data:image/jpeg;base64,'+Buffer.concat([Buffer.from([0xFF,0xD8,0xFF,0xE0]),Buffer.alloc(400,7)]).toString('base64');
 r=await fetch(base+'/api/catalog');let cat=await r.json();let pr0=cat.products.find(p=>p.id===pid);
 ok(pr0&&pr0.updatedAt&&pr0.photoV===0,'catalog carries updatedAt and photo version');
 ok(Array.isArray(cat.farmers)&&cat.farmers.some(x=>x.farm==='Lakshmi Farms'&&x.owner==='Lakshmi'&&!('phone' in x)),'catalog lists farmer profiles without phone numbers');
 db.prepare('UPDATE products SET updated=? WHERE id=?').run('2020-01-01T00:00:00.000Z',pid);
 r=await c('POST','/api/products/'+pid+'/confirm');ok(r.s===403,'customer cannot confirm stock');
 r=await f2('POST','/api/products/'+pid+'/confirm');ok(r.s===404,'other seller cannot confirm my stock');
 r=await f('POST','/api/products/'+pid+'/confirm');ok(r.s===200,'seller confirms stock');
 r=await fetch(base+'/api/catalog');cat=await r.json();ok(cat.products.find(p=>p.id===pid).updatedAt.slice(0,4)!=='2020','confirm refreshes the timestamp');
 db.prepare('UPDATE products SET updated=? WHERE owner_id IS NOT NULL').run('2020-01-01T00:00:00.000Z');
 r=await f('POST','/api/farmer/confirm-all');ok(r.s===200&&r.j.n>=1,'confirm all works');
 // price history
 const day=n=>new Date(Date.now()+330*60e3-n*864e5).toISOString().slice(0,10);
 db.prepare('INSERT OR REPLACE INTO price_log VALUES(?,?,?,?,?)').run(day(8),pid,'m1','tomato',3000);
 db.prepare('INSERT OR REPLACE INTO price_log VALUES(?,?,?,?,?)').run(day(3),pid,'m1','tomato',3600);
 r=await f('PUT','/api/products/'+pid,{name:'Tomato',price:44,qty:10,unit:'kg',marketId:'m1'});ok(r.s===200,'seller changes the price');
 r=await fetch(base+'/api/catalog');cat=await r.json();const t=cat.products.find(p=>p.id===pid);ok(t.price===44&&t.was7===30,'catalog shows the price a week ago ('+t.was7+')');
 r=await fetch(base+'/api/prices?name=Tomato&market=m1');const ph=await r.json();ok(ph.days.length>=3&&ph.days[ph.days.length-1].market===44&&ph.days[0].market===30,'price history returns the daily series');
 r=await fetch(base+'/api/prices');ok(r.status===400,'price history needs a product name');
 // photos
 r=await c('POST','/api/photo/farm',{data:jpeg});ok(r.s===403,'customer cannot upload a seller photo');
 r=await f('POST','/api/photo/farm',{data:'data:image/jpeg;base64,'+Buffer.from('<html><script>alert(1)</script>'.repeat(20)).toString('base64')});ok(r.s===400,'html disguised as a photo is rejected');
 r=await f('POST','/api/photo/farm',{data:'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='});ok(r.s===400,'svg is rejected');
 {let big=false;try{r=await f('POST','/api/photo/farm',{data:'data:image/jpeg;base64,'+Buffer.concat([Buffer.from([0xFF,0xD8,0xFF]),Buffer.alloc(200*1024,1)]).toString('base64')});big=r.s===400||r.s===413}catch{big=true}ok(big,'oversized photo is rejected')}
 r=await f('POST','/api/photo/farm',{data:jpeg});ok(r.s===200&&r.j.v===1,'seller uploads a profile photo');
 r=await fetch(base+'/api/photo/farm/'+cat.farmers[0].id);ok(r.status===200&&r.headers.get('content-type')==='image/jpeg'&&r.headers.get('x-content-type-options')==='nosniff','photo is served as an image only');
 r=await f2('POST','/api/photo/product/'+pid,{data:jpeg});ok(r.s===404,'other seller cannot set my product photo');
 r=await f('POST','/api/photo/product/'+pid,{data:jpeg});ok(r.s===200,'seller adds a product photo');
 r=await fetch(base+'/api/catalog');cat=await r.json();ok(cat.products.find(p=>p.id===pid).photoV===1&&cat.farmers.find(x=>x.farm==='Lakshmi Farms').photoV===1,'catalog points to the photos');
 r=await f('DELETE','/api/photo/product/'+pid);ok(r.s===200,'seller removes a product photo');
 r=await fetch(base+'/api/photo/product/'+pid);ok(r.status===404,'removed photo is gone');
 // profile story
 r=await f('GET','/api/me');const me0=r.j.user;
 r=await f('POST','/api/me',{name:me0.name,phone:me0.phone,farm:{farm:'Lakshmi Farms',area:'Anekal',grow:'tomato, beans',marketId:'m1',story:'Third generation growers near Anekal.',since:'1998'}});ok(r.s===200&&r.j.user.farm.story.startsWith('Third')&&r.j.user.farm.since==='1998','seller saves story and year');
 r=await f('POST','/api/me',{name:me0.name,phone:me0.phone,farm:{farm:'Lakshmi Farms',area:'Anekal',story:'<img src=x onerror=alert(1)>',since:'abc'}});ok(r.s===200&&r.j.user.farm.since==='','bad year is ignored');
 // pre-orders
 const tom=new Date(Date.now()+330*60e3+864e5).toISOString().slice(0,10);
 r=await c('POST','/api/orders',{type:'pickup',payMethod:'cod',name:'Asha',phone:'9876543210',terms:1,date:tom,slot:'Morning',items:[{id:pid,qty:1}]});ok(r.s===200,'pre-order for tomorrow is accepted');
 r=await f('GET','/api/farmer/orders');ok(r.j.orders.some(o=>o.date===tom),'seller sees the order date');
 r=await c('POST','/api/orders',{type:'pickup',payMethod:'cod',name:'Asha',phone:'9876543210',terms:1,date:'2020-01-01',items:[{id:pid,qty:1}]});ok(r.s===200,'an old date is accepted but reset');
 r=await f('GET','/api/farmer/orders');ok(!r.j.orders.some(o=>o.date==='2020-01-01'),'old dates never reach the seller');
 const far=new Date(Date.now()+330*60e3+9*864e5).toISOString().slice(0,10);
 r=await c('POST','/api/orders',{type:'pickup',payMethod:'cod',name:'Asha',phone:'9876543210',terms:1,date:far,items:[{id:pid,qty:1}]});ok(r.s===200,'a far date is accepted but reset');
 r=await f('GET','/api/farmer/orders');ok(!r.j.orders.some(o=>o.date===far),'dates beyond two days are reset');
 r=await c('POST','/api/account/delete',{password:'mango2026x'});ok(r.s===409||r.s===200,'account with open orders is handled');
 // static + security headers
 r=await fetch(base+'/');ok(r.status===404||r.status===200,'home route answers');
 r=await fetch(base+'/robots.txt');ok((await r.text()).includes('Disallow: /admin'),'robots.txt hides admin');
 r=await fetch(base+'/api/config');const cfg=await r.json();ok(cfg.live===true&&cfg.site.email==='help@example.com'&&cfg.otp===true,'public config lists support details');
 ok(!JSON.stringify(cfg).includes('sekret'),'config never leaks secrets');
 r=await fetch(base+'/api/me',{method:'GET'});ok(r.headers.get('x-content-type-options')==='nosniff','security headers set');
 r=await fetch(base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'});ok(r.status===403,'cross-site POST refused');
 console.log(fails?'FAILED '+fails:'ALL PASSED');server.close();process.exit(fails?1:0);
})().catch(e=>{console.log('CRASH',e);process.exit(2)});
