#!/usr/bin/env bash
# Downloads the WoW Forever (product "wowf") DB2 tables the talent calculator needs
# from wago.tools as CSV. Usage: tools/research/fetch_db2.sh [BUILD] [OUT_DIR]
# Find the latest build: curl -s https://wago.tools/api/builds | jq -r '.wowf[0].version'
set -euo pipefail
BUILD="${1:-1.60.1.70888}"
OUT="${2:-data/raw/$BUILD}"
mkdir -p "$OUT"
TABLES=(
  # Talent system (Forever uses retail-style Trait* tables, NOT the legacy Talent table)
  TraitTree TraitNode TraitNodeEntry TraitDefinition TraitNodeXTraitNodeEntry
  TraitNodeGroup TraitNodeGroupXTraitNode TraitNodeGroupXTraitCond TraitCond TraitEdge
  TraitCurrency TraitCurrencySource TraitCost TraitTreeXTraitCurrency TraitTreeXTraitCost
  TraitDefinitionEffectPoints SkillLineXTraitTree
  # Legacy talent tables (kept for comparison with Classic Era)
  Talent TalentTab
  # Spells
  SpellName Spell SpellEffect SpellMisc SpellLevels SpellClassOptions SpellCooldowns
  SpellPower SpellCastTimes SpellDuration SpellRange SpellCategories SpellAuraOptions
  SpellCategory SpellInterrupts SpellAuraRestrictions SpellShapeshift SpellProcsPerMinute
  SpellProcsPerMinuteMod SpellItemEnchantment SkillLineAbility SkillLine ChrClasses ChrRaces
  # Items / weapons
  ItemSparse Item ItemDamageOneHand ItemDamageTwoHand ItemDamageOneHandCaster
  ItemDamageTwoHandCaster ItemDamageAmmo ItemArmorQuality ItemArmorShield ItemArmorTotal
  # Pets
  CreatureFamily
  # Scaling curves referenced by TraitDefinitionEffectPoints
  Curve CurvePoint
)
for t in "${TABLES[@]}"; do
  code=$(curl -s --max-time 300 -o "$OUT/$t.csv" -w '%{http_code}' \
    "https://wago.tools/db2/$t/csv?build=$BUILD")
  if [[ "$code" != 200 ]]; then echo "WARN $t -> HTTP $code (table absent in this build?)"; rm -f "$OUT/$t.csv"; continue; fi
  echo "ok  $t ($(($(wc -l < "$OUT/$t.csv") - 1)) rows)"
done
