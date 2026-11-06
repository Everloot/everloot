import { GearBoardPage, gearBoardMetadata } from "../gear-board";

export const dynamic = "force-dynamic";

export const generateMetadata = () => gearBoardMetadata("item-level");

export default async function Page({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  return GearBoardPage({ metric: "item-level", searchParams });
}
