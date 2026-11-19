import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
import Integrations from "./integrations";
import OverviewRows from "./overview-rows";

test("linked social logins appear as connected, and only missing configured providers can be linked", () => {
  const html = renderToStaticMarkup(<Integrations methods={["battlenet", "google", "credential"]} name="Thrall" overview={null}
    availableLogins={["battlenet", "google", "discord"]} />);
  expect(html).toContain("Google");
  expect(html).toContain("Email and password");
  expect(html).toContain("Link Discord");
  expect(html).not.toContain("Link Google");
  expect(html).not.toContain("Link Battle.net");
  expect(html).not.toContain("Link Microsoft");
  expect(html).not.toContain("Unlink");
  expect(renderToStaticMarkup(<OverviewRows name="Thrall" methods={["google", "discord"]} overview={null} />)).toContain("Google, Discord");
});
