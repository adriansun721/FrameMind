import {readFile} from 'node:fs/promises'; import {gunzipSync} from 'node:zlib';
const v=JSON.parse(gunzipSync(await readFile('static-target-new.json.gz'))); for (const [i,r] of v.discretization.runs.entries()){console.log('run',i,Object.fromEntries(Object.entries(r.result).map(([k,x])=>[k,JSON.stringify(x).length])));}
