-- ============================================================
-- Fix recommendation_settings weights: the previous migration's
-- "rebalance" arithmetic was wrong (0.30+0.17+0.13+0.09+0.09+0.04+0.04
-- +0.13+0.15 = 1.14, not 1.0). final_score is clamped via LEAST(1, ...)
-- so nothing broke, but scores land on the 1.0 ceiling far more often
-- than intended, flattening ranking among strong matches. Re-derive the
-- weights by scaling the original 7-component split (35/20/15/10/10/5/5)
-- down to fit alongside cold_start (10%) and semantic (15%), so all 9
-- components sum to exactly 1.0.
-- ============================================================

ALTER TABLE public.recommendation_settings
    ALTER COLUMN skill_weight SET DEFAULT 0.26,
    ALTER COLUMN location_weight SET DEFAULT 0.15,
    ALTER COLUMN salary_weight SET DEFAULT 0.11,
    ALTER COLUMN experience_weight SET DEFAULT 0.08,
    ALTER COLUMN freshness_weight SET DEFAULT 0.07,
    ALTER COLUMN boost_weight SET DEFAULT 0.04,
    ALTER COLUMN trending_weight SET DEFAULT 0.04,
    ALTER COLUMN cold_start_weight SET DEFAULT 0.10,
    ALTER COLUMN semantic_weight SET DEFAULT 0.15;

UPDATE public.recommendation_settings
SET
    skill_weight = 0.26,
    location_weight = 0.15,
    salary_weight = 0.11,
    experience_weight = 0.08,
    freshness_weight = 0.07,
    boost_weight = 0.04,
    trending_weight = 0.04,
    cold_start_weight = 0.10,
    semantic_weight = 0.15
WHERE id = 1;
