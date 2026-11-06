import {requireChatGPTUser} from "../chatgpt-auth";
import {env} from "cloudflare:workers";
import RoomPanel from "../../components/RoomPanel";
export const dynamic="force-dynamic";
export default async function Display(){
 const user=await requireChatGPTUser('/display');
 const saved=env.DB?await env.DB.prepare('SELECT id FROM owners LIMIT 1').first<{id:string}>():null;
 const allowed=!!(env.OWNER_USER_ID||saved?.id)&&(env.OWNER_USER_ID||saved?.id)===user.userId;
 return <main className="tv"><nav className="site-nav" aria-label="Main navigation"><a className="wordmark" href="/"><span className="brand-disc" aria-hidden="true"/>NEEDLE RUSH</a><span className="nav-mode"><span className="live-dot"/> TV &amp; GAME CONTROLS</span></nav><RoomPanel mode="owner" allowed={allowed} bootstrap={env.BOOTSTRAP_ENABLED==='true'&&!saved}/></main>
}
