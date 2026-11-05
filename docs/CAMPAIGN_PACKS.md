# Campaign packs (.zip)

A campaign pack is a `.zip` that creates a brand-new, ready-to-run campaign: scenes with maps
and tokens, NPC/monster sheets (with inventory for chests), journal entries, encounters and
random tables. Import it from the Dashboard with **Import campaign (.zip)**
(`POST /api/campaigns/import`). The importer becomes the DM; no players are added.

## Layout

```
campaign.json          (at the root, or inside one top-level folder)
maps/…, tokens/…       any images that campaign.json names in `assets`
```

Limits: 300 MB per pack, 400 files, 30 MB per file. Map images follow the normal upload rules
(PNG/JPEG/WebP/GIF, at most 16384 px per side). Zip64 and encrypted zips are refused.

## campaign.json

The schema lives in `apps/server/src/packs/schema.ts`. A short example:

```json
{
  "format": "vtt-campaign-pack",
  "version": 1,
  "campaign": { "name": "Frozen Sick", "description": "…", "houseRules": "" },
  "assets": [{ "id": "cave", "file": "maps/cave.webp", "kind": "map" }],
  "statBlocks": [
    { "id": "goblin", "kind": "monster", "name": "Goblin",
      "monster": { "ac": 15, "hp": 7, "abilities": { "str": 8, "dex": 14, "con": 10, "int": 10, "wis": 8, "cha": 8 },
                   "cr": "1/4", "xp": 50, "actions": [{ "name": "Scimitar", "attackBonus": 4, "damage": "1d6+2", "damageType": "slashing" }] } },
    { "id": "chest", "kind": "npc", "name": "Chest", "monster": { "ac": 11, "hp": 10, "abilities": { "str": 10, "dex": 10, "con": 10, "int": 1, "wis": 1, "cha": 1 } },
      "inventory": [{ "name": "Potion of Healing", "quantity": 2 }], "currency": { "gp": 25 } }
  ],
  "scenes": [
    { "name": "Cave", "map": "cave", "grid": { "size": 200 }, "fogEnabled": true,
      "tokens": [
        { "name": "Goblin 1", "statBlock": "goblin", "cell": [4, 7], "hidden": true },
        { "name": "Chest", "statBlock": "chest", "linked": true, "cell": [10, 2], "layer": "objects", "shape": "square" }
      ] },
    { "name": "Ship (no map yet)", "cols": 16, "rows": 40 }
  ],
  "journal": [{ "title": "Read-aloud: arrival", "body": "> Snow falls…", "folder": "Part 1" }],
  "encounters": [{ "name": "Ambush", "entries": [{ "statBlock": "goblin", "count": 3 }] }],
  "tables": [{ "name": "Weather", "formula": "1d4", "entries": [{ "min": 1, "max": 4, "text": "Snow" }] }]
}
```

Notes:

- Ids (`id`, `map`, `statBlock`, `image`) are labels inside the pack; every row gets a fresh id.
- `cell` is the token's top-left grid cell, 0-based `[column, row]`, measured from the grid offset.
- `linked: true` makes the token *be* the sheet (shared HP, inventory the DM can hand out with
  "give item"). Unlinked tokens get their own HP and point at the sheet as a stat block.
- Without a map, a scene is a blank grid of `cols × rows` cells.
- Every reference is checked before anything is written; a bad pack creates nothing.
