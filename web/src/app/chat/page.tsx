import type { Metadata } from "next";
import ChatClient from "@/components/chat/ChatClient";
import { freeChatNames } from "@/lib/chat/free-chat";
import { chatWorkspaceOn } from "@/lib/chat/workspace";
import { profilesOn } from "@/lib/profiles";
import { savedBuildsOn } from "@/lib/saved-builds";
import { pageMetadata } from "@/lib/seo";

const TITLE = "Ask Everloot";
const description = "Ask about WoW: Forever in plain words. Everloot's search finds the sources with no key. An optional AI model of your own reads them for you. Your key lasts only in this tab.";

export const metadata: Metadata = pageMetadata({ title: TITLE, description, path: "/chat" });

// No ad slot here: the page is a conversation. It fills the screen under the header (ChatClient is fixed there),
// with no footer; the optional model is set up on /account#chat-keys. The workspace switch and the free model's providers
// (only their names, never a key) are read at build time, so the page stays static; private projects and chats are fetched by the browser.
export default function ChatPage() {
  return (
    <>
      <h1 className="sr-only">{TITLE}</h1>
      <ChatClient savedBuilds={savedBuildsOn()} profiles={profilesOn()} workspace={chatWorkspaceOn()} freeChat={freeChatNames()} />
    </>
  );
}
