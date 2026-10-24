import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

let runtime: Miniflare;
let outbound = 0;
let redirect = false;
beforeEach(()=>{outbound=0;redirect=false;});
beforeAll(async () => {
  const compiled = await build({ entryPoints: ['src/ai/openrouter.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  runtime = new Miniflare({ ...convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-10-22', compatibilityFlags: ['nodejs_compat'],
    script: compiled.outputFiles[0].text + `
      export default { async fetch() {
        try {
          const provider = new OpenRouterProvider();
          const key = 'runtime-fixture-not-a-real-credential';
          await provider.validate(key);
          const models = await provider.models(key);
          const answer = await provider.complete(key, 'test/model', [{role:'user',content:'hi'}], []);
          let streamed = '';
          await provider.complete(key, 'test/model', [{role:'user',content:'hi'}], [], undefined, part => streamed += part);
          return Response.json({valid:true,models:models.length,answer:answer.content,streamed});
        } catch(error) { return Response.json({code:error.code},{status:502}); }
      }};`,
    outboundService: async request => {
      outbound++;
      if (redirect) return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/'}});
      const path = new URL(request.url).pathname;
      if (path.endsWith('/key')) return Response.json({data:{limit:null}});
      if (path.endsWith('/models')) return Response.json({data:[{id:'test/model',name:'Fixture',supported_parameters:[],pricing:{prompt:'0',completion:'0'}}]});
      const payload = await request.json() as {stream?:boolean};
      if (payload.stream) return new Response('data: {"choices":[{"delta":{"content":"Fixture answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
      return Response.json({choices:[{message:{content:'Fixture answer'}}]});
    },
  }), telemetry: {enabled:false} });
},30000);
it('blocks redirects without forwarding the credential in real workerd',async()=>{
  outbound=0;redirect=true;
  const response=await runtime.dispatchFetch('http://localhost/test');
  expect(await response.json()).toEqual({code:'AI_REDIRECT_BLOCKED'});
  expect(response.status).toBe(502);
  expect(outbound).toBe(1);
});
afterAll(async () => { await runtime?.dispose(); });
it('uses the default native fetch with the correct receiver in real workerd (mocked outbound provider)',async()=>{
  const response=await runtime.dispatchFetch('http://localhost/test');
  const result=await response.json();
  expect({outbound,result}).toEqual({outbound:4,result:{valid:true,models:1,answer:'Fixture answer',streamed:'Fixture answer'}});
  expect(response.status).toBe(200);
  expect(outbound).toBe(4);
},30000);
