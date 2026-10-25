import type { Metadata } from "next";
import ChatClient from "@/components/chat/ChatClient";
import { chatWorkspaceOn } from "@/lib/chat/workspace";
import { profilesOn } from "@/lib/profiles";
import { savedBuildsOn } from "@/lib/saved-builds";
import { pageMetadata } from "@/lib/seo";

const TITLE = "Ask Everloot";
const description = "Ask about WoW: Forever in plain words. Your own AI model looks it up in Everloot's data and names the sources. Your key lasts only in this tab.";

export const metadata: Metadata = pageMetadata({ title: TITLE, description, path: "/chat" });

// No ad slot here: the page is a conversation. It fills the screen under the header (ChatClient is fixed there),
// with no footer; keys are set up on /account#chat-keys. The workspace switch is read at build time, so the page
// stays static; private projects and chats are fetched by the browser.
export default function ChatPage() {
  return (
    <>
      <h1 className="sr-only">{TITLE}</h1>
      <ChatClient savedBuilds={savedBuildsOn()} profiles={profilesOn()} workspace={chatWorkspaceOn()} />
    </>
  );
}
