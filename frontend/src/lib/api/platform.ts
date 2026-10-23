export interface ApiErrorBody { error: { code: string; message: string; requestId: string } }
export interface Page<T> { data: T[]; page: { limit: number; offset: number }; requestId: string }
export interface Organization { id: string; slug: string; name: string; status: string; created_at: string }
export interface Workspace { id: string; organization_id: string; slug: string; name: string; created_at: string }
export interface Session { user: { id: string }; session: { authenticated: boolean }; requestId: string }

export class PlatformApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export async function platformToken(getToken: (options?: { template?: string }) => Promise<string | null>): Promise<string> {
  const template = process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE;
  if (template !== undefined && (!template || /\s/.test(template))) {
    throw new PlatformApiError(503, "NOT_CONFIGURED", "Platform token configuration is invalid.");
  }
  const token = await getToken(template ? { template } : undefined);
  if (!token) throw new PlatformApiError(401, "UNAUTHENTICATED", "Session token unavailable.");
  return token;
}

function platformOrigin(): string {
  const base = process.env.NEXT_PUBLIC_PLATFORM_API_URL;
  if (!base) throw new PlatformApiError(503, "NOT_CONFIGURED", "Platform API is not configured.");
  let url: URL;
  try { url = new URL(base); } catch { throw new PlatformApiError(503, "NOT_CONFIGURED", "Platform API origin is invalid."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(process.env.NODE_ENV === "development" && local && url.protocol === "http:")) ||
      (process.env.NODE_ENV === "production" && local)) {
    throw new PlatformApiError(503, "NOT_CONFIGURED", "Platform API origin is invalid.");
  }
  return url.origin;
}

async function platformRequest<T>(path: string, token: string, method: "GET" | "POST", payload?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${platformOrigin()}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      cache: "no-store",
      ...(signal ? { signal } : {}),
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch (error) {
    if (error instanceof PlatformApiError) throw error;
    if (signal?.aborted) throw new PlatformApiError(499, "CANCELLED", "Request cancelled.");
    throw new PlatformApiError(503, "NETWORK_ERROR", "Platform API could not be reached.");
  }
  let body: unknown;
  try { body = await response.json(); } catch { throw new PlatformApiError(response.ok ? 502 : response.status, "API_ERROR", "Platform API returned an invalid response."); }
  if (!response.ok) {
    const error = (body as Partial<ApiErrorBody>)?.error;
    throw new PlatformApiError(response.status, error?.code ?? "API_ERROR", error?.message ?? "Request failed.");
  }
  return body as T;
}

export function platformGet<T>(path: string, token: string): Promise<T> {
  return platformRequest(path, token, "GET");
}

export function platformPost<T>(path: string, token: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  return platformRequest(path, token, "POST", payload, signal);
}

// Streaming uses the same origin and authenticated request contract as JSON calls.
export async function platformStream<T>(path:string,token:string,payload:unknown,onDelta:(text:string)=>void,signal?:AbortSignal,onEvent?:(type:string,data:unknown)=>void):Promise<T>{
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
    const response=await fetch(`${platformOrigin()}/api/v1${path}`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},cache:"no-store",signal,body:JSON.stringify(payload)});
    if(!response.ok){let code="API_ERROR",message="AI request failed.";try{const body=await response.json() as ApiErrorBody;code=body.error?.code??code;message=body.error?.message??message;}catch{}throw new PlatformApiError(response.status,code,message);}
    if(!response.headers.get("Content-Type")?.startsWith("text/event-stream"))throw new PlatformApiError(502,"STREAM_ERROR","Invalid AI stream response.");
    reader=response.body?.getReader();if(!reader)throw new PlatformApiError(502,"STREAM_ERROR","AI stream is unavailable.");
    const decoder=new TextDecoder();let buffer="",size=0;
    for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4000000)throw new PlatformApiError(502,"STREAM_LIMIT","AI response exceeded the stream limit.");buffer=(buffer+decoder.decode(part.value,{stream:true})).replace(/\r\n/g,"\n");let boundary:number;
      while((boundary=buffer.indexOf("\n\n"))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const type=frame.split("\n").find(line=>line.startsWith("event:"))?.slice(6).trim(),raw=frame.split("\n").filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");if(!raw)continue;const data=JSON.parse(raw);
        if(type)onEvent?.(type,data);
        if(type==="delta"&&typeof data.text==="string")onDelta(data.text);
        if(type==="complete")return data as T;
        if(type==="error")throw new PlatformApiError(502,data.code??"AI_UNAVAILABLE",data.message??"AI request failed.");
      }
    }
    throw new PlatformApiError(502,"STREAM_INTERRUPTED","AI response ended before completion. Reload the conversation before retrying.");
  }catch(error){if(signal?.aborted)throw new PlatformApiError(499,"CANCELLED","Request cancelled.");if(error instanceof PlatformApiError)throw error;throw new PlatformApiError(502,"STREAM_ERROR","AI stream could not be completed.");}
  finally{await reader?.cancel().catch(()=>undefined);}
}
