import { GearBoardPage, gearBoardMetadata } from "../gear-board";

export const dynamic = "force-dynamic";

export const generateMetadata = () => gearBoardMetadata("gear-score");

export default async function Page({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  return GearBoardPage({ metric: "gear-score", searchParams });
}
