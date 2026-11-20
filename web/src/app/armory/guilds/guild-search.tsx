import { Input } from "@/components/ui";
import { GUILD_DIRECTORY_PATH } from "@/lib/armory-guilds";

export default function GuildSearch() {
  return (
    <form action={GUILD_DIRECTORY_PATH} method="get" role="search" className="flex max-w-xl flex-col gap-2 sm:flex-row">
      <label htmlFor="guild-search" className="sr-only">Guild name</label>
      <Input id="guild-search" name="q" type="search" maxLength={24} autoComplete="off" placeholder="Start of a guild name, 2 letters or more" />
      <button type="submit" className="btn btn-secondary min-h-11 shrink-0">Find a guild</button>
    </form>
  );
}
