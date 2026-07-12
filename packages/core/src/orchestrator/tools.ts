/**
 * Deterministic tool layer (E5). Tools are the only path the DM model has to
 * dice math and canon writes: narration is free, but anything mechanical goes
 * through a tool. Every tool returns a structured `ToolResult` — never throws
 * across the seam — so the orchestrator can feed errors back to the model and
 * keep the turn recoverable.
 *
 * This module assembles the default tool set from focused per-tool modules.
 * The provider-neutral registry contract lives in `toolRegistry.ts`.
 */

export type {
  JsonSchema,
  JsonSchemaType,
  ModelToolDefinition,
  ToolInputSchema,
} from '../model/toolSchema.js';
export type { MarkSceneToolData } from './toolMarkScene.js';
export { isMarkSceneToolData } from './toolMarkScene.js';
export type { Tool, ToolContext, ToolResult } from './toolRegistry.js';
export { ToolRegistry } from './toolRegistry.js';

import { addConditionTool } from './toolAddCondition.js';
import { adjustHpTool } from './toolAdjustHp.js';
import { attuneItemTool } from './toolAttuneItem.js';
import { awardInspirationTool } from './toolAwardInspiration.js';
import { beginTurnTool } from './toolBeginTurn.js';
import { calcTool } from './toolCalc.js';
import { closeCombatInstanceTool } from './toolCloseCombatInstance.js';
import { endAttunementTool } from './toolEndAttunement.js';
import { giveItemTool } from './toolGiveItem.js';
import { grantTempHpTool } from './toolGrantTempHp.js';
import { lookupRulesTool } from './toolLookupRules.js';
import { markSceneTool } from './toolMarkScene.js';
import { memoryDrilldownTool } from './toolMemoryDrilldown.js';
import { recordDeathSaveTool } from './toolRecordDeathSave.js';
import { recordWorldFactTool } from './toolRecordWorldFact.js';
import type { Tool } from './toolRegistry.js';
import { ToolRegistry } from './toolRegistry.js';
import { removeConditionTool } from './toolRemoveCondition.js';
import { removeItemTool } from './toolRemoveItem.js';
import { resetUsageTool } from './toolResetUsage.js';
import { resolveCheckTool } from './toolResolveCheck.js';
import { resolveContestTool } from './toolResolveContest.js';
import { resolveDamageTool } from './toolResolveDamage.js';
import { restoreUsageTool } from './toolRestoreUsage.js';
import { rollTool } from './toolRoll.js';
import { setPlotFlagTool } from './toolSetPlotFlag.js';
import { setSurprisedTool } from './toolSetSurprised.js';
import { setWorldFactTool } from './toolSetWorldFact.js';
import { spendSpellSlotTool } from './toolSpendSpellSlot.js';
import { spendTurnResourceTool } from './toolSpendTurnResource.js';
import { spendUsageTool } from './toolSpendUsage.js';
import { stabilizeCharacterTool } from './toolStabilizeCharacter.js';
import { startEncounterTool } from './toolStartEncounter.js';
import { updateClockTool } from './toolUpdateClock.js';
import { updateCombatantTool } from './toolUpdateCombatant.js';
import { useInspirationTool } from './toolUseInspiration.js';
import { worldQueryTool } from './toolWorldQuery.js';

export const DEFAULT_TOOLS: readonly Tool[] = [
  rollTool,
  resolveCheckTool,
  resolveContestTool,
  resolveDamageTool,
  calcTool,
  markSceneTool,
  lookupRulesTool,
  startEncounterTool,
  updateCombatantTool,
  closeCombatInstanceTool,
  beginTurnTool,
  spendTurnResourceTool,
  setSurprisedTool,
  adjustHpTool,
  recordDeathSaveTool,
  stabilizeCharacterTool,
  grantTempHpTool,
  addConditionTool,
  removeConditionTool,
  spendSpellSlotTool,
  spendUsageTool,
  restoreUsageTool,
  resetUsageTool,
  attuneItemTool,
  endAttunementTool,
  awardInspirationTool,
  useInspirationTool,
  giveItemTool,
  removeItemTool,
  updateClockTool,
  setPlotFlagTool,
  setWorldFactTool,
  recordWorldFactTool,
  worldQueryTool,
  memoryDrilldownTool,
];

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of DEFAULT_TOOLS) {
    registry.register(tool);
  }
  return registry;
}
