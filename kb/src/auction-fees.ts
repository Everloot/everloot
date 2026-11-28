/** Forever faction houses take 5% of sale proceeds and the neutral house takes 15%. */
export const auctionCut = (house: string | null) => (house === "Neutral" ? 0.15 : 0.05);
