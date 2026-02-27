-- Create scanner gate event logging table
CREATE TABLE IF NOT EXISTS scanner_gate_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  gate text NOT NULL,
  ticker text,
  reason text,
  edge numeric,
  score numeric,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scanner_gate_events_created_at ON scanner_gate_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scanner_gate_events_gate ON scanner_gate_events(gate);
