/* Loads the 35 Bengaluru markets. Safe to run more than once: node seed.js
   Add --demo to also load sample produce from made-up farms (for a private test site only, never the public one). */
const {db}=require('./server.js');const seed=require('./seed.json');
const have=new Set(db.prepare('SELECT id FROM markets').all().map(r=>r.id));let m=0,p=0;
db.exec('BEGIN');
for(const x of seed.markets)if(!have.has(x.id)){db.prepare('INSERT INTO markets VALUES(?,?,?,?,?,?,?,?)').run(x.id,null,x.name,x.area||x.name,x.hours||'',x.contact||'',x.lat,x.lng);m++}
if(process.argv.includes('--demo')&&!db.prepare('SELECT 1 FROM products WHERE owner_id IS NULL').get())
  for(const x of seed.products){db.prepare('INSERT INTO products(owner_id,market_id,farmer,name,category,emoji,price_paise,unit,qty,online_price,online_retailer,description) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(null,x.marketId,x.farmer||'Sample farm',x.name,x.category,x.emoji||'',Math.round(x.price*100),x.unit,x.qty,x.onlinePrice||null,x.onlineRetailer||'Sample reference price',x.description||'');p++}
db.exec('COMMIT');console.log('Added',m,'markets and',p,'sample products.');process.exit(0);
