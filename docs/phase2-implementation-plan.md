# Phase 2 implementation plan: Talent calculator (Classic UI parity)

Audience: the agent that implements Phase 2. Follow this document literally. When it says "exactly", copy
the value. When something here contradicts an older doc, this document wins for Phase 2, and task T13 updates
the older doc.

Everything below was checked against `data/generated/1.60.1.70888/` and `data/raw/1.60.1.70888/` on 2026-11-12.
The toolchain versions, the configs in section 2, and the pipeline change in section 3 were installed and run in a scratch
copy (`tsc -b`, `vite build`, `vitest run`, `eslint .`, `playwright test`, `python3 -m unittest`: all passed).

---

## 0. Key decisions (summary)

| Topic | Decision |
|---|---|
| Data loading | `classes.json` + `manifest.json` imported statically through the `@data` alias. Each `talents/<class>.json` is lazy-loaded per class (`import.meta.glob`, one ~6 KB gzip chunk per class). `spells.json` (2.4 MB) is **not** used in Phase 2. |
| Gating | Uses `spec.tierGates[].countedNodeIds` (so the Q21 anomalies apply automatically), **filtered to nodes in a lower tier than the gate** (new Q28: the raw scope of every tier-7 gate, and the Discipline tier-3 gate, contains the gated node itself). |
| Remove rule | Removing a point is allowed only if the build is still valid afterwards: every invested node still meets its gate and its prerequisite is still maxed. Implemented as "simulate, then validate". |
| Points | `available = min(currency.max, Σ amount of sources with level ≤ L and (no perk or perk.rank ≤ talentedRank))`. At level 60 this is 51 with or without the Talented perk. The perk toggle only changes **Required level** (for example 51 points need level 60 without the perk and 55 with it). Pipeline addition: `perk` object on currency sources (section 3). |
| URL | `#v1.<class>.<level>.<talentedRank>.<payload>`. Payload = base64url of LEB128 varints `(nodeId − previousNodeId) × 8 + rank` over invested nodes sorted by nodeId. It is keyed by node ID, so it survives layout changes and regenerated data. A full 51-point build is 24 characters. |
| Icons | `manifest.iconUrlTemplate` (render.worldofwarcraft.com), then `manifest.iconUrlFallback` (wow.zamimg.com), then a CSS placeholder. All 371 icon names used by Phase 2 return HTTP 200 on **both** CDNs (checked with curl HEAD, 2026-11-12). |
| Tree backgrounds | Classic art exists at `https://wow.zamimg.com/images/wow/talents/backgrounds/classic/{talentTabId}.jpg` (300×331 JPEG; all 27 talentTabIds return 200; Mage Fire 41 and Mage Frost 61 checked visually). It is drawn as an `<img>` over a per-spec CSS gradient with a spec-icon watermark. If the image fails, only the gradient shows. A constant switches remote backgrounds off (Q30). |
| Fonts | No bundled fonts (Friz Quadrata is licensed). Use system font stacks (section 8.3). |
| Hosting | GitHub Pages at `/talentcalc/`, hash routing (no 404 fallback needed). |

---

## 1. Verified data facts (what the code may rely on)

| Fact | Value |
|---|---|
| Classes / specs / talents | 9 / 27 / 447 (no `hidden`, no `choices` in any talent) |
| Tiers | Every spec uses tiers 1..7. Tier 6 and tier 7 often have one node each |
| Columns | 0..3 in 26 specs. Warlock Destruction uses 0..2 only. The grid is always 4 columns |
| Duplicate (tier, col) in a spec | none |
| `talent.requiredPoints` | always `5 × (tier − 1)` |
| `spec.tierGates` | always 6 gates: tiers 2..7, requiredPoints 5..30. `countedNodeIds` ⊆ the spec's node IDs |
| Gate anomalies (lower tier missing) | Hunter MM Improved Serpent Sting **105003** (tier 4) is missing from the tier-5 and tier-6 gates. Priest Holy Holy Specialization **105865** (tier 1) is missing from the tier-2..6 gates. Both are counted by the tier-7 gate |
| Gate anomalies (same tier included) | The tier-7 gate of all 27 specs contains the tier-7 capstone. Priest Discipline tier-3 gate contains Improved Power Word: Shield **105846** (tier 3). See Q28 |
| Prerequisites | 69 edges, ≤ 1 per node, all inside the same spec. 68 are vertical (same col, 1–3 tiers apart, never with a node in between). 1 is horizontal: Priest Shadow Mind Flay **105826** (T3C2) → Improved Mind Flay **105825** (T3C3). No L-shaped arrows exist, but the code supports them |
| maxRank | 1..5 |
| Longest description | 801 characters (Rogue *Death Mark*, which contains unresolved `${…$<ratio>…}` tokens, Q27). p50 94, p95 241. Longest talent name: 32 characters |
| Description markup | `\r\n` newlines (35 rank descriptions), leading spaces (indentation), WoW color codes `|cAARRGGBB…|r` (31, upper case `|C…|R`), unresolved `$…` tokens (23 ranks have `unresolved`) |
| Talent currency | `classes.json.talentCurrency`: `id` 3820, `max` 51, 56 sources: levels 10..60 (one point each) + 5 "Talented Rank N (Level 10−N)" sources at levels 5..9 |
| Talented perk | Legacy tree 1188, node 110298 (Type 1, 5 entries). Spell 1225474 "Talented": *"You gain talent points every level starting at level $s1 instead of starting at level 10, but you still may not have more than 51 total talent points."* `TraitCurrency.SourcedMax` = 51 |
| File sizes | `talents/*.json` 32–42 KB each (5.3–6.8 KB gzip), 332 KB total (48 KB gzip). `classes.json` 12.5 KB, `manifest.json` 6.4 KB, `spells.json` 2.4 MB (not used) |
| Spec background art | `classes[].specs[].talentTabId` → zamimg classic background (section 0) |
| Class/spec icons | `classes[].icon` (`classicon_<token>`), `classes[].specs[].icon` (for example `spell_fire_firebolt02`) |

---

## 2. Project scaffold (task T1)

Create these files at the repo root. Versions are exact; do not use `^` or `~`. Node 22 LTS (tested with 22.23.4 and npm 10.9.9).

### 2.1 `package.json`

```json
{
  "name": "talentcalc",
  "private": true,
  "version": "0.2.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview --port 4173 --strictPort",
    "typecheck": "tsc -b",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test --trace off",
    "e2e:install": "playwright install --with-deps chromium"
  },
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "zustand": "5.0.1"
  },
  "devDependencies": {
    "@eslint/js": "9.17.0",
    "@playwright/test": "1.49.1",
    "@types/node": "22.10.2",
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "@vitejs/plugin-react": "4.3.4",
    "eslint": "9.17.0",
    "eslint-plugin-react-hooks": "5.1.0",
    "eslint-plugin-react-refresh": "0.4.16",
    "globals": "15.14.0",
    "prettier": "3.4.2",
    "typescript": "5.6.3",
    "typescript-eslint": "8.18.1",
    "vite": "5.4.11",
    "vitest": "2.1.8"
  }
}
```

Run `npm install` once to create `package-lock.json` and commit the lock file (CI uses `npm ci`). `npm` prints
a deprecation notice for eslint 9.17.0. Ignore it. Also add `.nvmrc` containing `22`.

### 2.2 TypeScript

`tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
```

`tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": { "@data/*": ["data/generated/1.60.1.70888/*"], "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts", "playwright.config.ts", "e2e"]
}
```

### 2.3 `vite.config.ts` (also configures Vitest)

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Data build served by the app. When a new build is generated, change it here AND in tsconfig.app.json "paths".
const DATA_BUILD = "1.60.1.70888";

