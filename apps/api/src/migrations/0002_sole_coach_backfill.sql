-- Organizations that already had a single coach when responsibilities were introduced get the
-- responsibilities that coach would have been given automatically.
INSERT INTO "athlete_coaches" ("organization_id", "athlete_id", "coach_id")
SELECT "athlete"."organization_id", "athlete"."account_id", "sole_coach"."account_id"
FROM "organization_membership_roles" AS "athlete"
INNER JOIN (
	SELECT "organization_id", (array_agg("account_id"))[1] AS "account_id"
	FROM "organization_membership_roles"
	WHERE "role" = 'coach'
	GROUP BY "organization_id"
	HAVING count(*) = 1
) AS "sole_coach" ON "sole_coach"."organization_id" = "athlete"."organization_id"
WHERE "athlete"."role" = 'athlete'
ON CONFLICT DO NOTHING;
