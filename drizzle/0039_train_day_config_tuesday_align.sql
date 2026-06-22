-- After 0037 shifted train_week_schedules.week_start Mon→Tue, day configs may still
-- span the old Mon–Sun range. Shift +1 day when the earliest config is one day before week_start.
WITH lagging_weeks AS (
  SELECT ws.id AS week_schedule_id
  FROM train_week_schedules AS ws
  WHERE EXTRACT(DOW FROM ws.week_start::date) = 2
    AND EXISTS (
      SELECT 1
      FROM train_day_configs AS d2
      WHERE d2.week_schedule_id = ws.id
      GROUP BY d2.week_schedule_id
      HAVING MIN(d2.date::date) = (ws.week_start::date - interval '1 day')::date
    )
),
ordered AS (
  SELECT
    dc.id,
    to_char((dc.date::date + interval '1 day'), 'YYYY-MM-DD') AS new_date
  FROM train_day_configs AS dc
  INNER JOIN lagging_weeks AS lw ON dc.week_schedule_id = lw.week_schedule_id
  ORDER BY dc.date::date DESC
)
UPDATE train_day_configs AS dc
SET date = ordered.new_date
FROM ordered
WHERE dc.id = ordered.id
  AND NOT EXISTS (
    SELECT 1
    FROM train_day_configs AS dup
    WHERE dup.alliance_id = dc.alliance_id
      AND dup.date = ordered.new_date
      AND dup.id <> dc.id
  );
