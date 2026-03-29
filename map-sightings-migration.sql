-- Map sightings table for the 3D globe
CREATE TABLE IF NOT EXISTS map_sightings (
  id BIGSERIAL PRIMARY KEY,
  nuforc_id TEXT UNIQUE,
  title TEXT,
  description TEXT,
  location TEXT,
  city TEXT,
  state TEXT,
  country TEXT DEFAULT 'USA',
  lat DECIMAL(9,6),
  lng DECIMAL(9,6),
  shape TEXT,
  sighted_date DATE,
  reported_date DATE,
  source TEXT DEFAULT 'NUFORC',
  source_url TEXT,
  is_credible BOOLEAN DEFAULT false,
  dot_color TEXT DEFAULT 'red',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast map queries
CREATE INDEX IF NOT EXISTS map_sightings_sighted_date_idx ON map_sightings(sighted_date DESC);
CREATE INDEX IF NOT EXISTS map_sightings_dot_color_idx ON map_sightings(dot_color);
CREATE INDEX IF NOT EXISTS map_sightings_lat_lng_idx ON map_sightings(lat, lng);

-- Allow public read access
ALTER TABLE map_sightings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read map_sightings" ON map_sightings FOR SELECT USING (true);
CREATE POLICY "Service insert map_sightings" ON map_sightings FOR INSERT WITH CHECK (true);
