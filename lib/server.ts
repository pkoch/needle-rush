import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
export class Failure extends Error {constructor(public status:number,message:string,public code?:string){super(message)}}
export function database(){if(!env.DB)throw new Failure(503,"Database unavailable");return env.DB}
export const now=()=>Date.now();
export const token=()=>crypto.randomUUID()+crypto.randomUUID();
export async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,"0")).join("")}
export function roomCode(){const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";return Array.from(crypto.getRandomValues(new Uint8Array(6)),x=>alphabet[x%alphabet.length]).join("")}
export function cookie(req:Request,name:string){return req.headers.get("cookie")?.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1)??""}
export function response(data:unknown,session?:{role:string,value:string}){const headers=new Headers({"Cache-Control":"no-store"});if(session)headers.set("Set-Cookie",`nr_${session.role}=${session.value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`);return Response.json(data,{headers})}
export function origin(req:Request){if(req.headers.get("origin")!==new URL(req.url).origin)throw new Failure(403,"Request origin rejected")}
export async function owner(){const user=await getChatGPTUser();if(!user)throw new Failure(401,"Sign in to host");const configured=env.OWNER_USER_ID;const saved=await database().prepare("SELECT id FROM owners LIMIT 1").first<{id:string}>();if(user.userId!==(configured||saved?.id))throw new Failure(403,"Owner access required");return user.userId}
export async function rate(req:Request,action:string,max:number){const key=action+":"+(req.headers.get("cf-connecting-ip")??"unknown");const window=Math.floor(now()/60000);const row=await database().prepare("INSERT INTO limits (key,window,count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END, window=excluded.window RETURNING count").bind(key,window).first<{count:number}>();if(!row||row.count>max)throw new Failure(429,"Too many requests; try again shortly")}
export type Room={id:string,code:string,owner_id:string,phase:string,revision:number,scored_rounds:number,current_round_id:string|null,deadline:number|null,display_audio_ready:number,display_last_seen:number|null,expires_at:number};
export async function room(code:string){await database().prepare("UPDATE rooms SET phase='CANCELLED',active_key=NULL WHERE expires_at<=? AND active_key=1").bind(now()).run();const r=await database().prepare("SELECT * FROM rooms WHERE code=? AND expires_at>?").bind(code.toUpperCase(),now()).first<Room>();if(!r)throw new Failure(404,"Room unavailable or expired");return r}
export async function session(req:Request,r:Room,role:string){
 const value=cookie(req,'nr_'+role);if(!value)throw new Failure(401,'Join this room to play.','SESSION_MISSING');
 const row=await database().prepare('SELECT room_id,role,player_id,revoked_at,expires_at FROM sessions WHERE token_hash=?').bind(await hash(value)).first<{room_id:string,role:string,player_id:string|null,revoked_at:number|null,expires_at:number}>();
 if(!row)throw new Failure(401,'Your player session is no longer valid. Please rejoin.','SESSION_INVALID');
 if(row.room_id!==r.id||row.role!==role)throw new Failure(401,'Join this room to play.','SESSION_OTHER_ROOM');
 if(row.revoked_at!==null)throw new Failure(401,'Your player session was ended. Please rejoin.','SESSION_REVOKED');
 if(row.expires_at<=now())throw new Failure(401,'Your player session has expired. Please rejoin.','SESSION_EXPIRED');
 return row;
}
