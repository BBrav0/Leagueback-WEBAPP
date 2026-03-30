ALTER TABLE public.player_matches
  ADD COLUMN role text,
  ADD COLUMN damage_to_champions integer;

UPDATE public.player_matches AS pm
SET
  role = CASE
    WHEN participant.team_position IS NULL OR upper(participant.team_position) = 'INVALID' THEN NULL
    ELSE upper(participant.team_position)
  END,
  damage_to_champions = CASE
    WHEN participant.total_damage_dealt_to_champions IS NULL OR participant.total_damage_dealt_to_champions < 0 THEN NULL
    ELSE participant.total_damage_dealt_to_champions
  END
FROM (
  SELECT
    mc.match_id,
    participant ->> 'puuid' AS puuid,
    participant ->> 'teamPosition' AS team_position,
    CASE
      WHEN jsonb_typeof(participant -> 'totalDamageDealtToChampions') = 'number'
      THEN (participant ->> 'totalDamageDealtToChampions')::integer
      ELSE NULL
    END AS total_damage_dealt_to_champions
  FROM public.match_cache AS mc
  CROSS JOIN LATERAL jsonb_array_elements(mc.match_data -> 'info' -> 'participants') AS participant
) AS participant
WHERE pm.match_id = participant.match_id
  AND pm.puuid = participant.puuid;
