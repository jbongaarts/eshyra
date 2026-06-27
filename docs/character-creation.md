# Character Creation and Import

Character creation is the only MVP path for producing a player character. The
flow is agent-guided, but final legality is enforced by deterministic core
validation before any canonical state write is accepted.

The accepted output is a canonical `character` row plus related canonical tables
such as `inventory` when starting equipment is added. `completeCharacterCreation`
takes an optional `characterId` (defaulting to `pc-1`) so a campaign can hold
more than one player character, and it sets the created PC as the active
character. Character creation does not own a second sheet model. It emits
`mutate_state`-compatible writes so the same persistence and provenance rules
apply to created characters, DM-authored corrections, and future import output.
See `docs/multi-pc-design.md` for the party model and
`docs/design/character-progression.md` for the post-creation progression and
leveling model.

## MVP Creation Contract

The agent may propose or ask the player about choices such as name, ancestry,
class, ability score method, hit points, equipment, and spells. The
deterministic character-creation validator is responsible for rejecting
illegal combinations and surfacing errors back to the agent.

`completeCharacterCreation` is system-aware: it reads the campaign rules
binding (defaulting to D&D 5e SRD when no binding row exists) and dispatches
by `base.systemId`. The bundled validators cover:

- **D&D 5e SRD** (`dnd5e-srd`) — full existing behavior. Validates the level-1
  SRD character draft: class (Fighter), ancestry (Human), point-buy or
  standard-array ability scores, level-1 hit points derived from the class hit
  die plus Constitution modifier, and spell legality against the selected class.
- **Pathfinder 2e Remaster** (`pathfinder2e-remaster`) — broad level-1 draft
  backed by the bundled ORC fixture. Validates ancestry (Human), background
  (Acolyte), class (Fighter), ability scores within level-1 bounds with a
  generous total range, class feat and ancestry feat (trait-matched against
  the selected class/ancestry), starting equipment, spells (rejected for
  non-caster classes), and HP equal to ancestry + class/level + Con modifier.
  The data structures are open to later advancement, but only level 1 is
  currently accepted.

When validation succeeds, the flow writes the accepted sheet into canonical
state through `mutate_state`. Both validators project into the same canonical
`character` row (`name`, `ancestry`, `class_name`, `level`, `hp_current`,
`hp_max`, `ability_scores_json`) — system-specific detail (e.g. Pathfinder
background, feats, equipment) is summarized in the completion prompt for now.
If validation fails, the flow returns the validation errors to the agent for a
player-facing correction turn rather than partially persisting the sheet.

## Deferred Import Contract

Character import is explicitly out of MVP scope. Deferred sources include:

- D&D Beyond exports or scraping.
- OCR from scanned or photographed paper sheets.
- Virtual tabletop exports.
- User-authored ad hoc JSON or spreadsheet sheets.

Future importers must be pure mappers into the single canonical schema. They may
parse source-specific formats, normalize names, and surface validation errors,
but they must not create a parallel character model or source-specific gameplay
schema. The convergence target remains the canonical E3 `character` row and
related canonical state tables, with provenance identifying the importer and
source artifact.
