import { chromium } from "playwright";
import { createHmac } from "crypto";
import { join } from "path";
const BASE="https://illumestudentservices.cloud", SEC="QVUFFKVLSX2RZ5SFUZSSHXQRV6TEBDZC";
function b32d(s){const A="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b="";for(const c of s.toUpperCase()){const i=A.indexOf(c);if(i<0)continue;b+=i.toString(2).padStart(5,"0");}const o=Buffer.alloc(Math.floor(b.length/8));for(let i=0;i<o.length;i++)o[i]=parseInt(b.slice(i*8,i*8+8),2);return o;}
function totp(s){const k=b32d(s);const c=Buffer.alloc(8);c.writeUInt32BE(Math.floor(Date.now()/1000/30),4);const h=createHmac("sha1",k).update(c).digest();const o=h[h.length-1]&0xf;const n=((h[o]&0x7f)<<24)|(h[o+1]<<16)|(h[o+2]<<8)|h[o+3];return String(n%1e6).padStart(6,"0");}
const b=await chromium.launch({headless:true});
const p=await b.newPage({viewport:{width:1440,height:950},deviceScaleFactor:1});
await p.goto(`${BASE}/login`,{waitUntil:"networkidle",timeout:60000});
await p.fill('input[type="email"]',"admin@illumestudentservices.cloud");
await p.fill('input[type="password"]',"Ilm-Fw35HO0aXRBk");
await p.waitForSelector('button[type="submit"]:not([disabled])',{timeout:30000});
await p.click('button[type="submit"]');
for(let i=0;i<40;i++){await p.waitForTimeout(300);if(p.url().includes("/verify-2fa"))break;}
await p.waitForTimeout(1200); await p.fill("input",totp(SEC)); await p.click('button[type="submit"]');
for(let i=0;i<50;i++){await p.waitForTimeout(300);if(p.url().includes("/dashboard"))break;}
await p.goto(`${BASE}/knowledge`,{waitUntil:"domcontentloaded",timeout:45000});
await p.waitForTimeout(4000);
await p.screenshot({path:join(import.meta.dirname,"audit-shots","kb-zoom-top.png"),clip:{x:256,y:60,width:1180,height:560}});
// card internals
const card = await p.evaluate(()=>{
  const h = Array.from(document.querySelectorAll("h3,h4")).find(x=>/Visa Application/i.test(x.innerText));
  let el = h; for(let i=0;i<6&&el;i++){ if(el.className && /rounded|border/.test(el.className)) break; el=el.parentElement; }
  return el ? el.outerHTML.slice(0,900) : "not found";
});
console.log("CARD MARKUP:\n", card);
await b.close();