export default defineConfig({
  base: "/talentcalc/",
  plugins: [react()],
  resolve: {
    alias: {
      "@data": fileURLToPath(new URL(`./data/generated/${DATA_BUILD}`, import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: { target: "es2022", sourcemap: false },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

The `@data` alias works inside `import.meta.glob("@data/talents/*.json")`. In the built app the glob keys are
`/data/generated/1.60.1.70888/talents/<token>.json`, so match keys with `endsWith("/talents/<token>.json")`.

### 2.4 ESLint (`eslint.config.js`)

```js
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "data", "tools", "docs", "playwright-report", "test-results"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["*.config.ts", "e2e/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    // The engine is pure TS: no React, no store, no UI, no JSON loaders (types from @/data/types are fine).
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["react", "react-dom", "zustand", "zustand/*", "@/ui/*", "@/state/*", "@data/*", "@/data/index", "@/data/load*"],
        },
      ],
    },
  },
);
```

### 2.5 Prettier

`.prettierrc.json`: `{ "printWidth": 110, "trailingComma": "all" }`

`.prettierignore`:
```
data/
dist/
docs/
tools/
package-lock.json
*.md
playwright-report/
test-results/
```

Run `npm run format` once after creating the files.

### 2.6 Playwright (`playwright.config.ts`)

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: "http://localhost:4173/talentcalc/", trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 5"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173/talentcalc/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

Navigate with relative URLs (`page.goto("./")`, `page.goto("./#v1.mage.60.0")`) so the `/talentcalc/` base is kept.
Browsers: `npm run e2e:install` (locally `npx playwright install chromium` is enough if system deps exist).

### 2.7 `.gitignore` additions

```
playwright-report/
test-results/
*.tsbuildinfo
```

### 2.8 `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Classic-style talent calculator for WoW Forever" />
    <link rel="preconnect" href="https://render.worldofwarcraft.com" crossorigin />
    <link rel="preconnect" href="https://wow.zamimg.com" crossorigin />
    <title>WoW Forever Talent Calculator</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

---

## 3. Pipeline addition: Talented perk metadata (task T2)

The generated `classes.json` has the 5 perk sources, but the only thing that marks them is the display string
`requirement`. Add a structured `perk` object and read `max` from `TraitCurrency.SourcedMax`.

### 3.1 `tools/pipeline/classes.py`: replace the `sources` block (from `sources = []` to the `return`) with

```python
    currency = db.by_id("TraitCurrency")[str(C.TALENT_CURRENCY_ID)]
    assert I(currency["SourcedMax"]) == C.TALENT_CURRENCY_MAX, \
        "TraitCurrency %d SourcedMax %s != %d" % (C.TALENT_CURRENCY_ID, currency["SourcedMax"], C.TALENT_CURRENCY_MAX)
    entry_node = {}       # TraitNodeEntryID -> (TraitNodeID, _Index)
    for r in db.rows("TraitNodeXTraitNodeEntry"):
        entry_node[I(r["TraitNodeEntryID"])] = (I(r["TraitNodeID"]), I(r["_Index"]))
    node_entries = collections.defaultdict(list)
    for eid, (nid, idx) in entry_node.items():
        node_entries[nid].append((idx, eid))
    entries = db.by_id("TraitNodeEntry")
    defs = db.by_id("TraitDefinition")
    spell_names = db.by_id("SpellName")
    sources = []
    for r in db.rows("TraitCurrencySource"):
        if I(r["TraitCurrencyID"]) != C.TALENT_CURRENCY_ID:
            continue
        src = {"level": I(r["PlayerLevel"]), "amount": I(r["Amount"]), "requirement": r["Requirement_lang"]}
        eid = I(r["TraitNodeEntryID"])
        if eid:
            nid, _ = entry_node[eid]
            rank = [e for _, e in sorted(node_entries[nid])].index(eid) + 1
            spell_id = I(defs[entries[str(eid)]["TraitDefinitionID"]]["SpellID"])
            src["perk"] = {"nodeId": nid, "entryId": eid, "rank": rank, "spellId": spell_id,
                           "name": spell_names[str(spell_id)]["Name_lang"]}
        sources.append(src)
    sources.sort(key=lambda s: (s["level"], s["requirement"]))
    return {"build": build,
            "talentCurrency": {"id": C.TALENT_CURRENCY_ID, "max": I(currency["SourcedMax"]), "sources": sources},
            "classes": classes, "races": races}
```

Result (verified): the level 5..9 sources get `"perk": {"nodeId": 110298, "entryId": 137371..136852, "rank": 5..1, "spellId": 1225474, "name": "Talented"}` with `level == 10 − rank`.
Level sources have no `perk` key.

### 3.2 `tools/pipeline/tests/test_output.py`: in `test_classes`, after the `sources` length assertion, add

```python
        perk = [s for s in c["talentCurrency"]["sources"] if "perk" in s]
        self.assertEqual(sorted(s["perk"]["rank"] for s in perk), [1, 2, 3, 4, 5])
        for s in perk:
            self.assertEqual(s["level"], 10 - s["perk"]["rank"])
            self.assertEqual(s["perk"]["name"], "Talented")
            self.assertEqual(s["perk"]["nodeId"], 110298)
        self.assertEqual(sum(s["amount"] for s in c["talentCurrency"]["sources"] if "perk" not in s), 51)
        self.assertTrue(all(s["level"] >= 10 for s in c["talentCurrency"]["sources"] if "perk" not in s))
```

### 3.3 Regenerate

If `data/raw/1.60.1.70888/` is missing, run `tools/research/fetch_db2.sh 1.60.1.70888` and `tools/pipeline/fetch_era_items.sh 1.15.9.70576`.
Then run `python3 tools/pipeline/build_data.py --build 1.60.1.70888` and `python3 -m unittest discover -s tools/pipeline/tests -t tools -v` (43 tests, all OK).
Expected `git diff --stat data/generated`: only `classes.json` (perk objects) and `manifest.json` (new `TraitCurrency` row in
`rawTables`, and `generatedAt` if the date differs). Any other diff means something is wrong: stop and investigate.

---

## 4. Module structure

```
src/
├─ main.tsx                     createRoot, <App/>, initUrlSync()
├─ App.tsx                      layout: header, ClassPicker, TalentCalculator, footer
├─ styles/
│  ├─ tokens.css                CSS variables (section 8.2), imported once in main.tsx
│  └─ global.css                body/background/fonts reset
├─ data/
│  ├─ types.ts                  TS interfaces mirroring the JSON (4.1). Types only, no imports of JSON
│  ├─ index.ts                  classesFile, manifest, DATA_BUILD, getClassInfo, CLASS_TOKENS, loadTalentFile
│  ├─ assets.ts                 iconUrls(name), specBackgroundUrl(talentTabId), SPEC_TINTS, REMOTE_BACKGROUNDS
│  └─ data.test.ts              data invariants (section 9.1)
├─ engine/
│  └─ talents/
│     ├─ constants.ts           MIN_LEVEL=1, MAX_LEVEL=60, MAX_TALENTED_RANK=5, GATE_COUNTS_LOWER_TIERS_ONLY=true [VERIFY Q28]
│     ├─ tree.ts                buildClassTree(file, classInfo) → ClassTree (indexes)
│     ├─ points.ts              availablePoints, requiredLevel
│     ├─ rules.ts               rankOf, pointsInSpec, pointsBySpec, pointsSpent, gateProgress, unmetRequirements,
│     │                         isUnlocked, canAdd, canRemove, addPoint, removePoint, resetSpec, resetAll,
│     │                         nodeState, validate, sanitize
│     ├─ index.ts               re-exports
│     ├─ points.test.ts
│     └─ rules.test.ts
├─ testkit/
│  └─ talents.ts                TEST-ONLY helpers (never imported by app code): treeFor(token) built from
│                               import.meta.glob("@data/talents/*.json", {eager:true}) + classesFile, ctx60(), spend(), MAGE_51
├─ state/
│  ├─ buildCode.ts              encodeBuild / decodeBuild (pure, no data import except types)
│  ├─ buildCode.test.ts
│  ├─ store.ts                  Zustand store
│  ├─ store.test.ts
│  └─ urlSync.ts                hash ⇄ store
└─ ui/
   ├─ common/
   │  ├─ WowIcon.tsx + .module.css   icon with CDN fallback chain and placeholder
   │  └─ useMediaQuery.ts
   └─ talents/
      ├─ ClassPicker.tsx + .module.css
      ├─ TalentCalculator.tsx + .module.css   summary bar + 3 trees (desktop) or tabs (mobile)
      ├─ PointsSummary.tsx + .module.css
      ├─ TalentTree.tsx + .module.css
      ├─ TalentNode.tsx + .module.css
      ├─ PrereqArrows.tsx                     one <svg> per tree, draws all arrows of that spec
      ├─ TalentTooltip.tsx + .module.css      portal, fixed position
      ├─ geometry.ts + geometry.test.ts       node boxes and arrow paths (pure)
      ├─ tooltipModel.ts + tooltipModel.test.ts  builds tooltip lines from engine state (pure)
      └─ wowText.ts + wowText.test.ts         parses |cAARRGGBB…|r color codes (pure)
e2e/
├─ helpers.ts
├─ smoke.spec.ts
└─ mobile.spec.ts
```

The owner's component named `PrereqArrow` is implemented as `PrereqArrows` (one SVG per tree, one `<g>` per arrow).

### 4.1 `src/data/types.ts` (mirrors the JSON exactly; optional keys are optional)

```ts
export type ClassToken =
  | "warrior" | "paladin" | "hunter" | "rogue" | "priest" | "shaman" | "mage" | "warlock" | "druid";

export interface Manifest {
  build: string; eraBuild: string | null; generatedAt: string; pipelineVersion: number;
  options: { includeHiddenNodes: boolean; eraFallback: boolean };
  iconUrlTemplate: string;   // contains "{icon}"
  iconUrlFallback: string;   // contains "{icon}"
  rawTables: { name: string; rows: number; sha256: string }[];
  eraRawTables?: { name: string; rows: number; sha256: string }[];
  counts: Record<string, number>;
}

export interface TalentCurrencyPerk { nodeId: number; entryId: number; rank: number; spellId: number; name: string }
export interface TalentCurrencySource { level: number; amount: number; requirement: string; perk?: TalentCurrencyPerk }
export interface TalentCurrency { id: number; max: number; sources: TalentCurrencySource[] }

export interface ClassSpecInfo {
  index: number; name: string; talentTabId: number; background: string; icon: string | null; iconFileId: number;
}
export interface ClassInfo {
  id: number; token: ClassToken; name: string; color: string; spellClassSet: number; powerType: number;
  icon: string | null; iconFileId: number; traitTreeId: number; skillLineIds: number[]; specs: ClassSpecInfo[];
}
export interface RaceInfo { id: number; token: string; name: string; faction: "alliance" | "horde" }
export interface ClassesFile { build: string; talentCurrency: TalentCurrency; classes: ClassInfo[]; races: RaceInfo[] }

export interface TalentRank { rank: number; values: number[]; description: string; unresolved?: string[] }
export interface Talent {
  nodeId: number; entryId: number; definitionId: number; spellId: number;
  name: string; icon: string | null; iconFileId: number;
  tier: number; col: number; maxRank: number; requiredPoints: number;
  prereqNodeId?: number;
  kind: "passive" | "ability";
  hidden?: true;
  valueSources: ("curve" | "base")[];
  ranks: TalentRank[];
  choices?: Omit<Talent, "tier" | "col" | "requiredPoints" | "prereqNodeId">[];
}
export interface TierGate { tier: number; requiredPoints: number; countedNodeIds: number[] }
export interface Spec {
  index: number; name: string; talentTabId: number; specGroupId: number; nodeCount: number; maxPoints: number;
  tierGates: TierGate[]; talents: Talent[];
}
export interface TalentFile { build: string; classId: number; token: ClassToken; traitTreeId: number; maxPoints: number; specs: Spec[] }
```

### 4.2 `src/data/index.ts`

```ts
import classesJson from "@data/classes.json";
import manifestJson from "@data/manifest.json";
import type { ClassesFile, ClassInfo, ClassToken, Manifest, TalentFile } from "./types";

export const classesFile = classesJson as unknown as ClassesFile;
export const manifest = manifestJson as unknown as Manifest;
export const DATA_BUILD = manifest.build;
export const CLASS_TOKENS: readonly ClassToken[] = classesFile.classes.map((c) => c.token);
export function getClassInfo(token: ClassToken): ClassInfo { /* find or throw */ }
export function isClassToken(s: string): s is ClassToken { return (CLASS_TOKENS as readonly string[]).includes(s); }

const talentLoaders = import.meta.glob<{ default: unknown }>("@data/talents/*.json");
const cache = new Map<ClassToken, Promise<TalentFile>>();
export function loadTalentFile(token: ClassToken): Promise<TalentFile> {
  // key = Object.keys(talentLoaders).find(k => k.endsWith(`/talents/${token}.json`)); throw if missing;
  // cache the promise; resolve (await loader()).default as unknown as TalentFile.
}
```

The JSON casts are safe because `data.test.ts` checks the shape at runtime (section 9.1). TypeScript widens string
literals in JSON imports (`kind: string`), so `satisfies` cannot be used.

### 4.3 `src/data/assets.ts`

```ts
import { manifest } from "./index";
export function iconUrls(name: string): [string, string] {
  return [manifest.iconUrlTemplate.replace("{icon}", name), manifest.iconUrlFallback.replace("{icon}", name)];
}
/** Classic talent-tree background art, hotlinked from Wowhead's CDN, keyed by TalentTab ID (Q30). */
export const REMOTE_BACKGROUNDS = true;
export function specBackgroundUrl(talentTabId: number): string {
  return `https://wow.zamimg.com/images/wow/talents/backgrounds/classic/${talentTabId}.jpg`;
}
/** Fallback gradient tint per talentTabId (used under the image, and alone if it fails). */
export const SPEC_TINTS: Readonly<Record<number, string>> = {
  161: "#5a3a1e", 164: "#6b1f12", 163: "#3b4250",   // Warrior Arms, Fury, Protection
  382: "#6b5a2a", 383: "#3a4a6b", 381: "#6b4a1e",   // Paladin Holy, Protection, Retribution
  361: "#3f4a22", 363: "#4a3a26", 362: "#2e4a3a",   // Hunter BM, MM, Survival
  182: "#2e4a22", 181: "#5a2a1e", 183: "#2a2a4a",   // Rogue Assassination, Combat, Subtlety
  201: "#4a4a5a", 202: "#6b6040", 203: "#3a1f4a",   // Priest Discipline, Holy, Shadow
  261: "#1f3a6b", 263: "#3a4a5a", 262: "#1f4a4a",   // Shaman Elemental, Enhancement, Restoration
  81: "#3a2a6b", 41: "#6b2a10", 61: "#1f3a6b",      // Mage Arcane, Fire, Frost
  302: "#2a4a1f", 303: "#4a1f4a", 301: "#6b2a1f",   // Warlock Affliction, Demonology, Destruction
  283: "#2a3a5a", 281: "#5a3a1a", 282: "#2a4a2a",   // Druid Balance, Feral Combat, Restoration
};
```

---

## 5. Rules engine (`src/engine/talents`)

All functions are pure, never mutate inputs, and take the tree index as the first argument.

```ts
export type Ranks = Readonly<Record<number, number>>;   // nodeId → rank; only ranks > 0 are stored
export interface PointsContext { level: number; talentedRank: number; currency: TalentCurrency }
export type NodeState = "locked" | "available" | "partial" | "maxed";
export type Requirement =
  | { kind: "gate"; specIndex: number; points: number; counted: number; excludedInvested: number[] }
  | { kind: "prereq"; nodeId: number; points: number };
export type Violation =
  | { kind: "unknownNode"; nodeId: number }
  | { kind: "rankOutOfRange"; nodeId: number; rank: number }
  | { kind: "gate"; nodeId: number; required: number; counted: number }
  | { kind: "prereq"; nodeId: number; prereqNodeId: number }
  | { kind: "overBudget"; spent: number; available: number };
```

### 5.1 `tree.ts`: `buildClassTree(file: TalentFile, info: ClassInfo): ClassTree`

```ts
export interface GateIndex { tier: number; requiredPoints: number; counted: readonly number[]; excludedLower: readonly number[] }
export interface TreeNode { talent: Talent; specIndex: number; dependents: readonly number[] }
export interface ClassTree {
  token: ClassToken; info: ClassInfo; file: TalentFile;
  nodes: ReadonlyMap<number, TreeNode>;
  order: readonly number[];                          // all nodeIds sorted by (specIndex, tier, col)
  specNodeIds: readonly (readonly number[])[];       // [specIndex] → nodeIds in (tier, col) order
  gates: readonly (readonly (GateIndex | undefined)[])[];   // [specIndex][tier] (index 0 and 1 unused → undefined)
}
```

Algorithm:
1. For each spec `s` (in file order, `s.index` = 0..2) and each talent `t`: `nodes.set(t.nodeId, { talent: t, specIndex: s.index, dependents: [] })`.
   Throw `Error("duplicate node …")` on a repeated ID.
2. For each talent with `prereqNodeId`: push `t.nodeId` into `nodes.get(prereqNodeId).dependents` (throw if the prereq is missing or in another spec).
3. For each spec gate `g`:
   `counted = g.countedNodeIds.filter(id => !GATE_COUNTS_LOWER_TIERS_ONLY || nodes.get(id)!.talent.tier < g.tier)`;
   `excludedLower = spec talents with tier < g.tier whose nodeId is NOT in g.countedNodeIds` (this is the Q21 anomaly list);
   store at `gates[s.index][g.tier]`.
4. Throw if any talent with tier ≥ 2 has no gate for its tier, or if `gate.requiredPoints !== talent.requiredPoints`.
5. `order` = concat of `specNodeIds` (talents are already sorted by (tier, col) in the file. Sort anyway).

Expected `excludedLower`: Priest Holy gates 2..6 → `[105865]`. Hunter MM gates 5 and 6 → `[105003]`. Empty everywhere else.

### 5.2 `points.ts`

```
availablePoints(ctx):
  total = 0
  for src in ctx.currency.sources:
    if src.level > ctx.level: continue
    if src.perk && src.perk.rank > ctx.talentedRank: continue
    total += src.amount
  return min(total, ctx.currency.max)

requiredLevel(spent, talentedRank, currency):          // smallest level with enough points
  if spent <= 0: return null
  for L in MIN_LEVEL..MAX_LEVEL:
    if availablePoints({level: L, talentedRank, currency}) >= spent: return L
  return null                                           // more points than any level gives
```

Assumption (Q29): owning perk rank R means owning ranks 1..R (cumulative), and the UI toggle sets R = 5 (on) or 0 (off).

### 5.3 `rules.ts`

```
rankOf(ranks, id)            = ranks[id] ?? 0
pointsInSpec(tree, ranks, s) = Σ rankOf over tree.specNodeIds[s]
pointsBySpec(tree, ranks)    = [pointsInSpec(…,0), pointsInSpec(…,1), pointsInSpec(…,2)]
pointsSpent(tree, ranks)     = Σ pointsBySpec

gateProgress(tree, ranks, s, tier):
  g = tree.gates[s][tier]; if !g: return { required: 0, counted: 0, excludedInvested: [] }
  return { required: g.requiredPoints,
           counted: Σ rankOf(ranks, id) for id in g.counted,
           excludedInvested: g.excludedLower.filter(id => rankOf(ranks, id) > 0) }

unmetRequirements(tree, ranks, id) → Requirement[]     (gate first, then prereq; empty when unlocked)
  n = tree.nodes.get(id); t = n.talent
  gp = gateProgress(tree, ranks, n.specIndex, t.tier)
  if gp.counted < gp.required: push { kind:"gate", specIndex, points: gp.required, counted: gp.counted, excludedInvested: gp.excludedInvested }
  if t.prereqNodeId: p = node(t.prereqNodeId).talent
     if rankOf(ranks, p.nodeId) < p.maxRank: push { kind:"prereq", nodeId: p.nodeId, points: p.maxRank }

isUnlocked(tree, ranks, id)  = unmetRequirements(...).length === 0

canAdd(tree, ranks, id, ctx):
  n = node(id); if !n: return false
  return rankOf(ranks,id) < n.talent.maxRank
      && pointsSpent(tree, ranks) < availablePoints(ctx)
      && isUnlocked(tree, ranks, id)

canRemove(tree, ranks, id):
  r = rankOf(ranks, id); if r === 0 || !node(id): return false
  next = withRank(ranks, id, r - 1)
  s = node(id).specIndex
  for other in tree.specNodeIds[s]:            // only the same spec can be affected
    if rankOf(next, other) > 0 && !isUnlocked(tree, next, other): return false
  return true
  // Covers the Classic rules: (a) a dependent with points needs its prereq maxed; (b) every invested node in a
  // higher tier needs `counted ≥ required` with the counted set of its own gate. The budget is never checked
  // here, so an over-budget build (lower level in Phase 7) can always be reduced.

addPoint(tree, ranks, id, ctx)    = canAdd ? withRank(ranks, id, r + 1) : ranks       (same reference when refused)
removePoint(tree, ranks, id)      = canRemove ? withRank(ranks, id, r - 1) : ranks
resetSpec(tree, ranks, s)         = copy of ranks without the keys in tree.specNodeIds[s]
resetAll()                        = {}
withRank(ranks, id, k)            = k > 0 ? { ...ranks, [id]: k } : copy without id     (never store 0)

nodeState(tree, ranks, id, ctx):
  r = rankOf; max = maxRank
  if r === max: "maxed"
  else if r > 0: "partial"                     // green even when no points are left (Q31)
  else if canAdd(tree, ranks, id, ctx): "available"
  else: "locked"                               // includes "no points left" (Classic greys unspent talents at 0 points)

validate(tree, ranks, ctx) → Violation[]
  for [id, r] of entries(ranks):
    n = node(id); if !n: unknownNode; continue
    if !Number.isInteger(r) || r < 1 || r > maxRank: rankOutOfRange; continue
    for req in unmetRequirements(tree, ranks, id): gate → {kind:"gate", nodeId:id, required:req.points, counted:req.counted};
                                                   prereq → {kind:"prereq", nodeId:id, prereqNodeId:req.nodeId}
  spent = Σ valid ranks; available = availablePoints(ctx); if spent > available: overBudget
  Order: by nodeId ascending in `order`; overBudget last.

sanitize(tree, wanted: Ranks, ctx) → { ranks: Ranks; dropped: boolean }
  // Rebuilds a legal build from untrusted input (URL). Greedy in (spec, tier, col) order, which is valid because
  // gates only count lower tiers and every prereq comes earlier in that order (asserted by data.test.ts).
  out = {}; dropped = false
  for id in tree.order:
    target = min(wanted[id] ?? 0, maxRank(id)); if (wanted[id] ?? 0) > maxRank: dropped = true
    while rankOf(out,id) < target and canAdd(tree, out, id, ctx): out = withRank(out, id, rankOf(out,id)+1)
    if rankOf(out,id) < target: dropped = true
  if any key of wanted is not in tree.nodes: dropped = true
  return { ranks: out, dropped }
```

Edge cases to handle explicitly:
- Unknown nodeId in `canAdd`/`canRemove`/`addPoint`/`removePoint`: return false / unchanged ranks (no throw).
- `ctx.level` below 1 or above 60, or a non-integer: the engine does not clamp (the codec and store do), and `availablePoints` just sums the sources.
- A tier-1 node always has a gate requirement of 0.
- The horizontal prerequisite (Shadow) works through the same rules. Mind Flay and Improved Mind Flay are both tier 3, gate 10.
- Removing a capstone (tier 7) point is always allowed (nothing depends on it).
- Q21 nodes: points in Holy Specialization (Priest Holy) never unlock tiers 2–6. Points in Improved Serpent Sting (Hunter MM) do not unlock tiers 5–6. Both still count toward tier 7, and therefore can be blocked from removal by a tier-7 point.

---

## 6. URL encoding (`src/state/buildCode.ts`)

### 6.1 Format

```
#v1.<classToken>.<level>.<talentedRank>[.<payload>]
```
- `v1`: format version. Any other prefix → decode error `"version"`.
- `classToken`: one of the 9 lowercase tokens from `classes.json` (`mage`).
- `level`: decimal integer 1..60 (v1 always writes `60`).
- `talentedRank`: one digit 0..5 (the UI writes 0 or 5).
- `payload`: omitted (and the dot before it too) when no points are spent. Otherwise unpadded base64url
  (`A–Z a–z 0–9 - _`) of a byte string built as follows:
  ```
  prev = 0
  for id in invested nodeIds sorted ascending:
      value = (id − prev) × 8 + rank        // rank 1..7 (RANK_BITS = 3; data max is 5)
      write value as unsigned LEB128 varint (7 bits per byte, low group first, 0x80 = continuation)
      prev = id
  ```
Why: node IDs are the stable `TraitNode.ID` database keys. Positions, tiers and the order of talents in the
file can change between builds without breaking old links. A node that disappears is dropped on decode
(sanitize reports `dropped`). The encoder throws if a rank is > 7. If that ever happens, introduce `v2`.

### 6.2 API

```ts
export interface BuildCode { classToken: ClassToken; level: number; talentedRank: number; ranks: Record<number, number> }
export type DecodeResult =
  | { ok: true; build: BuildCode }
  | { ok: false; reason: "empty" | "version" | "class" | "level" | "perk" | "payload" };
export function encodeBuild(b: BuildCode): string;          // returns the string WITH the leading "#"
export function decodeBuild(hash: string, isClassToken: (s: string) => s is ClassToken): DecodeResult;
export function bytesToBase64Url(bytes: Uint8Array): string;   // hand-written, no btoa (pure, same in Node and browser)
export function base64UrlToBytes(s: string): Uint8Array | null; // null on any char outside the alphabet or length % 4 === 1
```

Decode rules, checked in this order: strip one leading `#`. Empty → `"empty"`. Split on `.`. Part 0 must be `v1`
(else `"version"`). Fewer than 4 or more than 5 parts → `"payload"`. Part 1 must pass `isClassToken`. Part 2 must match `/^\d{1,2}$/` and be 1..60. Part 3 must match `/^[0-5]$/`.
Part 4, if present and non-empty, must decode to bytes, and each varint must be complete (the last byte must not
have the continuation bit), with `delta ≥ 1` (except that the first `id` may be any value ≥ 1) and `rank = value % 8` in 1..7.
Otherwise → `"payload"`. Ranks for the same id cannot repeat because delta ≥ 1.
The decoder does not check the IDs against the data. The store runs `sanitize` after decoding.

### 6.3 Golden vector (verified with an independent Python implementation)

Build `MAGE_51` (Mage, level 60, talentedRank 0), Fire 33 / Frost 18:

| nodeId | name | rank |
|---|---|---|
| 105796 | Incineration | 5 |
| 105795 | Accelerant | 5 |
| 105794 | Ignite | 5 |
| 105792 | Impact | 3 |
| 105789 | Burning Soul | 3 |
| 105790 | Pyroblast | 1 |
| 105788 | Improved Scorch | 3 |
| 105786 | Heating Up | 1 |
| 105784 | Critical Mass | 3 |
| 105782 | Fire Power | 3 |
| 105781 | Combustion | 1 |
| 105779 | Improved Frostbolt | 5 |
| 105778 | Precision | 3 |
| 105780 | Frost Warding | 2 |
| 105777 | Ice Shards | 5 |
| 105774 | Frostbite | 3 |

`encodeBuild(MAGE_51)` → `#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N` (18 bytes, 24 payload chars).
Points by spec `0/33/18`, points left 0, required level 60 (55 with talentedRank 5).

---

## 7. State (`src/state`)

### 7.1 Store (`store.ts`, Zustand 5)

```ts
interface CalcState {
  classToken: ClassToken | null;      // null → only the class picker is shown
  tree: ClassTree | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  notice: string | null;              // e.g. "Some talents in this link were not valid and were removed."
  level: number;                      // fixed 60 in v1
  talentedRank: number;               // 0 or 5 from the UI
  ranks: Ranks;
  activeSpec: number;                 // mobile tab, 0..2
  selectClass(token: ClassToken): Promise<void>;   // loads file, builds tree, ranks = {}, activeSpec 0
  applyBuildCode(code: BuildCode): Promise<void>;  // load class, set level/perk, ranks = sanitize(...); notice if dropped
  clearClass(): void;
  addPoint(nodeId: number): void;
  removePoint(nodeId: number): void;
  resetSpec(specIndex: number): void;
  resetAll(): void;
  setTalented(on: boolean): void;     // talentedRank = on ? 5 : 0; then ranks = sanitize(ranks) (no-op at level 60)
  setActiveSpec(i: number): void;
  dismissNotice(): void;
}
export const pointsContext = (s: CalcState): PointsContext => ({ level: s.level, talentedRank: s.talentedRank, currency: classesFile.talentCurrency });
```

- Export it as `export const useCalc = create<CalcState>()((set, get) => ({ … }))`. Non-React code uses `useCalc.getState()` / `useCalc.subscribe`.
- Race guard: `selectClass`/`applyBuildCode` keep a module-level `requestId` counter and ignore results from an older request.
- Selecting the class that is already selected does nothing. Selecting another class resets ranks (Classic behavior).
- **Zustand 5 pitfall:** a selector must not return a new object or array on every call (React logs an infinite-loop
  error). Select primitive fields or stable references (`s.ranks`, `s.tree`) and derive the rest with `useMemo` in the
  component, or wrap the selector with `useShallow` from `zustand/react/shallow`.

### 7.2 URL sync (`urlSync.ts`)

```
initUrlSync():                                   // called once in main.tsx before render
  lastHash = ""
  apply(hash):
    r = decodeBuild(hash, isClassToken)
    if r.ok: void useCalc.getState().applyBuildCode(r.build)
    else if r.reason !== "empty": useCalc.setState({ notice: "This link could not be read (" + r.reason + ")." })
  apply(location.hash)
  window.addEventListener("hashchange", () => { if (location.hash !== lastHash) apply(location.hash) })
  useCalc.subscribe((s) => {
    if (s.status === "loading") return
    next = s.classToken ? encodeBuild({ classToken, level, talentedRank, ranks }) : ""
    if (next === lastHash) return
    lastHash = next
    history.replaceState(null, "", next || location.pathname + location.search)   // replace: no history spam
  })
```

Copy link: `navigator.clipboard.writeText(location.href)`. If that throws, select the text of a hidden read-only
`<input>` and call `document.execCommand("copy")`. The button label changes to "Copied!" for 2 s.

---

## 8. UI and visual spec

### 8.1 Page layout

```
┌ header: "WoW Forever Talent Calculator"  (h1, gold, serif)                          ┐
│ ClassPicker: 9 round-cornered class icons, alphabetical by name (Druid … Warrior)   │
│ PointsSummary bar:  [Mage] 0/33/18 · Points left: 0 · Required level: 60 · Level 60   │
│                     [ ] Talented (Legacy perk)   [Reset all]  [Copy link]              │
│ notice banner (dismissible) if store.notice                                          │
│ Trees: desktop (≥ 980 px wide): 3 TalentTree panels in a row, gap 16 px, centered      │
│        mobile  (< 980 px): tab bar (3 tabs: spec icon + name + points) + active tree   │
└ footer: "Data: WoW Forever build 1.60.1.70888 · generated 2026-11-12" · icons/art © Blizzard │
```
With no class selected, show the picker and the text "Choose a class to start." Use `max-width: 980px; margin: 0 auto;
padding: 16px 8px` for the main column. 980 = 3 × 300 + 2 × 16 + 2 × 24.

### 8.2 Colors (`tokens.css`)

Game colors come from FrameXML constants (`NORMAL_FONT_COLOR` 1.0/0.82/0, `GREEN_FONT_COLOR` 0.1/1.0/0.1,
`RED_FONT_COLOR` 1.0/0.1/0.1, `GRAY_FONT_COLOR` 0.5/0.5/0.5).

```css
:root {
  --bg: #0b0b0f;            /* page */
  --panel: #15151c;         /* summary bar, tree header */
  --panel-border: #3a3326;
  --text: #e6e0d0;
  --text-dim: #9d9d9d;
  --gold: #ffd100;          /* NORMAL_FONT_COLOR: maxed border/badge, descriptions, active arrows, headings */
  --green: #19ff19;         /* GREEN_FONT_COLOR: available/partial border and badge, "Click to learn" */
  --red: #ff1919;           /* RED_FONT_COLOR: unmet requirements */
  --grey: #808080;          /* GRAY_FONT_COLOR: locked border/badge, inactive arrows */
  --white: #ffffff;         /* tooltip name, "Rank x/y", "Next rank:" */
  --tooltip-bg: rgba(8, 10, 22, 0.94);
  --tooltip-border: #8c8c8c;
  --badge-bg: #000000;
  --focus: #4fc3ff;
}
```

### 8.3 Fonts

- Headings, spec names, tooltip title: `"Friz Quadrata TT", "Friz Quadrata Std", Georgia, "Times New Roman", serif`
  (uses Friz only if it is installed locally. Nothing is bundled).
- Body, tooltip text, badges: `Verdana, "Segoe UI", Tahoma, Arial, sans-serif`. Tooltip 12px/1.35, badge 11px bold.

### 8.4 Tree geometry (`geometry.ts`, all values in CSS px)

```ts
export const NODE = 40;        // 36 px icon + 2 px border on each side
export const ICON = 36;
export const COL_PITCH = 64;
export const ROW_PITCH = 60;
export const PAD_X = 34;
export const PAD_Y = 24;
export const TREE_W = 300;     // = 2*PAD_X + 3*COL_PITCH + NODE
export const TREE_H = 448;     // = 2*PAD_Y + 6*ROW_PITCH + NODE
export const HEAD_LEN = 8;     // arrowhead length
export const HEAD_HALF = 7;    // arrowhead half width
export const ARROW_WIDTH = 5;  // shaft stroke width
export function nodeBox(tier: number, col: number) {
  return { left: PAD_X + col * COL_PITCH, top: PAD_Y + (tier - 1) * ROW_PITCH, size: NODE };
}
export function arrowPath(pre: { tier: number; col: number }, dep: { tier: number; col: number }): { shaft: string; head: string };
```

`arrowPath` (a = nodeBox(pre), b = nodeBox(dep), cx = left + NODE/2, cy = top + NODE/2):
- **Vertical** (same col, dep.tier > pre.tier): `x = a.cx`, `y1 = a.top + NODE`, `tip = b.top`.
  `shaft = "M x y1 V (tip−HEAD_LEN)"`, `head = "x−7,tip−8 x+7,tip−8 x,tip"`.
- **Horizontal** (same tier): `dir = sign(dep.col − pre.col)`, `y = a.cy`, `x1 = dir > 0 ? a.left+NODE : a.left`,
  `tip = dir > 0 ? b.left : b.left+NODE`. `shaft = "M x1 y H (tip − dir*HEAD_LEN)"`,
  `head = "(tip−dir*8),y−7 (tip−dir*8),y+7 tip,y"`.
- **L-shape** (different tier and col; not in current data): leave the prereq side toward the dependent at `a.cy`,
  go horizontally to `b.cx`, then down: `shaft = "M x1 a.cy H b.cx V (b.top−HEAD_LEN)"`, with the head as in the vertical case.

Numbers are written as plain integers separated by single spaces (`M 118 304 V 376`), and polygon points as `x,y`
pairs separated by single spaces. Golden values (tested):
- Fire Critical Mass (5,1) → Combustion (7,1): shaft `M 118 304 V 376`, head `111,376 125,376 118,384`.
- Shadow Mind Flay (3,2) → Improved Mind Flay (3,3): shaft `M 202 164 H 218`, head `218,157 218,171 226,164`.

Arrow color: `--gold` if the prerequisite is maxed, else `--grey`. Drawing: one `<svg width=300 height=448>`
absolutely positioned at 0,0 of the grid, `pointer-events: none`, `z-index: 1`. Each arrow is a `<path fill="none"
stroke-width=5 stroke-linecap="butt">` plus a `<polygon>` filled with the same color, with a 1 px dark outline
(`stroke: rgba(0,0,0,.6)` drawn first as a 7 px wider path) for contrast on bright art. Nodes are `z-index: 2`.

### 8.5 `TalentTree`

```
<section class=tree data-testid="tree-{specIndex}" aria-label="{spec.name} talents, {points} points">
  <header>  [spec icon 20px] {spec.name}   <span data-testid="spec-points-{i}">{points}</span>   [↺ reset button] </header>
  <div class=grid style="width:300px;height:448px;position:relative;overflow:hidden">
    <div class=fallback/>      radial-gradient(ellipse at 50% 30%, SPEC_TINTS[tabId] 0%, #0d0d12 75%) +
                               spec icon watermark: <img> 160px, centered, opacity .12, grayscale
    <img class=art src=specBackgroundUrl(tabId) alt="" loading="lazy" onError={hide}/>   object-fit: cover; only if REMOTE_BACKGROUNDS
    <div class=shade/>         linear-gradient(rgba(0,0,0,.15), rgba(0,0,0,.35)) for icon contrast
    <PrereqArrows .../>
    {talents.map(t => <TalentNode … style={{left, top}}/>)}
  </div>
</section>
```

Header: 32 px high, `--panel` background, 1 px `--panel-border`, the spec name in gold serif 15px, points in white.
Reset button: `aria-label="Reset {spec.name}"`, disabled when the spec has 0 points.
The panel is 300 px wide on every screen. Below 332 px viewports, the page may scroll horizontally (accepted).

### 8.6 `TalentNode`

- Element: `<button type="button" class=node data-node-id={id} data-state={state} aria-label=… aria-describedby={tooltipOpen ? "talent-tooltip" : undefined}>`,
  absolutely positioned at `nodeBox`. Size 40×40, `border: 2px solid`, `border-radius: 4px`, background `#000`, padding 0.
- Icon: `<WowIcon name={talent.icon} size={36}/>`.
- Border by state: locked `--grey`; available and partial `--green` + `box-shadow: 0 0 6px rgba(25,255,25,.55)`;
  maxed `--gold` + `box-shadow: 0 0 6px rgba(255,209,0,.6)`.
- Locked icon: `filter: grayscale(1) brightness(.55)`. Others: no filter. Hover (not locked): `filter: brightness(1.15)`.
- Rank badge `data-testid="rank"`: text `{rank}/{maxRank}`, absolute `right: -10px; bottom: -8px`, min-width 28px,
  height 15px, line-height 13px, padding 0 3px, `--badge-bg`, 1px solid #4a4a4a, radius 3px, font 11px bold, centered.
  Color: locked `--grey`, available/partial `--green`, maxed `--gold`. (In-game Classic hides the badge on locked talents.
  The owner asked for x/y everywhere, so the badge is always shown.)
- `aria-label`: `"{name}, rank {rank} of {max}, {stateWord}"` where stateWord = locked → "locked", available → "available",
  partial → "available" if canAdd, otherwise "learned", maxed → "maxed".
- Mouse: `onClick` → `e.shiftKey ? removePoint : addPoint`. `onContextMenu` → `preventDefault(); removePoint`.
- Touch: on `pointerdown` with `pointerType === "touch"`, start a 500 ms timer. Cancel it on `pointerup`/`pointercancel` or
  if the pointer moves more than 10 px. When it fires: `removePoint`, `navigator.vibrate?.(15)`, and set a flag so the
  following `click` is swallowed. Also call `preventDefault` on `contextmenu` (Android long-press). CSS: `touch-action: manipulation;
  -webkit-touch-callout: none; user-select: none`.
- Keyboard (`onKeyDown`): `+` or `=` → add; `-`, `_`, `Delete`, `Backspace` → remove (preventDefault).
  Enter/Space use the native button click (add). Arrow keys move focus within the same tree: Up/Down go to the nearest
  node in the same column with a lower/higher tier, otherwise the nearest node by tier distance then column distance in
  that direction. Left/Right go to the nearest node in the same tier. Implement with `data-tier`/`data-col` attributes and
  `querySelector` inside the tree element.
- Focus ring: `outline: 2px solid var(--focus); outline-offset: 2px` on `:focus-visible`.
- Tooltip: open on `mouseenter` and `focus`, close on `mouseleave` and `blur`. On touch, a tap adds a point **and**
  opens the tooltip for that node. A tap outside any node closes it. The tooltip re-renders when ranks change.

### 8.7 `TalentTooltip` and `tooltipModel.ts`

`buildTooltipModel(tree, ranks, nodeId, ctx)` returns:
```ts
interface TooltipModel {
  name: string;
  rankLine: string;              // "Rank 2/5"
  requirements: string[];        // red lines, in unmetRequirements order
  gateNote: string | null;       // grey line, Q21 explanation, or null
  current: string | null;        // description shown first
  next: string | null;           // shown after the "Next rank:" label
  learnHint: boolean;            // green "Click to learn" when canAdd
}
```
Rules:
- rank 0 → `current = ranks[0].description`, `next = null`.
- 0 < rank < max → `current = ranks[rank−1].description`, `next = ranks[rank].description`.
- rank = max → `current = ranks[max−1].description`, `next = null`.
- gate requirement → `"Requires {points} points in {specName} Talents"`.
- prereq requirement → `"Requires {points} point{points === 1 ? "" : "s"} in {prereqName}"`.
- gateNote: if the gate requirement's `excludedInvested` is not empty →
  `"Points in {names joined with ", "} do not count toward this requirement."`.

Rendering (top to bottom, Classic in-game order): name (white, 14px serif) · rank line (white) · red requirement lines ·
grey gate note · current description (gold, `white-space: pre-wrap`) · if `next`: blank line, `Next rank:` (white),
next description (gold) · if `learnHint`: green `Click to learn`.
Description text goes through `parseWowText` (below), and each segment is rendered as a `<span>` (color segments with `style.color`).

Box: `role="tooltip" id="talent-tooltip"`, rendered through `createPortal` into `document.body`, `position: fixed`,
`max-width: 320px`, padding 8px 10px, `--tooltip-bg`, `1px solid var(--tooltip-border)`, radius 4px,
`box-shadow: 0 4px 12px rgba(0,0,0,.6)`, `pointer-events: none`, z-index 1000.
Position: anchor = the node's `getBoundingClientRect()`. Place it at `left = anchor.right + 8`, `top = anchor.top`. If
`left + width > innerWidth − 8`, use `left = anchor.left − 8 − width`. If that is `< 8`, set `left = 8` and
`top = anchor.bottom + 8`. Finally clamp `top` to `[8, innerHeight − height − 8]`. Measure with `useLayoutEffect`
(render hidden first, measure, then position).

`parseWowText(s): { text: string; color?: string }[]`:
- Normalize `\r\n` and `\r` to `\n`.
- Regex (case-insensitive) `/\|c([0-9a-f]{8})([\s\S]*?)(\|r|$)/gi`: the segment color is `#` + the last 6 hex digits
  (lower case); text outside matches has no color. A stray `|r` is removed. Everything else (including unresolved `$…`
  tokens, Q27) is kept verbatim.
- Example: `"|CFFFF2020Requires Bear Form|R\r\nCharge"` → `[{text:"Requires Bear Form", color:"#ff2020"}, {text:"\nCharge"}]`.

### 8.8 `WowIcon`

Props `{ name: string | null; size: number; alt?: string }`. State `stage: 0 | 1 | 2`.
`name === null` → stage 2 right away. Stage 0 `src = iconUrls(name)[0]`, stage 1 `src = iconUrls(name)[1]`, and `onError` moves
to the next stage. Stage 2 renders `<span class=placeholder aria-hidden>?</span>`: size×size, background
`radial-gradient(#3a3a3a, #111)`, `--text-dim` "?" centered, bold 60% of the size. Reset the stage when `name` changes
(`key={name}` on the component is enough). Attributes: `width/height=size`, `loading="lazy"`, `decoding="async"`,
`draggable={false}`, `alt=""` (the button carries the label), `referrerPolicy="no-referrer"`.

### 8.9 `ClassPicker`

A row of 9 `<button aria-pressed={selected} aria-label={name} title={name}>` with `WowIcon(class.icon, 40)`, sorted by `name`.
The selected button gets a 2 px gold border, the others 2 px #3a3a3a, radius 6. Wraps on mobile (flex-wrap, gap 8).
Clicking calls `selectClass(token)`.

### 8.10 `PointsSummary`

- Class name in the class color (`classInfo.color`).
- `data-testid="points-by-spec"`: `pointsBySpec.join("/")`, for example `0/33/18` (spec order Arcane/Fire/Frost).
- `data-testid="points-left"`: `Points left: {available − spent}` (red if negative).
- `data-testid="required-level"`: `Required level: {requiredLevel ?? "–"}` (with 0 points spent it shows "–").
- `Level 60` (static text in v1).
- Checkbox `Talented (Legacy perk)` with a `title` that explains: "Account perk: talent points start at level 5 instead of 10
  (max 51). At level 60 it only lowers the required level."
- Buttons `Reset all` (disabled at 0 points) and `Copy link`.
- A visually hidden `aria-live="polite"` region announces `"{name} {rank}/{max}. {left} points left."` after each change.

### 8.11 Mobile tabs (`< 980 px`, `useMediaQuery("(min-width: 980px)")`)

Render a `role="tablist"` with 3 `role="tab"` buttons (`aria-selected`, spec icon 20px, name, points). Only the active
tree is visible; render all 3 and hide the inactive ones with `display:none`, so the state and test IDs stay stable.
Swipe: on the tree grid, a horizontal touch move with `|dx| > 60` and `|dy| < 40` switches to the next/previous tab
(no wrap-around).

---

## 9. Tests

### 9.1 `src/data/data.test.ts` (data invariants, Vitest)

Load all 9 files with `import.meta.glob("@data/talents/*.json", { eager: true })`.
1. 9 talent files. `token`s equal `CLASS_TOKENS`. Each has 3 specs with `index` 0,1,2, and the spec `talentTabId` equals `classes.json` `specs[i].talentTabId`.
2. 447 talents in total. Every `kind` is "passive" or "ability". No `hidden`, no `choices`. `ranks.length === maxRank`. `1 ≤ maxRank ≤ 7`.
3. `1 ≤ tier ≤ 7`, `0 ≤ col ≤ 3`, `requiredPoints === 5*(tier−1)`, no duplicate (tier, col) within a spec, talents sorted by (tier, col).
4. `tierGates` tiers are exactly [2..7] with `requiredPoints === 5*(tier−1)`. `countedNodeIds` ⊆ the spec's node IDs.
5. Every `prereqNodeId` is in the same spec and comes before its dependent in (tier, col) order. For same-col prereqs, no node of the spec lies strictly between them in that column.
6. `classesFile.talentCurrency.max === 51`. Sources without `perk` sum to 51. Perk ranks are {1..5} with `level === 10 − rank`.
7. Every `icon` is a non-empty lowercase string (`/^[a-z0-9_\-]+$/`).
8. `buildClassTree` succeeds for all 9 classes, and `excludedLower` is non-empty only for Priest Holy gates 2–6 ([105865]) and Hunter MM gates 5–6 ([105003]).

### 9.2 `src/engine/talents/points.test.ts`

`availablePoints` (level, talentedRank → expected): (60,0)→51, (60,5)→51, (55,0)→46, (55,5)→51, (54,5)→50, (30,0)→21, (30,5)→26,
(10,0)→1, (9,0)→0, (9,5)→5, (5,5)→1, (4,5)→0, (7,2)→0, (7,3)→1, (1,0)→0.

`requiredLevel` (spent, talentedRank → expected): (0,0)→null, (1,0)→10, (31,0)→40, (51,0)→60, (52,0)→null, (1,5)→5, (5,5)→9,
(6,5)→10, (51,5)→55, (1,2)→8, (2,2)→9, (3,2)→10. Also: for every s in 1..51, `requiredLevel(s,0) === 9 + s` (the owner's "10 + spent − 1").

### 9.3 `src/engine/talents/rules.test.ts`

Helper `spend(tree, ranks, [[id, n], …], ctx)` calls `addPoint` n times and **asserts** every call changed the ranks.
`ctx = { level: 60, talentedRank: 0, currency }` unless stated. IDs below are from build 1.60.1.70888.

Mage Fire (spec 1):
1. Empty build: `canAdd(Incineration 105796)` true. `canAdd(Ignite 105794)` false. `nodeState(Ignite)` "locked". `unmetRequirements(Ignite)` = one gate requirement with `points 5, counted 0`.
2. Incineration ×4 → `canAdd(Ignite)` false. A fifth point → true. `nodeState(Incineration)` "maxed". `canAdd(Incineration)` false (max rank).
3. `addPoint` on a maxed node returns the **same** ranks object.
4. Incineration 5, Ignite 5, Pyroblast 105790 ×1 (11 spent) → `canAdd(Heating Up 105786)` false with two unmet requirements: gate (15, counted 11) and prereq (Pyroblast, 1).
5. Then Accelerant 105795 ×4 (15) → `canAdd(Heating Up)` true. Add it. Then: `canRemove(Pyroblast)` false (dependent), `canRemove(Incineration)` false (tier-4 gate would drop to 14), `canRemove(Heating Up)` true.
6. Then Burning Soul 105789 ×1 (16 below tier 4) → `canRemove(Incineration)` true.
7. Combustion path: Incineration 5, Accelerant 5, Ignite 5, Impact 105792 ×3, Burning Soul 3, Pyroblast 1, Improved Scorch 105788 ×3, Heating Up 1, Critical Mass 105784 ×3, Fire Power 105782 ×1 → spent 30. `canAdd(Combustion 105781)` true. Add it.
8. Continuing 7 (Fire tiers 1–6 = exactly 30, Combustion 1): `canRemove(Incineration)` **false** (Q28: Combustion's own point does not count). `canRemove(Critical Mass)` false (prereq of Combustion). `canRemove(Fire Power)` false (gate 30). `canRemove(Combustion)` true.
9. Continuing 8: Fire Power +2 (33 spent) → `canRemove(Incineration)` true.
10. Prereq arrow rule: build of 7 with Critical Mass ×2 only (and Fire Power ×2 to keep 30 below tier 7) → `canAdd(Combustion)` false, and unmetRequirements = prereq "Critical Mass", 3.
11. Full `MAGE_51` (6.3) via `spend` in table order → spent 51. `pointsBySpec` = [0,33,18]. `canAdd` false for every node. `nodeState(Wand Specialization 105815)` "locked". `nodeState(Frostbite 105774)` "maxed". `validate` = [].
12. `resetSpec(MAGE_51, 1)` → `pointsBySpec` [0,0,18]. `resetAll` → {}.
13. Removing a partial point: Incineration 3 → `removePoint` → 2. Removing the last point deletes the key (`2 in ranks` is false after removing 1 → 0).

Q21 anomalies:

14. Priest Holy: Holy Specialization 105865 ×5 → `canAdd(Spell Warding 105864)` false. Its gate requirement has `counted 0` and `excludedInvested [105865]`.
15. Then Twilight Focus 105867 ×3 and Improved Renew 105866 ×2 → `canAdd(Spell Warding)` true. Add 1. Then `canRemove(Holy Specialization)` **true** and `canRemove(Improved Renew)` false.
16. Hunter MM: Hawk Eye 105013 ×3, Improved Concussive Shot 105012 ×5, Lethal Attacks 105011 ×5, Efficiency 105009 ×2 (15) → `canAdd(Improved Serpent Sting 105003)` true. Add ×5 (20 spent) → `canAdd(Barrage 105001)` false (counted 15).
17. Continue: Efficiency +3, Careful Aim 105008 ×1 (24 spent, counted 19) → `canAdd(Barrage)` false. Careful Aim +1 (25 spent, counted 20) → true.

Q28 (same-tier gate members):

18. Priest Discipline: Wand Specialization 105850 ×2, Twin Disciplines 105849 ×5, Silent Resolve 105848 ×3 (10) → `canAdd(Improved Power Word: Shield 105846)` true. Add ×3. `canRemove(Silent Resolve)` **false** (with the raw scope it would be allowed: 9 + 3 ≥ 10).

Horizontal prerequisite:

19. Priest Shadow: Blackout 105832 ×5, Spirit Tap 105833 ×5 → `canAdd(Improved Mind Flay 105825)` false with unmet prereq "Mind Flay", 1. Add Mind Flay 105826 → true. Add IMF. `canRemove(Mind Flay)` false.

Validation and sanitize:

20. `validate(MAGE_51, level 59)` → exactly `[{kind:"overBudget", spent:51, available:50}]`. With level 59: `canAdd` false everywhere, and `canRemove(Frostbite)` true.
21. `validate({105786: 1})` (Heating Up alone) → gate violation (required 15, counted 0) **and** prereq violation (Pyroblast).
22. `validate({999999: 1})` → unknownNode. `validate({105796: 6})` → rankOutOfRange.
23. `sanitize(MAGE_51)` → identical ranks, `dropped` false. `sanitize({...MAGE_51, 105796: 9})` → Incineration 5, `dropped` true.
24. `sanitize({105786: 1, 999999: 2})` → `{}`, `dropped` true.
25. `sanitize` of a build with 60 points (MAGE_51 + Arcane Wand Specialization 2, Improved Channeling 5, Arcane Resilience 2) → total exactly 51 (earlier specs in `order` win: Arcane is spec 0, so Frost loses points), `dropped` true.
26. Property test: a seeded LCG (`x = (x * 1103515245 + 12345) % 2**31`, seed 42) picks random nodes and calls `addPoint` 500 times on each of the 9 classes. Every intermediate build has `validate` = []. Random `removePoint` calls never produce a build with violations. `sanitize(b).ranks` deep-equals `b`.

### 9.4 `src/state/buildCode.test.ts`

1. `encodeBuild(MAGE_51)` === `#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N`.
2. `decodeBuild` of that string → ok, `classToken` "mage", level 60, talentedRank 0, ranks deep-equal MAGE_51.
3. Same with talentedRank 5 → the string starts with `#v1.mage.60.5.` and round-trips.
4. Empty ranks → `#v1.mage.60.0`. Decoding it gives empty ranks. Decoding `#v1.mage.60.0.` (trailing dot) is also ok.
5. Errors: `""` and `"#"` → "empty". `#v2.mage.60.0` → "version". `#v1.foo.60.0` → "class". `#v1.mage.0.0`, `#v1.mage.61.0`, `#v1.mage.6x.0` → "level". `#v1.mage.60.6` → "perk". `#v1.mage.60.0.***` → "payload". A truncated varint (`bytesToBase64Url([0x80])`) → "payload". A value with rank 0 (`bytesToBase64Url([0x08])` = `CA`, i.e. delta 1 rank 0) → "payload". `#v1.mage` (2 parts) and `#v1.mage.60.0.pdQz.x` (6 parts) → "payload". Extra vectors: `{105796: 5}` → payload `pdQz`, `{105786: 1}` → payload `0dMz`, `[0x80]` → `gA`.
6. `encodeBuild` with a rank of 8 throws.
7. base64url: round-trip for every byte length 0..40 with random bytes (seeded). `base64UrlToBytes("a")` → null. `base64UrlToBytes("ab+/")` → null.
8. The round-trip property over the random builds from rules test 26 (all 9 classes).

### 9.5 UI unit tests (Vitest, node environment)

- `geometry.test.ts`: `nodeBox(1,0)` = {left 34, top 24}. `nodeBox(7,3)` = {left 226, top 384}. The two golden arrows from 8.4. An L-shaped case: (1,0)→(2,1) gives `M 74 44 H 118 V 76`, head `111,76 125,76 118,84`.
- `wowText.test.ts`: the example from 8.7. Plain text → one segment. An unterminated `|cffffffffABC` → one white segment "ABC". A stray `|r` is removed. `$s1` is kept.
- `tooltipModel.test.ts`: fresh Mage, Ignite → name "Ignite", rankLine "Rank 0/5", requirements ["Requires 5 points in Fire Talents"], current = Ignite rank-1 text ("…additional 8% of your spell's damage over 4 sec."), next null, learnHint false. After Incineration ×5 and Ignite ×2 → rankLine "Rank 2/5", requirements [], current mentions 16%, next mentions 24%, learnHint true. Heating Up at 11 points (test 4) → requirements ["Requires 15 points in Fire Talents", "Requires 1 point in Pyroblast"]. Priest Holy test 14 → gateNote "Points in Holy Specialization do not count toward this requirement."

### 9.6 Playwright (`e2e/`)

`helpers.ts`:
- `blockRemoteImages(page)`: `page.route(/render\.worldofwarcraft\.com|zamimg\.com/, r => r.abort())`. Every test calls it first, so tests never depend on the network (icons fall back to the placeholder).
- `node(page, name)`: `page.getByRole("button", { name: new RegExp("^" + escape(name) + ",") })`.
- Expected node counts per class/spec, read with `fs` from `data/generated/1.60.1.70888/talents/*.json`.

`smoke.spec.ts` (desktop project):
1. **load**: `goto("./")` → title "WoW Forever Talent Calculator". 9 class buttons. Text "Choose a class to start.". No console errors (collect `page.on("console")` errors and `pageerror`, and assert none at the end of every test).
2. **all 27 specs render**: for each class, click its button, then `tree-0..2` are visible, and `[data-node-id]` inside each tree matches the data count.
3. **spend points**: Mage → Incineration ×5 → its rank badge "5/5", `data-state="maxed"`, points-by-spec "0/5/0", points-left "Points left: 46", required-level "Required level: 14". Ignite `data-state="available"`. Right-click Incineration → "4/5" and Ignite "locked". Shift+click Incineration → "3/5".
4. **remove blocked**: Incineration ×5, Ignite ×1 → right-click Incineration → still "5/5".
5. **URL round-trip**: after test 3's clicks, `page.url()` matches `/#v1\.mage\.60\.0\.[A-Za-z0-9_-]+$/`. Open a new page with that URL → same badge texts and summary.
6. **golden link**: `goto("./#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N")` → "0/33/18", "Points left: 0", "Required level: 60", Combustion "1/1". Toggle Talented → "Required level: 55", URL now contains `.60.5.`.
7. **tooltip**: Mage, hover Ignite → `role=tooltip` contains "Ignite", "Rank 0/5", "Requires 5 points in Fire Talents" (computed color `rgb(255, 25, 25)`). Spend 5 Incineration, hover Ignite → no "Requires" text, and "Click to learn" is visible. Hover Impact after 1 point (Incineration ×5, Impact ×1) → "Next rank:" visible.
8. **reset**: golden link → "Reset Fire" → "0/0/18". "Reset all" → "0/0/0" and the URL is `#v1.mage.60.0`.
9. **keyboard**: Mage → focus Incineration (`.focus()`), press `+` 3 times → "3/5". Press `-` → "2/5". `ArrowRight` moves focus to Accelerant.
10. **icon fallback**: without `blockRemoteImages`, route render.worldofwarcraft.com → `fulfill({ status: 404 })` and zamimg → `fulfill` a 1×1 PNG (`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=`, content-type image/png). The Incineration `img` src ends up containing `wow.zamimg.com`. Abort both → `.placeholder` visible.
11. **bad link**: `goto("./#v1.mage.60.0.***")` → notice text contains "could not be read". `goto("./#v1.mage.60.0.0dMz")` (Heating Up alone) → notice "were not valid and were removed", "0/0/0".

`mobile.spec.ts` (Pixel 5 project):
1. Mage → a tablist with 3 tabs. Only `tree-0` is visible. Tap the "Fire" tab → `tree-1` visible. Tap Incineration → "1/5". Long-press (dispatch `pointerdown`, wait 600 ms, `pointerup` with `pointerType: "touch"`) → "0/5".

---

## 10. GitHub workflows

### 10.1 `.github/workflows/deploy.yml`

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Notes for the owner (also in README): it runs only on pushes to `main` (or a manual run). The repository currently has
only the `claude/…` branch, so create `main` / merge into it. The owner must enable Pages once: *Settings → Pages →
Build and deployment → Source: GitHub Actions*. The site is then served at `https://<owner>.github.io/talentcalc/`.
If the repository is renamed, change `base` in `vite.config.ts`.

### 10.2 `.github/workflows/ci.yml` (pull requests and feature branches)

```yaml
name: CI

on:
  pull_request:
  push:
    branches-ignore: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: npm ci
      - run: npm run format:check
      - run: npm run lint
      - run: npm test
      - run: python3 -m unittest discover -s tools/pipeline/tests -t tools -v   # raw-data tests skip in CI
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
        env:
          CI: "true"
```

---

## 11. Ordered task list

Do one task per commit (or a small group), with the acceptance check passing before moving on. Commit messages follow the
repo style (imperative, short). Do not push to `main`.

| # | Task | Acceptance check |
|---|---|---|
| T1 | Scaffold (section 2): package.json, lock, tsconfigs, vite/eslint/prettier/playwright configs, .nvmrc, .gitignore, index.html, a minimal `src/main.tsx` + `App.tsx` that renders the title | `npm ci && npm run typecheck && npm run lint && npm run build` succeed. `npm run preview` serves `/talentcalc/` |
| T2 | Pipeline perk addition + test + regenerate (section 3) | Pipeline unittest OK (43). The `git diff --stat` matches 3.3 |
| T3 | `src/data/types.ts`, `index.ts`, `assets.ts`, `data.test.ts` (9.1) | `npm test` green. `vite build` shows 9 per-class chunks (~30–40 KB each) and no `spells` chunk |
| T4 | Engine: `constants.ts`, `tree.ts`, `points.ts`, `rules.ts`, `index.ts`, plus `src/testkit/talents.ts` and tests 9.2, 9.3 | All engine tests green. ESLint engine import restriction passes |
| T5 | `buildCode.ts` + tests 9.4 | Golden vector exact. All decode-error cases pass |
| T6 | `store.ts` + `urlSync.ts` | `store.test.ts` (node env, `useCalc.getState()` calls, no React): `selectClass("mage")` → status ready, 3 specs. `applyBuildCode(decode(golden))` → pointsBySpec 0/33/18. A bad code sets a notice |
| T7 | `geometry.ts`, `wowText.ts`, `tooltipModel.ts` + tests 9.5 | Tests green |
| T8 | UI: `tokens.css`, `global.css`, `WowIcon`, `ClassPicker`, `PointsSummary`, `TalentTree`, `TalentNode`, `PrereqArrows`, `TalentTooltip`, `TalentCalculator` (desktop) | Manual check in `npm run dev`: Mage Fire looks like the Classic tree (background art, arrows, badges, colors). Golden link renders 0/33/18 |
| T9 | Interaction details: right-click, shift-click, long-press, keyboard and arrow navigation, aria-live, copy link, notices | Manual keyboard-only walkthrough. No console errors |
| T10 | Mobile tabs + swipe (8.11) | Chrome devtools Pixel 5: tabs work. No horizontal page scroll at 360 px |
| T11 | Playwright tests (9.6) | `npm run e2e` green on both projects |
| T12 | Workflows (section 10) | Files match 10.1/10.2 exactly. `python3 -c "import yaml"` may be missing, so check by eye. They run only after a push to GitHub |
| T13 | Docs (section 12) | All items in section 12 done. PLAN Phase 2 boxes ticked |

---

## 12. Documentation updates (task T13)

- **docs/PLAN.md**: Phase 2 status ✅ (or 🟨 if any item is open). Tick every Phase 2 checkbox. Add lines:
  `- [x] Talented Legacy perk toggle (sources from TraitCurrencySource; affects required level at 60)`,
  `- [x] Pipeline: perk metadata on talent currency sources`. Update the "Output" line of the phase tracker exit criteria if needed.
- **docs/ARCHITECTURE.md**:
  - Stack table: Zustand **5**. Add "Data loading" row: `@data` alias → `data/generated/<build>`, classes/manifest static, talents lazy per class, spells not loaded in the talent UI.
  - Generated data contracts: `classes.json` sources may carry `perk {nodeId, entryId, rank, spellId, name}`.
  - New section "Build URL format" (copy section 6.1).
  - New paragraph "Tree backgrounds" (zamimg classic art by talentTabId, CSS gradient fallback, `REMOTE_BACKGROUNDS`).
  - Mention that gate counting uses `countedNodeIds` filtered to lower tiers (Q28).
- **docs/DATA_SOURCES.md**: under "Talent points", add the Talented perk facts (node 110298, spell 1225474, entries ↔ ranks, cap 51 via `SourcedMax`).
- **docs/OPEN_QUESTIONS.md**: add Q28–Q32 from section 13. Update Q21 ("Engine honors the data. In-game check still pending").
  Update Q22 with the finding that the perk does not change the points at level 60.
- **README.md**: status line (Phase 2). Section "Web app": `npm ci`, `npm run dev` (open http://localhost:5173/talentcalc/),
  `npm test`, `npm run e2e:install && npm run e2e`, `npm run build && npm run preview`, and the Pages setup note from 10.1.
- **CLAUDE.md** Commands: add `npm ci`, `npm run dev`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run e2e`, `npm run build`.
  Conventions: "Data build for the app is set in `vite.config.ts` (`DATA_BUILD`) and `tsconfig.app.json` paths". "Talent rules live
  in `src/engine/talents` (pure). The UI never re-implements a rule".
- **tools/pipeline/README.md**: no change needed (the commands are unchanged).

---

## 13. Remaining uncertainties (add Q28–Q32 to OPEN_QUESTIONS.md)

| # | Question | Plan's choice |
|---|---|---|
| Q28 | The scope group of every tier-7 gate (all 27 specs) and of Discipline's tier-3 gate contains the gated node itself. Does the game count a node's own points (or same-tier points) toward its gate? If yes, a player could refund a lower-tier point after taking the capstone (29 + 1 = 30) | Count only lower-tier members (`GATE_COUNTS_LOWER_TIERS_ONLY = true`, `[VERIFY]`). In-game test: with exactly 30 in tiers 1–6 plus the capstone, try to refund a tier-1 point |
| Q29 | Talented perk: is owning rank R cumulative (levels 10−R..9 all grant a point)? The node is Type 1 (choice-like) with 5 entries | Assume cumulative. The UI toggle = rank 5. The URL keeps a 0..5 digit for the future |
| Q30 | Is hotlinking Wowhead's CDN (backgrounds, icon fallback) acceptable long term, and are Classic backgrounds the same art Forever uses? Blizzard's render CDN has no talent backgrounds (403) | Hotlink with the gradient fallback. `REMOTE_BACKGROUNDS` turns it off in one place. Revisit before any public launch |
| Q31 | Classic display details: does a partially-ranked talent stay green when no points are left? Does in-game Forever show `x/y` or only `x`? | Partial stays green. Always show `x/y` (owner request) |
| Q32 | Ability talents (Pyroblast, Combustion, …) show cost/cast time/cooldown lines in Classic tooltips. That data is in `spells.json` (2.4 MB), which Phase 2 does not load | Not shown in Phase 2. Possible pipeline follow-up: add `cost`, `castMs`, `cooldownMs`, `range` to ability talents in `talents/*.json` |

Other notes:
- Q21 is honored as the data says. If the in-game check shows the anomalies are cosmetic, fix it in the pipeline (`tierGates`), not in the engine.
- Descriptions with unresolved tokens (for example Death Mark) render verbatim (Q27). That is accepted for Phase 2.
- Icons: 371/371 names resolve today. New Forever-only icons may be missing later, and the placeholder covers that.
  `tools/pipeline/check_icons.py` stays the audit tool.
- Viewports narrower than ~332 px scroll horizontally (tree panels are a fixed 300 px).
