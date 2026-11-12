# Lightweight armory rollout

The profile uses a small portrait and equipment slots. Supported Blizzard statistics, talent allocations and professions appear with their read dates. An explicitly associated, public linked character can also show its shared addon sections through the existing public readers. An observation is never ownership or contribution proof.

## Release order

1. Apply `supabase/migrations/20261112190000_armory_profiles.sql` after the existing character-link and armory migrations. It adds the profile projection, observation dates, account association and atomic discovery write. The association table remains closed to API roles; the backup role receives SELECT and its RLS policy.
2. Deploy the site and crawler. The migration must precede deployment: the account list and named-upload store call new functions. Run the existing armory workflow to backfill old profiles. Detail requests use the same regional API client and its existing call budget.
3. Check a real character's optional API responses and page. For a missing character, use region/name/surname or its official Blizzard armory URL. Update character queues a request; it does not promise an immediate fetch. Refresh has an address quota and a one-hour character cooldown.
4. Check the surname collector in the live client before the next addon release. The source and protocol change are implemented, but no addon version was tagged here and the published archive is unchanged. Include protocol package 2.2.0 / record protocol 1.14.0 in the next addon-compatible Desktop build; follow the existing paired-release rules.
5. With named sharing enabled, a subsequent upload queues each complete region/name/surname identity, including guildless characters and encountered players. First-name-only uploads retain the legacy path. Unknown regions and absent surnames are not guessed; use manual submission. Full-name rows bypass the ambiguous legacy sighting table. Their API profiles seed actual guild slugs for roster discovery.
6. A signed-in player connects the Blizzard profile under their existing linked character on the account page. Name, race, class, faction, region and ruleset must match. Public acknowledgment and addon sections still require existing sharing settings; private, frozen, suppressed and unlinked characters have no public association. A basic API profile does not require an account.

API sections and addon observation dates expire independently after 30 days. Hiding an armory character deletes its association and prevents rediscovery. No Blizzard profile data enters the open dataset, MCP or public answer APIs.

## Verification

- Protocol: 104 passing tests and one expected failure; types, build and semver check pass.
- Knowledge base: 2,097 passing tests and one existing skip; targeted SQL/crawler checks pass after final migration updates.
- Website: 5,617 passing tests and 30 existing skips with four workers; types and design guard pass; lint has three pre-existing warnings.
- Addon: all 51 contract suites and both planner contracts pass. A scratch source archive builds; the published download was not replaced.
- SQL: migration reapplies safely; tests exercise full-name queueing, legacy collision avoidance, observation retention, optional-section retention, refresh cooldowns, public/private/frozen associations, hides and role grants.
- Next production build passes. This checkout lacks the public knowledge snapshot, so unrelated knowledge pages used their unavailable-snapshot fallback during static generation.
- Fresh code reviews have no remaining blocking findings after the fixes. No migration, deployment, registry publication or addon release was performed as part of these checks. Live optional API responses and the collector's in-game behavior remain release checks.
