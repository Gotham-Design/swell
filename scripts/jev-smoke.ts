// Live check of the Jev categorizer on made-up transactions: run with TYPESAFE_API_KEY set,
// `npx tsx scripts/jev-smoke.ts`. Sends only the sample rows below.
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { buildJevRequest, readJevAnswers } from "../src/lib/ai/jev";
const cats = ["Advertising","Bank Fees","Contractors","Meals","Office Supplies","Rent","Software & Subscriptions","Travel","Utilities","Insurance","Sales","Interest Income"].map((name,i)=>({id:`c${i}`,name,type:["Sales","Interest Income"].includes(name)?"income":"expense",description:null}));
const ctx = {enabled:true,model:null,share_memos:false,categories:cats,examples:[{description:"Adobe Creative Cloud",category:"Software & Subscriptions"}],rejections:[]};
const txns = [
 ["FIGMA INC SAN FRANCISCO","figma",-4500,"credit_card"],
 ["DELTA AIR 0062345","delta air",-38420,"credit_card"],
 ["STRIPE TRANSFER","stripe",250000,"checking"],
 ["CHIPOTLE 2231","chipotle",-1645,"credit_card"],
 ["DUKE ENERGY PAYMENT","duke energy",-18733,"checking"],
 ["PAYMENT THANK YOU","payment thank you",120000,"credit_card"],
 ["MONTHLY SERVICE FEE","monthly service fee",-1500,"checking"],
 ["UPWORK -INV 8812","upwork",-60000,"checking"],
].map(([d,v,a,k],i)=>({id:`t${i}`,date:"2026-10-0"+(i+1),description_clean:d as string,vendor_normalized:v as string,amount_cents:a as number,money_account_kind:k as string,memo:null,recurring_cadence:null,is_large:false,vendor_categories:[]}));
async function main(){
const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });
const { request, labelToId } = buildJevRequest(ctx, txns, "jev-latest");
const t0 = Date.now();
const res = await client.systemOne(request as never);
const ms = Date.now() - t0;
const out = readJevAnswers(res.answers as never, txns, labelToId);
const name = (id?: string) => cats.find(c=>c.id===id)?.name;
console.log(`model=${res.model} ${ms}ms input_tokens=${res.usage.input_tokens}`);
for (const s of out) { const t = txns.find(x=>x.id===s.transaction_id)!; console.log(`${t.description_clean.padEnd(26)} → ${name(s.category_id)} ${(s.confidence*100).toFixed(0)}% | runner-up ${name(s.runner_up_category_id)} ${((s.runner_up_confidence??0)*100).toFixed(0)}% | flags ${s.flags.join(",")}`); }
}
main();
