-- F8: generic live-state ability scores are legal D&D values, including the
-- one-time bootstrap character. Existing campaigns retain their chosen rows;
-- only the historical all-zero bootstrap placeholder is repaired.
UPDATE character
SET ability_scores_json =
  '{"strength":10,"dexterity":10,"constitution":10,"intelligence":10,"wisdom":10,"charisma":10}'
WHERE id = 'pc-1'
  AND ability_scores_json =
    '{"strength":0,"dexterity":0,"constitution":0,"intelligence":0,"wisdom":0,"charisma":0}';
