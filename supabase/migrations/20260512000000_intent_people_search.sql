-- Intent-based people search for agent-facing recommendations.
-- Returns candidate profiles for a free-form user intent while keeping contact
-- details and raw device IDs out of tool responses at the client wrapper layer.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS embedding vector(768);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS quality_score float;

CREATE INDEX IF NOT EXISTS idx_profiles_embedding
  ON profiles USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE OR REPLACE FUNCTION antenna_jsonb_or_null(p_text text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN NULL;
  END IF;

  RETURN p_text::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION antenna_intent_search_people(
  p_device_id text,
  p_query text,
  p_query_embedding text DEFAULT NULL,
  p_limit int DEFAULT 3
)
RETURNS TABLE (
  device_id text,
  display_name text,
  profile_slug text,
  personal_description text,
  looking_for text,
  conversation_style text,
  more_information text,
  interest_tags text[],
  city text,
  match_score float,
  recommendation_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_query_embedding vector(768);
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 3), 1), 3);
BEGIN
  IF p_query IS NULL OR length(btrim(p_query)) < 2 THEN
    RETURN;
  END IF;

  IF p_query_embedding IS NOT NULL AND btrim(p_query_embedding) <> '' THEN
    BEGIN
      v_query_embedding := p_query_embedding::vector(768);
    EXCEPTION WHEN others THEN
      v_query_embedding := NULL;
    END;
  END IF;

  RETURN QUERY
  WITH candidate_profiles AS (
    SELECT
      p.*,
      antenna_jsonb_or_null(p.matching_context) AS ctx,
      concat_ws(
        ' ',
        p.display_name,
        p.line1,
        p.line2,
        p.line3,
        p.matching_context
      ) AS search_text
    FROM profiles p
    WHERE p.visible = true
      AND p.device_id <> p_device_id
      AND COALESCE(NOT (
        antenna_jsonb_or_null(p.matching_context) ? 'isActive'
        AND lower(antenna_jsonb_or_null(p.matching_context)->>'isActive') = 'false'
      ), true)
      AND length(concat_ws('', p.line1, p.line2, p.line3, p.matching_context)) >= 10
      AND NOT EXISTS (
        SELECT 1
        FROM matches m
        WHERE m.status IN ('accepted', 'pending')
          AND (
            (m.device_id_a = p_device_id AND m.device_id_b = p.device_id)
            OR (m.device_id_a = p.device_id AND m.device_id_b = p_device_id)
          )
      )
  ),
  scored AS (
    SELECT
      c.*,
      CASE
        WHEN v_query_embedding IS NOT NULL AND c.embedding IS NOT NULL
          THEN GREATEST(0, 1 - (c.embedding <=> v_query_embedding))
        ELSE 0
      END AS semantic_score,
      ts_rank_cd(
        to_tsvector('simple', c.search_text),
        plainto_tsquery('simple', p_query)
      ) AS text_score,
      COALESCE(c.quality_score, 0.5) AS profile_quality
    FROM candidate_profiles c
  )
  SELECT
    s.device_id,
    s.display_name,
    s.profile_slug,
    s.line1 AS personal_description,
    s.line2 AS looking_for,
    s.line3 AS conversation_style,
    COALESCE(s.ctx->>'context', s.matching_context) AS more_information,
    CASE
      WHEN jsonb_typeof(s.ctx->'interestTags') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(s.ctx->'interestTags'))
      ELSE ARRAY[]::text[]
    END AS interest_tags,
    s.ctx->>'city' AS city,
    (
      (s.semantic_score * 0.72)
      + (LEAST(s.text_score, 1) * 0.18)
      + (LEAST(GREATEST(s.profile_quality, 0), 1) * 0.10)
    )::float AS match_score,
    CASE
      WHEN s.semantic_score > 0.60 THEN 'Semantic match to the user intent.'
      WHEN s.text_score > 0 THEN 'Profile text overlaps with the user intent.'
      ELSE 'Relevant active profile with enough context for the agent to judge.'
    END AS recommendation_reason
  FROM scored s
  WHERE s.semantic_score > 0
     OR s.text_score > 0
     OR v_query_embedding IS NULL
  ORDER BY
    ((s.semantic_score * 0.72)
      + (LEAST(s.text_score, 1) * 0.18)
      + (LEAST(GREATEST(s.profile_quality, 0), 1) * 0.10)) DESC,
    s.last_seen_at DESC NULLS LAST
  LIMIT v_limit;
END;
$$;
